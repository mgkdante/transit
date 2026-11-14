import json
from dataclasses import replace
from hashlib import sha256

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


def test_roll_forward_and_bad_chain(objects):
    advance(objects)
    second = {
        "format": 1,
        "seq": 2,
        "at_utc": "2026-01-02T03:04:05.123456Z",
        "before_sha256": sha256(objects.read(m.window_key(ID)).body).hexdigest(),
        "records": [m.encode_event(RECORD)],
        "after": m.encode_window(replace(DOC, seq=2)),
    }
    objects.create(t.transition_key(ID, 2), second)
    assert advance(objects).seq == 3
    assert t.rebuild_window(objects, ID).seq == 3
    fourth = {**second, "seq": 4, "before_sha256": "f" * 64}
    fourth["after"] = m.encode_window(replace(DOC, seq=4))
    objects.create(t.transition_key(ID, 4), fourth)
    with pytest.raises(m.LedgerDocumentInvalid):
        advance(objects)


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


def test_contention_gap_and_invalid_change(objects, monkeypatch):
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
    def fail(*args, **kwargs):
        raise error

    monkeypatch.setattr(objects, "replace", fail)
    with pytest.raises(t.LedgerTransitionCommitted) as caught:
        advance(objects)
    assert caught.value.after == DOC
    assert t.rebuild_window(objects, ID) == DOC
