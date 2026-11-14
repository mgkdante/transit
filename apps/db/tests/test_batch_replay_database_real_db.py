import os
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

from transit_ops.batch.pg_load import (
    ReplayDatabaseRefused,
    pinned_replay_engine,
    prepare_replay_database,
    reset_replay_tables,
)

STAMP = datetime(2025, 9, 2, 7, 0, 0, 123456, UTC)
LOCAL = "postgresql+psycopg://transit_ci@localhost/transit_ci"


def definitions(conn):
    query = "SELECT pg_get_functiondef('pg_catalog.{}()'::regprocedure)"
    return [conn.exec_driver_sql(query.format(n)).scalar_one() for n in ("now", "clock_timestamp")]


def test_refuses_a_database_not_confirmed_disposable():
    with pytest.raises(ReplayDatabaseRefused, match="confirmation"):
        prepare_replay_database(LOCAL, {})


def test_guard_uses_actual_process_identity(monkeypatch):
    monkeypatch.setenv("PGHOSTADDR", "203.0.113.10")
    confirmation = "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE"
    with pytest.raises(ReplayDatabaseRefused, match="Disposable"):
        prepare_replay_database(LOCAL, {"TRANSIT_TEST_DATABASE_DISPOSABLE": confirmation})


def test_refuses_a_database_behind_head(real_db_engine):
    with real_db_engine.begin() as conn:
        heads = list(conn.exec_driver_sql("SELECT version_num FROM alembic_version").scalars())
        conn.exec_driver_sql("UPDATE alembic_version SET version_num = 'behind_head'")
    try:
        with pytest.raises(ReplayDatabaseRefused, match="Alembic head"):
            prepare_replay_database(
                real_db_engine.url.render_as_string(hide_password=False), os.environ
            )
    finally:
        with real_db_engine.begin() as conn:
            conn.exec_driver_sql("DELETE FROM alembic_version")
            for head in heads:
                conn.execute(text("INSERT INTO alembic_version VALUES (:head)"), {"head": head})


@pytest.fixture
def replay(real_db_engine):
    url = real_db_engine.url.render_as_string(hide_password=False)
    database = prepare_replay_database(url, os.environ)
    yield database
    getattr(database, "engine", database).dispose()


@pytest.fixture
def engine(replay):
    return getattr(replay, "engine", replay)


@pytest.fixture
def probe(engine):
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE SCHEMA replay_probe")
        conn.exec_driver_sql("""
            CREATE TABLE replay_probe.times (
                stamp timestamptz DEFAULT pg_catalog.now(),
                tick timestamptz DEFAULT pg_catalog.clock_timestamp())
        """)
        conn.exec_driver_sql("""
            CREATE VIEW replay_probe.clock AS
            SELECT pg_catalog.now() AS stamp, pg_catalog.clock_timestamp() AS tick
        """)
    yield
    with engine.begin() as conn:
        conn.exec_driver_sql("DROP VIEW replay_probe.clock")
        conn.exec_driver_sql(
            "DROP TABLE IF EXISTS replay_probe.child, replay_probe.parent, replay_probe.times"
        )
        conn.exec_driver_sql("DROP SCHEMA replay_probe")


def assert_pinned_connection(conn):
    query = "SELECT now(), clock_timestamp(), pg_catalog.now(), pg_catalog.clock_timestamp()"
    assert tuple(conn.execute(text(query)).one()) == (STAMP,) * 4
    assert tuple(conn.exec_driver_sql("SELECT * FROM replay_probe.clock").one()) == (STAMP, STAMP)
    insert = "INSERT INTO replay_probe.times DEFAULT VALUES RETURNING stamp, tick"
    assert tuple(conn.execute(text(insert)).one()) == (STAMP, STAMP)
    assert (
        conn.exec_driver_sql("SHOW search_path").scalar_one() == "replay_clock, pg_catalog, public"
    )
    conn.rollback()


@pytest.mark.parametrize("fail", [False, True])
def test_pinned_engine_pins_now_and_clock_timestamp(replay, engine, probe, fail):
    with engine.connect() as conn:
        original = definitions(conn)
    try:
        with pinned_replay_engine(replay, STAMP) as pinned:
            with pinned.connect() as first, pinned.connect() as second:
                for conn in (first, second):
                    assert_pinned_connection(conn)
                with engine.connect() as unpinned:
                    assert all(
                        v != STAMP
                        for v in unpinned.execute(text("SELECT now(), clock_timestamp()")).one()
                    )
            with pinned.connect() as reused:
                assert reused.execute(text("SELECT now()")).scalar_one() == STAMP
            if fail:
                raise ValueError("body failed")
    except ValueError:
        assert fail
    with engine.connect() as conn:
        assert conn.exec_driver_sql("SELECT to_regnamespace('replay_clock')").scalar() is None
        assert definitions(conn) == original


def test_reset_truncates_only_the_named_relations(replay, engine, probe):
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE replay_probe.parent (id int PRIMARY KEY)")
        conn.exec_driver_sql(
            "CREATE TABLE replay_probe.child (id int REFERENCES replay_probe.parent)"
        )
        conn.exec_driver_sql("INSERT INTO replay_probe.parent VALUES (1)")
        conn.exec_driver_sql("INSERT INTO replay_probe.child VALUES (1)")
        conn.exec_driver_sql("INSERT INTO replay_probe.times DEFAULT VALUES")
    with pytest.raises(DBAPIError):
        reset_replay_tables(replay, ["replay_probe.parent"])
    reset_replay_tables(replay, ["replay_probe.parent", "replay_probe.child"])
    with engine.connect() as conn:
        assert conn.exec_driver_sql("SELECT * FROM replay_probe.parent").all() == []
        assert conn.exec_driver_sql("SELECT * FROM replay_probe.child").all() == []
        assert conn.exec_driver_sql("SELECT stamp FROM replay_probe.times").scalar_one() is not None


def test_naive_clock_is_refused(replay):
    with pytest.raises(ReplayDatabaseRefused, match="aware"):
        with pinned_replay_engine(replay, datetime(2025, 9, 2)):
            pytest.fail("naive clock accepted")


@pytest.mark.parametrize("operation", ["pin", "reset"])
def test_unprepared_engine_is_refused_without_connecting(operation, monkeypatch):
    engine = create_engine(LOCAL)
    monkeypatch.setattr(engine, "connect", lambda: pytest.fail("unprepared connection opened"))
    with pytest.raises(ReplayDatabaseRefused, match="prepare_replay_database"):
        if operation == "pin":
            with pinned_replay_engine(engine, STAMP):
                pytest.fail("unprepared engine accepted")
        else:
            reset_replay_tables(engine, ["public.probe"])


@pytest.mark.parametrize("schema", [True, False])
@pytest.mark.parametrize("name", ["now", "clock_timestamp"])
def test_leftover_clock_is_refused(replay, engine, schema, name):
    with engine.begin() as conn:
        original = definitions(conn)
        conn.exec_driver_sql(f"""
            CREATE OR REPLACE FUNCTION pg_catalog.{name}() RETURNS timestamptz
            LANGUAGE sql AS $$ SELECT '2025-09-02T07:00:00Z'::timestamptz $$
        """)
        planted = definitions(conn)
        if schema:
            conn.exec_driver_sql("CREATE SCHEMA replay_clock")
    try:
        with pytest.raises(ReplayDatabaseRefused, match=f"pg_catalog.{name}"):
            prepare_replay_database(engine.url.render_as_string(hide_password=False), os.environ)
        with pytest.raises(ReplayDatabaseRefused, match=f"pg_catalog.{name}"):
            with pinned_replay_engine(replay, STAMP):
                pytest.fail("leftover clock accepted")
        with engine.connect() as conn:
            assert definitions(conn) == planted
    finally:
        with engine.begin() as conn:
            for definition in original:
                conn.exec_driver_sql(definition)
            if schema:
                conn.exec_driver_sql("DROP SCHEMA replay_clock")


@pytest.mark.parametrize("operation", ["pin", "reset"])
def test_server_identity_is_rechecked(replay, engine, operation):
    with engine.begin() as conn:
        conn.exec_driver_sql("SET ROLE pg_read_all_data")
    try:
        with pytest.raises(ReplayDatabaseRefused, match="Server database/role"):
            if operation == "pin":
                with pinned_replay_engine(replay, STAMP):
                    pytest.fail("unapproved server role accepted")
            else:
                reset_replay_tables(replay, ["public.alembic_version"])
    finally:
        with engine.begin() as conn:
            conn.exec_driver_sql("RESET ROLE")


def test_replay_handle_cannot_be_constructed_directly():
    from transit_ops.batch.pg_load import ReplayDatabase

    with pytest.raises(ReplayDatabaseRefused, match="prepare_replay_database"):
        ReplayDatabase()


@pytest.mark.parametrize("name", ["bare", "a.b.c", "a.", ".b", "a.b\x00"])
def test_relation_names_are_refused_before_connecting(replay, engine, name, monkeypatch):
    monkeypatch.setattr(
        engine, "connect", lambda: pytest.fail("malformed relation opened connection")
    )
    with pytest.raises(ReplayDatabaseRefused, match="schema-qualified"):
        reset_replay_tables(replay, [name])


def test_advisory_lock_refuses_another_replay(replay, engine):
    with engine.connect() as locker:
        original = definitions(locker)
        locker.exec_driver_sql("SELECT pg_advisory_lock(724113, 1)")
        locker.commit()
        try:
            with pytest.raises(ReplayDatabaseRefused, match="Another replay"):
                with pinned_replay_engine(replay, STAMP):
                    pytest.fail("contended clock accepted")
            assert definitions(locker) == original
            assert locker.exec_driver_sql("SELECT to_regnamespace('replay_clock')").scalar() is None
        finally:
            locker.exec_driver_sql("SELECT pg_advisory_unlock(724113, 1)")
            locker.commit()


def test_non_utc_timezone_is_refused_and_catalog_restored(engine):
    with engine.connect() as conn:
        original = definitions(conn)
    url = engine.url.update_query_dict({"options": "-c TimeZone=America/Toronto"})
    database = prepare_replay_database(url.render_as_string(hide_password=False), os.environ)
    try:
        with pytest.raises(ReplayDatabaseRefused, match="TimeZone"):
            with pinned_replay_engine(database, STAMP):
                pytest.fail("non-UTC connection accepted")
        with engine.connect() as conn:
            assert definitions(conn) == original
            assert conn.exec_driver_sql("SELECT to_regnamespace('replay_clock')").scalar() is None
    finally:
        database.engine.dispose()


def test_cleanup_preserves_dependent_objects(replay, engine):
    with engine.connect() as conn:
        original = definitions(conn)
    try:
        with pytest.raises(DBAPIError):
            with pinned_replay_engine(replay, STAMP) as pinned, pinned.begin() as conn:
                conn.exec_driver_sql("CREATE VIEW public.replay_dependency AS SELECT now()")
        with engine.connect() as conn:
            assert conn.exec_driver_sql("SELECT to_regclass('public.replay_dependency')").scalar()
    finally:
        with engine.begin() as conn:
            conn.exec_driver_sql("DROP VIEW IF EXISTS public.replay_dependency")
            for definition in original:
                conn.exec_driver_sql(definition)
            for name in ("now", "clock_timestamp"):
                conn.exec_driver_sql(f"DROP FUNCTION IF EXISTS replay_clock.{name}()")
                conn.exec_driver_sql(f"DROP FUNCTION IF EXISTS replay_clock.real_{name}()")
            conn.exec_driver_sql("DROP SCHEMA IF EXISTS replay_clock")


@pytest.mark.parametrize("state", ["schema", "wrong_internal_source"])
def test_other_noncanonical_states_are_refused(replay, engine, state):
    with engine.begin() as conn:
        original = definitions(conn)
        if state == "schema":
            conn.exec_driver_sql("CREATE SCHEMA replay_clock")
        else:
            conn.exec_driver_sql("""
                CREATE OR REPLACE FUNCTION pg_catalog.now() RETURNS timestamptz
                LANGUAGE internal AS 'clock_timestamp'
            """)
    try:
        name = "replay_clock" if state == "schema" else "pg_catalog.now"
        with pytest.raises(ReplayDatabaseRefused, match=name):
            prepare_replay_database(engine.url.render_as_string(hide_password=False), os.environ)
        with pytest.raises(ReplayDatabaseRefused, match=name):
            with pinned_replay_engine(replay, STAMP):
                pytest.fail("noncanonical state accepted")
    finally:
        with engine.begin() as conn:
            for definition in original:
                conn.exec_driver_sql(definition)
            if state == "schema":
                conn.exec_driver_sql("DROP SCHEMA replay_clock")
