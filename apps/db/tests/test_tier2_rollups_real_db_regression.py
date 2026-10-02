from __future__ import annotations

from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text

from transit_ops.gold import rollups
from transit_ops.settings import Settings

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

    local_date = seed.closed_local_date
    day_local_midnight = datetime(
        local_date.year, local_date.month, local_date.day, tzinfo=TORONTO
    )
    starts = [
        ("T1", 10 * 60, 30, 10, 2),
        ("T2", 10 * 60 + 30, 60, 10, 0),
        ("T3", 14 * 60, 120, 10, 1),
    ]
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
    connection.execute(
        text(
            "INSERT INTO core.feed_endpoints "
            "(feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format) "
            "VALUES (:eid, :p, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates')"
        ),
        {"eid": ENDPOINT_ID, "p": PROVIDER},
    )
    service_date = seed.closed_local_date - timedelta(days=1)
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
    _obs("T4", 23 * 60 + 50, 200, entity_index=0)
    _obs("T4", 24 * 60 + 30, 600, entity_index=1)


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
    service_date = seed.closed_local_date - timedelta(days=1)

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

    assert row["trip_count"] == 4
    assert row["service_span_min"] == 830
    assert row["first_trip_delay_seconds"] == 30
    assert row["last_trip_delay_seconds"] == 600
    assert row["first_trip_start_utc"] < row["last_trip_start_utc"]

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
    assert before == 1
    _build_rollups(connection)
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

    assert row["stop_time_update_count"] == 30
    assert row["skipped_stop_count"] == 3
    assert float(row["skipped_stop_rate_pct"]) == 10.00


def _seed_crowding(connection, seed: _Seed) -> None:  # noqa: ANN001
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
    rows = [
        ("M1", 600, 60, 1), ("M2", 605, 120, 1), ("M3", 610, 180, 1),
        ("S1", 700, 240, 3), ("S2", 705, 360, 4),
        ("F1", 800, 600, 5), ("F2", 805, 900, 5),
        ("X1", 900, 100, None),
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

    assert set(bands) == {"many_seats", "standing", "full"}
    assert bands["many_seats"]["delay_observation_count"] == 3
    assert float(bands["many_seats"]["sum_delay_seconds"]) == 360.0
    assert float(bands["many_seats"]["p50_delay_seconds"]) == 120.0
    assert bands["standing"]["delay_observation_count"] == 2
    assert float(bands["standing"]["sum_delay_seconds"]) == 600.0
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
