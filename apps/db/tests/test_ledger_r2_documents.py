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
    [
        ("kind", "unknown"),
        ("actor", ""),
        ("reason", ""),
        ("format", 2),
        ("details", {"value": (1, 2)}),
    ],
)
def test_decode_refuses_invalid_event(field, value):
    with pytest.raises(m.LedgerDocumentInvalid):
        m.decode_event({**m.encode_event(RECORD), field: value})


def test_public_record_sequence_round_trips_and_rejects_invalid_ordinals():
    record = replace(RECORD, sequence=7)
    assert m.encode_event(record)["sequence"] == 7
    assert m.decode_event(m.encode_event(record)) == record
    for sequence in (0, -1, [1, 0], 1.0):
        with pytest.raises(m.LedgerDocumentInvalid):
            m.decode_event({**m.encode_event(record), "sequence": sequence})


@pytest.mark.parametrize("state", [None, DOC])
def test_prepare_transition_assigns_stored_public_ordinals(state):
    after, envelope = m.prepare_transition(
        state, (RECORD, RECORD), ID, 1, None, NOW, operation_id="seed", first_record=1
    )
    assert after == state and envelope["next_record"] == 3
    assert [r["sequence"] for r in envelope["records"]] == [1, 2]
    record = envelope["records"][0]
    assert m.decode_transition(json.dumps(envelope).encode(), ID, 1, None) == state
    for records in (([],) if state is None else ()) + (
        [{**record, "sequence": 9}],
        [m.encode_event(RECORD)],
    ):
        with pytest.raises(m.LedgerDocumentInvalid):
            m.decode_transition(json.dumps({**envelope, "records": records}).encode(), ID, 1, None)
    for operation_id in (None, "", 7):
        with pytest.raises(m.LedgerDocumentInvalid):
            m.decode_transition(
                json.dumps({**envelope, "operation_id": operation_id}).encode(), ID, 1, None
            )


def test_candidate_and_recorded_view_preserve_sequence_and_time():
    assert m.normalize_candidate(DOC, None, ID, 3).seq == 3
    assert m.normalize_candidate(None, None, ID, 1) is None
    with pytest.raises(m.LedgerDocumentInvalid):
        m.normalize_candidate(None, DOC, ID, 2)
    record = m.recorded_event(
        m.encode_event(replace(RECORD, sequence=2)), "2026-01-02T03:04:05.123456Z"
    )
    assert (record.kind, record.sequence, record.at_utc) == ("changed", 2, NOW)
    with pytest.raises(m.LedgerDocumentInvalid):
        m.recorded_event(m.encode_event(RECORD), "2026-01-02T03:04:05")
