import json
from dataclasses import replace

import pytest
from test_ledger_r2_documents import DOC, ID, NOW, RECORD

from transit_ops.control.objects import (
    ObjectCollision,
    ObjectConflict,
    ObjectRateLimited,
    SnapshotConditionalObjects,
)
from transit_ops.history import ledger_r2_documents as m
from transit_ops.history import ledger_r2_transitions as t
from transit_ops.snapshots.storage import LocalSnapshotStorage as LocalStore


@pytest.fixture
def objects(tmp_path):
    return SnapshotConditionalObjects(LocalStore(str(tmp_path), "ledger/v1"), min_interval_s=0)


def advance(objects, change=None, attempts=10):
    def default(doc, now):
        return t.Transition(replace(doc or DOC, seq=doc.seq + 1 if doc else 1), (RECORD,))

    return t.apply_transition(
        objects, ID, change or default, clock=lambda: NOW, max_attempts=attempts
    )


def test_first_transition_and_no_change(objects):
    assert advance(objects, lambda doc, now: None) is None
    assert advance(objects) == DOC
    assert json.loads(objects.read(t.transition_key(ID, 1)).body)["after"] == m.encode_window(DOC)
    before = list(objects.list_keys("transitions/"))
    assert advance(objects, lambda doc, now: None) == DOC
    assert list(objects.list_keys("transitions/")) == before
    assert t.rebuild_window(objects, ID) == DOC


def test_two_writers_and_rolled_forward_success(objects, monkeypatch):
    advance(objects)

    def competing(doc, now):
        if doc.seq == 1:
            advance(
                objects,
                lambda doc, now: t.Transition(
                    replace(doc, seq=2), (replace(RECORD, actor="writer-b"),)
                ),
            )
        return t.Transition(replace(doc, seq=doc.seq + 1), (RECORD,))

    assert advance(objects, competing).seq == 3
    assert b'"writer-b"' in objects.read(t.transition_key(ID, 2)).body
    assert b'"test"' in objects.read(t.transition_key(ID, 3)).body

    def recovered(key, payload, *, expected, original=objects.replace):
        original(key, payload, expected=expected)
        monkeypatch.setattr(objects, "read", raced)
        raise ObjectConflict("another reader applied our event")

    read, decisions = objects.read, []

    def raced(key):
        monkeypatch.setattr(objects, "read", read)
        raise ObjectConflict("recovery read raced another window write")

    monkeypatch.setattr(objects, "replace", recovered)

    def change(doc, now):
        decisions.append(doc)
        return t.Transition(replace(doc, seq=4), (RECORD,))

    assert advance(objects, change).seq == 4
    assert len(decisions) == 1


def test_contention_and_invalid_change(objects, monkeypatch):
    with pytest.raises(ValueError):
        advance(objects, lambda doc, now: t.Transition(replace(DOC, seq=2), (RECORD,)))
    assert list(objects.list_keys("windows/")) == []
    objects.create(t.transition_key(ID, 2), {})
    with pytest.raises(m.LedgerDocumentInvalid):
        t.rebuild_window(objects, ID)

    def collide(*args):
        raise ObjectCollision("busy")

    monkeypatch.setattr(objects, "create", collide)
    with pytest.raises(t.LedgerContention):
        advance(objects, attempts=2)
    assert objects.read(m.window_key(ID)) is None


@pytest.mark.parametrize("value", [1.0, "1", True, {"unsupported"}])
def test_coercion_is_rejected_before_writing(objects, value):
    with pytest.raises(m.LedgerDocumentInvalid):
        advance(objects, lambda doc, now: t.Transition(replace(DOC, next_version=value), (RECORD,)))
    assert list(objects.list_keys("transitions/")) == []


@pytest.mark.parametrize(
    "record", [replace(RECORD, content_version=1.0), replace(RECORD, details={"value": (1, 2)})]
)
def test_record_values_are_checked_before_serializing(objects, record):
    with pytest.raises(m.LedgerDocumentInvalid):
        advance(objects, lambda doc, now: t.Transition(DOC, (record,)))
    assert list(objects.list_keys("transitions/")) == []


@pytest.mark.parametrize("changes", [{"next_version": 2}, {"working_state": "empty"}])
def test_dirty_transition_without_public_records_and_noop(objects, changes):
    result = advance(objects, lambda doc, now: t.Transition(DOC, ()))
    assert result == DOC == t.rebuild_window(objects, ID)
    event = json.loads(objects.read(t.transition_key(ID, 1)).body)
    assert event["records"] == []
    dirty = replace(DOC, seq=2, **changes)
    assert advance(objects, lambda doc, now: t.Transition(dirty, ())) == dirty
    assert t.rebuild_window(objects, ID) == dirty
    assert json.loads(objects.read(t.transition_key(ID, 2)).body)["records"] == []
    keys = list(objects.list_keys("transitions/"))
    assert advance(objects, lambda doc, now: t.Transition(replace(doc, seq=3), ())) == dirty
    assert list(objects.list_keys("transitions/")) == keys


@pytest.mark.parametrize("error", [ObjectRateLimited("429"), OSError("transport failed")])
def test_committed_replace_failure_does_not_report_uncommitted(objects, monkeypatch, error):
    advance(objects)
    write, decisions, failures = objects.replace, [], [error]

    def fail(*args, **kwargs):
        if failures:
            raise failures.pop()
        return write(*args, **kwargs)

    def allocate(doc, now):
        decisions.append(doc.next_version)
        return t.Transition(replace(doc, seq=doc.seq + 1, next_version=doc.next_version + 1), ())

    monkeypatch.setattr(objects, "replace", fail)
    for _ in range(2):
        try:
            result = advance(objects, allocate)
        except t.LedgerTransitionCommitted as committed:
            result = committed.after
            break
        except (ObjectRateLimited, OSError):
            continue
        break
    assert result.next_version == 2
    assert decisions == [1]
    assert advance(objects, lambda doc, now: None) == result
    assert result.seq == 2 and t.rebuild_window(objects, ID) == result


def test_event_only_records_leave_state_absent_and_continue_sequence(objects):
    records = (RECORD, replace(RECORD, kind="close_runs"))
    for seq in (1, 2):
        assert advance(objects, lambda doc, now: t.Transition(None, records)) is None
        assert objects.read(m.window_key(ID)) is None
        assert t.rebuild_window(objects, ID) is None
        envelope = json.loads(objects.read(m.transition_key(ID, seq)).body)
        assert envelope["after"] is None
        assert [m.decode_event(r).sequence for r in envelope["records"]] == [(seq, 0), (seq, 1)]
        assert [r.sequence for r in t.events(objects, ID) if r.kind == "close_runs"] == [
            (n, 1) for n in range(1, seq + 1)
        ]
    result = advance(objects)
    assert result.seq == 3 and t.rebuild_window(objects, ID) == result
    record = json.loads(objects.read(m.transition_key(ID, 3)).body)["records"][0]
    assert m.decode_event(record).sequence == (3, 0)
    assert [r.sequence for r in t.events(objects, ID, kinds={"close_runs"})] == [(1, 1), (2, 1)]
