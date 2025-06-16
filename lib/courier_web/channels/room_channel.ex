defmodule CourierWeb.RoomChannel do
  use CourierWeb, :channel
  alias CourierWeb.Presence

  @adjectives ~w(bright silent clever bold lucky chilly spicy brave fuzzy sleepy wise eager shiny)
  @nouns ~w(fox panda comet cactus kiwi otter tiger dragon wolf cloud echo flame river pixel orbit)

  @impl true
  def join("room:" <> room_id, %{"pass" => pass}, socket) do
    username = get_username_from_socket(socket)
    Process.flag(:trap_exit, true)

    case Courier.RoomStore.insert_or_validate(room_id, pass) do
      :ok ->
        socket = assign(socket, :username, username)
        send(self(), {:after_join, username})
        {:ok, %{username: username}, socket}

      {:error, :invalid_password} ->
        {:error, %{reason: "invalid password"}}
    end
  end

  @impl true
  def handle_in("signal", %{"to" => to, "data" => data}, socket) do
    from = socket.assigns.username

    broadcast_from!(socket, "signal", %{
      from: from,
      to: to,
      data: data
    })

    {:noreply, socket}
  end

  @impl true
  def terminate({:shutdown, _reason}, socket) do
    maybe_cleanup(socket)
    :ok
  end

  @impl true
  def handle_info({:EXIT, _pid, _reason}, socket) do
    maybe_cleanup(socket)
    broadcast_from!(socket, "disconnect-user", %{username: socket.assigns.username})
    {:noreply, socket}
  end

  def handle_info({:after_join, username}, socket) do
    Presence.track(socket, username, %{})

    users =
      Presence.list(socket)
      |> Map.keys()
      |> Enum.reject(&(&1 == username))

    Enum.each(users, fn user ->
      push(socket, "connect-user", %{username: user})
    end)

    {:noreply, socket}
  end

  defp maybe_cleanup(socket) do
    topic = socket.topic
    "room:" <> room_id = topic

    # Comprobar si quedan usuarios en Presence
    Courier.RoomStore.maybe_delete_if(room_id, fn _ -> map_size(Presence.list(topic)) <= 1 end)
  end

  defp get_username_from_socket(socket) do
    Map.get(socket.assigns, :user_id) || generate_username()
  end

  defp generate_username do
    adj = Enum.random(@adjectives)
    noun = Enum.random(@nouns)
    num = :rand.uniform(9999)
    "#{adj}_#{noun}_#{num}"
  end
end
