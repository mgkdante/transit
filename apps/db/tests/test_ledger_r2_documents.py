import json
from dataclasses import replace
from datetime import UTC, date, datetime

import pytest

from transit_ops.history import ledger_r2_documents as m
from transit_ops.history.ledger import HOLD_NO_END, ArchiveCopy

NOW = datetime(2026, 1, 2, 3, 4, 5, 123456, UTC)
ID = ("capture.trip_updates", "network:a/b", 0, "2026-01-02")
DAY = date(2026, 1, 2)
DOC = m.WindowDocument(*ID, DAY, "present", NOW, 1, None, None, None, None, None, 1, ())
RECORD = m.EventRecord("changed", None, "test", None, {})


def test_round_trip_every_field_and_hold():
    digests = ("a" * 64, "b" * 64)
    times = (NOW, NOW, NOW, NOW, NOW)
    files, counts = ("pack", "manifest", 10, *digests), (2, 3, 4)
    inspection = (None, None, {"nested": [None, 2]}, DOC.window_start, True)
    copy = ArchiveCopy(*ID, 1, 1, "local", *files, *counts, *digests, *times, *inspection)
    doc = replace(DOC, copies=(copy,), current_version=1, next_version=2, trimmed_at_utc=NOW)
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
        ("content_version", 3),
        ("is_current", False),
        ("window_start", "2026-01-01"),
        ("details", {"at": NOW}),
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
        ("current_version", 7),
        ("next_version", 1.0),
        ("seq", "1"),
        ("future_field", True),
        ("working_changed_at_utc", 0),
    ],
)
def test_decode_refuses_invalid_window(field, value):
    with pytest.raises(m.LedgerDocumentInvalid):
        m.decode_window({**m.encode_window(DOC), field: value})


@pytest.mark.parametrize(
    "field,value",
    [("kind", "unknown"), ("actor", ""), ("format", 2), ("details", {"value": (1, 2)})],
)
def test_decode_refuses_invalid_event(field, value):
    with pytest.raises(m.LedgerDocumentInvalid):
        m.decode_event({**m.encode_event(RECORD), field: value})


def test_public_record_sequence_round_trips_and_rejects_invalid_coordinates():
    record = replace(RECORD, sequence=(7, 0))
    assert m.encode_event(record)["sequence"] == [7, 0]
    assert m.decode_event(m.encode_event(record)) == record
    for sequence in ([0, 0], [1, -1], [1], [1.0, 0]):
        with pytest.raises(m.LedgerDocumentInvalid):
            m.decode_event({**m.encode_event(record), "sequence": sequence})


def test_event_only_envelope_requires_indexed_public_records():
    record = m.encode_event(replace(RECORD, sequence=(1, 0)))
    envelope = {
        "format": 1,
        "seq": 1,
        "at_utc": "2026-01-02T03:04:05.123456Z",
        "before_sha256": None,
        "after": None,
        "records": [record],
    }
    assert m.decode_transition(json.dumps(envelope).encode(), ID, 1, None) is None
    for records in ([], [{**record, "sequence": [1, 1]}], [m.encode_event(RECORD)]):
        with pytest.raises(m.LedgerDocumentInvalid):
            m.decode_transition(json.dumps({**envelope, "records": records}).encode(), ID, 1, None)
