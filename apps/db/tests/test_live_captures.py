from dataclasses import replace
from datetime import UTC, datetime
from hashlib import sha256

import pytest
import realtime_replay_fixtures as replay
from google.transit import gtfs_realtime_pb2 as pb
from realtime_replay_fixtures import engine as engine
from sqlalchemy import text
from test_realtime_silver import FakeBronzeStorage, _build_manifest, _build_snapshot

from transit_ops.core.models import ProviderBoundsConfig
from transit_ops.history.poll_record import CaptureEntry
from transit_ops.live.captures import (
    FRAME_COLUMNS,
    CaptureIntegrityError,
    CaptureParseError,
    CaptureRef,
    ParsePolicy,
    parse_capture,
)
from transit_ops.silver.realtime_gtfs import (
    RealtimeNormalizationContext,
    load_realtime_snapshot_to_silver,
    normalize_realtime_message,
)

AT = datetime(2026, 6, 20, 12, 10, 0, 123456, tzinfo=UTC)
POLICY = ParsePolicy(replay.PROVIDER_BOUNDS, 100)


def _message(endpoint="trip_updates"):
    message = pb.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    if endpoint == "trip_updates":
        first = message.entity.add(id="Côte-Vertu").trip_update
        first.trip.trip_id = " "
        first.stop_time_update.add(stop_id="√2").departure.time = 1_781_956_800
        first.stop_time_update.add().schedule_relationship = pb.TripUpdate.StopTimeUpdate.SKIPPED
        second = message.entity.add(id="second").trip_update
        second.trip.trip_id = "√2"
        second.trip.schedule_relationship = pb.TripDescriptor.CANCELED
        second.stop_time_update.add().arrival.time = 0
    else:
        for latitude, speed in ((45.5, 10), (0, 10), (45.5, 1000)):
            vehicle = message.entity.add(id=str(latitude) + str(speed)).vehicle
            vehicle.position.latitude, vehicle.position.longitude = latitude, -73.5
            vehicle.position.speed, vehicle.position.bearing = speed, 123.4
    return message


def _capture(payload, endpoint="trip_updates"):
    return CaptureRef("network", endpoint, 42, AT, AT, len(payload), sha256(payload).hexdigest())


def _parse(message, endpoint="trip_updates"):
    payload = message.SerializeToString()
    return parse_capture(payload, _capture(payload, endpoint), POLICY)


def test_trip_update_rows_equal_the_silver_normalizer():
    message = _message()
    parsed = _parse(message)
    expected = normalize_realtime_message(
        message,
        context=RealtimeNormalizationContext("network", "trip_updates", AT, AT),
        rt_feed_snapshot_id=42,
    )
    for table, rows in expected.items():
        frame = parsed.frames[table]
        assert (
            frame.columns
            == tuple(k for k in rows[0] if k not in ("provider_id", "rt_feed_snapshot_id"))
            == FRAME_COLUMNS[table]
        )
        assert frame.rows == tuple(tuple(row[c] for c in frame.columns) for row in rows)
    trips, stops = parsed.frames["rt_trip_updates"], parsed.frames["rt_trip_update_stop_times"]
    assert trips.column("trip_id") == [None, "√2"]
    assert trips.column("schedule_relationship") == [None, pb.TripDescriptor.CANCELED]
    assert stops.column("arrival_time_utc") == [None, None, None]
    assert stops.column("departure_time_utc") == [datetime(2026, 6, 20, 12, tzinfo=UTC), None, None]
    assert stops.column("schedule_relationship") == [
        None,
        pb.TripUpdate.StopTimeUpdate.SKIPPED,
        None,
    ]
    assert (parsed.gtfs_realtime_version, parsed.incrementality, parsed.entity_count) == (
        "2.0",
        None,
        2,
    )


def test_vehicle_rows_apply_bounds_and_speed_policy():
    frame = _parse(_message("vehicle_positions"), "vehicle_positions").frames[
        "rt_vehicle_positions"
    ]
    assert frame.column("position_quality") == [
        "valid_provider_bbox",
        "outside_provider_bbox",
        "valid_provider_bbox",
    ]
    assert frame.column("speed") == [10.0, 10.0, None]
    assert frame.column("bearing") == [123.4000015258789] * 3
    expected = normalize_realtime_message(
        _message("vehicle_positions"),
        context=RealtimeNormalizationContext("network", "vehicle_positions", AT, AT),
        rt_feed_snapshot_id=42,
        provider_bounds=POLICY.provider_bounds,
        max_vehicle_speed_kmh=100,
    )["rt_vehicle_positions"]
    assert frame.columns == tuple(
        k for k in expected[0] if k not in ("provider_id", "rt_feed_snapshot_id")
    )
    assert frame.rows == tuple(tuple(row[c] for c in frame.columns) for row in expected)


def test_timestamps_keep_utc_and_microseconds():
    parsed = _parse(_message())
    assert parsed.capture.captured_at_utc == parsed.capture.feed_timestamp_utc == AT
    assert parsed.frames["rt_trip_updates"].column("captured_at_utc") == [AT, AT]
    assert parsed.frames["rt_trip_updates"].column("feed_timestamp_utc") == [AT, AT]


def test_unicode_ids_round_trip():
    parsed = _parse(_message())
    assert parsed.frames["rt_entities"].column("entity_id") == ["Côte-Vertu", "second"]
    assert parsed.frames["rt_trip_update_stop_times"].column("stop_id") == ["√2", None, None]


@pytest.mark.parametrize("fault", ["size", "hash", "protobuf"])
def test_integrity_is_checked_before_parsing(fault):
    payload = b"\xff"
    capture = _capture(payload)
    if fault == "size":
        capture = replace(capture, byte_size=2)
    elif fault == "hash":
        capture = replace(capture, sha256="0" * 64)
    error = CaptureParseError if fault == "protobuf" else CaptureIntegrityError
    with pytest.raises(error):
        parse_capture(payload, capture, POLICY)


def test_alert_endpoint_is_refused():
    payload = _message().SerializeToString()
    with pytest.raises(ValueError, match="^Unsupported realtime endpoint 'alerts'\\.$"):
        parse_capture(payload, _capture(payload, "alerts"), POLICY)


def test_capture_ref_from_poll_record_entry():
    payload = _message().SerializeToString()
    entry = CaptureEntry(
        "realtime_snapshot",
        42,
        12,
        13,
        False,
        None,
        None,
        len(payload),
        sha256(payload).hexdigest(),
        "local",
        "capture.pb",
        "realtime_feed",
        None,
        AT,
        AT,
        AT,
        AT,
        "header",
        2,
        200,
        None,
        None,
    )
    assert CaptureRef.from_entry(
        entry, provider_id="network", endpoint_key="trip_updates"
    ) == _capture(payload)


def test_policy_from_manifest_and_header_metadata():
    manifest = _build_manifest()
    policy = ParsePolicy.from_manifest(manifest)
    assert policy.provider_bounds is None
    assert policy.max_vehicle_speed_kmh == manifest.provider.max_vehicle_speed_kmh
    manifest.provider.bounds = ProviderBoundsConfig(**vars(replay.PROVIDER_BOUNDS))
    assert ParsePolicy.from_manifest(manifest).provider_bounds == replay.PROVIDER_BOUNDS
    message = _message()
    message.header.gtfs_realtime_version = " "
    message.header.incrementality = pb.FeedHeader.DIFFERENTIAL
    parsed = _parse(message)
    assert (parsed.gtfs_realtime_version, parsed.incrementality) == (None, "DIFFERENTIAL")


@pytest.mark.parametrize("endpoint", ["trip_updates", "vehicle_positions"])
def test_parsed_rows_equal_the_rows_silver_stores(engine, seed_provider, tmp_path, endpoint):
    payload = _message(endpoint).SerializeToString()
    path = tmp_path / "capture.pb"
    path.write_bytes(payload)
    snapshot = replace(
        _build_snapshot(path, endpoint),
        provider_id=replay.PROVIDER,
        realtime_snapshot_id=replay.SNAPSHOTS[0][0],
        feed_endpoint_id=replay.TRIP_ENDPOINT_ID,
        ingestion_run_id=replay.SNAPSHOTS[0][1],
        ingestion_object_id=replay.SNAPSHOTS[0][2],
        feed_timestamp_utc=AT,
        captured_at_utc=AT,
    )
    capture = replace(
        _capture(payload, endpoint),
        provider_id=snapshot.provider_id,
        capture_row_id=snapshot.realtime_snapshot_id,
    )
    parsed = parse_capture(payload, capture, POLICY)
    with engine.begin() as connection:
        replay._seed_provider_and_static(connection, seed_provider)
        replay._seed_raw_realtime_snapshots(connection, replay.SNAPSHOTS[:1])
        load_realtime_snapshot_to_silver(
            connection,
            snapshot=snapshot,
            bronze_storage=FakeBronzeStorage(payload),
            provider_bounds=POLICY.provider_bounds,
            max_vehicle_speed_kmh=POLICY.max_vehicle_speed_kmh,
        )
        for table, frame in parsed.frames.items():
            order = "entity_index" + (
                ", stop_time_update_index" if table.endswith("stop_times") else ""
            )
            rows = connection.execute(
                text(
                    f"SELECT {', '.join(frame.columns)} FROM silver.{table} "
                    "WHERE provider_id=:p ORDER BY " + order
                ),
                {"p": snapshot.provider_id},
            ).all()
            assert tuple(tuple(row) for row in rows) == frame.rows
