from __future__ import annotations

import os
import re
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from datetime import UTC, datetime
from uuid import uuid4

from alembic import command
from alembic.config import Config
from psycopg import Connection
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.pool import NullPool

from transit_ops.db.target_safety import assert_disposable_test_url, resolve_database_target
from transit_ops.ingestion.common import project_root

CLOCK_SCHEMA = "transit_oracle_clock"
CLOCK_SETTING = "transit_oracle.now"


class OracleDatabaseRefused(RuntimeError):
    pass


class PinnedClock:
    def __init__(self, instant: datetime) -> None:
        self.set(instant)

    @property
    def instant(self) -> datetime:
        return self._instant

    def set(self, instant: datetime) -> None:
        if instant.utcoffset() is None:
            raise ValueError("Pinned clock requires an aware datetime")
        self._instant = instant.astimezone(UTC)


def _initialize(engine: Engine, database: str, admin: Engine, clock: PinnedClock) -> None:
    with engine.begin() as connection:
        connection.exec_driver_sql(f"CREATE SCHEMA {CLOCK_SCHEMA}")
        for name in ("now", "clock_timestamp", "statement_timestamp", "transaction_timestamp"):
            connection.exec_driver_sql(f"""
                CREATE FUNCTION {CLOCK_SCHEMA}.{name}() RETURNS timestamptz
                LANGUAGE sql STABLE AS $$
                    SELECT pg_catalog.current_setting('{CLOCK_SETTING}')::timestamptz
                $$
            """)
    with admin.connect() as connection:
        connection.exec_driver_sql(
            f"ALTER DATABASE {database} SET search_path = {CLOCK_SCHEMA}, pg_catalog, public"
        )
        connection.exec_driver_sql(f"ALTER DATABASE {database} SET timezone = 'UTC'")
        connection.exec_driver_sql(
            f"ALTER DATABASE {database} SET \"{CLOCK_SETTING}\" = '{clock.instant.isoformat()}'"
        )
    root = project_root()
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "src/transit_ops/db/migrations"))
    cfg.set_main_option(
        "sqlalchemy.url", engine.url.render_as_string(hide_password=False).replace("%", "%%")
    )
    command.upgrade(cfg, "head")


def _pin_connections(engine: Engine, clock: PinnedClock) -> None:
    @event.listens_for(engine, "connect")
    def configure(connection: Connection[tuple[object, ...]], _record: object) -> None:
        with connection.cursor() as cursor:
            cursor.execute(f"SET search_path = {CLOCK_SCHEMA}, pg_catalog, public")
            cursor.execute(
                "SELECT pg_catalog.set_config(%s, %s, false)",
                (CLOCK_SETTING, clock.instant.isoformat()),
            )
            cursor.execute("SHOW TimeZone")
            zone = cursor.fetchone()
            if zone is None or zone[0] != "UTC":
                raise OracleDatabaseRefused("Oracle database TimeZone must be UTC")
        connection.commit()


def _drop_database(
    admin: Engine, database: str, admin_url: str, environment: Mapping[str, str], uncertain: bool
) -> None:
    checked = resolve_database_target(admin_url, environment)
    current = resolve_database_target(admin_url, os.environ)
    fields = ("host", "hostaddr", "port", "username", "database")
    if any(getattr(checked, field) != getattr(current, field) for field in fields):
        raise OracleDatabaseRefused("Oracle cleanup target changed after validation")
    optional = "IF EXISTS " if uncertain else ""
    with admin.connect() as connection:
        connection.exec_driver_sql(f"DROP DATABASE {optional}{database} WITH (FORCE)")


@contextmanager
def oracle_database(
    admin_url: str, *, clock: PinnedClock, environment: Mapping[str, str], keep: bool = False
) -> Iterator[Engine]:
    confirmation = environment.get("TRANSIT_TEST_DATABASE_DISPOSABLE", "")
    environment = dict(os.environ, TRANSIT_TEST_DATABASE_DISPOSABLE=confirmation)
    try:
        assert_disposable_test_url(admin_url, environment)
        url = make_url(admin_url)
        base = url.query.get("dbname", url.database or environment.get("PGDATABASE", ""))
        if not isinstance(base, str):
            raise OracleDatabaseRefused("Oracle database requires one database name")
        base = re.sub(r"_xdist_[0-9a-f]{16}_gw[0-9]+$", "", base)
        name = f"{base}_oracle_{uuid4().hex[:16]}"
        query = dict(url.query)
        if "dbname" in query:
            query["dbname"] = name
        options = query.get("options", environment.get("PGOPTIONS", ""))
        if not isinstance(options, str):
            raise OracleDatabaseRefused("Oracle database requires one options string")
        query["options"] = (
            f"{options} -c search_path={CLOCK_SCHEMA},pg_catalog,public -c timezone=UTC"
        ).strip()
        oracle_url = url.set(database=name, query=query)
        assert_disposable_test_url(oracle_url.render_as_string(hide_password=False), environment)
    except RuntimeError as error:
        raise OracleDatabaseRefused(str(error)) from error
    admin = create_engine(url, poolclass=NullPool, isolation_level="AUTOCOMMIT")
    engine = create_engine(oracle_url, poolclass=NullPool)
    database = admin.dialect.identifier_preparer.quote_identifier(name)
    created, uncertain = False, False
    try:
        with admin.connect() as connection:
            try:
                connection.exec_driver_sql(f"CREATE DATABASE {database} TEMPLATE template0")
                created = True
            except OperationalError:
                uncertain = True
                raise
        _initialize(engine, database, admin, clock)
        _pin_connections(engine, clock)
        yield engine
    finally:
        try:
            engine.dispose()
        finally:
            try:
                if (created or uncertain) and not keep:
                    _drop_database(admin, database, admin_url, environment, uncertain)
            finally:
                admin.dispose()
