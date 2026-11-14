from contextlib import nullcontext
from datetime import datetime
from types import SimpleNamespace

import pytest
from ledger_store_contract import new_copy
from sqlalchemy import create_engine

from transit_ops.history.ledger_postgres import PostgresLedger
from transit_ops.history.ledger_store import WindowIdentity


class IdleConnection:
    def in_transaction(self):
        return False


def test_postgres_session_needs_the_callers_transaction():
    store = PostgresLedger(IdleConnection())
    with pytest.raises(ValueError, match="ledger session needs the caller's transaction"):
        with store.session(WindowIdentity("capture.trip_updates", "network", "2026-11-01")):
            pytest.fail("session accepted an idle connection")


class TransactionConnection:
    engine = create_engine("sqlite://")

    def in_transaction(self):
        return True

    def execute(self, *args):
        return None

    def begin_nested(self):
        return nullcontext()


@pytest.mark.parametrize(
    "verb,kwargs",
    [
        ("mark_rejected", {"rejected_at": None, "reason": "bad"}),
        ("make_current", {"verified_at": None}),
        ("mark_rejected", {"rejected_at": datetime(2026, 11, 1), "reason": "bad"}),
        ("make_current", {"verified_at": datetime(2026, 11, 1)}),
    ],
)
def test_copy_times_are_required_before_database_writes(verb, kwargs):
    store = PostgresLedger(TransactionConnection())
    with store.session(WindowIdentity("capture.trip_updates", "network", "2026-11-01")) as session:
        with pytest.raises(ValueError, match="aware datetime"):
            getattr(session, verb)(1, **kwargs)


class ConflictConnection(TransactionConnection):
    def execute(self, *args):
        return SimpleNamespace(rowcount=0)


def test_copy_insert_refuses_an_existing_version():
    store = PostgresLedger(ConflictConnection())
    with pytest.raises(RuntimeError, match=r"could not insert copy.*'content_version': 1\b"):
        with store.session(WindowIdentity("capture.trip_updates", "network", "2026-11-01")) as s:
            s.insert_allocated_copy(new_copy(1))
