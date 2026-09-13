"""Capture order must survive replay/import order in live departure selection."""

import json
from datetime import UTC

from sqlalchemy import text
from test_snapshots_live_departures_real_db import (
    ENDPOINT_ID,
    PROVIDER,
    RAW_SNAP_ID,
    RT_SNAP_ID,
    RUN_ID,
    _add_trip_update,
    _stop,
)
from test_snapshots_live_departures_real_db import conn as conn

from transit_ops.snapshots.builders import build_trips


def _later_inserted_snapshot(
    connection,
    *,
    capture_minutes,
    departure_minutes,
    provider_id=PROVIDER,
    endpoint_id=ENDPOINT_ID,
):
    params = {
        "p": provider_id,
        "e": endpoint_id,
        "run": RUN_ID + 1,
        "raw": RAW_SNAP_ID + 1,
        "silver": RT_SNAP_ID + 1,
        "capture_minutes": capture_minutes,
        "entities": int(departure_minutes is not None),
    }
    connection.execute(
        text("""
        INSERT INTO raw.ingestion_runs
            (ingestion_run_id,provider_id,feed_endpoint_id,run_kind,status)
        VALUES (:run,:p,:e,'trip_updates','succeeded')
        """),
        params,
    )
    connection.execute(
        text("""
        INSERT INTO raw.realtime_snapshot_index
            (realtime_snapshot_id,ingestion_run_id,provider_id,feed_endpoint_id,
             captured_at_utc,feed_timestamp_utc,entity_count)
        VALUES (:raw,:run,:p,:e,now()+make_interval(mins=>:capture_minutes),
                now()-interval '20 minutes',:entities)
        """),
        params,
    )
    connection.execute(
        text("""
        INSERT INTO silver.rt_feed_snapshots
            (rt_feed_snapshot_id,provider_id,feed_endpoint_id,ingestion_run_id,
             endpoint_key,source_realtime_snapshot_id,captured_at_utc,feed_timestamp_utc,
             manifest_json)
        VALUES (:silver,:p,:e,:run,'trip_updates',:raw,
                now()+make_interval(mins=>:capture_minutes),now()-interval '20 minutes',
                jsonb_build_object('entity_count',CAST(:entities AS integer)))
        """),
        params,
    )
    if departure_minutes is None:
        return
    connection.execute(
        text("""
        INSERT INTO silver.rt_entities
            (rt_feed_snapshot_id,entity_index,provider_id,entity_kind)
        VALUES (:silver,0,:p,'trip_update')
        """),
        params,
    )
    connection.execute(
        text("""
        INSERT INTO silver.rt_trip_updates
            (rt_feed_snapshot_id,entity_index,provider_id,trip_id,route_id,captured_at_utc)
        VALUES (:silver,0,:p,'capture-order-trip','51',
                now()+make_interval(mins=>:capture_minutes))
        """),
        params,
    )
    connection.execute(
        text("""
        INSERT INTO silver.rt_trip_update_stop_times
            (rt_feed_snapshot_id,entity_index,stop_time_update_index,provider_id,
             stop_sequence,stop_id,departure_time_utc)
        VALUES (:silver,0,0,:p,1,'S1',now()+make_interval(mins=>:minutes))
        """),
        {**params, "minutes": departure_minutes},
    )


def _seed_current_report(connection, *, capture_minutes=0):
    for table in ("raw.realtime_snapshot_index", "silver.rt_feed_snapshots"):
        connection.execute(
            text(
                f"UPDATE {table} SET feed_timestamp_utc=now()-interval '20 minutes', "
                "captured_at_utc=now()+make_interval(mins=>:minutes) WHERE provider_id=:p"
            ),
            {"p": PROVIDER, "minutes": capture_minutes},
        )
    _add_trip_update(connection, entity_index=0, trip_id="capture-order-trip", route_id="51")
    connection.execute(
        text("""
        UPDATE silver.rt_trip_updates SET captured_at_utc=now()+make_interval(mins=>:minutes)
        WHERE provider_id=:p
    """),
        {"p": PROVIDER, "minutes": capture_minutes},
    )
    _stop(connection, entity_index=0, stu_index=0, stop_id="S1", seq=1, mins=20)


def test_departures_keep_newer_capture_when_replayed_source_id_is_higher(conn, record_property):
    _seed_current_report(conn)
    clock = conn.execute(text("SELECT now()")).scalar_one()
    stamp = clock.astimezone(UTC).isoformat().replace("+00:00", "Z")
    before = build_trips(conn, provider_id=PROVIDER, generated_utc=stamp)
    assert before.trips["capture-order-trip"].status == "unknown"
    assert len(before.trips["capture-order-trip"].stops) == 1
    expected = before.trips["capture-order-trip"].stops[0].eta_utc

    _later_inserted_snapshot(conn, capture_minutes=-10, departure_minutes=5)
    after = build_trips(conn, provider_id=PROVIDER, generated_utc=stamp)
    identities = (
        conn.execute(
            text("""
        SELECT source_realtime_snapshot_id,captured_at_utc,feed_timestamp_utc
        FROM silver.rt_feed_snapshots WHERE provider_id=:p
        ORDER BY captured_at_utc DESC,source_realtime_snapshot_id DESC
    """),
            {"p": PROVIDER},
        )
        .mappings()
        .all()
    )
    assert [row["source_realtime_snapshot_id"] for row in identities] == [
        RAW_SNAP_ID,
        RAW_SNAP_ID + 1,
    ]
    assert identities[0]["feed_timestamp_utc"] == identities[1]["feed_timestamp_utc"]
    actual = after.trips["capture-order-trip"].stops[0].eta_utc
    evidence = {
        "clock": stamp,
        "schema": conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one(),
        "view": conn.execute(
            text("SELECT pg_get_viewdef('gold.current_stop_next_departures'::regclass,true)")
        ).scalar_one(),
        "identities": [dict(row) for row in identities],
        "expected_eta": expected,
        "actual_eta": actual,
        "before": before.model_dump(mode="json"),
        "after": after.model_dump(mode="json"),
    }
    record_property("departure_capture_order", json.dumps(evidence, default=str))
    if actual != expected:
        print("DEPARTURE_CAPTURE_ORDER " + json.dumps(evidence, default=str))
    assert after.trips["capture-order-trip"].status == "unknown"
    assert actual == expected, "An older capture replaced the retained newer-capture departure"


def test_newest_empty_silver_parent_suppresses_older_predictions(conn):
    _seed_current_report(conn, capture_minutes=-10)
    assert build_trips(conn, provider_id=PROVIDER, generated_utc="fixture").trips
    _later_inserted_snapshot(conn, capture_minutes=0, departure_minutes=None)
    assert build_trips(conn, provider_id=PROVIDER, generated_utc="fixture").trips == {}


def test_equal_capture_times_choose_the_higher_raw_identity(conn):
    _seed_current_report(conn)
    _later_inserted_snapshot(conn, capture_minutes=0, departure_minutes=5)
    expected = conn.execute(text("SELECT now()+interval '5 minutes'")).scalar_one()
    trip = build_trips(conn, provider_id=PROVIDER, generated_utc="fixture").trips[
        "capture-order-trip"
    ]
    assert trip.status == "unknown"
    assert trip.stops[0].eta_utc == expected.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def test_other_providers_newer_capture_does_not_replace_departures(conn, seed_provider):
    _seed_current_report(conn, capture_minutes=-10)
    before = build_trips(conn, provider_id=PROVIDER, generated_utc="fixture")
    other = PROVIDER + "_other"
    seed_provider(conn, other, display_name="Other departure capture")
    conn.execute(
        text("""
        INSERT INTO core.feed_endpoints
            (feed_endpoint_id,provider_id,endpoint_key,feed_kind,source_format)
        VALUES (:e,:p,'trip_updates','trip_updates','gtfs_rt_trip_updates')
    """),
        {"e": ENDPOINT_ID + 1, "p": other},
    )
    _later_inserted_snapshot(
        conn,
        capture_minutes=0,
        departure_minutes=5,
        provider_id=other,
        endpoint_id=ENDPOINT_ID + 1,
    )
    assert build_trips(conn, provider_id=PROVIDER, generated_utc="fixture") == before
    assert build_trips(conn, provider_id=other, generated_utc="fixture").trips
