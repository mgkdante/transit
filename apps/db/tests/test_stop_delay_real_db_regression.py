"""Real-database regressions for per-stop delay attribution and stop rollups.

These tests run only against a disposable Postgres database migrated to head:

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55432/transit_repro?host=/tmp/i3repro" \
        uv run pytest tests/test_stop_delay_real_db_regression.py -v

Never point this at production.
"""

from __future__ import annotations

import os
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import create_engine, text

from transit_ops.gold import marts, rollups

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set - real-DB regression tests skipped",
)

PROVIDER = "stm_stopdelay_test"
STATIC_ENDPOINT_ID = 993401
TRIP_ENDPOINT_ID = 993402
STATIC_RUN_ID = 993500
TRIP_RUN_ID = 993501
SNAPSHOT_ID = 993600
RT_FEED_SNAPSHOT_ID = 993700
DATASET_VERSION_ID = 993800
BUILT_AT = datetime(2026, 6, 12, 13, 0, tzinfo=UTC)
PERIOD = datetime(2026, 6, 12, 12, 15, tzinfo=UTC)


@pytest.fixture()
def conn():
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        _ensure_delay_stop_columns(connection)
        _seed_provider(connection)
        try:
            yield connection
        finally:
            transaction.rollback()
        engine.dispose()


def _ensure_delay_stop_columns(connection) -> None:  # noqa: ANN001
    for table_name in ("fact_trip_delay_snapshot", "latest_trip_delay_snapshot"):
        connection.execute(
            text(
                f"""
                ALTER TABLE gold.{table_name}
                ADD COLUMN IF NOT EXISTS delay_stop_id text
                """
            )
        )
        connection.execute(
            text(
                f"""
                ALTER TABLE gold.{table_name}
                ADD COLUMN IF NOT EXISTS delay_stop_sequence integer
                """
            )
        )


def _seed_provider(connection) -> None:  # noqa: ANN001
    connection.execute(
        text(
            """
            INSERT INTO core.providers (provider_id, display_name, timezone, provider_key)
            VALUES (:p, 'STM stop-delay regression', 'America/Toronto', :p)
            """
        ),
        {"p": PROVIDER},
    )
    endpoints = [
        (STATIC_ENDPOINT_ID, "static_schedule", "static_schedule", "gtfs_schedule_zip"),
        (TRIP_ENDPOINT_ID, "trip_updates", "trip_updates", "gtfs_rt_trip_updates"),
    ]
    connection.execute(
        text(
            """
            INSERT INTO core.feed_endpoints
                (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
            VALUES (:endpoint_id, :p, :endpoint_key, :feed_kind, :source_format)
            """
        ),
        [
            {
                "endpoint_id": endpoint_id,
                "p": PROVIDER,
                "endpoint_key": endpoint_key,
                "feed_kind": feed_kind,
                "source_format": source_format,
            }
            for endpoint_id, endpoint_key, feed_kind, source_format in endpoints
        ],
    )


def _seed_raw_snapshot(connection) -> None:  # noqa: ANN001
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
            VALUES (:run_id, :p, :endpoint_id, 'trip_updates', 'succeeded')
            """
        ),
        {"run_id": TRIP_RUN_ID, "p": PROVIDER, "endpoint_id": TRIP_ENDPOINT_ID},
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.realtime_snapshot_index
                (realtime_snapshot_id, ingestion_run_id, provider_id, feed_endpoint_id,
                 feed_timestamp_utc, entity_count, captured_at_utc)
            VALUES (:snapshot_id, :run_id, :p, :endpoint_id, :captured, 0, :captured)
            """
        ),
        {
            "snapshot_id": SNAPSHOT_ID,
            "run_id": TRIP_RUN_ID,
            "p": PROVIDER,
            "endpoint_id": TRIP_ENDPOINT_ID,
            "captured": PERIOD,
        },
    )


def _insert_trip_delay_fact(
    connection,  # noqa: ANN001
    *,
    entity_index: int,
    stop_id: str,
    stop_sequence: int,
    delay_seconds: int,
    route_id: str = "51",
) -> None:
    connection.execute(
        text(
            """
            INSERT INTO gold.fact_trip_delay_snapshot
                (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                 snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                 trip_id, route_id, direction_id, start_date, vehicle_id,
                 trip_schedule_relationship, delay_seconds, stop_time_update_count,
                 delay_stop_id, delay_stop_sequence)
            VALUES
                (:p, :snapshot_id, :entity_index, 20260612, :local_date,
                 :captured, :captured, :entity_id, :trip_id, :route_id, 0,
                 :local_date, :vehicle_id, 0, :delay, 1, :stop_id, :stop_sequence)
            """
        ),
        {
            "p": PROVIDER,
            "snapshot_id": SNAPSHOT_ID,
            "entity_index": entity_index,
            "local_date": date(2026, 6, 12),
            "captured": PERIOD,
            "entity_id": f"E{entity_index}",
            "trip_id": f"T{entity_index}",
            "route_id": route_id,
            "vehicle_id": f"V{entity_index}",
            "delay": delay_seconds,
            "stop_id": stop_id,
            "stop_sequence": stop_sequence,
        },
    )


def _run_stop_hourly_rollup(connection) -> None:  # noqa: ANN001
    params = {"provider_id": PROVIDER, "built_at_utc": BUILT_AT, "open_window_days": 10}
    connection.execute(rollups.DELETE_REPORTING_AGGREGATES["stop_delay_hourly"], params)
    connection.execute(rollups.REPORTING_AGGREGATE_UPSERTS["stop_delay_hourly"], params)


def _seed_stop_rollup_facts(connection) -> None:  # noqa: ANN001
    _seed_raw_snapshot(connection)
    for entity_index in range(1, 5):
        _insert_trip_delay_fact(
            connection,
            entity_index=entity_index,
            stop_id="SA",
            stop_sequence=1,
            delay_seconds=600,
        )
    for entity_index in range(5, 7):
        _insert_trip_delay_fact(
            connection,
            entity_index=entity_index,
            stop_id="SB",
            stop_sequence=2,
            delay_seconds=30,
        )
    _insert_trip_delay_fact(
        connection,
        entity_index=7,
        stop_id="SC",
        stop_sequence=3,
        delay_seconds=25000,
    )


def test_stop_delay_hourly_severe_is_per_stop_not_route_max(conn) -> None:  # noqa: ANN001
    _seed_stop_rollup_facts(conn)
    _run_stop_hourly_rollup(conn)

    rows = {
        row["stop_id"]: row
        for row in conn.execute(
            text(
                """
                SELECT stop_id, observation_count, severe_delay_count,
                       avg_arrival_delay_seconds
                FROM gold.stop_delay_hourly
                WHERE provider_id = :p
                ORDER BY stop_id
                """
            ),
            {"p": PROVIDER},
        ).mappings()
    }

    assert rows["SB"]["observation_count"] == 2
    assert rows["SB"]["severe_delay_count"] == 0
    assert float(rows["SB"]["avg_arrival_delay_seconds"]) == 30.0
    assert rows["SA"]["severe_delay_count"] == 4
    assert "SC" not in rows


def test_stop_delay_weekly_propagates_per_stop_values(conn) -> None:  # noqa: ANN001
    _seed_stop_rollup_facts(conn)
    _run_stop_hourly_rollup(conn)

    params = {"provider_id": PROVIDER, "built_at_utc": BUILT_AT}
    conn.execute(rollups.DELETE_REPORTING_AGGREGATES["stop_delay_weekly"], params)
    conn.execute(rollups.REPORTING_AGGREGATE_UPSERTS["stop_delay_weekly"], params)

    row = conn.execute(
        text(
            """
            SELECT observation_count, severe_delay_count, avg_delay_seconds
            FROM gold.stop_delay_weekly
            WHERE provider_id = :p AND stop_id = 'SB'
            """
        ),
        {"p": PROVIDER},
    ).mappings().one()

    assert row["observation_count"] == 2
    assert row["severe_delay_count"] == 0
    assert float(row["avg_delay_seconds"]) == 30.0


def _seed_static_schedule(connection) -> None:  # noqa: ANN001
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
            VALUES (:run_id, :p, :endpoint_id, 'static_schedule', 'succeeded')
            """
        ),
        {"run_id": STATIC_RUN_ID, "p": PROVIDER, "endpoint_id": STATIC_ENDPOINT_ID},
    )
    connection.execute(
        text(
            """
            INSERT INTO core.dataset_versions
                (dataset_version_id, provider_id, feed_endpoint_id,
                 source_ingestion_run_id, dataset_kind, content_hash, is_current)
            VALUES (:dataset_version_id, :p, :endpoint_id, :run_id,
                    'static_schedule', 'stop-delay-static', true)
            """
        ),
        {
            "dataset_version_id": DATASET_VERSION_ID,
            "p": PROVIDER,
            "endpoint_id": STATIC_ENDPOINT_ID,
            "run_id": STATIC_RUN_ID,
        },
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.routes
                (dataset_version_id, provider_id, route_id, route_type)
            VALUES (:dataset_version_id, :p, '51', 3)
            """
        ),
        {"dataset_version_id": DATASET_VERSION_ID, "p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.stops
                (dataset_version_id, provider_id, stop_id, stop_name)
            VALUES
                (:dataset_version_id, :p, 'S1', 'Stop 1'),
                (:dataset_version_id, :p, 'S2', 'Stop 2')
            """
        ),
        {"dataset_version_id": DATASET_VERSION_ID, "p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.trips
                (dataset_version_id, provider_id, trip_id, route_id, service_id)
            VALUES (:dataset_version_id, :p, 'T_ATTR', '51', 'WK')
            """
        ),
        {"dataset_version_id": DATASET_VERSION_ID, "p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.stop_times
                (dataset_version_id, provider_id, trip_id, stop_sequence,
                 stop_id, arrival_time, departure_time)
            VALUES
                (:dataset_version_id, :p, 'T_ATTR', 1, 'S1', '08:00:00', '08:00:00'),
                (:dataset_version_id, :p, 'T_ATTR', 2, 'S2', '08:08:00', '08:08:00')
            """
        ),
        {"dataset_version_id": DATASET_VERSION_ID, "p": PROVIDER},
    )


def _seed_trip_update_with_past_and_future_stops(connection) -> None:  # noqa: ANN001
    _seed_raw_snapshot(connection)
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_feed_snapshots
                (rt_feed_snapshot_id, provider_id, feed_endpoint_id, ingestion_run_id,
                 endpoint_key, feed_timestamp_utc, captured_at_utc,
                 source_realtime_snapshot_id)
            VALUES
                (:rt_snapshot, :p, :endpoint_id, :run_id, 'trip_updates',
                 :feed_ts, :feed_ts, :source_snapshot)
            """
        ),
        {
            "rt_snapshot": RT_FEED_SNAPSHOT_ID,
            "p": PROVIDER,
            "endpoint_id": TRIP_ENDPOINT_ID,
            "run_id": TRIP_RUN_ID,
            "feed_ts": datetime(2026, 6, 12, 12, 5, tzinfo=UTC),
            "source_snapshot": SNAPSHOT_ID,
        },
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_entities
                (rt_feed_snapshot_id, entity_index, provider_id, entity_id, entity_kind)
            VALUES (:rt_snapshot, 1, :p, 'E_ATTR', 'trip_update')
            """
        ),
        {"rt_snapshot": RT_FEED_SNAPSHOT_ID, "p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_trip_updates
                (rt_feed_snapshot_id, entity_index, provider_id, trip_id, route_id,
                 direction_id, start_date, schedule_relationship,
                 feed_timestamp_utc, captured_at_utc)
            VALUES
                (:rt_snapshot, 1, :p, 'T_ATTR', '51', 0, :start_date, 0,
                 :feed_ts, :feed_ts)
            """
        ),
        {
            "rt_snapshot": RT_FEED_SNAPSHOT_ID,
            "p": PROVIDER,
            "start_date": date(2026, 6, 12),
            "feed_ts": datetime(2026, 6, 12, 12, 5, tzinfo=UTC),
        },
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_trip_update_stop_times
                (rt_feed_snapshot_id, entity_index, stop_time_update_index,
                 provider_id, stop_sequence, stop_id, arrival_time_utc,
                 departure_time_utc, schedule_relationship)
            VALUES
                (:rt_snapshot, 1, 1, :p, 1, 'S1', :past_ts, :past_ts, 0),
                (:rt_snapshot, 1, 2, :p, 2, 'S2', :future_ts, :future_ts, 0)
            """
        ),
        {
            "rt_snapshot": RT_FEED_SNAPSHOT_ID,
            "p": PROVIDER,
            "past_ts": datetime(2026, 6, 12, 12, 1, tzinfo=UTC),
            "future_ts": datetime(2026, 6, 12, 12, 10, tzinfo=UTC),
        },
    )


def test_refresh_attributes_delay_to_next_upcoming_stop(conn) -> None:  # noqa: ANN001
    _seed_static_schedule(conn)
    _seed_trip_update_with_past_and_future_stops(conn)

    conn.execute(
        marts.UPSERT_FACT_TRIP_DELAY_SNAPSHOT_LATEST,
        {
            "provider_id": PROVIDER,
            "provider_timezone": "America/Toronto",
            "dataset_version_id": DATASET_VERSION_ID,
            "realtime_snapshot_id": SNAPSHOT_ID,
        },
    )

    row = conn.execute(
        text(
            """
            SELECT delay_seconds, delay_stop_id, delay_stop_sequence
            FROM gold.fact_trip_delay_snapshot
            WHERE provider_id = :p AND realtime_snapshot_id = :snapshot_id
            """
        ),
        {"p": PROVIDER, "snapshot_id": SNAPSHOT_ID},
    ).mappings().one()

    assert row["delay_seconds"] == 120
    assert row["delay_stop_id"] == "S2"
    assert row["delay_stop_sequence"] == 2
