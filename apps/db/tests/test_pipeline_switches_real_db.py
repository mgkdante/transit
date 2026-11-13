from concurrent.futures import ThreadPoolExecutor
from datetime import UTC
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, ProgrammingError

from transit_ops import pipeline_switches as switches


@pytest.fixture
def connection(real_db_engine, monkeypatch):
    monkeypatch.setattr(switches, "_guards", dict(switches._guards))
    with real_db_engine.connect() as c:
        key = "test:" + uuid4().hex
        try:
            yield c, key
        finally:
            c.rollback()
            with c.begin():
                c.execute(
                    text("DELETE FROM core.pipeline_switches WHERE switch_key LIKE :prefix"),
                    {"prefix": key + "%"},
                )


def set_value(c, key, on=True):
    switches.set_switch(c, key, on=on, updated_by="test_actor", reason="test_reason")


def test_missing_table_means_every_switch_off(connection):
    c, key = connection
    with c.begin():
        c.exec_driver_sql("ALTER TABLE core.pipeline_switches RENAME TO hidden_switches")
        assert switches.enabled(c) == frozenset()
        assert switches.list_switches(c) == []
        assert switches.show_switch(c, key) is None
        c.rollback()


def test_missing_row_means_off(connection):
    c, key = connection
    assert switches.show_switch(c, key) is None
    assert key not in switches.enabled(c)
    assert all(row.switch_key != key for row in switches.list_switches(c))
    assert switches.show_switch(c, key) is None


def test_switch_on_is_refused_when_its_guard_fails(connection):
    c, key = connection
    switches.register_guard(key, lambda *a: switches.GuardResult(False, "blocked"))
    for existing in (False, True):
        if existing:
            set_value(c, key, False)
        before = switches.show_switch(c, key)
        c.rollback()
        with pytest.raises(switches.GuardRefused, match="blocked"):
            set_value(c, key)
        assert switches.show_switch(c, key) == before
        c.rollback()


def test_switch_off_is_always_allowed(connection):
    c, key = connection
    switches.register_guard(key, lambda *a: switches.GuardResult(True))
    set_value(c, key)
    switches._guards[key] = lambda *a: switches.GuardResult(False, "blocked")
    with pytest.raises(switches.GuardRefused):
        set_value(c, key)
    switches.set_switch(c, key, on=False, updated_by="off_actor", reason="off_reason")
    row = switches.show_switch(c, key)
    assert not row.enabled and row.updated_by == "off_actor" and row.reason == "off_reason"
    c.rollback()
    set_value(c, key, False)
    assert switches.show_switch(c, key) == row
    c.rollback()
    set_value(c, key + ":unknown", False)
    keys = [r.switch_key for r in switches.list_switches(c)]
    assert keys == sorted(keys)


def test_guard_is_found_by_key_prefix(connection):
    c, key = connection
    switches.register_guard(key, lambda *a: switches.GuardResult(False, "short"))
    switches.register_guard(key + ":long", lambda *a: switches.GuardResult(True))
    set_value(c, key + ":longer")
    with pytest.raises(switches.GuardRefused):
        set_value(c, "history_trim:" + key)
    for prefix in ("", key):
        with pytest.raises(ValueError):
            switches.register_guard(prefix, lambda *a: switches.GuardResult(True))


@pytest.mark.parametrize("on", [False, True])
def test_stop_time_diet_keys_are_refused_with_the_name_of_their_command(connection, on):
    c, key = connection
    with pytest.raises(ValueError, match="set-stop-time-diet"):
        set_value(c, "stop_time_diet:" + key, on)
    assert switches.show_switch(c, "stop_time_diet:" + key) is None


def test_switch_off_waits_for_a_reader_holding_for_share(connection, real_db_engine):
    c, key = connection
    switches.register_guard(key, lambda *a: switches.GuardResult(True))
    set_value(c, key)
    with real_db_engine.connect() as reader:
        reader.execute(
            text("SELECT * FROM core.pipeline_switches WHERE switch_key=:key FOR SHARE"),
            {"key": key},
        )
        c.exec_driver_sql("SET lock_timeout = '100ms'")
        c.commit()
        with pytest.raises(OperationalError) as error:
            set_value(c, key, False)
        assert error.value.orig.sqlstate == "55P03"
        assert switches.show_switch(c, key).enabled
        c.rollback()
        reader.rollback()
    set_value(c, key, False)
    assert not switches.show_switch(c, key).enabled


def test_repeated_on_preserves_the_enabled_interval(connection, real_db_engine):
    c, key = connection
    switches.register_guard(key, lambda *a: switches.GuardResult(True))

    def setter():
        with real_db_engine.connect() as other:
            set_value(other, key)

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda _: setter(), range(2)))
    before = switches.show_switch(c, key)
    c.rollback()
    switches.set_switch(c, key, on=True, updated_by="other", reason="other")
    assert switches.show_switch(c, key) == before
    c.rollback()
    set_value(c, key, False)
    set_value(c, key)
    after = switches.show_switch(c, key)
    assert after.updated_at_utc.astimezone(UTC) > before.updated_at_utc.astimezone(UTC)
    assert [r.switch_key for r in switches.list_switches(c)].count(key) == 1


def test_history_daily_on_requires_ledger_tables(connection):
    c, key = connection
    with c.begin():
        assert switches.history_daily_guard(c, "history_daily").allowed
        assert not switches.history_daily_guard(c, "history_daily_extra").allowed
        for table in ("history_window", "history_archive_copy", "history_event"):
            with c.begin_nested() as savepoint:
                c.exec_driver_sql(f"ALTER TABLE core.{table} RENAME TO hidden_ledger")
                assert not switches.history_daily_guard(c, "history_daily").allowed
                savepoint.rollback()


def test_switch_queries_do_not_hide_database_errors(connection):
    c, key = connection
    with pytest.raises(ProgrammingError), c.begin():
        c.exec_driver_sql("SET LOCAL search_path TO pg_catalog")
        c.exec_driver_sql(
            "ALTER TABLE core.pipeline_switches RENAME COLUMN enabled TO hidden_enabled"
        )
        switches.enabled(c)
