from __future__ import annotations

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine

from transit_ops.settings import Settings

DAILY_WARM_STATEMENT_TIMEOUT = text("SET LOCAL statement_timeout = '30min'")
DAILY_WARM_LOCK_TIMEOUT = text("SET LOCAL lock_timeout = '30s'")


def set_daily_warm_transaction_timeouts(connection: Connection) -> None:

    connection.execute(DAILY_WARM_STATEMENT_TIMEOUT)
    connection.execute(DAILY_WARM_LOCK_TIMEOUT)


def require_database_url(settings: Settings) -> str:

    if not settings.sqlalchemy_database_url:
        raise ValueError("DATABASE_URL is required for database commands.")
    return settings.sqlalchemy_database_url


def make_engine(settings: Settings) -> Engine:

    return create_engine(
        require_database_url(settings),
        pool_pre_ping=True,
        connect_args={
            "keepalives": 1,
            "keepalives_idle": 20,
            "keepalives_interval": 10,
            "keepalives_count": 6,
        },
    )


def test_connection(settings: Settings) -> None:

    engine = make_engine(settings)
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
