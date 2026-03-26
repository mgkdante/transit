from __future__ import annotations

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from transit_ops.settings import Settings


def require_database_url(settings: Settings) -> str:
    """Return a SQLAlchemy-compatible database URL or raise a clear error."""

    if not settings.sqlalchemy_database_url:
        raise ValueError("NEON_DATABASE_URL is required for database commands.")
    return settings.sqlalchemy_database_url


def make_engine(settings: Settings) -> Engine:
    """Create a SQLAlchemy engine for Neon Postgres."""

    return create_engine(
        require_database_url(settings),
        pool_pre_ping=True,
    )


def test_connection(settings: Settings) -> None:
    """Run a minimal connectivity check against the configured database."""

    engine = make_engine(settings)
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
