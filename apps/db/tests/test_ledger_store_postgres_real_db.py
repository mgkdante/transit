from dataclasses import replace

import pytest
from history_ledger_fixtures import conn as rollback_conn
from history_ledger_fixtures import pipeline_role
from ledger_store_contract import *  # noqa: F403
from ledger_store_contract import new_copy
from sqlalchemy.exc import DBAPIError

from transit_ops.history.ledger_postgres import PostgresLedger
from transit_ops.history.ledger_store import WindowIdentity

conn = rollback_conn


@pytest.fixture
def store(conn, monkeypatch):
    with pipeline_role(conn, monkeypatch):
        yield PostgresLedger(conn)


@pytest.fixture
def make_identity():
    return lambda key="2026-11-01": WindowIdentity("capture.trip_updates", "network", key)


@pytest.mark.parametrize("invalid_copy", [False, True])
def test_caught_statement_error_preserves_outer_work(store, make_identity, invalid_copy):
    prior, failed = make_identity("2026-11-02"), make_identity()
    with store.session(prior) as session:
        session.allocate_version()
    with pytest.raises((RuntimeError, DBAPIError)):
        with store.session(failed) as session:
            session.allocate_version()
            with pytest.raises(DBAPIError):
                if invalid_copy:
                    session.insert_allocated_copy(replace(new_copy(1), details={"n": float("nan")}))
                else:
                    session.record_event("changed", details={"n": float("nan")})
    assert store.window_state(failed) is None
    assert store.window_state(prior).next_version == 2
    with store.session(failed) as session:
        assert session.allocate_version() == 1


def test_event_reads_do_not_wait_for_a_window_writer(real_db_engine, make_identity):
    with real_db_engine.connect() as writer, real_db_engine.connect() as reader:
        with writer.begin(), reader.begin():
            reader.exec_driver_sql("SET TRANSACTION READ ONLY")
            reader.exec_driver_sql("SET LOCAL lock_timeout = '100ms'")
            with PostgresLedger(writer).session(make_identity()):
                assert PostgresLedger(reader).events(make_identity()) == []
