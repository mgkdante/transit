
from __future__ import annotations

import pytest
from sqlalchemy import text

from transit_ops.snapshots.builders import build_stop_departures, build_trips

PROVIDER = "stm_stopdep_test"
ENDPOINT_ID = 990014
RUN_ID = 990201
RAW_SNAP_ID = 990301
RT_SNAP_ID = 990401


@pytest.fixture()
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        _seed_parents(connection, seed_provider)
        try:
            yield connection
        finally:
            transaction.rollback()


def _seed_parents(connection, seed_provider) -> None:
    seed_provider(connection, PROVIDER, display_name="STM stop-departures regression")
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
                (realtime_snapshot_id, ingestion_run_id, provider_id,
                 feed_endpoint_id, feed_timestamp_utc)
            VALUES (:rs, :r, :p, :e, now())
            """
        ),
        {"rs": RAW_SNAP_ID, "r": RUN_ID, "p": PROVIDER, "e": ENDPOINT_ID},
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_feed_snapshots
                (rt_feed_snapshot_id, provider_id, feed_endpoint_id, ingestion_run_id,
                 endpoint_key, source_realtime_snapshot_id, captured_at_utc, loaded_at_utc)
            VALUES (:s, :p, :e, :r, 'trip_updates', :rs, now(), now())
            """
        ),
        {"s": RT_SNAP_ID, "p": PROVIDER, "e": ENDPOINT_ID, "r": RUN_ID, "rs": RAW_SNAP_ID},
    )


def _add_trip_update(connection, *, entity_index: int, trip_id: str, route_id: str) -> None:
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_entities
                (rt_feed_snapshot_id, entity_index, provider_id, entity_kind)
            VALUES (:s, :i, :p, 'trip_update')
            """
        ),
        {"s": RT_SNAP_ID, "i": entity_index, "p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_trip_updates
                (rt_feed_snapshot_id, entity_index, provider_id, trip_id, route_id, captured_at_utc)
            VALUES (:s, :i, :p, :trip, :route, now())
            """
        ),
        {"s": RT_SNAP_ID, "i": entity_index, "p": PROVIDER, "trip": trip_id, "route": route_id},
    )


def _stop(
    connection,
    *,
    entity_index: int,
    stu_index: int,
    stop_id: str | None,
    seq: int,
    mins: int,
) -> None:
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_trip_update_stop_times
                (rt_feed_snapshot_id, entity_index, stop_time_update_index, provider_id,
                 stop_sequence, stop_id, departure_time_utc)
            VALUES (:s, :i, :sui, :p, :seq, :stop,
                    now() + make_interval(mins => :mins))
            """
        ),
        {
            "s": RT_SNAP_ID,
            "i": entity_index,
            "sui": stu_index,
            "p": PROVIDER,
            "seq": seq,
            "stop": stop_id,
            "mins": mins,
        },
    )


def _add_delay_snapshot(
    connection,
    *,
    entity_index: int,
    trip_id: str,
    route_id: str,
    direction_id: int,
    delay_seconds: int,
) -> None:
    connection.execute(
        text(
            """
            INSERT INTO gold.latest_trip_delay_snapshot
                (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                 snapshot_local_date, feed_timestamp_utc, captured_at_utc,
                 trip_id, route_id, direction_id, start_date, delay_seconds,
                 stop_time_update_count)
            VALUES (:p, :rs, :i, to_char(now(), 'YYYYMMDD')::int,
                    now()::date, now(), now(),
                    :trip, :route, :dir, now()::date, :delay, 1)
            """
        ),
        {
            "p": PROVIDER,
            "rs": RAW_SNAP_ID,
            "i": entity_index,
            "trip": trip_id,
            "route": route_id,
            "dir": direction_id,
            "delay": delay_seconds,
        },
    )


def test_stop_departures_dedups_multi_direction_delay_rows(conn) -> None:
    _add_trip_update(conn, entity_index=0, trip_id="DD-trip", route_id="A")
    _stop(conn, entity_index=0, stu_index=0, stop_id="S1", seq=1, mins=5)
    _add_delay_snapshot(
        conn, entity_index=10, trip_id="DD-trip", route_id="A", direction_id=0, delay_seconds=120
    )
    _add_delay_snapshot(
        conn, entity_index=11, trip_id="DD-trip", route_id="A", direction_id=1, delay_seconds=240
    )

    out = build_stop_departures(conn, provider_id=PROVIDER, generated_utc="2026-06-10T12:00:00Z")

    deps = out.stops["S1"]
    assert len(deps) == 1
    assert deps[0].route == "A"
    assert deps[0].trip == "DD-trip"
    assert deps[0].delay_min == 3


def test_stop_departures_caps_two_per_route_and_keeps_all_routes(conn) -> None:
    _add_trip_update(conn, entity_index=0, trip_id="A-trip", route_id="A")
    _stop(conn, entity_index=0, stu_index=0, stop_id="S1", seq=1, mins=5)
    _stop(conn, entity_index=0, stu_index=1, stop_id="S1", seq=2, mins=15)
    _stop(conn, entity_index=0, stu_index=2, stop_id="S1", seq=3, mins=25)
    _add_trip_update(conn, entity_index=1, trip_id="B-trip", route_id="B")
    _stop(conn, entity_index=1, stu_index=0, stop_id="S1", seq=1, mins=8)

    out = build_stop_departures(conn, provider_id=PROVIDER, generated_utc="2026-06-10T12:00:00Z")

    deps = out.stops["S1"]
    assert [d.route for d in deps] == ["A", "B", "A"]
    assert len(deps) == 3


def test_stop_departures_excludes_past_and_null_stop_ids(conn) -> None:
    _add_trip_update(conn, entity_index=0, trip_id="C-trip", route_id="C")
    _stop(conn, entity_index=0, stu_index=0, stop_id="S2", seq=1, mins=-10)
    _stop(conn, entity_index=0, stu_index=1, stop_id=None, seq=2, mins=12)

    out = build_stop_departures(conn, provider_id=PROVIDER, generated_utc="2026-06-10T12:00:00Z")

    assert "S2" not in out.stops
    assert out.stops == {}


def test_trips_sql_horizon_excludes_beyond_60_minutes(conn) -> None:
    _add_trip_update(conn, entity_index=0, trip_id="D-trip", route_id="D")
    _stop(conn, entity_index=0, stu_index=0, stop_id="S3", seq=1, mins=10)
    _stop(conn, entity_index=0, stu_index=1, stop_id="S4", seq=2, mins=90)

    out = build_trips(conn, provider_id=PROVIDER, generated_utc="2026-06-10T12:00:00Z")

    trip = out.trips["D-trip"]
    assert [s.stop for s in trip.stops] == ["S3"]
