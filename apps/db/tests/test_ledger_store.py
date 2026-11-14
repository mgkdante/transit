import pytest

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
