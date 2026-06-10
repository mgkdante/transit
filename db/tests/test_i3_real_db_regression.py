"""Real-database regression tests for the i3 SCD-2 silver loader (slice-9.1.1h).

These tests exercise the actual Postgres constraints (partial unique index,
informed-entities FK) that fake-connection tests structurally cannot see —
the prod incident they lock in (alerts.json frozen since 2026-06-09 14:16Z)
passed every offline test.

They run ONLY when TRANSIT_TEST_DATABASE_URL points at a disposable Postgres
with the transit schema applied (e.g. a throwaway local cluster restored from
`pg_dump --schema-only -n core -n raw -n silver`). Each test runs inside one
transaction and rolls back — nothing persists, reruns are idempotent.

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55432/transit_repro?host=/tmp/i3repro" \
        uv run pytest tests/test_i3_real_db_regression.py -v

Never point this at production.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, text

from transit_ops.silver.i3 import RawI3AlertSnapshot, load_i3_snapshot_to_silver

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set — real-DB regression tests skipped",
)

PROVIDER = "stm_i3fk_test"
ENDPOINT_ID = 990014
RUN_IDS = (990101, 990102, 990103, 990104)
SNAP_IDS = (990001, 990002, 990003, 990004)
T1 = datetime(2026, 6, 10, 3, 0, tzinfo=UTC)
T2 = datetime(2026, 6, 10, 3, 5, tzinfo=UTC)
T3 = datetime(2026, 6, 10, 3, 10, tzinfo=UTC)
T4 = datetime(2026, 6, 10, 3, 15, tzinfo=UTC)
SNAP_TIMES = dict(zip(SNAP_IDS, (T1, T2, T3, T4), strict=True))

ALERT_A = {
    "id": "ALERT-A",
    "header": "Ascenseur hors service - station X",
    "description": "L'ascenseur est hors service.",
    "severity": "info",
    "routes": ["51"],
    "stops": ["S100", "S101"],
}
ALERT_A_MORE_STOPS = {**ALERT_A, "stops": ["S100", "S101", "S102"]}
ALERT_B_V1 = {
    "id": "ALERT-B",
    "header": "Detour 105",
    "description": "v1",
    "severity": "warning",
    "routes": ["105"],
}
ALERT_B_V2 = {**ALERT_B_V1, "description": "v2 - trajet modifie"}
ALERT_C = {"id": "ALERT-C", "header": "Nouvel avis", "routes": ["24"]}


@pytest.fixture()
def conn():
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        _seed(connection)
        try:
            yield connection
        finally:
            transaction.rollback()
        engine.dispose()


def _seed(connection) -> None:
    connection.execute(
        text(
            """
            INSERT INTO core.providers (provider_id, display_name, timezone, provider_key)
            VALUES (:p, 'STM i3 FK regression', 'America/Toronto', :p)
            """
        ),
        {"p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO core.feed_endpoints
                (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
            VALUES (:e, :p, 'i3_alerts', 'i3_alerts', 'api_i3_json')
            """
        ),
        {"e": ENDPOINT_ID, "p": PROVIDER},
    )
    for run_id, snap_id in zip(RUN_IDS, SNAP_IDS, strict=True):
        connection.execute(
            text(
                """
                INSERT INTO raw.ingestion_runs
                    (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
                VALUES (:r, :p, :e, 'i3_alerts', 'succeeded')
                """
            ),
            {"r": run_id, "p": PROVIDER, "e": ENDPOINT_ID},
        )
        connection.execute(
            text(
                """
                INSERT INTO raw.i3_alert_snapshots
                    (i3_alert_snapshot_id, provider_id, feed_endpoint_id,
                     ingestion_run_id, captured_at_utc, raw_payload_json)
                VALUES (:s, :p, :e, :r, :captured, '{}')
                """
            ),
            {
                "s": snap_id,
                "p": PROVIDER,
                "e": ENDPOINT_ID,
                "r": run_id,
                "captured": SNAP_TIMES[snap_id],
            },
        )


def _load(connection, snap_id: int, alerts: list) -> object:
    snapshot = RawI3AlertSnapshot(
        i3_alert_snapshot_id=snap_id,
        provider_id=PROVIDER,
        captured_at_utc=SNAP_TIMES[snap_id],
        raw_payload_json=alerts,
    )
    return load_i3_snapshot_to_silver(connection, snapshot=snapshot)


def _active_rows(connection) -> list[dict]:
    return [
        dict(row)
        for row in connection.execute(
            text(
                """
                SELECT i3_alert_snapshot_id, alert_index, alert_id,
                       description_text, last_seen_at, valid_to
                FROM silver.i3_alerts
                WHERE provider_id = :p
                ORDER BY alert_id, i3_alert_snapshot_id
                """
            ),
            {"p": PROVIDER},
        ).mappings()
    ]


def _entities(connection) -> list[tuple]:
    return list(
        connection.execute(
            text(
                """
                SELECT i3_alert_snapshot_id, alert_index, entity_index, route_id, stop_id
                FROM silver.i3_alert_informed_entities
                WHERE provider_id = :p
                ORDER BY i3_alert_snapshot_id, alert_index, entity_index
                """
            ),
            {"p": PROVIDER},
        )
    )


def test_persisting_alert_with_entities_survives_cross_snapshot_load(conn) -> None:
    """THE regression: an alert whose content is unchanged across snapshots must
    not orphan its informed entities (prod: every load since the 2026-06-09
    deploy rolled back on fk_silver_i3_alert_informed_entities_alert)."""
    _load(conn, SNAP_IDS[0], [ALERT_A, ALERT_B_V1])

    # Pre-fix this raises IntegrityError (ForeignKeyViolation) — ALERT-A's
    # insert is ON CONFLICT-redirected to the snapshot-1 row, so its entities
    # written under snapshot 2 have no parent.
    _load(conn, SNAP_IDS[1], [ALERT_A, ALERT_B_V2, ALERT_C])

    rows = _active_rows(conn)
    by_alert = {}
    for row in rows:
        by_alert.setdefault(row["alert_id"], []).append(row)

    # ALERT-A: single row, still keyed to snapshot 1, active, last_seen bumped.
    (a_row,) = by_alert["ALERT-A"]
    assert a_row["i3_alert_snapshot_id"] == SNAP_IDS[0]
    assert a_row["valid_to"] is None
    assert a_row["last_seen_at"] == T2

    # ALERT-A entities: still exactly the two original rows on the snap-1 key.
    a_entities = [e for e in _entities(conn) if e[0] == SNAP_IDS[0] and e[1] == 0]
    assert {(e[3], e[4]) for e in a_entities} == {("51", "S100"), ("51", "S101")}

    # ALERT-B: v1 superseded at T2, v2 active under snapshot 2.
    b_rows = by_alert["ALERT-B"]
    v1 = next(r for r in b_rows if r["description_text"] == "v1")
    v2 = next(r for r in b_rows if r["description_text"].startswith("v2"))
    assert v1["valid_to"] == T2
    assert v2["valid_to"] is None
    assert v2["i3_alert_snapshot_id"] == SNAP_IDS[1]

    # ALERT-C: new and active with its entity.
    (c_row,) = by_alert["ALERT-C"]
    assert c_row["valid_to"] is None


def test_entity_extension_attaches_to_surviving_row(conn) -> None:
    """Same content hash but a longer stop list: new entities must attach to
    the surviving (older-snapshot) parent row, not crash and not duplicate."""
    _load(conn, SNAP_IDS[0], [ALERT_A])
    _load(conn, SNAP_IDS[1], [ALERT_A_MORE_STOPS])

    a_entities = [e for e in _entities(conn) if e[1] == 0]
    keys = {(e[0], e[1]) for e in a_entities}
    assert keys == {(SNAP_IDS[0], 0)}, "entities must live on the surviving row"
    assert {(e[3], e[4]) for e in a_entities} == {
        ("51", "S100"),
        ("51", "S101"),
        ("51", "S102"),
    }


def test_empty_payload_does_not_supersede(conn) -> None:
    """A feed hiccup returning zero alerts must not close every active alert."""
    _load(conn, SNAP_IDS[0], [ALERT_A, ALERT_B_V1])
    _load(conn, SNAP_IDS[1], [])

    assert all(row["valid_to"] is None for row in _active_rows(conn))


def test_reload_same_snapshot_is_idempotent(conn) -> None:
    """Re-running a load for the same snapshot id must converge, not error."""
    _load(conn, SNAP_IDS[0], [ALERT_A, ALERT_B_V1])
    _load(conn, SNAP_IDS[1], [ALERT_A, ALERT_B_V2, ALERT_C])
    before_rows = _active_rows(conn)
    before_entities = _entities(conn)

    _load(conn, SNAP_IDS[1], [ALERT_A, ALERT_B_V2, ALERT_C])

    assert _active_rows(conn) == before_rows
    assert _entities(conn) == before_entities
