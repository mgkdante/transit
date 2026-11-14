from dataclasses import replace
from datetime import datetime

import pytest

from transit_ops.history.datasets import UndeclaredDataset
from transit_ops.history.ledger import HOLD_NO_END, WindowNotFound


def test_session_reads_see_its_own_writes(store, make_identity):
    identity = make_identity()
    with store.session(identity) as session:
        assert session.state() is None
        assert session.allocate_version(above_version=3) == 4
        assert session.allocate_version() == 5
        assert session.state().next_version == 6
        assert session.now().utcoffset().total_seconds() == 0
    assert store.window_state(identity).next_version == 6
    with store.session(identity) as session:
        assert session.events() == []
        session.set_working_state("empty")
    with store.session(identity) as session:
        assert session.state().working_state == "empty"
        assert session.events() == []


def test_working_state_changes_only_from_present_or_empty(store, make_identity):
    with store.session(make_identity()) as session:
        session.mark_changed()
        session.set_working_state("empty")
        assert session.state().working_state == "empty"
        session.set_working_state("partial")
        session.set_working_state("present")
        assert session.state().working_state == "partial"
        session.mark_changed(actor="loader")
        assert session.state().working_state == "present"
        assert session.events()[-1].actor == "loader"


def test_exception_inside_a_session_writes_nothing(store, make_identity):
    identity = make_identity()
    with pytest.raises(RuntimeError, match="abort"):
        with store.session(identity) as session:
            session.allocate_version()
            session.record_event("changed")
            raise RuntimeError("abort")
    assert store.window_state(identity) is None
    with store.session(identity) as session:
        assert session.events() == []
        session.allocate_version()
    with pytest.raises(RuntimeError, match="abort"):
        with store.session(identity) as session:
            session.allocate_version()
            raise RuntimeError("abort")
    assert store.window_state(identity).next_version == 2


def test_hold_with_no_end_reads_back_as_hold_no_end(store, make_identity):
    with store.session(make_identity()) as session:
        with pytest.raises(WindowNotFound):
            session.hold(until_utc=None, reason="missing")
        session.mark_changed()
        session.hold(until_utc=HOLD_NO_END, reason="keep")
        assert session.state().hold_until_utc == HOLD_NO_END
        session.hold(until_utc=None, reason="release")
        assert (session.state().hold_until_utc, session.state().hold_reason) == (None, None)
        assert [e.kind for e in session.events()] == ["changed", "hold", "unhold"]


def test_processing_events_come_back_in_order_with_their_details(store, make_identity):
    with store.session(make_identity()) as session:
        session.mark_changed(actor="loader")
        for rows in (0, 5):
            session.record_event("processing_evidence", details={"rows": rows}, actor="loader")
        events = session.processing_events()
        assert [(e.kind, e.details, e.actor) for e in events] == [
            ("processing_evidence", {"rows": 0}, "loader"),
            ("processing_evidence", {"rows": 5}, "loader"),
        ]
        assert events == session.events(kinds={"processing_evidence"})
        assert session.events(kinds=set()) == []
        assert all(e.at_utc.tzinfo is not None for e in events)


def test_undeclared_dataset_and_misfit_key_are_refused_before_any_write(store, make_identity):
    identity = make_identity()
    for invalid, error in (
        ({"dataset_id": "unknown"}, UndeclaredDataset),
        ({"window_key": "bad"}, ValueError),
        ({"revision": 1}, ValueError),
    ):
        with pytest.raises(error), store.session(replace(identity, **invalid)):
            pytest.fail("invalid window accepted")
    with store.session(identity) as session:
        with pytest.raises(ValueError):
            session.allocate_version(above_version=-1)
        with pytest.raises(ValueError):
            session.hold(until_utc=datetime(2026, 11, 1), reason="naive")
        assert session.state() is None
        assert session.events() == []
