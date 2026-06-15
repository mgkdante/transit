from __future__ import annotations

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from transit_ops.settings import Settings


def require_database_url(settings: Settings) -> str:
    """Return a SQLAlchemy-compatible database URL or raise a clear error."""

    if not settings.sqlalchemy_database_url:
        raise ValueError("DATABASE_URL is required for database commands.")
    return settings.sqlalchemy_database_url


def make_engine(settings: Settings) -> Engine:
    """Create a SQLAlchemy engine for the configured Postgres database.

    TCP keepalives are set because the snapshot publishers hold one read
    connection open across a long, DB-idle network upload (static/historic
    fan out thousands of per-stop/per-route PUTs to R2 while the connection
    sits idle-in-transaction). Prod Postgres sets every idle/statement timeout
    to 0 and tcp_keepalives_idle=7200s, so no keepalive traffic flows for two
    hours — long enough for the OCI network path to silently drop the idle
    connection. The publish then fails on its FIRST post-upload statement
    (slice-r's snapshot_publish_state INSERT) with "SSL error: unexpected eof".
    Client keepalives keep packets flowing during the idle window so the
    firewall/NAT never reaps the connection. This matters most on cold-start
    and new-GTFS-edition days, when the hash-gate can't skip the upload.
    """

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
    """Run a minimal connectivity check against the configured database."""

    engine = make_engine(settings)
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
