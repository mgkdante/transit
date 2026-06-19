"""Real-database regression tests for Tier-1 rollups (cancellation + occupancy band).

Run only against a disposable Postgres database with the full Transit schema
migrated to head:

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55432/transit_repro?host=/tmp/i3repro" \
        uv run pytest tests/test_tier1_rollups_real_db_regression.py -v

Never point this at production.

These exercise the two correctness-critical Tier-1 properties that the
FakeConnection unit tests cannot (they don't execute SQL):
  - cancellation dedup + denominator honesty: multiple polls of one canceled
    (trip_id, start_date) collapse to one canceled trip-day, and scheduled trips
    with a NULL schedule_relationship STAY in the denominator (the adversary fix).
  - occupancy band counts: code 4 (CRUSHED_STANDING) folds into standing and
    NO_DATA/NOT_BOARDABLE codes are excluded from observation_count; the daily
    reduction is append-only (idempotent on rebuild).
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from decimal import Decimal
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

PROVIDER = "stm_tier1_test"
TU_ENDPOINT_ID = 993001
VP_ENDPOINT_ID = 993002
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
        self.today_local = base_utc.astimezone(TORONTO).date()
        self.closed_day_utc = base_utc - timedelta(days=1)
        self.closed_local_date = self.closed_day_utc.astimezone(TORONTO).date()
        self.snapshot_id = 993100
        self.run_id = 994100

    def next_ids(self) -> tuple[int, int]:
        self.snapshot_id += 1
        self.run_id += 1
        return self.snapshot_id, self.run_id


@pytest.fixture()
def conn():
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        # Anchor in the provider timezone (America/Toronto) — the same calendar
        # the closed-day rollup filter uses (local_date < (now() AT TIME ZONE
        # provider)::date). A UTC-anchored base flakes at the UTC/Toronto date
        # boundary: once Toronto crosses midnight, the UTC-derived today_local lags
        # the build's, so the open-day seed rows land on a day already treated as
        # closed. Noon-today local keeps today_local == the build's at any hour.
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
            VALUES (:p, 'STM tier-1 regression', 'America/Toronto', :p)
            """
        ),
        {"p": PROVIDER},
    )
    for endpoint_id, key, kind, fmt in (
        (TU_ENDPOINT_ID, "trip_updates", "trip_updates", "gtfs_rt_trip_updates"),
        (VP_ENDPOINT_ID, "vehicle_positions", "vehicle_positions", "gtfs_rt_vehicle_positions"),
    ):
        connection.execute(
            text(
                """
                INSERT INTO core.feed_endpoints
                    (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
                VALUES (:eid, :p, :key, :kind, :fmt)
                """
            ),
            {"eid": endpoint_id, "p": PROVIDER, "key": key, "kind": kind, "fmt": fmt},
        )

    local_date = seed.closed_local_date

    # Cancellation: three polls of the closed day. C1 (canceled) + N1 (NULL,
    # scheduled) appear in all three polls — dedup must collapse each to ONE
    # trip-day. C2 (canceled) + N2 (schedule_relationship=0, scheduled) appear
    # once. Expected: total_trip_days=4 (C1,C2,N1,N2), canceled_trip_days=2.
    for poll in range(3):
        captured_at = seed.closed_day_utc + timedelta(minutes=poll)
        snapshot_id = _insert_snapshot(connection, seed, captured_at, TU_ENDPOINT_ID, 4)
        rows = [
            ("C1", "99C", local_date, 3),   # canceled, every poll
            ("N1", "99C", local_date, None),  # scheduled (NULL), every poll
        ]
        if poll == 0:
            rows += [
                ("C2", "99C", local_date, 3),   # canceled, once
                ("N2", "99C", local_date, 0),   # scheduled (0), once
            ]
        _insert_trip_delay_rows(connection, snapshot_id, captured_at, rows)

    # Occupancy: one vehicle snapshot on the closed day with seven pings on route
    # 99C. Codes 1,1,2,3,4,5 are band-bearing (6); code 7 (NO_DATA) is excluded.
    # Expected bands: empty=0, many_seats=2, few_seats=1, standing=2 (code 3+4),
    # full=1; observation_count=6.
    occ_captured = seed.closed_day_utc + timedelta(minutes=10)
    occ_snapshot = _insert_snapshot(connection, seed, occ_captured, VP_ENDPOINT_ID, 7)
    _insert_vehicle_rows(
        connection,
        occ_snapshot,
        occ_captured,
        [
            ("V1", "99C", 1),
            ("V2", "99C", 1),
            ("V3", "99C", 2),
            ("V4", "99C", 3),
            ("V5", "99C", 4),
            ("V6", "99C", 5),
            ("V7", "99C", 7),
        ],
    )


def _insert_snapshot(
    connection,  # noqa: ANN001
    seed: _Seed,
    captured_at: datetime,
    endpoint_id: int,
    entity_count: int,
) -> int:
    snapshot_id, run_id = seed.next_ids()
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
            VALUES (:run_id, :p, :eid, 'trip_updates', 'succeeded')
            """
        ),
        {"run_id": run_id, "p": PROVIDER, "eid": endpoint_id},
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.realtime_snapshot_index
                (realtime_snapshot_id, ingestion_run_id, provider_id, feed_endpoint_id,
                 feed_timestamp_utc, entity_count, captured_at_utc)
            VALUES (:sid, :run_id, :p, :eid, :ts, :n, :ts)
            """
        ),
        {
            "sid": snapshot_id,
            "run_id": run_id,
            "p": PROVIDER,
            "eid": endpoint_id,
            "ts": captured_at,
            "n": entity_count,
        },
    )
    return snapshot_id


def _insert_trip_delay_rows(
    connection,  # noqa: ANN001
    snapshot_id: int,
    captured_at: datetime,
    rows: list[tuple[str, str, object, object]],
) -> None:
    snapshot_local_date = captured_at.astimezone(TORONTO).date()
    snapshot_date_key = int(snapshot_local_date.strftime("%Y%m%d"))
    for idx, (trip_id, route_id, start_date, schedule_rel) in enumerate(rows):
        connection.execute(
            text(
                """
                INSERT INTO gold.fact_trip_delay_snapshot
                    (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                     snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                     trip_id, route_id, direction_id, start_date, vehicle_id,
                     trip_schedule_relationship, delay_seconds, stop_time_update_count,
                     delay_stop_id, delay_stop_sequence)
                VALUES (:p, :sid, :ei, :dk, :sld, :ts, :ts, :entity_id, :trip_id, :route_id,
                        0, :start_date, NULL, :sched_rel, 60, 1, 'S1', :seq)
                """
            ),
            {
                "p": PROVIDER,
                "sid": snapshot_id,
                "ei": idx,
                "dk": snapshot_date_key,
                "sld": snapshot_local_date,
                "ts": captured_at,
                "entity_id": f"{trip_id}-{snapshot_id}",
                "trip_id": trip_id,
                "route_id": route_id,
                "start_date": start_date,
                "sched_rel": schedule_rel,
                "seq": idx + 1,
            },
        )


def _insert_vehicle_rows(
    connection,  # noqa: ANN001
    snapshot_id: int,
    captured_at: datetime,
    rows: list[tuple[str, str, int]],
) -> None:
    snapshot_local_date = captured_at.astimezone(TORONTO).date()
    snapshot_date_key = int(snapshot_local_date.strftime("%Y%m%d"))
    for idx, (vehicle_id, route_id, occupancy_status) in enumerate(rows):
        connection.execute(
            text(
                """
                INSERT INTO gold.fact_vehicle_snapshot
                    (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                     snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                     vehicle_id, trip_id, route_id, stop_id, current_stop_sequence,
                     current_status, occupancy_status, latitude, longitude, bearing, speed)
                VALUES (:p, :sid, :ei, :dk, :sld, :ts, :ts, :entity_id, :vehicle_id, NULL,
                        :route_id, NULL, NULL, NULL, :occ, NULL, NULL, NULL, NULL)
                """
            ),
            {
                "p": PROVIDER,
                "sid": snapshot_id,
                "ei": idx,
                "dk": snapshot_date_key,
                "sld": snapshot_local_date,
                "ts": captured_at,
                "entity_id": f"{vehicle_id}-{snapshot_id}",
                "vehicle_id": vehicle_id,
                "route_id": route_id,
                "occ": occupancy_status,
            },
        )


def _build_rollups(connection) -> None:  # noqa: ANN001
    rollups.build_warm_rollups(
        PROVIDER,
        settings=Settings.model_construct(DATABASE_URL=None),
        engine=_NoCommitEngine(connection),
    )


def _decimal(value: object) -> Decimal:
    assert value is not None
    return Decimal(str(value))


def test_cancellation_dedups_polls_and_keeps_null_scheduled_in_denominator(conn) -> None:  # noqa: ANN001
    connection, seed = conn

    row = connection.execute(
        text(
            """
            SELECT total_trip_days, canceled_trip_days, cancellation_rate_pct
            FROM gold.route_cancellation_daily
            WHERE provider_id = :p AND route_id = '99C'
              AND provider_local_date = :d
            """
        ),
        {"p": PROVIDER, "d": seed.closed_local_date},
    ).mappings().one()

    # Dedup: C1 (3 polls) + C2 (1 poll) = 2 distinct canceled trip-days, not 4.
    assert row["canceled_trip_days"] == 2
    # Denominator includes the NULL-schedule scheduled trip N1 (the adversary fix):
    # C1, C2, N1, N2 = 4 distinct (trip_id, start_date). If NULL were dropped the
    # denominator would be 3 and the rate would inflate to 66.67%.
    assert row["total_trip_days"] == 4
    assert _decimal(row["cancellation_rate_pct"]) == Decimal("50.00")

    # The open (current) local day is never built.
    today_rows = connection.execute(
        text(
            "SELECT COUNT(*) FROM gold.route_cancellation_daily "
            "WHERE provider_id = :p AND provider_local_date = :d"
        ),
        {"p": PROVIDER, "d": seed.today_local},
    ).scalar_one()
    assert today_rows == 0


def test_occupancy_band_counts_fold_code4_and_exclude_no_data(conn) -> None:  # noqa: ANN001
    connection, seed = conn

    daily = connection.execute(
        text(
            """
            SELECT observation_count, empty_count, many_seats_count,
                   few_seats_count, standing_count, full_count
            FROM gold.route_occupancy_band_daily
            WHERE provider_id = :p AND route_id = '99C'
              AND provider_local_date = :d
            """
        ),
        {"p": PROVIDER, "d": seed.closed_local_date},
    ).mappings().one()

    assert daily["observation_count"] == 6  # code 7 (NO_DATA) excluded
    assert daily["empty_count"] == 0
    assert daily["many_seats_count"] == 2
    assert daily["few_seats_count"] == 1
    assert daily["standing_count"] == 2  # code 3 + code 4 (CRUSHED_STANDING)
    assert daily["full_count"] == 1
    # Band counts partition observation_count exactly.
    band_sum = (
        daily["empty_count"] + daily["many_seats_count"] + daily["few_seats_count"]
        + daily["standing_count"] + daily["full_count"]
    )
    assert band_sum == daily["observation_count"]

    # The 5m mirror carries the same partition for the seeded bin.
    five_min = connection.execute(
        text(
            """
            SELECT observation_count, standing_count, full_count
            FROM gold.occupancy_summary_5m
            WHERE provider_id = :p AND route_id = '99C'
            ORDER BY observation_count DESC
            LIMIT 1
            """
        ),
        {"p": PROVIDER},
    ).mappings().one()
    assert five_min["observation_count"] == 6
    assert five_min["standing_count"] == 2


def test_tier1_daily_rollups_are_append_only_idempotent(conn) -> None:  # noqa: ANN001
    connection, _seed = conn

    def _count(table: str) -> int:
        return connection.execute(
            text(f"SELECT COUNT(*) FROM gold.{table} WHERE provider_id = :p"),
            {"p": PROVIDER},
        ).scalar_one()

    before = (_count("route_cancellation_daily"), _count("route_occupancy_band_daily"))
    # Re-running skips already-watermarked days — no duplicate/rewritten rows.
    _build_rollups(connection)
    after = (_count("route_cancellation_daily"), _count("route_occupancy_band_daily"))
    assert after == before

    # Watermark kinds recorded for both new append-only daily rollups.
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
    expected_kinds = {
        "route_cancellation_daily",
        "route_occupancy_band_daily",
        "occupancy_summary_5m",
    }
    assert expected_kinds <= kinds
