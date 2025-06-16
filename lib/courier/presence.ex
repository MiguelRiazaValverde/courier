defmodule CourierWeb.Presence do
  use Phoenix.Presence,
    otp_app: :courier,
    pubsub_server: Courier.PubSub
end
