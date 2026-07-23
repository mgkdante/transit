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
from sqlalchemy import text

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
def conn(real_db_engine, seed_provider):  # noqa: ANN001
    with real_db_engine.connect() as connection:
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
        seed_provider(connection, PROVIDER, display_name="STM tier-2 regression")
        _seed(connection, seed)
        _build_rollups(connection)
        try:
            yield connection, seed
        finally:
            transaction.rollback()


def _seed(connection, seed: _Seed) -> None:  # noqa: ANN001
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
    entity_index: int = 0,
    start_date=None,  # noqa: ANN001
    occupancy_status=None,  # noqa: ANN001
) -> None:
    # snapshot_local_date / snapshot_date_key are the CAPTURE-local date (what the
    # rollup's sargable window keys on). start_date is the GTFS SERVICE day; it defaults
    # to the capture date but can be passed explicitly for an OVERNIGHT trip whose
    # post-midnight tail is captured on the next calendar day (FIX-2 service-day grain).
    local_date = captured_at.astimezone(TORONTO).date()
    service_date = start_date or local_date
    connection.execute(
        text(
            """
            INSERT INTO gold.fact_trip_delay_snapshot
                (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                 snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                 trip_id, route_id, direction_id, start_date, vehicle_id, occupancy_status,
                 trip_schedule_relationship, delay_seconds, stop_time_update_count,
                 skipped_stop_count, delay_stop_id, delay_stop_sequence)
            VALUES (:p, :sid, :eidx, :dk, :sld, :ts, :ts, :entity_id, :trip_id, :route_id,
                    0, :service_date, NULL, :occ, NULL, :delay, :stop_updates, :skipped, 'S1', 1)
            """
        ),
        {
            "p": PROVIDER,
            "sid": snapshot_id,
            "eidx": entity_index,
            "dk": int(local_date.strftime("%Y%m%d")),
            "sld": local_date,
            "service_date": service_date,
            "ts": captured_at,
            "entity_id": f"{trip_id}-{snapshot_id}-{entity_index}",
            "trip_id": trip_id,
            "route_id": route_id,
            "occ": occupancy_status,
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


def _seed_span(connection, seed: _Seed) -> None:  # noqa: ANN001
    """FIX-2 service-day-grain seed. service_date D = closed_local_date - 1 (a closed day);
    its post-midnight tail is captured on D+1 = closed_local_date (also closed), so the run for
    local_date=D+1 builds service day D from the 2-day window {D, D+1} filtered start_date=D.

    Trips (ALL start_date = D):
      T1 10:00 D  delay 30   (first trip)
      T2 10:30 D  delay 60
      T3 14:00 D  delay 120
      T4 23:50 D  delay 200  + 00:30 D+1 delay 600   (OVERNIGHT last trip; its tail crosses
                                                       midnight, captured on D+1, start_date D)
    -> service day D: first=10:00, last=23:50, span=830 min, trip_count=4, first_delay=30,
       last_delay=600 (T4's TERMINAL obs, NOT its first obs 200 — the FIX-2 terminal fix).
    """
    connection.execute(
        text(
            "INSERT INTO core.feed_endpoints "
            "(feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format) "
            "VALUES (:eid, :p, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates')"
        ),
        {"eid": ENDPOINT_ID, "p": PROVIDER},
    )
    service_date = seed.closed_local_date - timedelta(days=1)  # D
    d_midnight = datetime(service_date.year, service_date.month, service_date.day, tzinfo=TORONTO)

    def _obs(trip_id: str, minutes: int, delay: int, *, entity_index: int = 0) -> None:
        captured_at = (d_midnight + timedelta(minutes=minutes)).astimezone(UTC)
        snapshot_id = _insert_snapshot(connection, seed, captured_at)
        _insert_trip_delay_row(
            connection, snapshot_id, captured_at, trip_id, "88S", delay,
            entity_index=entity_index, start_date=service_date,
        )

    _obs("T1", 10 * 60, 30)
    _obs("T2", 10 * 60 + 30, 60)
    _obs("T3", 14 * 60, 120)
    # T4 — overnight last trip: first obs 23:50 D (delay 200), terminal obs 00:30 D+1 (delay 600).
    _obs("T4", 23 * 60 + 50, 200, entity_index=0)
    _obs("T4", 24 * 60 + 30, 600, entity_index=1)  # 00:30 on D+1, same trip + start_date D


@pytest.fixture()
def conn_span(real_db_engine, seed_provider):  # noqa: ANN001
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        base_utc = (
            datetime.now(TORONTO)
            .replace(hour=12, minute=0, second=0, microsecond=0)
            .astimezone(UTC)
        )
        seed = _Seed(base_utc)
        seed_provider(connection, PROVIDER, display_name="STM tier-2 span regression")
        _seed_span(connection, seed)
        _build_rollups(connection)
        try:
            yield connection, seed
        finally:
            transaction.rollback()


def test_service_span_regrains_on_service_day_with_terminal_delay(conn_span) -> None:  # noqa: ANN001
    connection, seed = conn_span
    service_date = seed.closed_local_date - timedelta(days=1)  # D

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
        {"p": PROVIDER, "d": service_date},
    ).mappings().one()

    # FIX-2 re-grain: the row lands on the GTFS service day D (= closed_local_date - 1), and the
    # overnight tail captured on D+1 is folded in (the 2-day window), not split off.
    assert row["trip_count"] == 4
    # 10:00 D → 23:50 D = 13h50m = 830 min (the real operating span, not a fake ~24h).
    assert row["service_span_min"] == 830
    assert row["first_trip_delay_seconds"] == 30  # first trip's first obs
    # FIX-2 terminal fix: the LAST trip's LATEST (00:30 D+1) obs delay 600, NOT its first obs 200.
    assert row["last_trip_delay_seconds"] == 600
    assert row["first_trip_start_utc"] < row["last_trip_start_utc"]

    # No clobber / no misattribution: the post-midnight tail did NOT fabricate a spurious row on
    # the next calendar day (D+1 = closed_local_date).
    spurious = connection.execute(
        text(
            "SELECT COUNT(*) FROM gold.route_service_span_daily "
            "WHERE provider_id = :p AND route_id = '88S' AND provider_local_date = :d"
        ),
        {"p": PROVIDER, "d": seed.closed_local_date},
    ).scalar_one()
    assert spurious == 0


def test_service_span_is_append_only_idempotent(conn_span) -> None:  # noqa: ANN001
    connection, _seed = conn_span

    def _count() -> int:
        return connection.execute(
            text("SELECT COUNT(*) FROM gold.route_service_span_daily WHERE provider_id = :p"),
            {"p": PROVIDER},
        ).scalar_one()

    before = _count()
    assert before == 1  # exactly one service-day row was built (no double-count from the 2-day window)
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


def _seed_crowding(connection, seed: _Seed) -> None:  # noqa: ANN001
    """FIX-3 co-observation seed. Delay-fact rows on the closed day carry occupancy_status, so the
    new route_delay_by_crowding_daily rollup buckets each delay by ITS OWN band (not a day-dominant
    band). Bands seeded (delay_seconds): many_seats(1) 60/120/180; standing via codes 3 AND 4
    (240/360 — must fold to one 'standing' band); full(5) 600/900 (the high-crowding tail that the
    OLD dominant-band design censored); plus one NULL-occupancy row (excluded)."""
    connection.execute(
        text(
            "INSERT INTO core.feed_endpoints "
            "(feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format) "
            "VALUES (:eid, :p, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates')"
        ),
        {"eid": ENDPOINT_ID, "p": PROVIDER},
    )
    local_date = seed.closed_local_date
    day_local_midnight = datetime(local_date.year, local_date.month, local_date.day, tzinfo=TORONTO)
    # (trip, minute, delay, occupancy_status)
    rows = [
        ("M1", 600, 60, 1), ("M2", 605, 120, 1), ("M3", 610, 180, 1),   # many_seats
        ("S1", 700, 240, 3), ("S2", 705, 360, 4),                       # standing (3 + 4 fold)
        ("F1", 800, 600, 5), ("F2", 805, 900, 5),                       # full (tail, uncensored)
        ("X1", 900, 100, None),                                         # no VP match -> excluded
    ]
    for trip_id, minute, delay, occ in rows:
        captured_at = (day_local_midnight + timedelta(minutes=minute)).astimezone(UTC)
        snapshot_id = _insert_snapshot(connection, seed, captured_at)
        _insert_trip_delay_row(
            connection, snapshot_id, captured_at, trip_id, "88S", delay, occupancy_status=occ
        )


@pytest.fixture()
def conn_crowding(real_db_engine, seed_provider):  # noqa: ANN001
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        base_utc = (
            datetime.now(TORONTO)
            .replace(hour=12, minute=0, second=0, microsecond=0)
            .astimezone(UTC)
        )
        seed = _Seed(base_utc)
        seed_provider(connection, PROVIDER, display_name="STM tier-2 crowding regression")
        _seed_crowding(connection, seed)
        _build_rollups(connection)
        try:
            yield connection, seed
        finally:
            transaction.rollback()


def test_delay_by_crowding_co_observes_per_band(conn_crowding) -> None:  # noqa: ANN001
    connection, seed = conn_crowding

    bands = {
        r["band"]: r
        for r in connection.execute(
            text(
                """
                SELECT band, delay_observation_count, sum_delay_seconds, p50_delay_seconds
                FROM gold.route_delay_by_crowding_daily
                WHERE provider_id = :p AND route_id = '88S' AND provider_local_date = :d
                """
            ),
            {"p": PROVIDER, "d": seed.closed_local_date},
        ).mappings()
    }

    # Each band carries its OWN delay distribution — the NULL-occupancy row is excluded, and
    # occupancy codes 3 AND 4 fold to one 'standing' band.
    assert set(bands) == {"many_seats", "standing", "full"}
    assert bands["many_seats"]["delay_observation_count"] == 3
    assert float(bands["many_seats"]["sum_delay_seconds"]) == 360.0
    assert float(bands["many_seats"]["p50_delay_seconds"]) == 120.0
    # standing = codes 3 (240) + 4 (360) folded into one band.
    assert bands["standing"]["delay_observation_count"] == 2
    assert float(bands["standing"]["sum_delay_seconds"]) == 600.0
    # full = the high-crowding tail the old dominant-band design censored — now observable.
    assert bands["full"]["delay_observation_count"] == 2
    assert float(bands["full"]["sum_delay_seconds"]) == 1500.0
    assert "route_delay_by_crowding_daily" in {
        k
        for (k,) in connection.execute(
            text(
                "SELECT DISTINCT rollup_kind FROM gold.warm_rollup_periods WHERE provider_id = :p"
            ),
            {"p": PROVIDER},
        )
    }
