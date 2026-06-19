"""Real-database regression tests for Tier-2 service-span rollup.

Run only against a disposable Postgres database with the full Transit schema
migrated to head:

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55432/transit_repro?host=/tmp/i3repro" \
        uv run pytest tests/test_tier2_rollups_real_db_regression.py -v

Never point this at production.

Headway CoV/bunching is covered in test_route_headway_real_db_regression.py
(which already produces real inter-trip gaps). This file covers the append-only
service-span daily rollup: per-route first/last observed trip-start + span over
one closed local day, idempotent on rebuild.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, text

from transit_ops.gold import rollups
from transit_ops.settings import Settings

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set - real-DB regression tests skipped",
)

PROVIDER = "stm_tier2_test"
ENDPOINT_ID = 995001
TORONTO = ZoneInfo("America/Toronto")


class _NoCommitEngine:
    def __init__(self, connection) -> None:  # noqa: ANN001
        self._connection = connection

    @contextmanager
    def begin(self):  # noqa: ANN201
        yield self._connection


class _Seed:
    def __init__(self, base_utc: datetime) -> None:
        self.base_utc = base_utc
        self.closed_day_utc = base_utc - timedelta(days=1)
        self.closed_local_date = self.closed_day_utc.astimezone(TORONTO).date()
        self.snapshot_id = 995100
        self.run_id = 996100

    def next_ids(self) -> tuple[int, int]:
        self.snapshot_id += 1
        self.run_id += 1
        return self.snapshot_id, self.run_id


@pytest.fixture()
def conn():
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        # Anchor the closed day in the PROVIDER timezone (America/Toronto) — the
        # same calendar the rollup closes days on (`now() AT TIME ZONE provider`,
        # SELECT_MISSING_*_DAYS: local_date < today_local). Noon-today local makes
        # base_utc - 1 day resolve to noon yesterday-local, which is ALWAYS strictly
        # before today_local, so the daily rollups build it at any wall-clock hour.
        # The previous UTC-hour anchor (now(UTC).replace(hour=16)) flaked between
        # 00:00–04:00 UTC: Toronto is still on the prior calendar date then, so the
        # seeded "closed" day equalled today_local and every daily rollup skipped it.
        base_utc = (
            datetime.now(TORONTO)
            .replace(hour=12, minute=0, second=0, microsecond=0)
            .astimezone(UTC)
        )
        seed = _Seed(base_utc)
        _seed(connection, seed)
        _build_rollups(connection)
        try:
            yield connection, seed
        finally:
            transaction.rollback()
        engine.dispose()


def _seed(connection, seed: _Seed) -> None:  # noqa: ANN001
    connection.execute(
        text(
            """
            INSERT INTO core.providers (provider_id, display_name, timezone, provider_key)
            VALUES (:p, 'STM tier-2 regression', 'America/Toronto', :p)
            """
        ),
        {"p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO core.feed_endpoints
                (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
            VALUES (:eid, :p, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates')
            """
        ),
        {"eid": ENDPOINT_ID, "p": PROVIDER},
    )

    # Three trips on the closed day at distinct local start times (one fact each):
    # 10:00, 10:30, 14:00 local → first=10:00, last=14:00, span=240 min, trip_count=3.
    local_date = seed.closed_local_date
    day_local_midnight = datetime(
        local_date.year, local_date.month, local_date.day, tzinfo=TORONTO
    )
    starts = [
        # (trip, minute_of_day, delay, stop_time_update_count, skipped_stop_count)
        ("T1", 10 * 60, 30, 10, 2),   # 10:00, +30s delay (first trip)
        ("T2", 10 * 60 + 30, 60, 10, 0),
        ("T3", 14 * 60, 120, 10, 1),  # 14:00 (last trip), +120s delay
    ]
    # Skipped total = 3, stop-time updates total = 30 → 10.00% skipped-stop rate.
    for trip_id, minute_of_day, delay, stop_updates, skipped in starts:
        captured_at = (day_local_midnight + timedelta(minutes=minute_of_day)).astimezone(UTC)
        snapshot_id = _insert_snapshot(connection, seed, captured_at)
        _insert_trip_delay_row(
            connection, snapshot_id, captured_at, trip_id, "88S", delay, stop_updates, skipped
        )


def _insert_snapshot(connection, seed: _Seed, captured_at: datetime) -> int:  # noqa: ANN001
    snapshot_id, run_id = seed.next_ids()
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
            VALUES (:run_id, :p, :eid, 'trip_updates', 'succeeded')
            """
        ),
        {"run_id": run_id, "p": PROVIDER, "eid": ENDPOINT_ID},
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.realtime_snapshot_index
                (realtime_snapshot_id, ingestion_run_id, provider_id, feed_endpoint_id,
                 feed_timestamp_utc, entity_count, captured_at_utc)
            VALUES (:sid, :run_id, :p, :eid, :ts, 1, :ts)
            """
        ),
        {
            "sid": snapshot_id,
            "run_id": run_id,
            "p": PROVIDER,
            "eid": ENDPOINT_ID,
            "ts": captured_at,
        },
    )
    return snapshot_id


def _insert_trip_delay_row(  # noqa: ANN001
    connection,
    snapshot_id: int,
    captured_at: datetime,
    trip_id: str,
    route_id: str,
    delay: int,
    stop_updates: int = 1,
    skipped: int = 0,
) -> None:
    local_date = captured_at.astimezone(TORONTO).date()
    connection.execute(
        text(
            """
            INSERT INTO gold.fact_trip_delay_snapshot
                (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                 snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                 trip_id, route_id, direction_id, start_date, vehicle_id,
                 trip_schedule_relationship, delay_seconds, stop_time_update_count,
                 skipped_stop_count, delay_stop_id, delay_stop_sequence)
            VALUES (:p, :sid, 0, :dk, :sld, :ts, :ts, :entity_id, :trip_id, :route_id,
                    0, :sld, NULL, NULL, :delay, :stop_updates, :skipped, 'S1', 1)
            """
        ),
        {
            "p": PROVIDER,
            "sid": snapshot_id,
            "dk": int(local_date.strftime("%Y%m%d")),
            "sld": local_date,
            "ts": captured_at,
            "entity_id": f"{trip_id}-{snapshot_id}",
            "trip_id": trip_id,
            "route_id": route_id,
            "delay": delay,
            "stop_updates": stop_updates,
            "skipped": skipped,
        },
    )


def _build_rollups(connection) -> None:  # noqa: ANN001
    rollups.build_warm_rollups(
        PROVIDER,
        settings=Settings.model_construct(DATABASE_URL=None),
        engine=_NoCommitEngine(connection),
    )


def test_service_span_first_last_and_span(conn) -> None:  # noqa: ANN001
    connection, seed = conn

    row = connection.execute(
        text(
            """
            SELECT first_trip_start_utc, last_trip_start_utc, service_span_min,
                   first_trip_delay_seconds, last_trip_delay_seconds, trip_count
            FROM gold.route_service_span_daily
            WHERE provider_id = :p AND route_id = '88S'
              AND provider_local_date = :d
            """
        ),
        {"p": PROVIDER, "d": seed.closed_local_date},
    ).mappings().one()

    assert row["trip_count"] == 3
    # 10:00 → 14:00 local = 240 minutes.
    assert row["service_span_min"] == 240
    # First/last trip punctuality picks the earliest/latest trip's delay.
    assert row["first_trip_delay_seconds"] == 30
    assert row["last_trip_delay_seconds"] == 120
    assert row["first_trip_start_utc"] < row["last_trip_start_utc"]


def test_service_span_is_append_only_idempotent(conn) -> None:  # noqa: ANN001
    connection, _seed = conn

    def _count() -> int:
        return connection.execute(
            text("SELECT COUNT(*) FROM gold.route_service_span_daily WHERE provider_id = :p"),
            {"p": PROVIDER},
        ).scalar_one()

    before = _count()
    _build_rollups(connection)  # re-run skips already-watermarked days
    assert _count() == before

    kinds = {
        k
        for (k,) in connection.execute(
            text(
                "SELECT DISTINCT rollup_kind FROM gold.warm_rollup_periods "
                "WHERE provider_id = :p"
            ),
            {"p": PROVIDER},
        )
    }
    assert "route_service_span_daily" in kinds


def test_skipped_stop_rate_sums_fact_counts(conn) -> None:  # noqa: ANN001
    connection, seed = conn

    row = connection.execute(
        text(
            """
            SELECT stop_time_update_count, skipped_stop_count, skipped_stop_rate_pct
            FROM gold.route_skipped_stop_daily
            WHERE provider_id = :p AND route_id = '88S'
              AND provider_local_date = :d
            """
        ),
        {"p": PROVIDER, "d": seed.closed_local_date},
    ).mappings().one()

    # Seeded: 3 trips with stop_time_update_count 10 each (30) and skipped 2/0/1 (3).
    assert row["stop_time_update_count"] == 30
    assert row["skipped_stop_count"] == 3
    assert float(row["skipped_stop_rate_pct"]) == 10.00
