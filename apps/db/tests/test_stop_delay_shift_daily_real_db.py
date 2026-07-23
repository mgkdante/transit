"""Real-DB regression for gold.stop_delay_shift_daily (GC1 / Step G4, migration 0071).

Proves the two invariants the shift grain must hold:
  (i)  BUILD-TIME PARITY WITH THE ROUTE SPINE — a boundary-straddling fact (05:59 vs 06:00
       local -> night vs am_peak) buckets to the SAME shift the route spine's hour->shift
       CASE would, because both splice shift_case_sql over the SAME localized-hour expr.
  (ii) CROSS-TABLE ADDITIVE PARITY — SUM over shifts == the stop_delay_spine
       per-(stop,route,date) observation_count (a finer partition of the same in-clamp rows).

Runs only against a disposable Postgres migrated to head:

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://postgres@127.0.0.1:55434/transit_test" \
        uv run pytest tests/test_stop_delay_shift_daily_real_db.py -v

Never point this at production.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text

from transit_ops.gold import rollups

PROVIDER = "stm_shiftgrain_test"
TRIP_ENDPOINT_ID = 994401
TORONTO = ZoneInfo("America/Toronto")
LOCAL_DATE = date(2026, 6, 12)
DATE_KEY = 20260612
BUILT_AT = datetime(2026, 6, 13, 12, 0, tzinfo=UTC)


@pytest.fixture()
def conn(real_db_engine, seed_provider):  # noqa: ANN001, ANN201
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        _seed_provider(connection, seed_provider)
        try:
            yield connection
        finally:
            transaction.rollback()


def _seed_provider(connection, seed_provider) -> None:  # noqa: ANN001
    seed_provider(connection, PROVIDER, display_name="STM shift-grain regression")
    connection.execute(
        text(
            "INSERT INTO core.feed_endpoints "
            "(feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format) "
            "VALUES (:eid, :p, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates')"
        ),
        {"eid": TRIP_ENDPOINT_ID, "p": PROVIDER},
    )


def _snapshot(connection, sid, run_id, captured_at, n) -> None:  # noqa: ANN001
    connection.execute(
        text(
            "INSERT INTO raw.ingestion_runs "
            "(ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status) "
            "VALUES (:r, :p, :e, 'trip_updates', 'succeeded')"
        ),
        {"r": run_id, "p": PROVIDER, "e": TRIP_ENDPOINT_ID},
    )
    connection.execute(
        text(
            "INSERT INTO raw.realtime_snapshot_index "
            "(realtime_snapshot_id, ingestion_run_id, provider_id, feed_endpoint_id, "
            " feed_timestamp_utc, entity_count, captured_at_utc) "
            "VALUES (:s, :r, :p, :e, :ts, :n, :ts)"
        ),
        {"s": sid, "r": run_id, "p": PROVIDER, "e": TRIP_ENDPOINT_ID, "ts": captured_at, "n": n},
    )


def _fact(connection, sid, idx, captured_at, *, stop_id, route_id, delay) -> None:  # noqa: ANN001
    connection.execute(
        text(
            """
            INSERT INTO gold.fact_trip_delay_snapshot
                (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                 snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                 trip_id, route_id, direction_id, start_date, vehicle_id,
                 trip_schedule_relationship, delay_seconds, stop_time_update_count,
                 delay_stop_id, delay_stop_sequence)
            VALUES (:p, :s, :ei, :dk, :sld, :ts, :ts, :entity, :trip, :route, 0,
                    :sld, NULL, 0, :delay, 1, :stop, 1)
            """
        ),
        {
            "p": PROVIDER,
            "s": sid,
            "ei": idx,
            "dk": DATE_KEY,
            "sld": LOCAL_DATE,
            "ts": captured_at,
            "entity": f"e{sid}-{idx}",
            "trip": f"t{sid}-{idx}",
            "route": route_id,
            "delay": delay,
            "stop": stop_id,
        },
    )


def _at_local(hour: int, minute: int) -> datetime:
    return datetime.combine(LOCAL_DATE, time(hour, minute), tzinfo=TORONTO).astimezone(UTC)


def _seed_boundary_facts(connection) -> None:  # noqa: ANN001
    """Facts straddling the night/am_peak shift edge (05:59 vs 06:00 local) for one (stop,route)."""
    sid, run_id = 994500, 994600
    # 05:59 local -> hour 5 -> night ; 06:00 local -> hour 6 -> am_peak ; 07:00 -> am_peak.
    facts = [
        (_at_local(5, 59), 100),  # night
        (_at_local(6, 0), 200),  # am_peak (severe: >300? no -> not severe)
        (_at_local(7, 0), 400),  # am_peak, severe (>300)
    ]
    _snapshot(connection, sid, run_id, _at_local(6, 0), len(facts))
    for idx, (ts, delay) in enumerate(facts):
        _fact(connection, sid, idx, ts, stop_id="SX", route_id="51", delay=delay)


def _run_builders(connection) -> None:  # noqa: ANN001
    binds = {
        "provider_id": PROVIDER,
        "local_date": LOCAL_DATE,
        "date_key": DATE_KEY,
        "built_at_utc": BUILT_AT,
    }
    connection.execute(rollups.UPSERT_STOP_DELAY_SPINE, binds)
    connection.execute(rollups.UPSERT_STOP_DELAY_SHIFT_DAILY, binds)
    connection.execute(rollups.UPSERT_ROUTE_DELAY_SPINE, binds)


def test_shift_bucketing_matches_route_spine_at_boundary(conn) -> None:  # noqa: ANN001
    _seed_boundary_facts(conn)
    _run_builders(conn)

    # Stop shift grain: night has the 05:59 obs, am_peak has the 06:00 + 07:00 obs.
    shift_rows = {
        r["shift"]: r
        for r in conn.execute(
            text(
                "SELECT shift, observation_count, severe_delay_count, sum_delay_seconds "
                "FROM gold.stop_delay_shift_daily WHERE provider_id = :p AND stop_id = 'SX' "
                "ORDER BY shift"
            ),
            {"p": PROVIDER},
        ).mappings()
    }
    assert shift_rows["night"]["observation_count"] == 1
    assert shift_rows["night"]["sum_delay_seconds"] == 100
    assert shift_rows["am_peak"]["observation_count"] == 2
    assert shift_rows["am_peak"]["severe_delay_count"] == 1  # only the 400s obs is severe
    assert shift_rows["am_peak"]["sum_delay_seconds"] == 600

    # Route spine (hour_of_day_local pre-localized): the same three facts land at hours 5/6/7,
    # which the route projector's shift CASE buckets identically (5 -> night, 6/7 -> am_peak).
    route_by_hour = {
        int(r["hour_of_day_local"]): r["observation_count"]
        for r in conn.execute(
            text(
                "SELECT hour_of_day_local, observation_count FROM gold.route_delay_spine "
                "WHERE provider_id = :p AND route_id = '51' ORDER BY hour_of_day_local"
            ),
            {"p": PROVIDER},
        ).mappings()
    }
    assert route_by_hour[5] == 1  # night
    assert route_by_hour[6] + route_by_hour[7] == 2  # am_peak


def test_cross_table_additive_parity_with_stop_spine(conn) -> None:  # noqa: ANN001
    _seed_boundary_facts(conn)
    _run_builders(conn)

    spine = (
        conn.execute(
            text(
                "SELECT observation_count, severe_delay_count, sum_delay_seconds "
                "FROM gold.stop_delay_spine WHERE provider_id = :p AND stop_id = 'SX' "
                "AND route_id = '51'"
            ),
            {"p": PROVIDER},
        )
        .mappings()
        .one()
    )

    shift_sum = (
        conn.execute(
            text(
                "SELECT SUM(observation_count) AS obs, SUM(severe_delay_count) AS severe, "
                "       SUM(sum_delay_seconds) AS delay "
                "FROM gold.stop_delay_shift_daily WHERE provider_id = :p AND stop_id = 'SX' "
                "  AND route_id = '51'"
            ),
            {"p": PROVIDER},
        )
        .mappings()
        .one()
    )

    # The shift table is a FINER PARTITION of the same in-clamp row set -> SUM-over-shifts
    # equals the stop_delay_spine per-(stop,route,date) counts exactly.
    assert shift_sum["obs"] == spine["observation_count"]
    assert shift_sum["severe"] == spine["severe_delay_count"]
    assert shift_sum["delay"] == spine["sum_delay_seconds"]
