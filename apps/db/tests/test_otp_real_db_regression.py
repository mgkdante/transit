"""Real-database regression tests for observation-based OTP math (slice-9.1.1a).

These tests exercise the actual Postgres views/upserts that offline SQL-string
tests cannot prove: band-edge inclusivity, NULL-guard aggregation, and the 0030
backfill join.

They run ONLY when TRANSIT_TEST_DATABASE_URL points at a disposable Postgres
with the transit schema migrated through 0030:

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55432/transit_repro?host=/tmp/i3repro" \
        uv run pytest tests/test_otp_real_db_regression.py -v

Each test runs inside one transaction and rolls back. Never point this at production.
"""

from __future__ import annotations

import importlib.util
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from sqlalchemy import text

from transit_ops.gold import rollups

PROVIDER = "stm_otp_test"
ENDPOINT_ID = 990030
RUN_ID = 990300
SNAPSHOT_ID = 990400
BUILT_AT = datetime(2026, 6, 12, 12, 0, tzinfo=UTC)
PERIOD = datetime(2026, 6, 12, 12, 5, tzinfo=UTC)


@pytest.fixture()
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        _seed_provider_and_snapshot(connection, seed_provider)
        try:
            yield connection
        finally:
            transaction.rollback()


def _migration_0030():
    path = (
        Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0030_otp_observation_counts.py"
    )
    spec = importlib.util.spec_from_file_location("m0030", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _seed_provider_and_snapshot(connection, seed_provider) -> None:
    seed_provider(connection, PROVIDER, display_name="STM OTP regression")
    connection.execute(
        text(
            """
            INSERT INTO core.feed_endpoints
                (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
            VALUES (:e, :p, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates')
            """
        ),
        {"e": ENDPOINT_ID, "p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
            VALUES (:r, :p, :e, 'trip_updates', 'succeeded')
            """
        ),
        {"r": RUN_ID, "p": PROVIDER, "e": ENDPOINT_ID},
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.realtime_snapshot_index
                (realtime_snapshot_id, ingestion_run_id, provider_id, feed_endpoint_id,
                 feed_timestamp_utc, entity_count, captured_at_utc)
            VALUES (:s, :r, :p, :e, :captured, 0, :captured)
            """
        ),
        {
            "s": SNAPSHOT_ID,
            "r": RUN_ID,
            "p": PROVIDER,
            "e": ENDPOINT_ID,
            "captured": PERIOD,
        },
    )


def _seed_fact_delays(connection, delays: list[int | None], *, route_id: str | None = "51") -> None:
    rows = [
        {
            "p": PROVIDER,
            "snapshot": SNAPSHOT_ID,
            "entity_index": i,
            "snapshot_date_key": 20260612,
            "snapshot_local_date": date(2026, 6, 12),
            "captured": PERIOD,
            "trip_id": f"trip_{i}",
            "route_id": route_id,
            "delay": delay,
        }
        for i, delay in enumerate(delays)
    ]
    connection.execute(
        text(
            """
            INSERT INTO gold.fact_trip_delay_snapshot
                (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                 snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                 trip_id, route_id, direction_id, start_date, vehicle_id,
                 trip_schedule_relationship, delay_seconds, stop_time_update_count)
            VALUES
                (:p, :snapshot, :entity_index, :snapshot_date_key, :snapshot_local_date,
                 :captured, :captured, :trip_id, :trip_id, :route_id, 0,
                 :snapshot_local_date, :trip_id, 0, :delay, 1)
            """
        ),
        rows,
    )


def _insert_5m_summary(
    connection,
    *,
    period: datetime,
    route_id: str = "51",
    delay_obs: int,
    on_time: int | None,
) -> None:
    connection.execute(
        text(
            """
            INSERT INTO gold.trip_delay_summary_5m
                (provider_id, period_start_utc, route_id, trip_count, observation_count,
                 delay_observation_count, on_time_observation_count, avg_delay_seconds,
                 avg_delay_seconds_capped, max_delay_seconds, min_delay_seconds,
                 delayed_trip_count, outlier_count, built_at_utc)
            VALUES
                (:p, :period, :route_id, :delay_obs, :delay_obs, :delay_obs, :on_time,
                 60.0, 60.0, 120, -60, 1, 0, :built_at)
            """
        ),
        {
            "p": PROVIDER,
            "period": period,
            "route_id": route_id,
            "delay_obs": delay_obs,
            "on_time": on_time,
            "built_at": BUILT_AT,
        },
    )


def _insert_hourly(
    connection,
    *,
    period: datetime,
    route_id: str = "51",
    delay_obs: int,
    on_time: int | None,
    observation_count: int | None = None,
    avg_delay_seconds: float = 60.0,
) -> None:
    connection.execute(
        text(
            """
            INSERT INTO gold.route_delay_hourly
                (provider_id, period_start_utc, route_id, trip_count, observation_count,
                 delay_observation_count, on_time_observation_count, avg_delay_seconds,
                 max_delay_seconds, delayed_trip_count, severe_delay_count, built_at_utc)
            VALUES
                (:p, :period, :route_id, :delay_obs, :observation_count, :delay_obs, :on_time,
                 :avg_delay_seconds, 120, 1, 2, :built_at)
            """
        ),
        {
            "p": PROVIDER,
            "period": period,
            "route_id": route_id,
            "delay_obs": delay_obs,
            "on_time": on_time,
            "observation_count": observation_count if observation_count is not None else delay_obs,
            "avg_delay_seconds": avg_delay_seconds,
            "built_at": BUILT_AT,
        },
    )


def _insert_weekly(
    connection,
    *,
    week_start_local: date,
    route_id: str,
    delay_obs: int,
    on_time: int | None,
    observation_count: int,
    avg_delay_seconds: float,
) -> None:
    connection.execute(
        text(
            """
            INSERT INTO gold.route_reliability_weekly
                (provider_id, week_start_local, route_id, observation_count,
                 delay_observation_count, on_time_observation_count, avg_delay_seconds,
                 delayed_trip_count, severe_delay_count, built_at_utc)
            VALUES
                (:p, :week_start_local, :route_id, :observation_count,
                 :delay_obs, :on_time, :avg_delay_seconds, 1, 2, :built_at)
            """
        ),
        {
            "p": PROVIDER,
            "week_start_local": week_start_local,
            "route_id": route_id,
            "observation_count": observation_count,
            "delay_obs": delay_obs,
            "on_time": on_time,
            "avg_delay_seconds": avg_delay_seconds,
            "built_at": BUILT_AT,
        },
    )


def _run_route_delay_hourly_rollup(connection) -> None:  # noqa: ANN001
    params = {
        "provider_id": PROVIDER,
        "built_at_utc": BUILT_AT,
        "open_window_days": 10,
    }
    connection.execute(rollups.DELETE_REPORTING_AGGREGATES["route_delay_hourly"], params)
    connection.execute(rollups.UPSERT_ROUTE_DELAY_HOURLY, params)


def test_5m_upsert_counts_on_time_band_edges(conn) -> None:
    _seed_fact_delays(conn, [-120, -60, 0, 299, 300, 400, None])

    conn.execute(
        rollups.UPSERT_TRIP_DELAY_SUMMARY_5M,
        {"provider_id": PROVIDER, "period_start_utc": PERIOD, "built_at_utc": BUILT_AT},
    )

    row = (
        conn.execute(
            text(
                """
            SELECT observation_count, delay_observation_count, on_time_observation_count
            FROM gold.trip_delay_summary_5m
            WHERE provider_id = :p AND period_start_utc = :period AND route_id = '51'
            """
            ),
            {"p": PROVIDER, "period": PERIOD},
        )
        .mappings()
        .one()
    )

    assert row["on_time_observation_count"] == 3
    assert row["delay_observation_count"] == 6
    assert row["observation_count"] == 7


def test_hourly_rollup_null_guard_propagates_legacy_buckets(conn) -> None:
    _insert_5m_summary(conn, period=PERIOD, delay_obs=6, on_time=5)
    _insert_5m_summary(
        conn,
        period=datetime(2026, 6, 12, 12, 10, tzinfo=UTC),
        delay_obs=4,
        on_time=None,
    )

    _run_route_delay_hourly_rollup(conn)
    row = (
        conn.execute(
            text(
                """
            SELECT delay_observation_count, on_time_observation_count
            FROM gold.route_delay_hourly
            WHERE provider_id = :p
              AND period_start_utc = date_trunc('hour', CAST(:period AS timestamptz))
            """
            ),
            {"p": PROVIDER, "period": PERIOD},
        )
        .mappings()
        .one()
    )
    assert row["delay_observation_count"] == 10
    assert row["on_time_observation_count"] is None

    conn.execute(
        text(
            """
            UPDATE gold.trip_delay_summary_5m
            SET on_time_observation_count = 4
            WHERE provider_id = :p AND period_start_utc <> :period
            """
        ),
        {"p": PROVIDER, "period": PERIOD},
    )
    _run_route_delay_hourly_rollup(conn)
    on_time = conn.execute(
        text(
            """
            SELECT on_time_observation_count
            FROM gold.route_delay_hourly
            WHERE provider_id = :p
              AND period_start_utc = date_trunc('hour', CAST(:period AS timestamptz))
            """
        ),
        {"p": PROVIDER, "period": PERIOD},
    ).scalar_one()
    assert on_time == 9


def test_public_daily_view_null_guard(conn) -> None:
    _insert_hourly(conn, period=datetime(2026, 6, 12, 12, 0, tzinfo=UTC), delay_obs=6, on_time=5)
    _insert_hourly(conn, period=datetime(2026, 6, 12, 13, 0, tzinfo=UTC), delay_obs=4, on_time=None)

    row = (
        conn.execute(
            text(
                """
            SELECT delay_observation_count, on_time_observation_count
            FROM gold.public_route_reliability_daily
            WHERE provider_id = :p AND route_id = '51'
            """
            ),
            {"p": PROVIDER},
        )
        .mappings()
        .one()
    )
    assert row["delay_observation_count"] == 10
    assert row["on_time_observation_count"] is None

    conn.execute(
        text(
            """
            UPDATE gold.route_delay_hourly
            SET on_time_observation_count = 4
            WHERE provider_id = :p AND on_time_observation_count IS NULL
            """
        ),
        {"p": PROVIDER},
    )
    on_time = conn.execute(
        text(
            """
            SELECT on_time_observation_count
            FROM gold.public_route_reliability_daily
            WHERE provider_id = :p AND route_id = '51'
            """
        ),
        {"p": PROVIDER},
    ).scalar_one()
    assert on_time == 9


def test_migration_backfill_fills_buckets_within_fact_window(conn) -> None:
    migration = _migration_0030()
    _insert_5m_summary(conn, period=PERIOD, route_id="__unrouted__", delay_obs=3, on_time=None)
    _insert_5m_summary(
        conn,
        period=datetime(2026, 6, 12, 12, 15, tzinfo=UTC),
        route_id="__unrouted__",
        delay_obs=3,
        on_time=None,
    )
    _seed_fact_delays(conn, [-60, 0, 300], route_id=None)

    conn.execute(text(migration._BACKFILL_5M_ON_TIME))

    rows = {
        row["period_start_utc"]: row["on_time_observation_count"]
        for row in conn.execute(
            text(
                """
                SELECT period_start_utc, on_time_observation_count
                FROM gold.trip_delay_summary_5m
                WHERE provider_id = :p
                ORDER BY period_start_utc
                """
            ),
            {"p": PROVIDER},
        ).mappings()
    }
    assert rows[PERIOD] == 2
    assert rows[datetime(2026, 6, 12, 12, 15, tzinfo=UTC)] is None
