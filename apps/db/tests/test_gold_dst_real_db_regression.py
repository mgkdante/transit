"""Real-database DST regression tests for GTFS service-time conversion.

These tests run only against a disposable Postgres 16 database with the Transit
schema migrated to head. The throwaway schema must include gold tables because
the trip-delay refresh writes gold.fact_trip_delay_snapshot directly:

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55432/transit_repro?host=/tmp/i3repro" \
        uv run pytest tests/test_gold_dst_real_db_regression.py -v

For a schema-only rebuild, create postgis before restore and include `-n gold`
with the usual `-n core -n raw -n silver` dump filters. Never point this at
production.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import text

from transit_ops.gold import marts

PROVIDER = "stm_dst_test"
PROVIDER_TZ = "America/Toronto"
STATIC_ENDPOINT_ID = 991001
RT_ENDPOINT_ID = 991002
STATIC_RUN_ID = 991101
RT_RUN_ID = 991102
DATASET_VERSION_ID = 991201
RT_FEED_SNAPSHOT_ID = 991301
SOURCE_REALTIME_SNAPSHOT_ID = 991401


@dataclass(frozen=True)
class Scenario:
    entity_index: int
    start_date: date
    static_arrival_time: str
    actual_arrival_utc: datetime
    old_delay_seconds: int

    @property
    def trip_id(self) -> str:
        return f"dst_trip_{self.entity_index}"

    @property
    def stop_id(self) -> str:
        return f"DST_STOP_{self.entity_index}"


SCENARIOS = (
    Scenario(
        0,
        date(2026, 10, 31),
        "25:30:00",
        datetime(2026, 11, 1, 5, 30, tzinfo=UTC),
        -3600,
    ),
    Scenario(
        1,
        date(2026, 11, 1),
        "00:30:00",
        datetime(2026, 11, 1, 5, 30, tzinfo=UTC),
        3600,
    ),
    Scenario(
        2,
        date(2026, 11, 1),
        "01:30:00",
        datetime(2026, 11, 1, 6, 30, tzinfo=UTC),
        0,
    ),
    Scenario(
        3,
        date(2026, 3, 8),
        "01:30:00",
        datetime(2026, 3, 8, 5, 30, tzinfo=UTC),
        -3600,
    ),
    Scenario(
        4,
        date(2026, 3, 8),
        "02:30:00",
        datetime(2026, 3, 8, 6, 30, tzinfo=UTC),
        -3600,
    ),
    Scenario(
        5,
        date(2026, 6, 9),
        "08:30:00",
        datetime(2026, 6, 9, 12, 30, tzinfo=UTC),
        0,
    ),
    Scenario(
        6,
        date(2026, 6, 9),
        "26:15:00",
        datetime(2026, 6, 10, 6, 15, tzinfo=UTC),
        0,
    ),
)


@pytest.fixture()
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        _seed(connection, seed_provider)
        try:
            yield connection
        finally:
            transaction.rollback()


def _seed(connection, seed_provider) -> None:  # noqa: ANN001
    seed_provider(connection, PROVIDER, display_name="STM DST regression", timezone=PROVIDER_TZ)
    connection.execute(
        text(
            """
            INSERT INTO core.feed_endpoints
                (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
            VALUES
                (:static_endpoint_id, :provider_id, 'static_schedule',
                 'static_schedule', 'gtfs_schedule_zip'),
                (:rt_endpoint_id, :provider_id, 'trip_updates',
                 'trip_updates', 'gtfs_rt_trip_updates')
            """
        ),
        {
            "static_endpoint_id": STATIC_ENDPOINT_ID,
            "rt_endpoint_id": RT_ENDPOINT_ID,
            "provider_id": PROVIDER,
        },
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
            VALUES
                (:static_run_id, :provider_id, :static_endpoint_id, 'static_schedule',
                 'succeeded'),
                (:rt_run_id, :provider_id, :rt_endpoint_id, 'trip_updates', 'succeeded')
            """
        ),
        {
            "static_run_id": STATIC_RUN_ID,
            "rt_run_id": RT_RUN_ID,
            "provider_id": PROVIDER,
            "static_endpoint_id": STATIC_ENDPOINT_ID,
            "rt_endpoint_id": RT_ENDPOINT_ID,
        },
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.realtime_snapshot_index
                (realtime_snapshot_id, ingestion_run_id, provider_id, feed_endpoint_id,
                 feed_timestamp_utc, entity_count, captured_at_utc)
            VALUES (:snapshot_id, :run_id, :provider_id, :endpoint_id, :feed_ts,
                    :entity_count, :feed_ts)
            """
        ),
        {
            "snapshot_id": SOURCE_REALTIME_SNAPSHOT_ID,
            "run_id": RT_RUN_ID,
            "provider_id": PROVIDER,
            "endpoint_id": RT_ENDPOINT_ID,
            "feed_ts": max(s.actual_arrival_utc for s in SCENARIOS),
            "entity_count": len(SCENARIOS),
        },
    )
    connection.execute(
        text(
            """
            INSERT INTO core.dataset_versions
                (dataset_version_id, provider_id, feed_endpoint_id, source_ingestion_run_id,
                 dataset_kind, content_hash, is_current)
            VALUES (:dataset_version_id, :provider_id, :feed_endpoint_id, :run_id,
                    'static_schedule', 'dst-regression-static', true)
            """
        ),
        {
            "dataset_version_id": DATASET_VERSION_ID,
            "provider_id": PROVIDER,
            "feed_endpoint_id": STATIC_ENDPOINT_ID,
            "run_id": STATIC_RUN_ID,
        },
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.routes
                (dataset_version_id, provider_id, route_id, route_short_name, route_type)
            VALUES (:dataset_version_id, :provider_id, 'DST', 'DST', 3)
            """
        ),
        {"dataset_version_id": DATASET_VERSION_ID, "provider_id": PROVIDER},
    )
    _seed_static_trips(connection)
    _seed_realtime_snapshot(connection)


def _seed_static_trips(connection) -> None:  # noqa: ANN001
    rows = [
        {
            "dataset_version_id": DATASET_VERSION_ID,
            "provider_id": PROVIDER,
            "trip_id": scenario.trip_id,
            "stop_id": scenario.stop_id,
            "arrival_time": scenario.static_arrival_time,
        }
        for scenario in SCENARIOS
    ]
    connection.execute(
        text(
            """
            INSERT INTO silver.trips
                (dataset_version_id, provider_id, trip_id, route_id, service_id, direction_id)
            VALUES (:dataset_version_id, :provider_id, :trip_id, 'DST', 'svc', 0)
            """
        ),
        rows,
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.stops
                (dataset_version_id, provider_id, stop_id, stop_name)
            VALUES (:dataset_version_id, :provider_id, :stop_id, :stop_id)
            """
        ),
        rows,
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.stop_times
                (dataset_version_id, provider_id, trip_id, stop_sequence, stop_id,
                 arrival_time, departure_time)
            VALUES (:dataset_version_id, :provider_id, :trip_id, 1, :stop_id,
                    :arrival_time, :arrival_time)
            """
        ),
        rows,
    )


def _seed_realtime_snapshot(connection) -> None:  # noqa: ANN001
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_feed_snapshots
                (rt_feed_snapshot_id, provider_id, feed_endpoint_id, ingestion_run_id,
                 endpoint_key, feed_timestamp_utc, captured_at_utc, source_realtime_snapshot_id)
            VALUES (:rt_feed_snapshot_id, :provider_id, :feed_endpoint_id, :run_id,
                    'trip_updates', :feed_ts, :feed_ts, :source_realtime_snapshot_id)
            """
        ),
        {
            "rt_feed_snapshot_id": RT_FEED_SNAPSHOT_ID,
            "provider_id": PROVIDER,
            "feed_endpoint_id": RT_ENDPOINT_ID,
            "run_id": RT_RUN_ID,
            "feed_ts": max(s.actual_arrival_utc for s in SCENARIOS),
            "source_realtime_snapshot_id": SOURCE_REALTIME_SNAPSHOT_ID,
        },
    )
    rows = [
        {
            "rt_feed_snapshot_id": RT_FEED_SNAPSHOT_ID,
            "entity_index": scenario.entity_index,
            "provider_id": PROVIDER,
            "entity_id": scenario.trip_id,
            "trip_id": scenario.trip_id,
            "route_id": "DST",
            "start_date": scenario.start_date,
            "feed_ts": scenario.actual_arrival_utc - timedelta(minutes=5),
            "actual": scenario.actual_arrival_utc,
            "stop_id": scenario.stop_id,
        }
        for scenario in SCENARIOS
    ]
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_entities
                (rt_feed_snapshot_id, entity_index, provider_id, entity_id, entity_kind)
            VALUES (:rt_feed_snapshot_id, :entity_index, :provider_id, :entity_id,
                    'trip_update')
            """
        ),
        rows,
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_trip_updates
                (rt_feed_snapshot_id, entity_index, provider_id, trip_id, route_id,
                 direction_id, start_date, schedule_relationship, feed_timestamp_utc,
                 captured_at_utc)
            VALUES (:rt_feed_snapshot_id, :entity_index, :provider_id, :trip_id, :route_id,
                    0, :start_date, 0, :feed_ts, :feed_ts)
            """
        ),
        rows,
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_trip_update_stop_times
                (rt_feed_snapshot_id, entity_index, stop_time_update_index, provider_id,
                 stop_sequence, stop_id, arrival_time_utc, departure_time_utc)
            VALUES (:rt_feed_snapshot_id, :entity_index, 0, :provider_id, 1, :stop_id,
                    :actual, :actual)
            """
        ),
        rows,
    )


def _refresh_trip_delays(connection, *, latest_only: bool) -> list[dict[str, object]]:  # noqa: ANN001
    _clear_trip_delays(connection)
    params = {
        "provider_id": PROVIDER,
        "provider_timezone": PROVIDER_TZ,
        "dataset_version_id": DATASET_VERSION_ID,
    }
    if latest_only:
        connection.execute(
            marts.UPSERT_FACT_TRIP_DELAY_SNAPSHOT_LATEST,
            {**params, "realtime_snapshot_id": SOURCE_REALTIME_SNAPSHOT_ID},
        )
    else:
        connection.execute(marts.INSERT_FACT_TRIP_DELAY_SNAPSHOT, params)
    return _trip_delay_rows(connection)


def _clear_trip_delays(connection) -> None:  # noqa: ANN001
    connection.execute(
        text("DELETE FROM gold.fact_trip_delay_snapshot WHERE provider_id = :provider_id"),
        {"provider_id": PROVIDER},
    )


def _trip_delay_rows(connection) -> list[dict[str, object]]:  # noqa: ANN001
    return [
        dict(row)
        for row in connection.execute(
            text(
                """
                SELECT entity_index, trip_id, start_date, delay_seconds, delay_stop_id
                FROM gold.fact_trip_delay_snapshot
                WHERE provider_id = :provider_id
                ORDER BY entity_index
                """
            ),
            {"provider_id": PROVIDER},
        ).mappings()
    ]


def _assert_zero_delays(rows: list[dict[str, object]]) -> None:
    assert len(rows) == len(SCENARIOS)
    expected_old = {scenario.entity_index: scenario.old_delay_seconds for scenario in SCENARIOS}
    assert {row["entity_index"]: row["delay_seconds"] for row in rows} == {
        scenario.entity_index: 0 for scenario in SCENARIOS
    }, f"pre-fix expected old delays were {expected_old}"
    assert {row["entity_index"]: row["delay_stop_id"] for row in rows} == {
        scenario.entity_index: scenario.stop_id for scenario in SCENARIOS
    }


def test_latest_refresh_derives_zero_delay_across_dst_boundaries(conn) -> None:  # noqa: ANN001
    rows = _refresh_trip_delays(conn, latest_only=True)

    _assert_zero_delays(rows)


def test_full_rebuild_variant_matches(conn) -> None:  # noqa: ANN001
    rows = _refresh_trip_delays(conn, latest_only=False)

    _assert_zero_delays(rows)


def test_results_independent_of_session_timezone(conn) -> None:  # noqa: ANN001
    default_rows = _refresh_trip_delays(conn, latest_only=True)
    conn.execute(text("SET LOCAL TimeZone = 'America/Toronto'"))
    toronto_rows = _refresh_trip_delays(conn, latest_only=True)

    assert toronto_rows == default_rows
    _assert_zero_delays(toronto_rows)
