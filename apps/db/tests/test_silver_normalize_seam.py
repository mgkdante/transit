from dataclasses import replace
from pathlib import Path

import pytest
import realtime_replay_fixtures as replay
from google.transit import gtfs_realtime_pb2
from realtime_replay_fixtures import bronze_root as bronze_root
from realtime_replay_fixtures import engine as engine
from realtime_replay_fixtures import settings as settings
from sqlalchemy import text
from test_realtime_silver import (
    _build_snapshot,
    _build_trip_updates_bytes,
    _build_vehicle_positions_bytes,
)

from transit_ops.ingestion.storage import get_bronze_storage
from transit_ops.silver import realtime_gtfs as silver


@pytest.mark.parametrize("endpoint", ["trip_updates", "vehicle_positions"])
def test_seam_returns_the_rows_of_each_normalizer(tmp_path, endpoint):
    payload = (
        _build_trip_updates_bytes()
        if endpoint == "trip_updates"
        else _build_vehicle_positions_bytes()
    )
    path = tmp_path / "capture.pb"
    path.write_bytes(payload)
    snapshot = _build_snapshot(path, endpoint)
    message = gtfs_realtime_pb2.FeedMessage.FromString(payload)
    expected = {
        "rt_entities": silver._normalize_rt_entities(
            message, snapshot=snapshot, rt_feed_snapshot_id=42
        )
    }
    if endpoint == "trip_updates":
        trips, stops = silver._normalize_rt_trip_updates(
            message, snapshot=snapshot, rt_feed_snapshot_id=42
        )
        expected.update(rt_trip_updates=trips, rt_trip_update_stop_times=stops)
    else:
        expected["rt_vehicle_positions"] = silver._normalize_rt_vehicle_positions(
            message,
            snapshot=snapshot,
            rt_feed_snapshot_id=42,
            provider_bounds=replay.PROVIDER_BOUNDS,
            max_vehicle_speed_kmh=10,
        )
    assert (
        silver.normalize_realtime_message(
            message,
            snapshot=snapshot,
            rt_feed_snapshot_id=42,
            provider_bounds=replay.PROVIDER_BOUNDS,
            max_vehicle_speed_kmh=10,
        )
        == expected
    )


def test_seam_refuses_alert_endpoints(tmp_path):
    path = tmp_path / "capture.pb"
    path.write_bytes(_build_trip_updates_bytes())
    with pytest.raises(ValueError, match="^Unsupported realtime endpoint 'alerts'\\.$"):
        silver.normalize_realtime_message(
            gtfs_realtime_pb2.FeedMessage(),
            snapshot=replace(_build_snapshot(path, "trip_updates"), endpoint_key="alerts"),
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


def test_loaded_rows_are_unchanged(engine, settings, seed_provider):
    with engine.begin() as connection:
        replay._seed_provider_and_static(connection, seed_provider)
        replay._seed_raw_realtime_snapshots(connection)
        snapshots = silver.find_realtime_bronze_snapshots(
            connection,
            provider_id=replay.PROVIDER,
            start_utc=replay.WINDOW_START,
            end_utc=replay.WINDOW_END,
            settings=settings,
            project_root=Path.cwd(),
        )
        for snapshot in snapshots:
            storage = get_bronze_storage(settings, project_root=Path.cwd())
            message = gtfs_realtime_pb2.FeedMessage.FromString(
                storage.read_bytes(snapshot.storage_path)
            )
            result = silver.load_realtime_snapshot_to_silver(
                connection, snapshot=snapshot, bronze_storage=storage
            )
            frame = connection.execute(
                text(
                    "SELECT rt_feed_snapshot_id FROM silver.rt_feed_snapshots "
                    "WHERE source_realtime_snapshot_id=:id"
                ),
                {"id": snapshot.realtime_snapshot_id},
            ).scalar_one()
            trips, stops = silver._normalize_rt_trip_updates(
                message, snapshot=snapshot, rt_feed_snapshot_id=frame
            )
            expected = {
                "rt_entities": silver._normalize_rt_entities(
                    message, snapshot=snapshot, rt_feed_snapshot_id=frame
                ),
                "rt_trip_updates": trips,
                "rt_trip_update_stop_times": stops,
            }
            for table, rows in expected.items():
                actual = (
                    connection.execute(
                        text(
                            f"SELECT * FROM silver.{table} WHERE rt_feed_snapshot_id=:id "
                            "ORDER BY entity_index"
                        ),
                        {"id": frame},
                    )
                    .mappings()
                    .all()
                )
                assert [{key: row[key] for key in rows[0]} for row in actual] == rows
            assert result.row_counts == {
                "rt_feed_snapshots": 1,
                **{table: len(rows) for table, rows in expected.items()},
            }
