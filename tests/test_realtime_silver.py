from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from google.transit import gtfs_realtime_pb2

import transit_ops.silver.realtime_gtfs as realtime_silver_module
from transit_ops.core.models import ProviderManifest
from transit_ops.settings import Settings
from transit_ops.silver.realtime_gtfs import (
    BronzeRealtimeSnapshot,
    find_latest_realtime_bronze_snapshot,
    load_latest_realtime_to_silver,
    load_realtime_snapshot_to_silver,
    normalize_trip_updates,
    normalize_vehicle_positions,
)


class FakeResult:
    def __init__(self, scalar_value=None, mapping_value=None) -> None:  # noqa: ANN001
        self.scalar_value = scalar_value
        self.mapping_value = mapping_value

    def scalar_one(self):  # noqa: ANN201
        if self.scalar_value is None:
            raise AssertionError("Expected scalar result.")
        return self.scalar_value

    def one_or_none(self):  # noqa: ANN201
        return self.mapping_value

    def mappings(self):  # noqa: ANN201
        return self


class RecordingConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        sql_text = str(statement)
        self.calls.append((sql_text, params))
        if "SELECT count(*)" in sql_text:
            return FakeResult(scalar_value=0)
        return FakeResult()


class SnapshotLookupConnection:
    def __init__(self, row: dict[str, object] | None) -> None:
        self.row = row

    def execute(self, statement, params=None):  # noqa: ANN001
        return FakeResult(mapping_value=self.row)


class _ContextManager:
    def __init__(self, connection) -> None:  # noqa: ANN001
        self.connection = connection

    def __enter__(self):  # noqa: ANN201
        return self.connection

    def __exit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001, ANN201
        return False


class FakeEngine:
    def __init__(self, connect_connection, begin_connection) -> None:  # noqa: ANN001
        self.connect_connection = connect_connection
        self.begin_connection = begin_connection

    def connect(self):  # noqa: ANN201
        return _ContextManager(self.connect_connection)

    def begin(self):  # noqa: ANN201
        return _ContextManager(self.begin_connection)


class FakeRegistry:
    def __init__(self, manifest: ProviderManifest) -> None:
        self.manifest = manifest

    def get_provider(self, provider_id: str) -> ProviderManifest:
        assert provider_id == self.manifest.provider.provider_id
        return self.manifest


class FakeBronzeStorage:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload
        self.read_calls: list[str] = []

    def exists(self, storage_path: str) -> bool:
        return True

    def read_bytes(self, storage_path: str) -> bytes:
        self.read_calls.append(storage_path)
        return self.payload

    def describe_location(self, storage_path: str) -> str:
        return f"s3://bronze-bucket/{storage_path}"


def _build_trip_updates_bytes() -> bytes:
    message = gtfs_realtime_pb2.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    message.header.timestamp = 1_774_837_200

    entity = message.entity.add()
    entity.id = "tu-1"
    entity.trip_update.trip.trip_id = "trip-1"
    entity.trip_update.trip.route_id = "route-1"
    entity.trip_update.trip.direction_id = 1
    entity.trip_update.trip.start_date = "20260325"
    entity.trip_update.trip.schedule_relationship = (
        gtfs_realtime_pb2.TripDescriptor.ScheduleRelationship.SCHEDULED
    )
    entity.trip_update.vehicle.id = "veh-1"
    entity.trip_update.delay = 120

    stop_update = entity.trip_update.stop_time_update.add()
    stop_update.stop_sequence = 10
    stop_update.stop_id = "stop-1"
    stop_update.arrival.delay = 60
    stop_update.arrival.time = 1_774_837_260
    stop_update.departure.delay = 90
    stop_update.departure.time = 1_774_837_290
    stop_update.schedule_relationship = (
        gtfs_realtime_pb2.TripUpdate.StopTimeUpdate.ScheduleRelationship.SCHEDULED
    )

    return message.SerializeToString()


def _build_vehicle_positions_bytes() -> bytes:
    message = gtfs_realtime_pb2.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    message.header.timestamp = 1_774_837_200

    entity = message.entity.add()
    entity.id = "vp-1"
    entity.vehicle.vehicle.id = "veh-9"
    entity.vehicle.trip.trip_id = "trip-9"
    entity.vehicle.trip.route_id = "route-9"
    entity.vehicle.stop_id = "stop-9"
    entity.vehicle.current_stop_sequence = 12
    entity.vehicle.current_status = gtfs_realtime_pb2.VehiclePosition.IN_TRANSIT_TO
    entity.vehicle.occupancy_status = gtfs_realtime_pb2.VehiclePosition.MANY_SEATS_AVAILABLE
    entity.vehicle.position.latitude = 45.501
    entity.vehicle.position.longitude = -73.567
    entity.vehicle.position.bearing = 180.0
    entity.vehicle.position.speed = 11.5
    entity.vehicle.timestamp = 1_774_837_205

    return message.SerializeToString()


def _write_bytes(path: Path, payload: bytes) -> None:
    path.write_bytes(payload)


def _build_snapshot(path: Path, endpoint_key: str) -> BronzeRealtimeSnapshot:
    return BronzeRealtimeSnapshot(
        provider_id="stm",
        endpoint_key=endpoint_key,
        storage_backend="local",
        feed_endpoint_id=2 if endpoint_key == "trip_updates" else 3,
        ingestion_run_id=101 if endpoint_key == "trip_updates" else 102,
        ingestion_object_id=201 if endpoint_key == "trip_updates" else 202,
        realtime_snapshot_id=301 if endpoint_key == "trip_updates" else 302,
        storage_path=f"stm/{endpoint_key}/sample.pb",
        archive_full_path=str(path),
        source_url=f"https://example.com/{endpoint_key}.pb",
        checksum_sha256="c" * 64,
        byte_size=path.stat().st_size,
        feed_timestamp_utc=datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
        captured_at_utc=datetime(2026, 3, 25, 0, 0, 5, tzinfo=UTC),
    )


def _build_manifest() -> ProviderManifest:
    return ProviderManifest.model_validate(
        {
            "provider": {
                "provider_id": "stm",
                "display_name": "STM",
                "timezone": "America/Toronto",
                "is_active": True,
            },
            "feeds": {
                "static_schedule": {
                    "endpoint_key": "static_schedule",
                    "feed_kind": "static_schedule",
                    "source_format": "gtfs_schedule_zip",
                    "source_url": "https://example.com/static.zip",
                    "auth": {"auth_type": "none"},
                    "refresh_interval_seconds": 86400,
                },
                "trip_updates": {
                    "endpoint_key": "trip_updates",
                    "feed_kind": "trip_updates",
                    "source_format": "gtfs_rt_trip_updates",
                    "source_url": "https://example.com/trip-updates.pb",
                    "auth": {
                        "auth_type": "api_key",
                        "credential_env_var": "STM_API_KEY",
                        "auth_header_name": "apiKey",
                    },
                    "refresh_interval_seconds": 30,
                },
                "vehicle_positions": {
                    "endpoint_key": "vehicle_positions",
                    "feed_kind": "vehicle_positions",
                    "source_format": "gtfs_rt_vehicle_positions",
                    "source_url": "https://example.com/vehicle-positions.pb",
                    "auth": {
                        "auth_type": "api_key",
                        "credential_env_var": "STM_API_KEY",
                        "auth_header_name": "apiKey",
                    },
                    "refresh_interval_seconds": 30,
                },
            },
        }
    )


def test_find_latest_realtime_bronze_snapshot_resolves_local_file(tmp_path: Path) -> None:
    target_path = tmp_path / "stm" / "trip_updates" / "trip_updates.pb"
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_bytes(b"snapshot")
    row = {
        "realtime_snapshot_id": 44,
        "provider_id": "stm",
        "endpoint_key": "trip_updates",
        "storage_backend": "local",
        "feed_endpoint_id": 2,
        "ingestion_run_id": 11,
        "ingestion_object_id": 22,
        "storage_path": "stm/trip_updates/trip_updates.pb",
        "source_url": "https://example.com/tripUpdates",
        "checksum_sha256": "d" * 64,
        "byte_size": target_path.stat().st_size,
        "feed_timestamp_utc": datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
        "captured_at_utc": datetime(2026, 3, 25, 0, 0, 1, tzinfo=UTC),
    }
    settings = Settings(_env_file=None, BRONZE_LOCAL_ROOT=str(tmp_path))

    snapshot = find_latest_realtime_bronze_snapshot(
        SnapshotLookupConnection(row),
        provider_id="stm",
        endpoint_key="trip_updates",
        settings=settings,
        project_root=Path(__file__).resolve().parents[1],
    )

    assert snapshot.realtime_snapshot_id == 44
    assert snapshot.archive_full_path == str(target_path)


def test_normalize_trip_updates_maps_minimum_fields(tmp_path: Path) -> None:
    archive_path = tmp_path / "trip_updates.pb"
    _write_bytes(archive_path, _build_trip_updates_bytes())
    snapshot = _build_snapshot(archive_path, "trip_updates")
    message = gtfs_realtime_pb2.FeedMessage()
    message.ParseFromString(archive_path.read_bytes())

    trip_updates, stop_time_updates = normalize_trip_updates(message, snapshot=snapshot)

    assert len(trip_updates) == 1
    assert len(stop_time_updates) == 1
    assert trip_updates[0]["trip_id"] == "trip-1"
    assert trip_updates[0]["route_id"] == "route-1"
    assert trip_updates[0]["vehicle_id"] == "veh-1"
    assert trip_updates[0]["delay_seconds"] == 120
    assert stop_time_updates[0]["stop_sequence"] == 10
    assert stop_time_updates[0]["stop_id"] == "stop-1"
    assert stop_time_updates[0]["arrival_delay_seconds"] == 60
    assert stop_time_updates[0]["departure_delay_seconds"] == 90


def test_normalize_vehicle_positions_maps_minimum_fields(tmp_path: Path) -> None:
    archive_path = tmp_path / "vehicle_positions.pb"
    _write_bytes(archive_path, _build_vehicle_positions_bytes())
    snapshot = _build_snapshot(archive_path, "vehicle_positions")
    message = gtfs_realtime_pb2.FeedMessage()
    message.ParseFromString(archive_path.read_bytes())

    vehicle_positions = normalize_vehicle_positions(message, snapshot=snapshot)

    assert len(vehicle_positions) == 1
    assert vehicle_positions[0]["vehicle_id"] == "veh-9"
    assert vehicle_positions[0]["trip_id"] == "trip-9"
    assert vehicle_positions[0]["route_id"] == "route-9"
    assert vehicle_positions[0]["stop_id"] == "stop-9"
    assert vehicle_positions[0]["latitude"] == pytest.approx(45.501)
    assert vehicle_positions[0]["longitude"] == pytest.approx(-73.567)


def test_load_realtime_snapshot_to_silver_trip_updates_inserts_parent_and_child_rows(
    tmp_path: Path,
) -> None:
    archive_path = tmp_path / "trip_updates.pb"
    _write_bytes(archive_path, _build_trip_updates_bytes())
    snapshot = _build_snapshot(archive_path, "trip_updates")
    connection = RecordingConnection()
    bronze_storage = FakeBronzeStorage(archive_path.read_bytes())

    result = load_realtime_snapshot_to_silver(
        connection,
        snapshot=snapshot,
        bronze_storage=bronze_storage,
    )

    assert result.realtime_snapshot_id == 301
    assert result.row_counts == {
        "trip_updates": 1,
        "trip_update_stop_time_updates": 1,
    }
    assert "SELECT count(*)" in connection.calls[0][0]
    assert "INSERT INTO silver.trip_updates" in connection.calls[1][0]
    assert "INSERT INTO silver.trip_update_stop_time_updates" in connection.calls[2][0]


def test_load_realtime_snapshot_to_silver_vehicle_positions_inserts_rows(
    tmp_path: Path,
) -> None:
    archive_path = tmp_path / "vehicle_positions.pb"
    _write_bytes(archive_path, _build_vehicle_positions_bytes())
    snapshot = _build_snapshot(archive_path, "vehicle_positions")
    connection = RecordingConnection()
    bronze_storage = FakeBronzeStorage(archive_path.read_bytes())

    result = load_realtime_snapshot_to_silver(
        connection,
        snapshot=snapshot,
        bronze_storage=bronze_storage,
    )

    assert result.realtime_snapshot_id == 302
    assert result.row_counts == {"vehicle_positions": 1}
    assert "SELECT count(*)" in connection.calls[0][0]
    assert "INSERT INTO silver.vehicle_positions" in connection.calls[1][0]


def test_load_latest_realtime_to_silver_uses_bronze_snapshot_without_api_key(
    tmp_path: Path,
) -> None:
    bronze_root = tmp_path / "bronze"
    archive_path = bronze_root / "stm" / "trip_updates" / "captured_at_utc=2026-03-25" / "sample.pb"
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    _write_bytes(archive_path, _build_trip_updates_bytes())

    lookup_row = {
        "realtime_snapshot_id": 77,
        "provider_id": "stm",
        "endpoint_key": "trip_updates",
        "storage_backend": "local",
        "feed_endpoint_id": 2,
        "ingestion_run_id": 11,
        "ingestion_object_id": 22,
        "storage_path": "stm/trip_updates/captured_at_utc=2026-03-25/sample.pb",
        "source_url": "https://example.com/trip-updates.pb",
        "checksum_sha256": "e" * 64,
        "byte_size": archive_path.stat().st_size,
        "feed_timestamp_utc": datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
        "captured_at_utc": datetime(2026, 3, 25, 0, 0, 5, tzinfo=UTC),
    }
    engine = FakeEngine(
        SnapshotLookupConnection(lookup_row),
        RecordingConnection(),
    )
    settings = Settings(
        NEON_DATABASE_URL="postgresql://user:pass@example.com/neondb",
        BRONZE_LOCAL_ROOT=str(bronze_root),
        STM_API_KEY=None,
    )

    result = load_latest_realtime_to_silver(
        "stm",
        "trip_updates",
        settings=settings,
        registry=FakeRegistry(_build_manifest()),
        engine=engine,
    )

    assert result.realtime_snapshot_id == 77
    assert result.row_counts == {
        "trip_updates": 1,
        "trip_update_stop_time_updates": 1,
    }


def test_load_latest_realtime_to_silver_reads_s3_backed_snapshot(
    tmp_path: Path,
    monkeypatch,
) -> None:
    payload = _build_vehicle_positions_bytes()
    fake_storage = FakeBronzeStorage(payload)
    lookup_row = {
        "realtime_snapshot_id": 88,
        "provider_id": "stm",
        "endpoint_key": "vehicle_positions",
        "storage_backend": "s3",
        "feed_endpoint_id": 3,
        "ingestion_run_id": 12,
        "ingestion_object_id": 23,
        "storage_path": "stm/vehicle_positions/captured_at_utc=2026-03-25/sample.pb",
        "source_url": "https://example.com/vehicle-positions.pb",
        "checksum_sha256": "f" * 64,
        "byte_size": len(payload),
        "feed_timestamp_utc": datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
        "captured_at_utc": datetime(2026, 3, 25, 0, 0, 5, tzinfo=UTC),
    }
    engine = FakeEngine(
        SnapshotLookupConnection(lookup_row),
        RecordingConnection(),
    )
    settings = Settings(
        _env_file=None,
        NEON_DATABASE_URL="postgresql://user:pass@example.com/neondb",
        BRONZE_S3_ENDPOINT="https://example.r2.cloudflarestorage.com",
        BRONZE_S3_BUCKET="bronze-bucket",
        BRONZE_S3_ACCESS_KEY="access",
        BRONZE_S3_SECRET_KEY="secret",
        BRONZE_S3_REGION="auto",
    )

    monkeypatch.setattr(
        realtime_silver_module,
        "get_bronze_storage",
        lambda settings, project_root, storage_backend: fake_storage,
    )

    result = load_latest_realtime_to_silver(
        "stm",
        "vehicle_positions",
        settings=settings,
        registry=FakeRegistry(_build_manifest()),
        engine=engine,
    )

    assert result.realtime_snapshot_id == 88
    assert result.archive_full_path == (
        "s3://bronze-bucket/stm/vehicle_positions/captured_at_utc=2026-03-25/sample.pb"
    )
    assert result.row_counts == {"vehicle_positions": 1}
    assert fake_storage.read_calls == [lookup_row["storage_path"]]
