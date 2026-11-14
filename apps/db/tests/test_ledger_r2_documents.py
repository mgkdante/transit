import json
from dataclasses import replace
from datetime import UTC, date, datetime
from hashlib import sha256

import pytest

from transit_ops.control.objects import ObjectCollision, ObjectConflict, SnapshotConditionalObjects
from transit_ops.history import ledger_r2_documents as m
from transit_ops.history.ledger import HOLD_NO_END, ArchiveCopy
from transit_ops.snapshots.storage import LocalSnapshotStorage as LocalStore

NOW = datetime(2026, 1, 2, 3, 4, 5, 123456, UTC)
ID = ("capture.trip_updates", "network:a/b", 0, "2026-01-02")
DAY = date(2026, 1, 2)
DOC = m.WindowDocument(*ID, DAY, "present", NOW, 1, None, None, None, None, None, 1, ())
RECORD = m.EventRecord("changed", None, "test", None, {})


@pytest.fixture
def objects(tmp_path):
    return SnapshotConditionalObjects(LocalStore(str(tmp_path), "ledger/v1"), min_interval_s=0)


def advance(objects, change=None, attempts=10):
    def default(doc, now):
        return m.Transition(replace(doc or DOC, seq=doc.seq + 1 if doc else 1), (RECORD,))

    return m.apply_transition(
        objects, ID, change or default, clock=lambda: NOW, max_attempts=attempts
    )


def test_round_trip_every_field_and_hold():
    digests = ("a" * 64, "b" * 64)
    times = (NOW, NOW, NOW, NOW, NOW)
    files, counts = ("pack", "manifest", 10, *digests), (2, 3, 4)
    inspection = (None, None, {"nested": [None, 2]}, DOC.window_start, True)
    copy = ArchiveCopy(*ID, 1, 1, "local", *files, *counts, *digests, *times, *inspection)
    doc = replace(DOC, copies=(copy,), current_version=1, trimmed_at_utc=NOW)
    doc = replace(doc, remainder_fingerprint="e" * 64, hold_reason="keep")
    for hold in (None, HOLD_NO_END, NOW):
        value = replace(doc, hold_until_utc=hold)
        assert m.decode_window(m.encode_window(value)) == value
    assert m.encode_window(doc)["working_changed_at_utc"] == "2026-01-02T03:04:05.123456Z"
    for field, invalid in [
        ("sealed_at_utc", "2026-01-01T00:00:00Z"),
        ("verified_at_utc", "2026-01-01T00:00:00Z"),
        ("reject_reason", "bad"),
        ("sha256", "a" * 63),
        ("storage_backend", "gcs"),
        ("content_version", 0),
    ]:
        raw = m.encode_window(doc)
        raw["copies"][0][field] = invalid
        with pytest.raises(m.LedgerDocumentInvalid):
            m.decode_window(raw)


@pytest.mark.parametrize(
    "field,value",
    [
        ("format", 2),
        ("dataset_id", "unknown"),
        ("window_key", "2026-01"),
        ("revision", 1),
        ("working_state", "other"),
    ],
)
def test_decode_refuses_invalid_window(field, value):
    with pytest.raises(m.LedgerDocumentInvalid):
        m.decode_window({**m.encode_window(DOC), field: value})


@pytest.mark.parametrize("field,value", [("kind", "unknown"), ("actor", ""), ("format", 2)])
def test_decode_refuses_invalid_event(field, value):
    with pytest.raises(m.LedgerDocumentInvalid):
        m.decode_event({**m.encode_event(RECORD), field: value})


def test_first_transition_and_no_change(objects):
    assert advance(objects, lambda doc, now: None) is None
    assert advance(objects) == DOC
    assert json.loads(objects.read(m.event_key(ID, 1)).body)["after"] == m.encode_window(DOC)
    before = list(objects.list_keys("events"))
    assert advance(objects, lambda doc, now: None) == DOC
    assert list(objects.list_keys("events")) == before
    assert m.rebuild_window(objects, ID) == DOC


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
    objects.create(m.event_key(ID, 2), second)
    assert advance(objects).seq == 3
    assert m.rebuild_window(objects, ID).seq == 3
    objects.create(
        m.event_key(ID, 4),
        {
            **second,
            "seq": 4,
            "before_sha256": "f" * 64,
            "after": m.encode_window(replace(DOC, seq=4)),
        },
    )
    with pytest.raises(m.LedgerDocumentInvalid):
        advance(objects)


def test_two_writers_and_rolled_forward_success(objects, monkeypatch):
    advance(objects)

    def competing(doc, now):
        if doc.seq == 1:
            advance(
                objects,
                lambda doc, now: m.Transition(
                    replace(doc, seq=2), (replace(RECORD, actor="writer-b"),)
                ),
            )
        return m.Transition(replace(doc, seq=doc.seq + 1), (RECORD,))

    assert advance(objects, competing).seq == 3
    assert b'"writer-b"' in objects.read(m.event_key(ID, 2)).body
    assert b'"test"' in objects.read(m.event_key(ID, 3)).body

    def recovered(key, payload, *, expected, original=objects.replace):
        original(key, payload, expected=expected)
        raise ObjectConflict("another reader applied our event")

    monkeypatch.setattr(objects, "replace", recovered)
    assert advance(objects).seq == 4


def test_contention_gap_and_invalid_change(objects, monkeypatch):
    with pytest.raises(ValueError):
        advance(objects, lambda doc, now: m.Transition(replace(DOC, seq=2), (RECORD,)))
    assert list(objects.list_keys("windows")) == []
    objects.create(m.event_key(ID, 2), {})
    with pytest.raises(m.LedgerDocumentInvalid):
        m.rebuild_window(objects, ID)

    def collide(*args):
        raise ObjectCollision("busy")

    monkeypatch.setattr(objects, "create", collide)
    with pytest.raises(m.LedgerContention):
        advance(objects, attempts=2)
    assert objects.read(m.window_key(ID)) is None
