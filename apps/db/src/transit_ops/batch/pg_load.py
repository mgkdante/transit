from __future__ import annotations

import os
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from psycopg import Connection as PgConnection
from sqlalchemy import Connection, Engine, create_engine, event, text

from transit_ops.db.target_safety import assert_disposable_test_url


class ReplayDatabaseRefused(RuntimeError):
    pass


def prepare_replay_database(url: str, environment: Mapping[str, str]) -> Engine:
    """Open an already migrated disposable database; never migrate or create it."""
    effective = dict(
        os.environ,
        TRANSIT_TEST_DATABASE_DISPOSABLE=environment.get("TRANSIT_TEST_DATABASE_DISPOSABLE", ""),
    )
    try:
        assert_disposable_test_url(url, effective)
    except RuntimeError as error:
        raise ReplayDatabaseRefused(str(error)) from error
    engine = create_engine(url)
    try:
        scripts = ScriptDirectory(str(Path(__file__).resolve().parents[1] / "db" / "migrations"))
        with engine.connect() as conn:
            if set(MigrationContext.configure(conn).get_current_heads()) != set(
                scripts.get_heads()
            ):
                raise ReplayDatabaseRefused("Replay database must be at Alembic head")
        return engine
    except BaseException:
        engine.dispose()
        raise


def _install_clock(conn: Connection) -> list[str]:
    conn.exec_driver_sql("CREATE SCHEMA replay_clock")
    definitions = []
    for name, volatility in (("now", "STABLE"), ("clock_timestamp", "VOLATILE")):
        definitions.append(
            str(
                conn.execute(
                    text("SELECT pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(:name))"),
                    {"name": f"pg_catalog.{name}()"},
                ).scalar_one()
            )
        )
        # Keep the original internal implementation for connections without a replay setting.
        # Replacing the catalog function preserves OIDs already bound by views/defaults.
        conn.exec_driver_sql(f"""
            CREATE FUNCTION replay_clock.real_{name}() RETURNS timestamptz
            LANGUAGE internal {volatility} AS '{name}'
        """)
        conn.exec_driver_sql(f"""
            CREATE OR REPLACE FUNCTION pg_catalog.{name}() RETURNS timestamptz
            LANGUAGE sql {volatility} AS $$
                SELECT COALESCE(
                    NULLIF(pg_catalog.current_setting('replay.now', true), '')::timestamptz,
                    replay_clock.real_{name}())
            $$
        """)
        conn.exec_driver_sql(f"""
            CREATE FUNCTION replay_clock.{name}() RETURNS timestamptz
            LANGUAGE sql {volatility} AS $$
                SELECT pg_catalog.current_setting('replay.now')::timestamptz
            $$
        """)
    return definitions


def _configure_clock(engine: Engine, stamp: datetime) -> None:
    @event.listens_for(engine, "connect")
    def configure(connection: PgConnection[tuple[object, ...]], _record: object) -> None:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_catalog.set_config('replay.now', %s, false)", (stamp.isoformat(),)
            )
            cursor.execute("SET search_path = replay_clock, pg_catalog, public")
            cursor.execute("SHOW TimeZone")
            zone = cursor.fetchone()
            if zone is None or zone[0] not in ("UTC", "Etc/UTC"):
                raise ReplayDatabaseRefused("Replay database TimeZone must be UTC or Etc/UTC")
        connection.commit()


@contextmanager
def pinned_replay_engine(engine: Engine, as_of_utc: datetime) -> Iterator[Engine]:
    """Pin now/clock_timestamp, including existing catalog-bound views and defaults.

    Requires a prepared disposable database and superuser catalog privileges.
    SQL clock keywords, other timestamp functions and Python clocks stay real.
    Callers must close yielded connections before leaving the context.
    """
    if as_of_utc.utcoffset() is None:
        raise ReplayDatabaseRefused("Replay clock requires an aware datetime")
    pinned = create_engine(engine.url)
    _configure_clock(pinned, as_of_utc.astimezone(UTC))
    try:
        with engine.connect() as admin:
            # Serialize catalog replacement without waiting on another replay.
            locked = admin.exec_driver_sql("SELECT pg_try_advisory_lock(724113, 1)").scalar_one()
            admin.commit()
            if not locked:
                raise ReplayDatabaseRefused("Another replay owns the database clock")
            try:
                with admin.begin():
                    definitions = _install_clock(admin)
                try:
                    with pinned.connect():
                        pass
                    yield pinned
                finally:
                    try:
                        pinned.dispose()
                    finally:
                        with admin.begin():
                            for definition in definitions:
                                admin.exec_driver_sql(definition)
                            admin.exec_driver_sql("DROP SCHEMA replay_clock CASCADE")
            finally:
                admin.exec_driver_sql("SELECT pg_advisory_unlock(724113, 1)")
                admin.commit()
    finally:
        pinned.dispose()


def reset_replay_tables(engine: Engine, relations: Sequence[str]) -> None:
    """Truncate exactly the named schema-qualified relations; retain FK protection."""
    if not relations:
        return
    quote = engine.dialect.identifier_preparer.quote_identifier
    names = []
    for relation in relations:
        parts = relation.split(".")
        if len(parts) != 2 or not all(parts) or "\x00" in relation:
            raise ReplayDatabaseRefused("Replay relations must be schema-qualified names")
        names.append(".".join(quote(part) for part in parts))
    with engine.begin() as conn:
        conn.exec_driver_sql("TRUNCATE TABLE " + ", ".join(names))
