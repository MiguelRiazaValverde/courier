defmodule Courier.RoomStore do
  use GenServer

  @table :rooms

  ## API pública

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, nil, name: __MODULE__)
  end

  def insert_or_validate(room_id, password) do
    GenServer.call(__MODULE__, {:insert_or_validate, room_id, password})
  end

  def delete(room_id) do
    GenServer.cast(__MODULE__, {:delete, room_id})
  end

  def list_rooms do
    GenServer.call(__MODULE__, :list_rooms)
  end

  def valid_password?(room_id, password) do
    GenServer.call(__MODULE__, {:valid_password?, room_id, password})
  end

  def insert_if_not_exists(room_id, password) do
    GenServer.call(__MODULE__, {:insert_if_not_exists, room_id, password})
  end

  def maybe_delete_if(room_id, fun) when is_function(fun, 1) do
    GenServer.call(__MODULE__, {:maybe_delete_if, room_id, fun})
  end

  ## Callbacks

  @impl true
  def init(_) do
    :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])
    {:ok, %{}}
  end

  @impl true
  def handle_call({:insert_or_validate, room_id, password}, _from, state) do
    reply =
      case :ets.lookup(@table, room_id) do
        [] ->
          :ets.insert_new(@table, {room_id, password})
          :ok

        [{^room_id, ^password}] ->
          :ok

        [{^room_id, _wrong_pass}] ->
          {:error, :invalid_password}
      end

    {:reply, reply, state}
  end

  def handle_call({:valid_password?, room_id, password}, _from, state) do
    result =
      case :ets.lookup(@table, room_id) do
        [{^room_id, ^password}] -> true
        _ -> false
      end

    {:reply, result, state}
  end

  def handle_call(:list_rooms, _from, state) do
    room_ids =
      :ets.tab2list(@table)
      |> Enum.map(fn {room_id, _} -> room_id end)

    {:reply, room_ids, state}
  end

  def handle_call({:insert_if_not_exists, room_id, password}, _from, state) do
    result =
      case :ets.insert_new(@table, {room_id, password}) do
        true -> {:ok}
        false -> {:error, :already_exists}
      end

    {:reply, result, state}
  end

  def handle_call({:maybe_delete_if, room_id, fun}, _from, state) do
    # Ejecutar la función dentro del GenServer para evitar condiciones de carrera
    delete? = fun.(room_id)

    if delete? do
      IO.puts("deleteeeeeeeeeeeee")
      :ets.delete(@table, room_id)
      {:reply, :deleted, state}
    else
      {:reply, :not_deleted, state}
    end
  end

  @impl true
  def handle_cast({:delete, room_id}, state) do
    :ets.delete(@table, room_id)
    {:noreply, state}
  end
end
