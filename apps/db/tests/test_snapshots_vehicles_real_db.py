from __future__ import annotations

import pytest
from sqlalchemy import text
from test_departure_capture_order_real_db import _later_inserted_snapshot
from test_snapshots_live_departures_real_db import (
    PROVIDER,
    RAW_SNAP_ID,
    _add_trip_update,
    _stop,
)
from test_snapshots_live_departures_real_db import conn as conn

from transit_ops.snapshots.builders import build_vehicles
from transit_ops.snapshots.builders.live import _VEHICLES_SQL


def _vehicle(connection, *, stop=None, trip="capture-order-trip", capture_minutes=0):
    connection.execute(
        text("""
        INSERT INTO gold.latest_vehicle_snapshot
            (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
             snapshot_local_date, feed_timestamp_utc, captured_at_utc,
             vehicle_id, trip_id, route_id, stop_id, latitude, longitude)
        VALUES (:p, :s, 99, to_char(now(), 'YYYYMMDD')::int, now()::date, now(),
                now()+make_interval(mins=>:capture), 'vehicle', :trip, '51', :stop, 45.5, -73.6)
        """),
        {"p": PROVIDER, "s": RAW_SNAP_ID, "stop": stop, "trip": trip, "capture": capture_minutes},
    )


@pytest.mark.parametrize(
    ("position_stop", "trip", "minutes", "expected"),
    [
        ("position-stop", "capture-order-trip", [5, 10], "position-stop"),
        ("position-stop", None, [5], "position-stop"),
        (None, "capture-order-trip", [-1, 0, 5], "stop-1"),
        (None, None, [5], None),
        (None, "capture-order-trip", [-10, -1], None),
        (None, "missing-trip", [5], None),
        (None, "capture-order-trip", [], None),
    ],
)
def test_vehicle_next_stop(conn, position_stop, trip, minutes, expected):
    _vehicle(conn, stop=position_stop, trip=trip)
    _add_trip_update(conn, entity_index=0, trip_id="capture-order-trip", route_id="51")
    for i, mins in enumerate(minutes):
        _stop(conn, entity_index=0, stu_index=i, stop_id=f"stop-{i}", seq=i + 1, mins=mins)
    result = build_vehicles(conn, provider_id=PROVIDER, generated_utc="fixture")
    assert len(result.vehicles) == 1
    assert result.vehicles[0].next_stop == expected


def test_vehicle_next_stop_uses_capture_time_and_arrival_only_prediction(conn):
    _vehicle(conn, capture_minutes=-5)
    _add_trip_update(conn, entity_index=0, trip_id="capture-order-trip", route_id="51")
    _stop(conn, entity_index=0, stu_index=0, stop_id="arrival-stop", seq=1, mins=-2)
    conn.execute(
        text("""
        UPDATE silver.rt_trip_update_stop_times
        SET arrival_time_utc=departure_time_utc, departure_time_utc=NULL
        WHERE provider_id=:p
    """),
        {"p": PROVIDER},
    )
    result = build_vehicles(conn, provider_id=PROVIDER, generated_utc="fixture")
    assert result.vehicles[0].next_stop == "arrival-stop"


def test_vehicle_next_stop_uses_stop_sequence_not_prediction_order(conn):
    _vehicle(conn)
    _add_trip_update(conn, entity_index=0, trip_id="capture-order-trip", route_id="51")
    _stop(conn, entity_index=0, stu_index=0, stop_id="later-in-trip", seq=3, mins=1)
    _stop(conn, entity_index=0, stu_index=1, stop_id="first-upcoming", seq=2, mins=5)
    _stop(conn, entity_index=0, stu_index=2, stop_id="past", seq=1, mins=-1)
    result = build_vehicles(conn, provider_id=PROVIDER, generated_utc="fixture")
    assert result.vehicles[0].next_stop == "first-upcoming"


@pytest.mark.parametrize("missing", ["stop_id", "departure_time_utc"])
def test_vehicle_next_stop_requires_stop_id_and_prediction(conn, missing):
    _vehicle(conn)
    _add_trip_update(conn, entity_index=0, trip_id="capture-order-trip", route_id="51")
    _stop(conn, entity_index=0, stu_index=0, stop_id="unknown-stop", seq=1, mins=5)
    conn.execute(
        text(f"UPDATE silver.rt_trip_update_stop_times SET {missing}=NULL WHERE provider_id=:p"),
        {"p": PROVIDER},
    )
    result = build_vehicles(conn, provider_id=PROVIDER, generated_utc="fixture")
    assert result.vehicles[0].next_stop is None


@pytest.mark.parametrize("newer_minutes", [-10, 10])
def test_vehicle_next_stop_uses_latest_capture_not_largest_snapshot_id(conn, newer_minutes):
    _vehicle(conn)
    _add_trip_update(conn, entity_index=0, trip_id="capture-order-trip", route_id="51")
    _stop(conn, entity_index=0, stu_index=0, stop_id="current-stop", seq=1, mins=20)
    _later_inserted_snapshot(conn, capture_minutes=newer_minutes, departure_minutes=5)
    result = build_vehicles(conn, provider_id=PROVIDER, generated_utc="fixture")
    assert result.vehicles[0].next_stop == ("current-stop" if newer_minutes < 0 else "S1")


def test_vehicle_next_stop_does_not_resurrect_stops_after_empty_latest_feed(conn):
    _vehicle(conn)
    _add_trip_update(conn, entity_index=0, trip_id="capture-order-trip", route_id="51")
    _stop(conn, entity_index=0, stu_index=0, stop_id="old-stop", seq=1, mins=20)
    _later_inserted_snapshot(conn, capture_minutes=10, departure_minutes=None)
    assert (
        build_vehicles(conn, provider_id=PROVIDER, generated_utc="fixture").vehicles[0].next_stop
        is None
    )


def test_vehicle_next_stop_index_paths_are_available(conn, record_property):
    _vehicle(conn)
    _add_trip_update(conn, entity_index=0, trip_id="capture-order-trip", route_id="51")
    _stop(conn, entity_index=0, stu_index=0, stop_id="next-stop", seq=1, mins=5)
    # Tiny fixtures normally favor sequential scans. Disable them only to verify
    # index eligibility; this is not evidence of production cost or planner choice.
    conn.execute(text("SET LOCAL enable_seqscan = off"))
    plan = conn.execute(
        text("EXPLAIN (FORMAT JSON) " + str(_VEHICLES_SQL)), {"provider_id": PROVIDER}
    ).scalar_one()
    record_property("vehicles_index_plan", str(plan))

    def indexes(node):
        found = {node["Index Name"]} if "Index Name" in node else set()
        for child in node.get("Plans", []):
            found.update(indexes(child))
        return found

    used = indexes(plan[0]["Plan"])
    assert used & {"ix_silver_rt_trip_updates_provider_trip", "pk_silver_rt_trip_updates"}
    assert "pk_silver_rt_trip_update_stop_times" in used
