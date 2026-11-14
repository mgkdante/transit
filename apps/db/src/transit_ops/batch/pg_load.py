from __future__ import annotations

import os
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from psycopg import Connection as PgConnection
from sqlalchemy import Connection, Engine, create_engine, event, text
from sqlalchemy.engine import URL

from transit_ops.db.target_safety import assert_disposable_test_url

_IDENTITY_SQL = "SELECT current_database(), current_user"


class ReplayDatabaseRefused(RuntimeError):
    pass


@dataclass(frozen=True, init=False)
class ReplayDatabase:
    engine: Engine

    def __init__(self) -> None:
        raise ReplayDatabaseRefused("Use prepare_replay_database")


def _engine(database: ReplayDatabase) -> Engine:
    if not isinstance(database, ReplayDatabase):
        raise ReplayDatabaseRefused("Use prepare_replay_database")
    return database.engine


def _approve_identity(database: str, role: str) -> None:
    url = URL.create("postgresql+psycopg", username=role, host="localhost", database=database)
    try:
        assert_disposable_test_url(
            url.render_as_string(hide_password=False),
            {"TRANSIT_TEST_DATABASE_DISPOSABLE": "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE"},
        )
    except RuntimeError as error:
        raise ReplayDatabaseRefused("Server database/role is not disposable") from error


def _canonical_clock(conn: Connection) -> list[str]:
    definitions, dirty = [], []
    for name in ("now", "clock_timestamp"):
        query = text("""
            SELECT l.lanname, p.prosrc, pg_catalog.pg_get_functiondef(p.oid)
            FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
            WHERE p.oid = pg_catalog.to_regprocedure(:name)
        """)
        row = conn.execute(query, {"name": f"pg_catalog.{name}()"}).one_or_none()
        if row is None or tuple(row[:2]) != ("internal", name):
            dirty.append(f"pg_catalog.{name}")
        else:
            definitions.append(str(row[2]))
    if conn.exec_driver_sql("SELECT to_regnamespace('replay_clock')").scalar() is not None:
        dirty.append("replay_clock")
    if dirty:
        raise ReplayDatabaseRefused(
            f"Noncanonical clock: {', '.join(dirty)}; recreate the disposable database "
            "or restore internal clocks and remove replay_clock manually"
        )
    return definitions


def prepare_replay_database(url: str, environment: Mapping[str, str]) -> ReplayDatabase:
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
            _approve_identity(*conn.exec_driver_sql(_IDENTITY_SQL).one())
            _canonical_clock(conn)
            if set(MigrationContext.configure(conn).get_current_heads()) != set(
                scripts.get_heads()
            ):
                raise ReplayDatabaseRefused("Replay database must be at Alembic head")
        database = object.__new__(ReplayDatabase)
        object.__setattr__(database, "engine", engine)
        return database
    except BaseException:
        engine.dispose()
        raise


def _install_clock(conn: Connection) -> list[str]:
    definitions = _canonical_clock(conn)
    conn.exec_driver_sql("CREATE SCHEMA replay_clock")
    for name, volatility in (("now", "STABLE"), ("clock_timestamp", "VOLATILE")):
        conn.exec_driver_sql(f"""
            CREATE FUNCTION replay_clock.real_{name}() RETURNS timestamptz
                LANGUAGE internal {volatility} AS '{name}'
        """)
        conn.exec_driver_sql(f"""
            CREATE OR REPLACE FUNCTION pg_catalog.{name}() RETURNS timestamptz
            LANGUAGE sql {volatility} AS $$ SELECT COALESCE(
                NULLIF(pg_catalog.current_setting('replay.now', true), '')::timestamptz,
                replay_clock.real_{name}()) $$
        """)
        conn.exec_driver_sql(f"""
            CREATE FUNCTION replay_clock.{name}() RETURNS timestamptz
            LANGUAGE sql {volatility} AS $$
                SELECT pg_catalog.current_setting('replay.now')::timestamptz $$
        """)
    return definitions


def _configure_clock(engine: Engine, stamp: datetime) -> None:
    @event.listens_for(engine, "connect")
    def configure(connection: PgConnection[tuple[object, ...]], _record: object) -> None:
        with connection.cursor() as cursor:
            cursor.execute(_IDENTITY_SQL)
            identity = cursor.fetchone()
            if identity is None:
                raise ReplayDatabaseRefused("Server identity unavailable")
            _approve_identity(str(identity[0]), str(identity[1]))
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
def pinned_replay_engine(database: ReplayDatabase, as_of_utc: datetime) -> Iterator[Engine]:
    """Pin direct and bound clocks; requires disposable superuser privileges.
    Close yielded connections before exit. Other SQL/Python clocks stay real.
    After interruption, recreate the disposable database or restore both catalog
    functions to LANGUAGE internal AS their names and remove replay_clock manually.
    """
    engine = _engine(database)
    if as_of_utc.utcoffset() is None:
        raise ReplayDatabaseRefused("Replay clock requires an aware datetime")
    pinned = create_engine(engine.url)
    _configure_clock(pinned, as_of_utc.astimezone(UTC))
    try:
        with engine.connect() as admin:
            _approve_identity(*admin.exec_driver_sql(_IDENTITY_SQL).one())
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
                            for name in ("now", "clock_timestamp"):
                                admin.exec_driver_sql(f"DROP FUNCTION replay_clock.{name}()")
                                admin.exec_driver_sql(f"DROP FUNCTION replay_clock.real_{name}()")
                            admin.exec_driver_sql("DROP SCHEMA replay_clock")
            finally:
                admin.exec_driver_sql("SELECT pg_advisory_unlock(724113, 1)")
                admin.commit()
    finally:
        pinned.dispose()


def reset_replay_tables(database: ReplayDatabase, relations: Sequence[str]) -> None:
    """Truncate exactly the named schema-qualified relations; retain FK protection."""
    engine = _engine(database)
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
        _approve_identity(*conn.exec_driver_sql(_IDENTITY_SQL).one())
        conn.exec_driver_sql("TRUNCATE TABLE " + ", ".join(names))
