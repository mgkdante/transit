from dataclasses import replace

import pytest
import realtime_replay_fixtures as replay
from google.transit import gtfs_realtime_pb2
from realtime_replay_fixtures import engine as engine
from sqlalchemy import text
from test_realtime_silver import (
    FakeBronzeStorage,
    RecordingConnection,
    _build_snapshot,
    _build_trip_updates_bytes,
    _build_vehicle_positions_bytes,
    _first_call_params,
)

from transit_ops.silver import realtime_gtfs as silver


@pytest.fixture(params=["trip_updates", "vehicle_positions"])
def capture(tmp_path, request):
    endpoint = request.param
    payload = (
        _build_trip_updates_bytes()
        if endpoint == "trip_updates"
        else _build_vehicle_positions_bytes()
    )
    message = gtfs_realtime_pb2.FeedMessage.FromString(payload)
    first = message.entity[0]
    second = message.entity.add()
    second.CopyFrom(first)
    second.id = "second"
    if endpoint == "trip_updates":
        extra = first.trip_update.stop_time_update.add()
        extra.CopyFrom(first.trip_update.stop_time_update[0])
        extra.stop_id, extra.stop_sequence = "second-stop", 11
        second.trip_update.trip.trip_id = "second-trip"
    else:
        first.vehicle.position.speed = 2
        second.vehicle.position.latitude, second.vehicle.position.longitude = 0, 0
        second.vehicle.position.speed = 1
        third = message.entity.add()
        third.CopyFrom(first)
        third.id, third.vehicle.position.speed = "fast", 11.5
    path = tmp_path / "capture.pb"
    path.write_bytes(message.SerializeToString())
    return message, _build_snapshot(path, endpoint)


def _expected_rows(message, snapshot, frame):
    rows = {
        "rt_entities": silver._normalize_rt_entities(
            message, snapshot=snapshot, rt_feed_snapshot_id=frame
        )
    }
    if snapshot.endpoint_key == "trip_updates":
        trips, stops = silver._normalize_rt_trip_updates(
            message, snapshot=snapshot, rt_feed_snapshot_id=frame
        )
        rows.update(rt_trip_updates=trips, rt_trip_update_stop_times=stops)
    else:
        rows["rt_vehicle_positions"] = silver._normalize_rt_vehicle_positions(
            message,
            snapshot=snapshot,
            rt_feed_snapshot_id=frame,
            provider_bounds=replay.PROVIDER_BOUNDS,
            max_vehicle_speed_kmh=10,
        )
    return rows


def _assert_order_and_policy(rows, endpoint):
    if endpoint == "trip_updates":
        assert [row["trip_id"] for row in rows["rt_trip_updates"]] == ["trip-1", "second-trip"]
        assert [
            (row["entity_index"], row["stop_time_update_index"])
            for row in rows["rt_trip_update_stop_times"]
        ] == [(0, 0), (0, 1), (1, 0)]
        indexes = [0, 1]
    else:
        vehicles = rows["rt_vehicle_positions"]
        assert [row["position_quality"] for row in vehicles] == [
            "valid_provider_bbox",
            "outside_provider_bbox",
            "valid_provider_bbox",
        ]
        assert [row["speed"] for row in vehicles] == [2.0, 1.0, None]
        indexes = [0, 1, 2]
    assert [row["entity_index"] for row in rows["rt_entities"]] == indexes


def test_seam_returns_the_rows_of_each_normalizer(capture):
    message, snapshot = capture
    rows = silver.normalize_realtime_message(
        message,
        context=silver.RealtimeNormalizationContext.from_snapshot(snapshot),
        rt_feed_snapshot_id=42,
        provider_bounds=replay.PROVIDER_BOUNDS,
        max_vehicle_speed_kmh=10,
    )
    assert rows == _expected_rows(message, snapshot, 42)
    _assert_order_and_policy(rows, snapshot.endpoint_key)


def test_public_loader_preserves_policy_and_source_order(capture):
    message, snapshot = capture
    connection = RecordingConnection()
    result = silver.load_realtime_snapshot_to_silver(
        connection,
        snapshot=snapshot,
        bronze_storage=FakeBronzeStorage(message.SerializeToString()),
        provider_bounds=replay.PROVIDER_BOUNDS,
        max_vehicle_speed_kmh=10,
    )
    expected = _expected_rows(message, snapshot, 901)
    actual = {
        table: _first_call_params(connection, f"INSERT INTO silver.{table} (") for table in expected
    }
    assert actual == expected
    _assert_order_and_policy(actual, snapshot.endpoint_key)
    assert result.row_counts == {
        "rt_feed_snapshots": 1,
        **{table: len(rows) for table, rows in expected.items()},
    }


def test_seam_refuses_alert_endpoints(tmp_path):
    path = tmp_path / "capture.pb"
    path.write_bytes(_build_trip_updates_bytes())
    with pytest.raises(ValueError, match="^Unsupported realtime endpoint 'alerts'\\.$"):
        silver.normalize_realtime_message(
            gtfs_realtime_pb2.FeedMessage(),
            context=silver.RealtimeNormalizationContext.from_snapshot(
                replace(_build_snapshot(path, "trip_updates"), endpoint_key="alerts")
            ),
            rt_feed_snapshot_id=42,
        )


def test_expected_counts_are_unchanged(tmp_path):
    path = tmp_path / "capture.pb"
    path.write_bytes(_build_vehicle_positions_bytes())
    snapshot = _build_snapshot(path, "vehicle_positions")
    message = gtfs_realtime_pb2.FeedMessage.FromString(path.read_bytes())
    message.entity[0].vehicle.position.latitude = 0
    rows = silver._normalize_rt_vehicle_positions(message, snapshot=snapshot, rt_feed_snapshot_id=0)
    assert silver._expected_realtime_row_counts(message, snapshot=snapshot) == {
        "rt_feed_snapshots": 1,
        "rt_entities": 1,
        "rt_vehicle_positions": len(rows),
    }


def _stored_rows(connection, expected, frame):
    actual = {}
    for table, rows in expected.items():
        order = "entity_index" + (
            ", stop_time_update_index" if table.endswith("stop_times") else ""
        )
        stored = (
            connection.execute(
                text(
                    f"SELECT * FROM silver.{table} WHERE rt_feed_snapshot_id=:id ORDER BY " + order
                ),
                {"id": frame},
            )
            .mappings()
            .all()
        )
        actual[table] = [{key: row[key] for key in rows[0]} for row in stored]
    return actual


def test_loaded_rows_are_unchanged(engine, seed_provider, capture):
    message, snapshot = capture
    snapshot = replace(
        snapshot,
        provider_id=replay.PROVIDER,
        feed_endpoint_id=replay.TRIP_ENDPOINT_ID,
        realtime_snapshot_id=replay.SNAPSHOTS[0][0],
        ingestion_run_id=replay.SNAPSHOTS[0][1],
        ingestion_object_id=replay.SNAPSHOTS[0][2],
    )
    with engine.begin() as connection:
        replay._seed_provider_and_static(connection, seed_provider)
        replay._seed_raw_realtime_snapshots(connection, replay.SNAPSHOTS[:1])
        if snapshot.endpoint_key == "vehicle_positions":
            connection.execute(
                text(
                    "UPDATE core.feed_endpoints SET endpoint_key='vehicle_positions', "
                    "feed_kind='vehicle_positions', source_format='gtfs_rt_vehicle_positions' "
                    "WHERE feed_endpoint_id=:id"
                ),
                {"id": snapshot.feed_endpoint_id},
            )
        result = silver.load_realtime_snapshot_to_silver(
            connection,
            snapshot=snapshot,
            bronze_storage=FakeBronzeStorage(message.SerializeToString()),
            provider_bounds=replay.PROVIDER_BOUNDS,
            max_vehicle_speed_kmh=10,
        )
        frame = connection.execute(
            text(
                "SELECT rt_feed_snapshot_id FROM silver.rt_feed_snapshots "
                "WHERE source_realtime_snapshot_id=:id"
            ),
            {"id": snapshot.realtime_snapshot_id},
        ).scalar_one()
        expected = _expected_rows(message, snapshot, frame)
        actual = _stored_rows(connection, expected, frame)
        assert actual == expected
        _assert_order_and_policy(actual, snapshot.endpoint_key)
        assert result.row_counts == {
            "rt_feed_snapshots": 1,
            **{table: len(rows) for table, rows in expected.items()},
        }
