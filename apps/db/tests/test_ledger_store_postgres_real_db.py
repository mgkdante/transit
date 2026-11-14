import pytest
from history_ledger_fixtures import conn as rollback_conn
from history_ledger_fixtures import pipeline_role
from ledger_store_contract import *  # noqa: F403
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


def test_caught_statement_error_preserves_outer_work(store, make_identity):
    prior, failed = make_identity("2026-11-02"), make_identity()
    with store.session(prior) as session:
        session.allocate_version()
    with pytest.raises((RuntimeError, DBAPIError)):
        with store.session(failed) as session:
            session.allocate_version()
            with pytest.raises(DBAPIError):
                session.record_event("changed", details={"n": float("nan")})
    assert store.window_state(failed) is None
    assert store.window_state(prior).next_version == 2
    with store.session(failed) as session:
        assert session.allocate_version() == 1


@pytest.mark.parametrize(
    "verb,args,kwargs",
    [
        ("copies", (), {}),
        ("insert_allocated_copy", (None,), {}),
        ("mark_sealed", (1,), {}),
        ("mark_rejected", (1,), {"rejected_at": None, "reason": "test"}),
        ("make_current", (1,), {"verified_at": None}),
    ],
)
def test_copy_verbs_await_pr2(store, make_identity, verb, args, kwargs):
    with store.session(make_identity()) as session:
        with pytest.raises(NotImplementedError, match="LS3.1d-2"):
            getattr(session, verb)(*args, **kwargs)
    with pytest.raises(NotImplementedError, match="LS3.1d-2"):
        store.find_copies(
            dataset_id="capture.trip_updates", provider_id="network", start=None, end=None
        )
