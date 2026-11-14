import os
from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from transit_ops.batch.pg_load import (
    ReplayDatabaseRefused,
    pinned_replay_engine,
    prepare_replay_database,
    reset_replay_tables,
)

STAMP = datetime(2025, 9, 2, 7, 0, 0, 123456, UTC)
LOCAL = "postgresql+psycopg://transit_ci@localhost/transit_ci"


def test_refuses_a_database_not_confirmed_disposable():
    with pytest.raises(ReplayDatabaseRefused, match="confirmation"):
        prepare_replay_database(LOCAL, {})


def test_guard_uses_actual_process_identity(monkeypatch):
    monkeypatch.setenv("PGHOSTADDR", "203.0.113.10")
    with pytest.raises(ReplayDatabaseRefused, match="Disposable"):
        prepare_replay_database(
            LOCAL,
            {"TRANSIT_TEST_DATABASE_DISPOSABLE": "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE"},
        )


def test_refuses_a_database_behind_head(real_db_engine):
    with real_db_engine.begin() as conn:
        heads = list(conn.execute(text("SELECT version_num FROM alembic_version")).scalars())
        conn.execute(text("UPDATE alembic_version SET version_num = 'behind_head'"))
    try:
        with pytest.raises(ReplayDatabaseRefused, match="Alembic head"):
            prepare_replay_database(
                real_db_engine.url.render_as_string(hide_password=False), os.environ
            )
    finally:
        with real_db_engine.begin() as conn:
            conn.execute(text("DELETE FROM alembic_version"))
            for head in heads:
                conn.execute(text("INSERT INTO alembic_version VALUES (:head)"), {"head": head})


@pytest.fixture
def replay(real_db_engine):
    engine = prepare_replay_database(
        real_db_engine.url.render_as_string(hide_password=False), os.environ
    )
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def probe(replay):
    with replay.begin() as conn:
        conn.execute(text("CREATE SCHEMA replay_probe"))
        conn.execute(
            text("""
            CREATE TABLE replay_probe.times (
                stamp timestamptz DEFAULT pg_catalog.now(),
                tick timestamptz DEFAULT pg_catalog.clock_timestamp()
            )
        """)
        )
        conn.execute(
            text("""
            CREATE VIEW replay_probe.clock AS
            SELECT pg_catalog.now() AS stamp, pg_catalog.clock_timestamp() AS tick
        """)
        )
    try:
        yield
    finally:
        with replay.begin() as conn:
            conn.execute(text("DROP SCHEMA replay_probe CASCADE"))


def assert_pinned_connection(conn):
    query = "SELECT now(), clock_timestamp(), pg_catalog.now(), pg_catalog.clock_timestamp()"
    assert tuple(conn.execute(text(query)).one()) == (STAMP,) * 4
    assert tuple(conn.execute(text("SELECT * FROM replay_probe.clock")).one()) == (STAMP, STAMP)
    insert = "INSERT INTO replay_probe.times DEFAULT VALUES RETURNING stamp, tick"
    assert tuple(conn.execute(text(insert)).one()) == (STAMP, STAMP)
    conn.rollback()


@pytest.mark.parametrize("fail", [False, True])
def test_pinned_engine_pins_now_and_clock_timestamp(replay, probe, fail):
    with replay.connect() as conn:
        definitions = conn.execute(
            text("""
            SELECT pg_get_functiondef('pg_catalog.now()'::regprocedure),
                   pg_get_functiondef('pg_catalog.clock_timestamp()'::regprocedure)
        """)
        ).one()
    try:
        with pinned_replay_engine(replay, STAMP) as pinned:
            with pinned.connect() as first, pinned.connect() as second:
                for conn in (first, second):
                    assert_pinned_connection(conn)
                with replay.connect() as unpinned:
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
    with replay.connect() as conn:
        assert conn.execute(text("SELECT to_regnamespace('replay_clock')")).scalar() is None
        assert (
            conn.execute(
                text("""
            SELECT pg_get_functiondef('pg_catalog.now()'::regprocedure),
                   pg_get_functiondef('pg_catalog.clock_timestamp()'::regprocedure)
        """)
            ).one()
            == definitions
        )


def test_reset_truncates_only_the_named_relations(replay, probe):
    with replay.begin() as conn:
        conn.execute(text("CREATE TABLE replay_probe.parent (id int PRIMARY KEY)"))
        conn.execute(
            text("CREATE TABLE replay_probe.child (id int REFERENCES replay_probe.parent)")
        )
        conn.execute(text("INSERT INTO replay_probe.parent VALUES (1)"))
        conn.execute(text("INSERT INTO replay_probe.child VALUES (1)"))
        conn.execute(text("INSERT INTO replay_probe.times DEFAULT VALUES"))
    with pytest.raises(DBAPIError):
        reset_replay_tables(replay, ["replay_probe.parent"])
    reset_replay_tables(replay, ["replay_probe.parent", "replay_probe.child"])
    with replay.connect() as conn:
        assert conn.execute(text("SELECT * FROM replay_probe.parent")).all() == []
        assert conn.execute(text("SELECT * FROM replay_probe.child")).all() == []
        assert conn.execute(text("SELECT stamp FROM replay_probe.times")).scalar_one() is not None


def test_naive_clock_is_refused(replay):
    with pytest.raises(ReplayDatabaseRefused, match="aware"):
        with pinned_replay_engine(replay, datetime(2025, 9, 2)):
            pytest.fail("naive clock accepted")
