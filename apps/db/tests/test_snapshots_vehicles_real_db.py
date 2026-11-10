from __future__ import annotations

import pytest
import real_db_seed as db_seed
from sqlalchemy import text
from test_departure_capture_order_real_db import _later_inserted_snapshot
from test_snapshots_live_departures_real_db import (
    ENDPOINT_ID,
    PROVIDER,
    RAW_SNAP_ID,
    RUN_ID,
    _add_trip_update,
    _stop,
)
from test_snapshots_live_departures_real_db import conn as conn

from transit_ops.snapshots.builders import build_vehicles
from transit_ops.snapshots.builders.live import _VEHICLES_SQL


def _vehicle(
    connection, *, stop=None, trip="capture-order-trip", capture_minutes=0, provider=PROVIDER
):
    connection.execute(
        text("""
        INSERT INTO gold.latest_vehicle_snapshot
            (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
             snapshot_local_date, feed_timestamp_utc, captured_at_utc,
             vehicle_id, trip_id, route_id, stop_id, latitude, longitude)
        VALUES (:p, :s, 99, to_char(now(), 'YYYYMMDD')::int, now()::date, now(),
                now()+make_interval(mins=>:capture), 'vehicle', :trip, '51', :stop, 45.5, -73.6)
        """),
        {"p": provider, "s": RAW_SNAP_ID, "stop": stop, "trip": trip, "capture": capture_minutes},
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
    db_seed.dataset_versions(
        conn, {"d": 990501, "p": PROVIDER, "e": ENDPOINT_ID, "r": RUN_ID, "h": "next-stop"}
    )
    conn.execute(
        text("""
        INSERT INTO gold.dim_stop
            (provider_id, dataset_version_id, stop_id, stop_name, stop_lat, stop_lon)
        VALUES (:p, 990501, 'position-stop', 'Position stop', 45.5, -73.6),
               (:p, 990501, 'stop-1', 'Trip update stop', 45.6, -73.7)
    """),
        {"p": PROVIDER},
    )
    result = build_vehicles(conn, provider_id=PROVIDER, generated_utc="fixture")
    coordinates = {"position-stop": (45.5, -73.6), "stop-1": (45.6, -73.7)}
    v = result.vehicles[0]
    assert (v.next_stop_lat, v.next_stop_lon) == coordinates.get(expected, (None, None))
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
    # Plan against the seeded rows, not statistics left by an earlier test.
    # Keep every production index available so a non-PK choice still fails below.
    for relation in (
        "gold.latest_vehicle_snapshot",
        "gold.latest_trip_delay_snapshot",
        "gold.dim_stop",
        "silver.rt_feed_snapshots",
        "silver.rt_trip_updates",
        "silver.rt_trip_update_stop_times",
    ):
        conn.execute(text(f"ANALYZE {relation}"))
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
    assert "pk_gold_dim_stop" in used


@pytest.mark.parametrize("provider", ["stm_coords_test", "octranspo_coords_test"])
@pytest.mark.parametrize(
    "coords", [(45.501234, -73.601234), (None, None), (45.5, None), (None, -73.6)]
)
def test_next_stop_coordinates_join_only_provider_current_stops(
    conn, seed_provider, provider, coords
):
    seed_provider(conn, provider, display_name=provider)
    # A foreign provider with the same stop id must never supply coordinates.
    for p, dataset, lat, lon in [
        (PROVIDER, 990501, 10, 20),
        (provider, 990502, coords[0], coords[1]),
    ]:
        db_seed.dataset_versions(
            conn, {"d": dataset, "p": p, "e": ENDPOINT_ID, "r": RUN_ID, "h": "next-stop"}
        )
        conn.execute(
            text("""
            INSERT INTO gold.dim_stop
                (provider_id, dataset_version_id, stop_id, stop_name, stop_lat, stop_lon)
            VALUES (:p, :d, 'position-stop', 'Stop', :lat, :lon)
        """),
            {"p": p, "d": dataset, "lat": lat, "lon": lon},
        )
    _vehicle(conn, provider=provider, stop="position-stop", trip=None)
    v = build_vehicles(conn, provider_id=provider, generated_utc="fixture").vehicles[0]
    expected = tuple(round(c, 5) for c in coords) if None not in coords else (None, None)
    assert (v.next_stop_lat, v.next_stop_lon) == expected
    conn.execute(text("DELETE FROM gold.dim_stop WHERE provider_id=:p"), {"p": provider})
    v = build_vehicles(conn, provider_id=provider, generated_utc="fixture").vehicles[0]
    assert v.next_stop == "position-stop"
    assert (v.next_stop_lat, v.next_stop_lon) == (None, None)
