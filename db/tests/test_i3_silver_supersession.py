"""Offline contract tests for the slice-9.1.1h i3 loader fix.

Covers the SQL-shape contract and the pure-Python rekey/supersede sequencing
with a dispatching fake connection. The cross-snapshot FK semantics themselves
(the prod incident) are locked in by tests/test_i3_real_db_regression.py
against a real Postgres — these tests intentionally stay offline per the
repo's no-live-DB convention.
"""

from __future__ import annotations

from datetime import UTC, datetime

from transit_ops.silver.i3 import (
    INSERT_I3_ENTITIES,
    SELECT_ACTIVE_ALERT_KEYS,
    SUPERSEDE_VANISHED_ALERTS,
    RawI3AlertSnapshot,
    load_i3_snapshot_to_silver,
)

SNAP_ID = 900
CAPTURED = datetime(2026, 6, 10, 3, 5, tzinfo=UTC)

ALERT_PERSISTING = {
    "id": "ALERT-A",
    "header": "Ascenseur hors service",
    "severity": "info",
    "routes": ["51"],
    "stops": ["S100", "S101"],
}
ALERT_FRESH = {"id": "ALERT-C", "header": "Nouvel avis", "routes": ["24"]}


class _Result:
    def __init__(self, rows=None, rowcount=0) -> None:  # noqa: ANN001
        self._rows = rows or []
        self.rowcount = rowcount

    def mappings(self):  # noqa: ANN201
        return iter(self._rows)


class _DispatchConnection:
    """Answers the surviving-key SELECT from a canned map and records calls."""

    def __init__(self, surviving_rows, supersede_rowcount=0) -> None:  # noqa: ANN001
        self.calls: list[tuple[str, object]] = []
        self._surviving_rows = surviving_rows
        self._supersede_rowcount = supersede_rowcount

    def execute(self, statement, params=None):  # noqa: ANN001
        sql = str(statement)
        self.calls.append((sql, params))
        if "SELECT content_hash, i3_alert_snapshot_id, alert_index" in sql:
            return _Result(rows=self._surviving_rows)
        if "SET valid_to" in sql:
            return _Result(rowcount=self._supersede_rowcount)
        return _Result()


def _load(connection, alerts) -> object:  # noqa: ANN001
    snapshot = RawI3AlertSnapshot(
        i3_alert_snapshot_id=SNAP_ID,
        provider_id="stm",
        captured_at_utc=CAPTURED,
        raw_payload_json=alerts,
    )
    return load_i3_snapshot_to_silver(connection, snapshot=snapshot)


def _hash_of(connection, alert_index: int):  # noqa: ANN201
    insert_calls = [p for s, p in connection.calls if "INSERT INTO silver.i3_alerts" in s]
    (batch,) = insert_calls
    return next(r["content_hash"] for r in batch if r["alert_index"] == alert_index)


def test_entities_insert_uses_on_conflict_do_nothing() -> None:
    sql = str(INSERT_I3_ENTITIES)
    assert "ON CONFLICT (i3_alert_snapshot_id, alert_index, entity_index) DO NOTHING" in sql


def test_surviving_key_lookup_targets_active_rows_only() -> None:
    sql = str(SELECT_ACTIVE_ALERT_KEYS)
    assert "valid_to IS NULL" in sql
    assert "content_hash IN" in sql


def test_supersede_statement_excludes_legacy_null_hash_rows() -> None:
    sql = str(SUPERSEDE_VANISHED_ALERTS)
    assert "SET valid_to = :captured_at_utc" in sql
    assert "content_hash IS NOT NULL" in sql
    assert "content_hash NOT IN" in sql


def test_redirected_alert_entities_are_rekeyed_to_surviving_row() -> None:
    probe = _DispatchConnection(surviving_rows=[])
    _load(probe, [ALERT_PERSISTING, ALERT_FRESH])
    persisting_hash = _hash_of(probe, 0)
    fresh_hash = _hash_of(probe, 1)

    connection = _DispatchConnection(
        surviving_rows=[
            # ALERT-A redirected to an older snapshot's active row (777, 3).
            {"content_hash": persisting_hash, "i3_alert_snapshot_id": 777, "alert_index": 3},
            # ALERT-C inserted fresh under this snapshot.
            {"content_hash": fresh_hash, "i3_alert_snapshot_id": SNAP_ID, "alert_index": 1},
        ],
        supersede_rowcount=2,
    )
    result = _load(connection, [ALERT_PERSISTING, ALERT_FRESH])

    (entity_batch,) = [
        p for s, p in connection.calls if "i3_alert_informed_entities" in s and "INSERT" in s
    ]
    rekeyed = [(r["i3_alert_snapshot_id"], r["alert_index"]) for r in entity_batch]
    assert rekeyed == [(777, 3), (777, 3), (SNAP_ID, 1)]
    assert result.alerts_redirected_to_existing == 1
    assert result.alerts_superseded == 2
    assert result.entities_dropped_missing_parent == 0
    assert result.informed_entity_rows_inserted == 3


def test_entities_without_surviving_parent_are_dropped_not_inserted() -> None:
    connection = _DispatchConnection(surviving_rows=[])
    result = _load(connection, [ALERT_PERSISTING])

    entity_inserts = [
        p for s, p in connection.calls if "i3_alert_informed_entities" in s and "INSERT" in s
    ]
    assert entity_inserts == []
    assert result.entities_dropped_missing_parent == 2
    assert result.informed_entity_rows_inserted == 0


def test_empty_batch_skips_lookup_and_supersession() -> None:
    connection = _DispatchConnection(surviving_rows=[])
    result = _load(connection, [])

    sqls = [s for s, _ in connection.calls]
    assert not any("SELECT content_hash" in s for s in sqls)
    assert not any("SET valid_to" in s for s in sqls)
    assert result.alerts_superseded == 0


def test_supersession_passes_batch_hashes_and_capture_time() -> None:
    probe = _DispatchConnection(surviving_rows=[])
    _load(probe, [ALERT_PERSISTING])
    batch_hash = _hash_of(probe, 0)

    connection = _DispatchConnection(
        surviving_rows=[
            {"content_hash": batch_hash, "i3_alert_snapshot_id": SNAP_ID, "alert_index": 0}
        ]
    )
    _load(connection, [ALERT_PERSISTING])

    ((_, params),) = [(s, p) for s, p in connection.calls if "SET valid_to" in s]
    assert params["captured_at_utc"] == CAPTURED
    assert params["provider_id"] == "stm"
    assert params["content_hashes"] == [batch_hash]
