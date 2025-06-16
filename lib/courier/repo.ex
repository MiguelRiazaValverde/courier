defmodule Courier.Repo do
  use Ecto.Repo,
    otp_app: :courier,
    adapter: Ecto.Adapters.SQLite3
end
