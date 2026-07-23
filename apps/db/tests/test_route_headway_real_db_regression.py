"""Real-database regressions for route-headway direction and service-day math.

These tests run only against a disposable Postgres database migrated to head:

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55432/transit_repro?host=/tmp/i3repro" \
        uv run pytest tests/test_route_headway_real_db_regression.py -v

Optional local cluster setup used by the gatekeeper:
    initdb -D /tmp/hwrepro-data -U repro --auth=trust
    pg_ctl -D /tmp/hwrepro-data -o "-k /tmp/hwrepro -p 55433 -c listen_addresses=''" start
    createdb -h /tmp/hwrepro -p 55433 -U repro transit_repro
    psql -h /tmp/hwrepro -p 55433 -U repro transit_repro -c 'CREATE EXTENSION postgis'
    pg_dump --schema-only -n core -n raw -n silver -n gold "$PROD_RO_URL" \
        | psql -h /tmp/hwrepro -p 55433 -U repro transit_repro

Never point this at production.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text

from transit_ops.gold import rollups

PROVIDER = "stm_headway_test"
ENDPOINT_ID = 995001
RUN_ID_BASE = 995100
SNAPSHOT_ID_BASE = 995500
BUILT_AT = datetime.now(UTC)
LOCAL_TZ = ZoneInfo("America/Toronto")


@pytest.fixture()
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        _seed_provider(connection, seed_provider)
        try:
            yield connection
        finally:
            transaction.rollback()


def _seed_provider(connection, seed_provider) -> None:
    seed_provider(connection, PROVIDER, display_name="STM headway regression")
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


def _recent_weekday(index: int) -> date:
    seen = 0
    cursor = date.today()
    while True:
        if cursor.weekday() < 5:
            if seen == index:
                return cursor
            seen += 1
        cursor -= timedelta(days=1)


def _recent_saturday() -> date:
    cursor = date.today()
    while cursor.weekday() != 5:
        cursor -= timedelta(days=1)
    return cursor


def _local_to_utc(service_date: date, hour: int, minute: int) -> datetime:
    local = datetime.combine(service_date, time(hour, minute), tzinfo=LOCAL_TZ)
    return local.astimezone(UTC)


def _date_key(service_date: date) -> int:
    return int(service_date.strftime("%Y%m%d"))


def _seed_observation(
    connection,
    *,
    seq: int,
    route_id: str,
    trip_id: str,
    direction_id: int,
    service_date: date,
    captured_at_utc: datetime,
    delay_seconds: int | None = 60,
) -> None:
    run_id = RUN_ID_BASE + seq
    snapshot_id = SNAPSHOT_ID_BASE + seq
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
            VALUES (:run_id, :p, :endpoint_id, 'trip_updates', 'succeeded')
            """
        ),
        {"run_id": run_id, "p": PROVIDER, "endpoint_id": ENDPOINT_ID},
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.realtime_snapshot_index
                (realtime_snapshot_id, ingestion_run_id, provider_id, feed_endpoint_id,
                 feed_timestamp_utc, entity_count, captured_at_utc)
            VALUES (:snapshot_id, :run_id, :p, :endpoint_id, :captured, 1, :captured)
            """
        ),
        {
            "snapshot_id": snapshot_id,
            "run_id": run_id,
            "p": PROVIDER,
            "endpoint_id": ENDPOINT_ID,
            "captured": captured_at_utc,
        },
    )
    connection.execute(
        text(
            """
            INSERT INTO gold.fact_trip_delay_snapshot
                (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                 snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                 trip_id, route_id, direction_id, start_date, vehicle_id,
                 trip_schedule_relationship, delay_seconds, stop_time_update_count)
            VALUES
                (:p, :snapshot_id, 0, :date_key, :service_date, :captured, :captured,
                 :entity_id, :trip_id, :route_id, :direction_id, :service_date,
                 :vehicle_id, 0, :delay, 1)
            """
        ),
        {
            "p": PROVIDER,
            "snapshot_id": snapshot_id,
            "date_key": _date_key(service_date),
            "service_date": service_date,
            "captured": captured_at_utc,
            "entity_id": f"{route_id}:{trip_id}:{seq}",
            "trip_id": trip_id,
            "route_id": route_id,
            "direction_id": direction_id,
            "vehicle_id": f"V{seq}",
            "delay": delay_seconds,
        },
    )


def _seed_pattern(
    connection,
    *,
    seq_start: int,
    route_id: str,
    service_date: date,
    direction_id: int,
    local_times: list[tuple[int, int]],
    trip_ids: list[str] | None = None,
    delay_seconds: int | None = 60,
) -> int:
    trip_ids = trip_ids or [f"{route_id}-{direction_id}-{i}" for i in range(len(local_times))]
    seq = seq_start
    for trip_id, (hour, minute) in zip(trip_ids, local_times, strict=True):
        _seed_observation(
            connection,
            seq=seq,
            route_id=route_id,
            trip_id=trip_id,
            direction_id=direction_id,
            service_date=service_date,
            captured_at_utc=_local_to_utc(service_date, hour, minute),
            delay_seconds=delay_seconds,
        )
        seq += 1
    return seq


def _run_headway_rollup(connection) -> None:
    params = {
        "provider_id": PROVIDER,
        "built_at_utc": BUILT_AT,
        "open_window_days": 10,
        # The upsert now binds the fact window (was a hardcoded 14-day literal).
        "fact_retention_days": 14,
    }
    connection.execute(rollups.DELETE_REPORTING_AGGREGATES["route_headway_by_shift"], params)
    connection.execute(rollups.REPORTING_AGGREGATE_UPSERTS["route_headway_by_shift"], params)


def _headway_rows(connection, route_id: str) -> dict[str, dict]:
    rows = connection.execute(
        text(
            """
            SELECT shift, observed_headway_min, sample_count, headway_cov, bunched_count
            FROM gold.route_headway_by_shift
            WHERE provider_id = :p
              AND route_id = :route_id
            ORDER BY shift
            """
        ),
        {"p": PROVIDER, "route_id": route_id},
    ).mappings()
    return {str(row["shift"]): dict(row) for row in rows}


def _as_float(value: Decimal | float | int) -> float:
    return float(value)


def test_interleaved_directions_do_not_halve_headway(conn) -> None:
    service_date = _recent_weekday(0)
    seq = _seed_pattern(
        conn,
        seq_start=1,
        route_id="51",
        service_date=service_date,
        direction_id=0,
        local_times=[(10, 0), (10, 8), (10, 16), (10, 24)],
    )
    _seed_pattern(
        conn,
        seq_start=seq,
        route_id="51",
        service_date=service_date,
        direction_id=1,
        local_times=[(10, 4), (10, 12), (10, 20)],
    )

    _run_headway_rollup(conn)

    midday = _headway_rows(conn, "51")["midday"]
    assert _as_float(midday["observed_headway_min"]) == 8.0
    assert midday["sample_count"] == 3
    # Tier-2: perfectly regular 8-min gaps → CoV 0.0, no bunching.
    assert _as_float(midday["headway_cov"]) == 0.0
    assert midday["bunched_count"] == 0


def test_headway_cov_and_bunching_on_irregular_gaps(conn) -> None:
    # Busiest direction with irregular gaps: starts at +0,+2,+12,+22 min → gaps
    # [2, 10, 10] min. median=10, mean≈7.33, stddev_samp≈4.62 → CoV≈0.63; the 2-min
    # gap is < 0.5*median(=5) → 1 bunched.
    service_date = _recent_weekday(0)
    _seed_pattern(
        conn,
        seq_start=1,
        route_id="77",
        service_date=service_date,
        direction_id=0,
        local_times=[(10, 0), (10, 2), (10, 12), (10, 22)],
    )

    _run_headway_rollup(conn)

    midday = _headway_rows(conn, "77")["midday"]
    assert midday["sample_count"] == 3
    assert _as_float(midday["observed_headway_min"]) == 10.0
    # CoV = stddev_samp([2,10,10]) / mean ≈ 4.619 / 7.333 ≈ 0.63 (4dp rounded).
    assert 0.6 <= _as_float(midday["headway_cov"]) <= 0.66
    assert midday["bunched_count"] == 1


def test_pre_service_feed_rows_ignored(conn) -> None:
    service_date = _recent_weekday(0)
    trips = [f"52-T{i}" for i in range(4)]
    seq = _seed_pattern(
        conn,
        seq_start=100,
        route_id="52",
        service_date=service_date,
        direction_id=0,
        local_times=[(5, 30), (5, 30), (5, 30), (5, 30)],
        trip_ids=trips,
        delay_seconds=None,
    )
    _seed_pattern(
        conn,
        seq_start=seq,
        route_id="52",
        service_date=service_date,
        direction_id=0,
        local_times=[(10, 0), (10, 8), (10, 16), (10, 24)],
        trip_ids=trips,
    )

    _run_headway_rollup(conn)

    rows = _headway_rows(conn, "52")
    assert "night" not in rows
    assert _as_float(rows["midday"]["observed_headway_min"]) == 8.0
    assert rows["midday"]["sample_count"] == 3


def test_recurring_trip_ids_partition_by_service_day(conn) -> None:
    first_day = _recent_weekday(1)
    second_day = _recent_weekday(0)
    recurring_ids = [f"53-T{i}" for i in range(4)]
    seq = _seed_pattern(
        conn,
        seq_start=200,
        route_id="53",
        service_date=first_day,
        direction_id=0,
        local_times=[(10, 0), (10, 8), (10, 16), (10, 24)],
        trip_ids=recurring_ids,
    )
    _seed_pattern(
        conn,
        seq_start=seq,
        route_id="53",
        service_date=second_day,
        direction_id=0,
        local_times=[(10, 0), (10, 8), (10, 16), (10, 24)],
        trip_ids=recurring_ids,
    )

    _run_headway_rollup(conn)

    midday = _headway_rows(conn, "53")["midday"]
    assert _as_float(midday["observed_headway_min"]) == 8.0
    assert midday["sample_count"] == 6


def test_weekend_service_days_excluded(conn) -> None:
    weekday = _recent_weekday(0)
    saturday = _recent_saturday()
    seq = _seed_pattern(
        conn,
        seq_start=300,
        route_id="54",
        service_date=weekday,
        direction_id=0,
        local_times=[(10, 0), (10, 8), (10, 16), (10, 24)],
    )
    seq = _seed_pattern(
        conn,
        seq_start=seq,
        route_id="54",
        service_date=saturday,
        direction_id=0,
        local_times=[(10, 0), (10, 30), (11, 0), (11, 30)],
    )
    _seed_pattern(
        conn,
        seq_start=seq,
        route_id="54W",
        service_date=saturday,
        direction_id=0,
        local_times=[(10, 0), (10, 30), (11, 0), (11, 30)],
    )

    _run_headway_rollup(conn)

    rows = _headway_rows(conn, "54")
    assert _as_float(rows["midday"]["observed_headway_min"]) == 8.0
    assert rows["midday"]["sample_count"] == 3
    assert _headway_rows(conn, "54W") == {}


def _run_direction_headway_rollup(connection) -> None:
    params = {
        "provider_id": PROVIDER,
        "built_at_utc": BUILT_AT,
        "open_window_days": 10,
        # The upsert now binds the fact window (was a hardcoded 14-day literal).
        "fact_retention_days": 14,
    }
    connection.execute(
        rollups.DELETE_REPORTING_AGGREGATES["route_headway_by_direction_shift"], params
    )
    connection.execute(
        rollups.REPORTING_AGGREGATE_UPSERTS["route_headway_by_direction_shift"], params
    )


def _direction_headway_rows(connection, route_id: str) -> list[dict]:
    rows = connection.execute(
        text(
            """
            SELECT direction_id, service_day_kind, shift, observed_headway_min, sample_count
            FROM gold.route_headway_by_direction_shift
            WHERE provider_id = :p AND route_id = :route_id
            ORDER BY direction_id, service_day_kind, shift
            """
        ),
        {"p": PROVIDER, "route_id": route_id},
    ).mappings()
    return [dict(r) for r in rows]


def test_direction_headway_keeps_both_directions_and_weekends(conn) -> None:
    weekday = _recent_weekday(0)
    saturday = _recent_saturday()
    # Two directions on a weekday (interleaved) + direction 0 on a weekend day.
    seq = _seed_pattern(
        conn,
        seq_start=600,
        route_id="61",
        service_date=weekday,
        direction_id=0,
        local_times=[(10, 0), (10, 8), (10, 16), (10, 24)],
    )
    seq = _seed_pattern(
        conn,
        seq_start=seq,
        route_id="61",
        service_date=weekday,
        direction_id=1,
        local_times=[(10, 4), (10, 12), (10, 20)],
    )
    _seed_pattern(
        conn,
        seq_start=seq,
        route_id="61",
        service_date=saturday,
        direction_id=0,
        local_times=[(10, 0), (10, 10), (10, 20)],
    )

    _run_direction_headway_rollup(conn)
    rows = _direction_headway_rows(conn, "61")

    # Both directions survive on the weekday — NOT collapsed to one busiest direction
    # (the legacy route_headway_by_shift keeps only the busiest direction).
    weekday_dirs = {r["direction_id"] for r in rows if r["service_day_kind"] == "weekday"}
    assert weekday_dirs == {0, 1}
    # Weekend service days are KEPT and tagged (route_headway_by_shift excludes them).
    weekend_rows = [r for r in rows if r["service_day_kind"] == "weekend"]
    assert weekend_rows
    assert all(r["direction_id"] == 0 for r in weekend_rows)
    assert all(r["shift"] == "midday" for r in rows)
