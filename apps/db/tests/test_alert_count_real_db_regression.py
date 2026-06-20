"""Real-database regression tests for alert counts by content hash.

These tests run only against a disposable Postgres database with the Transit
schema migrated through wave-2 car 3:

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55432/transit_repro?host=/tmp/i3repro" \
        uv run pytest tests/test_alert_count_real_db_regression.py -v

Each test runs in one transaction and rolls back. Never point this at production.
"""

from __future__ import annotations

import importlib.util
import os
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from transit_ops.gold import rollups

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set — real-DB regression tests skipped",
)

PROVIDER = "stm_alertcount_test"
ENDPOINT_ID = 990032
RUN_IDS = (990320, 990321, 990322, 990323)
SNAP_IDS = (990420, 990421, 990422, 990423)
BUILT_AT = datetime(2026, 6, 12, 12, 0, tzinfo=UTC)
D1_CAPTURED_1 = datetime(2026, 6, 8, 15, 0, tzinfo=UTC)
D1_CAPTURED_2 = datetime(2026, 6, 8, 16, 0, tzinfo=UTC)
D2_CAPTURED_1 = datetime(2026, 6, 9, 15, 0, tzinfo=UTC)
D2_CAPTURED_2 = datetime(2026, 6, 9, 16, 0, tzinfo=UTC)


@pytest.fixture()
def conn():
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        _install_alert_count_views(connection)
        _seed_provider_and_snapshots(connection)
        _seed_alert_rows(connection)
        try:
            yield connection
        finally:
            transaction.rollback()
        engine.dispose()


def _migration_0032():
    path = (
        Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0032_alert_counts_by_content_hash.py"
    )
    spec = importlib.util.spec_from_file_location("m0032", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _migration_0037():
    path = (
        Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0037_i3_alert_text_en.py"
    )
    spec = importlib.util.spec_from_file_location("m0037", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _install_alert_count_views(connection) -> None:  # noqa: ANN001
    # Install the 0037 history-view body (the EN superset that keeps
    # effective_content_hash AND appends alert_header_text_en), not 0032's
    # EN-less body. CREATE OR REPLACE against the wave-3 head — where 0037 has
    # already added the EN column to the live view — cannot drop that column,
    # so re-applying the 0032 shape here fails ("cannot drop columns from
    # view"). The impact view (public_alert_impact_daily) is byte-identical
    # across 0032 and 0037 (no EN), so reuse 0032's constant for it.
    history_migration = _migration_0037()
    impact_migration = _migration_0032()
    connection.execute(text(history_migration._REPLACE_HISTORY_VIEW))
    connection.execute(text(impact_migration._IMPACT_VIEW))


def _seed_provider_and_snapshots(connection) -> None:  # noqa: ANN001
    connection.execute(
        text(
            """
            INSERT INTO core.providers (provider_id, display_name, timezone, provider_key)
            VALUES (:p, 'STM alert count regression', 'America/Toronto', :p)
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
    for run_id, snap_id, captured_at in zip(
        RUN_IDS,
        SNAP_IDS,
        (D1_CAPTURED_1, D1_CAPTURED_2, D2_CAPTURED_1, D2_CAPTURED_2),
        strict=True,
    ):
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
                VALUES (:s, :p, :e, :r, :captured, CAST(:payload AS jsonb))
                """
            ),
            {
                "s": snap_id,
                "p": PROVIDER,
                "e": ENDPOINT_ID,
                "r": run_id,
                "captured": captured_at,
                "payload": "{}",
            },
        )


def _seed_alert_rows(connection) -> None:  # noqa: ANN001
    # The two D1 "Elevator issue" rows are the same legacy alert seen twice in a
    # day. Pre-wave-3 they were seeded with content_hash NULL (synthesized hash
    # deduped them to 1); wave-3 slice-l 0039 makes content_hash NOT NULL. The
    # faithful post-l model is an SCD-2 supersession sharing one content_hash:
    # the first occurrence is CLOSED (valid_to = the second's capture) and the
    # second stays ACTIVE — both carry the same hash (legal under the active-only
    # partial unique index) and the reporting view still dedups them to 1.
    rows = [
        _alert_row(
            SNAP_IDS[0], 0, D1_CAPTURED_1, "Elevator issue",
            "legacy-elevator-hash", valid_to=D1_CAPTURED_2,
        ),
        _alert_row(SNAP_IDS[1], 0, D1_CAPTURED_2, "Elevator issue", "legacy-elevator-hash"),
        _alert_row(SNAP_IDS[2], 0, D2_CAPTURED_1, "Elevator issue", "realhash-a"),
        _alert_row(SNAP_IDS[3], 0, D2_CAPTURED_2, "Blue line delay", "realhash-b"),
    ]
    connection.execute(
        text(
            """
            INSERT INTO silver.i3_alerts
                (i3_alert_snapshot_id, alert_index, provider_id, alert_id,
                 alert_header_text, description_text, severity, cause, effect,
                 active_period_start_utc, active_period_end_utc, published_at_utc,
                 updated_at_utc, captured_at_utc, raw_alert_json, content_hash,
                 first_seen_at, last_seen_at, valid_to)
            VALUES
                (:snapshot_id, :alert_index, :provider_id, NULL,
                 :header, :description, :severity, :cause, :effect,
                 NULL, NULL, NULL, NULL, :captured, CAST(:raw AS jsonb), :content_hash,
                 NULL, NULL, :valid_to)
            """
        ),
        rows,
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.i3_alert_informed_entities
                (i3_alert_snapshot_id, alert_index, entity_index, provider_id,
                 route_id, stop_id, trip_id, area_id, raw_entity_json)
            VALUES
                (:snapshot_id, 0, :entity_index, :provider_id,
                 '1', :stop_id, NULL, NULL, CAST(:raw AS jsonb))
            """
        ),
        [
            {
                "snapshot_id": SNAP_IDS[0],
                "entity_index": index,
                "provider_id": PROVIDER,
                "stop_id": stop_id,
                "raw": "{}",
            }
            for index, stop_id in enumerate(("S1", "S2", "S3"))
        ],
    )


def _alert_row(
    snapshot_id: int,
    alert_index: int,
    captured_at: datetime,
    description: str,
    content_hash: str | None,
    valid_to: datetime | None = None,
) -> dict[str, object]:
    return {
        "snapshot_id": snapshot_id,
        "alert_index": alert_index,
        "provider_id": PROVIDER,
        "header": "Service alert",
        "description": description,
        "severity": "warning",
        "cause": "maintenance",
        "effect": "delay",
        "captured": captured_at,
        "raw": "{}",
        "content_hash": content_hash,
        "valid_to": valid_to,
    }


def _run_citizen_rollup(connection) -> None:  # noqa: ANN001
    params = {
        "provider_id": PROVIDER,
        "built_at_utc": BUILT_AT,
        "open_window_days": 10,
    }
    connection.execute(
        rollups.DELETE_REPORTING_AGGREGATES["citizen_accountability_daily"],
        params,
    )
    connection.execute(
        rollups.UPSERT_CITIZEN_ACCOUNTABILITY_DAILY,
        params,
    )


def _daily_row(connection, provider_local_date: date) -> dict[str, object]:  # noqa: ANN001
    return dict(
        connection.execute(
            text(
                """
                SELECT affected_route_count, affected_stop_count,
                       alert_count, rider_impact_score
                FROM gold.citizen_accountability_daily
                WHERE provider_id = :p
                  AND provider_local_date = :d
                """
            ),
            {"p": PROVIDER, "d": provider_local_date},
        )
        .mappings()
        .one()
    )


def test_alert_count_dedups_legacy_duplicates_per_day(conn) -> None:  # noqa: ANN001
    _run_citizen_rollup(conn)

    assert _daily_row(conn, date(2026, 6, 8))["alert_count"] == 1


def test_alert_count_entity_fanout_does_not_inflate(conn) -> None:  # noqa: ANN001
    _run_citizen_rollup(conn)

    assert _daily_row(conn, date(2026, 6, 8))["alert_count"] == 1
    impact_rows = list(
        conn.execute(
            text(
                """
                SELECT stop_id, alert_count
                FROM gold.public_alert_impact_daily
                WHERE provider_id = :p
                  AND provider_local_date = DATE '2026-06-08'
                  AND stop_id IS NOT NULL
                ORDER BY stop_id
                """
            ),
            {"p": PROVIDER},
        )
    )
    assert impact_rows == [("S1", 1), ("S2", 1), ("S3", 1)]


def test_alert_count_distinct_content_across_eras(conn) -> None:  # noqa: ANN001
    _run_citizen_rollup(conn)

    assert _daily_row(conn, date(2026, 6, 9))["alert_count"] == 2


def test_alerts_only_day_is_honest_no_delay_data(conn) -> None:  # noqa: ANN001
    """Truth-audit honesty fix (slice/truth-audit-fixes).

    This fixture seeds ONLY alert rows — no route_delay_hourly / stop_delay_hourly
    telemetry — so the route_daily and stop_daily CTEs both LEFT-JOIN-miss for the
    date. The rollup must NOT fabricate data on such a day:

      * affected_route_count / affected_stop_count publish NULL (the honest "no
        data"), NEVER a fabricated 0 that reads as "zero entities affected".
      * rider_impact_score publishes NULL, NEVER a composite (it would otherwise
        collapse to pure alerts*2 — here 2*2=4.0 — while every reliability input
        is honest-NULL, an internally inconsistent receipt).

    alert_count itself is real (alerts ARE present) so it stays populated.
    """
    _run_citizen_rollup(conn)

    row = _daily_row(conn, date(2026, 6, 9))
    assert row["alert_count"] == 2
    assert row["affected_route_count"] is None
    assert row["affected_stop_count"] is None
    assert row["rider_impact_score"] is None


def test_migration_backfill_recomputes_existing_citizen_daily_rows(conn) -> None:  # noqa: ANN001
    conn.execute(
        text(
            """
            INSERT INTO gold.citizen_accountability_daily
                (provider_id, provider_local_date, affected_route_count,
                 affected_stop_count, delayed_trip_count, severe_delay_count,
                 alert_count, rider_impact_score, built_at_utc)
            VALUES
                (:p, DATE '2026-06-09', 0, 0, 0, 0, 0, 0.0000, :built_at)
            """
        ),
        {"p": PROVIDER, "built_at": BUILT_AT},
    )

    migration = _migration_0032()
    conn.execute(text(migration._BACKFILL_CITIZEN_ACCOUNTABILITY_DAILY))

    row = _daily_row(conn, date(2026, 6, 9))
    assert row["alert_count"] == 2
    assert row["rider_impact_score"] == Decimal("4.0000")
