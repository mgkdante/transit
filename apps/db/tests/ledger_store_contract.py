from dataclasses import asdict, fields, replace
from datetime import UTC, date, datetime

import pytest

from transit_ops.history.datasets import UndeclaredDataset
from transit_ops.history.ledger import HOLD_NO_END, WindowNotFound
from transit_ops.history.ledger_store import NewCopy


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


def new_copy(version):
    return NewCopy(
        version,
        7,
        "s3",
        "archive/pack.xz",
        "archive/manifest.json.gz",
        123,
        "a" * 64,
        "b" * 64,
        17,
        19,
        293,
        "c" * 64,
        "d" * 64,
        datetime(2026, 11, 1, 12, 34, 56, 123456, tzinfo=UTC),
        datetime(2026, 11, 1, 12, 35, 57, 654321, tzinfo=UTC),
        {"example": "kept"},
    )


def _allocated(session):
    version = session.allocate_version()
    session.insert_allocated_copy(new_copy(version))
    return version


def test_allocated_copy_then_seal_then_verify_makes_it_current(store, make_identity):
    identity = make_identity()
    with store.session(identity) as session:
        version = _allocated(session)
        copy = session.copies()[0]
        assert (copy.state, copy.byte_size, copy.details) == (
            "allocated",
            123,
            {"example": "kept"},
        )
        assert session.events() == []
    with store.session(identity) as session:
        copy = session.copies()[0]
        assert {f.name: getattr(copy, f.name) for f in fields(NewCopy)} == asdict(new_copy(version))
        assert session.events() == []
        session.mark_sealed(version)
        session.make_current(version, verified_at=session.now())
        assert [(c.state, c.is_current) for c in session.copies()] == [("verified", True)]
        assert [(e.kind, e.content_version, e.details) for e in session.events()] == [
            ("seal", 1, {}),
            ("verify", 1, {}),
            ("current", 1, {"previous_version": None}),
        ]
    assert store.window_state(identity).current_version == 1
    with store.session(identity) as session:
        session.mark_sealed(_allocated(session))
        session.make_current(2, verified_at=session.now())
        assert session.events(kinds={"current"})[-1].details == {"previous_version": 1}
        assert session.state().current_version == 2


def test_make_current_never_moves_the_current_version_back(store, make_identity):
    identity = make_identity()
    with store.session(identity) as session:
        for _ in range(2):
            session.mark_sealed(_allocated(session))
        session.make_current(2, verified_at=session.now())
    with pytest.raises(RuntimeError, match=r"content_version': 1\b"):
        with store.session(identity) as session:
            session.make_current(1, verified_at=session.now())
    with store.session(identity) as session:
        assert [(c.content_version, c.state, c.is_current) for c in session.copies()] == [
            (1, "sealed", False),
            (2, "verified", True),
        ]
        assert session.state().current_version == 2


def test_seal_refuses_a_rejected_copy_and_reject_refuses_a_verified_copy(store, make_identity):
    identity = make_identity()
    with store.session(identity) as session:
        rejected = _allocated(session)
        rejected_at = session.now()
        session.mark_rejected(rejected, rejected_at=rejected_at, reason="bad")
        verified = _allocated(session)
        session.mark_sealed(verified)
        verified_at = session.now()
        session.make_current(verified, verified_at=verified_at)
    with pytest.raises(RuntimeError, match=r"content_version': 1\b"):
        with store.session(identity) as session:
            session.mark_sealed(rejected)
    with pytest.raises(RuntimeError, match=r"content_version': 2\b"):
        with store.session(identity) as session:
            session.mark_rejected(verified, rejected_at=session.now(), reason="bad")
    with store.session(identity) as session:
        rejected_copy, verified_copy = session.copies()
        assert [c.state for c in session.copies()] == ["rejected", "verified"]
        assert (rejected_copy.rejected_at_utc, rejected_copy.reject_reason) == (rejected_at, "bad")
        assert verified_copy.verified_at_utc == verified_at
        assert session.events(kinds={"reject"})[0].reason == "bad"


def test_copy_exception_and_swallowed_guard_failure_roll_back_the_session(store, make_identity):
    identity = make_identity()
    with pytest.raises(RuntimeError, match="abort"):
        with store.session(identity) as session:
            _allocated(session)
            raise RuntimeError("abort")
    assert store.window_state(identity) is None
    with pytest.raises(RuntimeError, match="failed"):
        with store.session(identity) as session:
            _allocated(session)
            with pytest.raises(RuntimeError, match=r"content_version': 99\b"):
                session.mark_sealed(99)
            with pytest.raises(RuntimeError, match="failed"):
                session.state()
    assert store.window_state(identity) is None


def test_find_copies_lists_every_version_in_the_date_range(store, make_identity):
    for key in ("2026-11-02", "2026-11-01", "2026-11-03"):
        with store.session(make_identity(key)) as session:
            _allocated(session)
            _allocated(session)
    copies = store.find_copies(
        dataset_id="capture.trip_updates",
        provider_id="network",
        start=date(2026, 11, 1),
        end=date(2026, 11, 2),
    )
    for copy in copies:
        assert {f.name: getattr(copy, f.name) for f in fields(NewCopy)} == asdict(
            new_copy(copy.content_version)
        )
    assert [(c.window_key, c.content_version) for c in copies] == [
        ("2026-11-01", 1),
        ("2026-11-01", 2),
        ("2026-11-02", 1),
        ("2026-11-02", 2),
    ]


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


def test_missing_copy_value_stays_missing_while_zero_stays_zero(store, make_identity):
    with store.session(make_identity()) as session:
        session.insert_allocated_copy(
            replace(new_copy(session.allocate_version()), byte_size=None, record_count=0)
        )
    with store.session(make_identity()) as session:
        copy = session.copies()[0]
        assert (copy.byte_size, copy.record_count) == (None, 0)


def test_existing_copy_version_is_create_only(store, make_identity):
    identity = make_identity()
    with store.session(identity) as session:
        version = _allocated(session)
        session.mark_sealed(version)
        original = session.copies()[0]
    with pytest.raises(RuntimeError, match=r"could not insert copy.*'content_version': 1\b"):
        with store.session(identity) as session:
            session.insert_allocated_copy(replace(new_copy(version), sha256="e" * 64))
    with store.session(identity) as session:
        assert session.copies() == [original]
