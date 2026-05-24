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
    def __init__(self, scalar_value=None, mapping_value=None, mapping_rows=None) -> None:  # noqa: ANN001
        self.scalar_value = scalar_value
        self.mapping_value = mapping_value
        self.mapping_rows = mapping_rows or []

    def scalar_one(self):  # noqa: ANN201
        if self.scalar_value is None:
            raise AssertionError("Expected scalar result.")
        return self.scalar_value

    def one_or_none(self):  # noqa: ANN201
        return self.mapping_value

    def mappings(self):  # noqa: ANN201
        return self

    def __iter__(self):  # noqa: ANN201
        return iter(self.mapping_rows)


class RecordingConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        sql_text = str(statement)
        self.calls.append((sql_text, params))
        if "SELECT count(*)" in sql_text:
            return FakeResult(scalar_value=0)
        return FakeResult()


class ExistingAwareConnection:
    def __init__(self, existing_snapshot_ids: set[int] | None = None) -> None:
        self.existing_snapshot_ids = existing_snapshot_ids or set()
        self.calls: list[tuple[str, object]] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        sql_text = str(statement)
        self.calls.append((sql_text, params))
        if "SELECT count(*)" in sql_text:
            snapshot_id = int(params["realtime_snapshot_id"])
            return FakeResult(scalar_value=1 if snapshot_id in self.existing_snapshot_ids else 0)
        return FakeResult()


class CountAwareConnection:
    def __init__(self, counts: dict[str, int]) -> None:
        self.counts = counts
        self.calls: list[tuple[str, object]] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        sql_text = str(statement)
        self.calls.append((sql_text, params))
        if "SELECT count(*)" in sql_text:
            table_name = sql_text.split("FROM silver.", maxsplit=1)[1].split()[0]
            return FakeResult(scalar_value=self.counts.get(table_name, 0))
        return FakeResult()


class SnapshotLookupConnection:
    def __init__(self, row: dict[str, object] | None) -> None:
        self.row = row

    def execute(self, statement, params=None):  # noqa: ANN001
        return FakeResult(mapping_value=self.row)


class SnapshotListConnection:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows
        self.calls: list[tuple[str, object]] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        sql_text = str(statement)
        self.calls.append((sql_text, params))
        start_utc = params["start_utc"]
        end_utc = params["end_utc"]
        provider_id = params["provider_id"]
        rows = [
            row
            for row in self.rows
            if row["provider_id"] == provider_id
            and row["captured_at_utc"] >= start_utc
            and row["captured_at_utc"] < end_utc
        ]
        rows.sort(
            key=lambda row: (
                row["captured_at_utc"],
                row["endpoint_key"],
                row["realtime_snapshot_id"],
            )
        )
        return FakeResult(mapping_rows=rows)


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


def _build_empty_feed_bytes() -> bytes:
    message = gtfs_realtime_pb2.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    message.header.timestamp = 1_774_837_200
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


def _build_snapshot_row(
    path: Path,
    *,
    endpoint_key: str,
    realtime_snapshot_id: int,
    provider_id: str = "stm",
    captured_at_utc: datetime = datetime(2026, 3, 25, 0, 0, 5, tzinfo=UTC),
) -> dict[str, object]:
    return {
        "realtime_snapshot_id": realtime_snapshot_id,
        "provider_id": provider_id,
        "endpoint_key": endpoint_key,
        "storage_backend": "local",
        "feed_endpoint_id": 2 if endpoint_key == "trip_updates" else 3,
        "ingestion_run_id": 100 + realtime_snapshot_id,
        "ingestion_object_id": 200 + realtime_snapshot_id,
        "storage_path": f"stm/{endpoint_key}/{realtime_snapshot_id}.pb",
        "source_url": f"https://example.com/{endpoint_key}.pb",
        "checksum_sha256": "a" * 64,
        "byte_size": path.stat().st_size,
        "feed_timestamp_utc": datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
        "captured_at_utc": captured_at_utc,
    }


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


def test_find_realtime_bronze_snapshots_filters_window_and_provider(
    tmp_path: Path,
) -> None:
    archive_path = tmp_path / "sample.pb"
    _write_bytes(archive_path, b"snapshot")
    start = datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC)
    end = datetime(2026, 3, 25, 0, 10, 0, tzinfo=UTC)
    rows = [
        _build_snapshot_row(
            archive_path,
            endpoint_key="trip_updates",
            realtime_snapshot_id=1,
            captured_at_utc=start,
        ),
        _build_snapshot_row(
            archive_path,
            endpoint_key="vehicle_positions",
            realtime_snapshot_id=2,
            captured_at_utc=end,
        ),
        _build_snapshot_row(
            archive_path,
            endpoint_key="trip_updates",
            realtime_snapshot_id=3,
            provider_id="exo",
            captured_at_utc=start,
        ),
    ]
    settings = Settings(_env_file=None, BRONZE_LOCAL_ROOT=str(tmp_path))
    connection = SnapshotListConnection(rows)

    snapshots = realtime_silver_module.find_realtime_bronze_snapshots(
        connection,
        provider_id="stm",
        start_utc=start,
        end_utc=end,
        settings=settings,
        project_root=Path(__file__).resolve().parents[1],
    )

    assert [snapshot.realtime_snapshot_id for snapshot in snapshots] == [1]
    assert connection.calls[0][1] == {
        "provider_id": "stm",
        "start_utc": start,
        "end_utc": end,
    }
    assert "rsi.captured_at_utc >= :start_utc" in connection.calls[0][0]
    assert "rsi.captured_at_utc < :end_utc" in connection.calls[0][0]
    assert "FROM raw.realtime_snapshot_index AS rsi" in connection.calls[0][0]
    assert "INNER JOIN raw.ingestion_runs AS ir" in connection.calls[0][0]
    assert "INNER JOIN core.feed_endpoints AS fe" in connection.calls[0][0]
    assert "INNER JOIN raw.ingestion_objects AS io" in connection.calls[0][0]
    assert "WHERE rsi.provider_id = :provider_id" in connection.calls[0][0]
    assert "AND ir.status = 'succeeded'" in connection.calls[0][0]


def test_find_realtime_bronze_snapshots_returns_window_in_capture_order(
    tmp_path: Path,
) -> None:
    archive_path = tmp_path / "sample.pb"
    _write_bytes(archive_path, b"snapshot")
    start = datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC)
    end = datetime(2026, 3, 25, 0, 10, 0, tzinfo=UTC)
    rows = [
        _build_snapshot_row(
            archive_path,
            endpoint_key="vehicle_positions",
            realtime_snapshot_id=3,
            captured_at_utc=datetime(2026, 3, 25, 0, 2, 0, tzinfo=UTC),
        ),
        _build_snapshot_row(
            archive_path,
            endpoint_key="trip_updates",
            realtime_snapshot_id=2,
            captured_at_utc=datetime(2026, 3, 25, 0, 2, 0, tzinfo=UTC),
        ),
        _build_snapshot_row(
            archive_path,
            endpoint_key="trip_updates",
            realtime_snapshot_id=1,
            captured_at_utc=datetime(2026, 3, 25, 0, 1, 0, tzinfo=UTC),
        ),
    ]
    settings = Settings(_env_file=None, BRONZE_LOCAL_ROOT=str(tmp_path))
    connection = SnapshotListConnection(rows)

    snapshots = realtime_silver_module.find_realtime_bronze_snapshots(
        connection,
        provider_id="stm",
        start_utc=start,
        end_utc=end,
        settings=settings,
        project_root=Path(__file__).resolve().parents[1],
    )

    assert [snapshot.realtime_snapshot_id for snapshot in snapshots] == [1, 2, 3]
    assert (
        "ORDER BY rsi.captured_at_utc ASC, fe.endpoint_key ASC, "
        "rsi.realtime_snapshot_id ASC"
    ) in connection.calls[0][0]


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


def test_load_realtime_snapshots_to_silver_aggregates_row_counts(
    tmp_path: Path,
) -> None:
    trip_path = tmp_path / "trip_updates.pb"
    vehicle_path = tmp_path / "vehicle_positions.pb"
    _write_bytes(trip_path, _build_trip_updates_bytes())
    _write_bytes(vehicle_path, _build_vehicle_positions_bytes())
    trip_snapshot = _build_snapshot(trip_path, "trip_updates")
    vehicle_snapshot = _build_snapshot(vehicle_path, "vehicle_positions")
    connection = ExistingAwareConnection()
    bronze_storage = FakeBronzeStorage(b"")
    payloads = {
        trip_snapshot.storage_path: trip_path.read_bytes(),
        vehicle_snapshot.storage_path: vehicle_path.read_bytes(),
    }
    bronze_storage.read_bytes = lambda storage_path: payloads[storage_path]  # type: ignore[method-assign]

    result = realtime_silver_module.load_realtime_snapshots_to_silver(
        connection,
        provider_id="stm",
        snapshots=[trip_snapshot, vehicle_snapshot],
        bronze_storage=bronze_storage,
        skip_existing=False,
    )

    assert result.provider_id == "stm"
    assert result.loaded_count == 2
    assert result.skipped_existing_snapshot_ids == []
    assert result.row_counts == {
        "trip_updates": 1,
        "trip_update_stop_time_updates": 1,
        "vehicle_positions": 1,
    }
    assert [item.realtime_snapshot_id for item in result.results] == [301, 302]


def test_load_realtime_snapshots_to_silver_skips_existing_when_requested(
    tmp_path: Path,
) -> None:
    archive_path = tmp_path / "trip_updates.pb"
    _write_bytes(archive_path, _build_trip_updates_bytes())
    already_loaded = _build_snapshot(archive_path, "trip_updates")
    connection = ExistingAwareConnection({already_loaded.realtime_snapshot_id})
    bronze_storage = FakeBronzeStorage(archive_path.read_bytes())

    result = realtime_silver_module.load_realtime_snapshots_to_silver(
        connection,
        provider_id="stm",
        snapshots=[already_loaded],
        bronze_storage=bronze_storage,
        skip_existing=True,
    )

    assert result.loaded_count == 0
    assert result.skipped_existing_snapshot_ids == [already_loaded.realtime_snapshot_id]
    assert result.row_counts == {}
    assert result.results == []
    assert bronze_storage.read_calls == [already_loaded.storage_path]


def test_load_realtime_snapshots_to_silver_skips_complete_trip_updates_snapshot(
    tmp_path: Path,
) -> None:
    archive_path = tmp_path / "trip_updates.pb"
    _write_bytes(archive_path, _build_trip_updates_bytes())
    already_loaded = _build_snapshot(archive_path, "trip_updates")
    connection = CountAwareConnection(
        {
            "trip_updates": 1,
            "trip_update_stop_time_updates": 1,
        }
    )
    bronze_storage = FakeBronzeStorage(archive_path.read_bytes())

    result = realtime_silver_module.load_realtime_snapshots_to_silver(
        connection,
        provider_id="stm",
        snapshots=[already_loaded],
        bronze_storage=bronze_storage,
        skip_existing=True,
    )

    assert result.loaded_count == 0
    assert result.skipped_existing_snapshot_ids == [already_loaded.realtime_snapshot_id]
    assert result.row_counts == {}
    assert result.results == []
    assert bronze_storage.read_calls == [already_loaded.storage_path]


def test_load_realtime_snapshots_to_silver_rejects_partial_trip_updates_skip(
    tmp_path: Path,
) -> None:
    archive_path = tmp_path / "trip_updates.pb"
    _write_bytes(archive_path, _build_trip_updates_bytes())
    partially_loaded = _build_snapshot(archive_path, "trip_updates")
    connection = CountAwareConnection(
        {
            "trip_updates": 1,
            "trip_update_stop_time_updates": 0,
        }
    )
    bronze_storage = FakeBronzeStorage(archive_path.read_bytes())

    with pytest.raises(ValueError, match="Incomplete Silver load"):
        realtime_silver_module.load_realtime_snapshots_to_silver(
            connection,
            provider_id="stm",
            snapshots=[partially_loaded],
            bronze_storage=bronze_storage,
            skip_existing=True,
        )


def test_load_realtime_snapshots_to_silver_skips_complete_vehicle_positions_snapshot(
    tmp_path: Path,
) -> None:
    archive_path = tmp_path / "vehicle_positions.pb"
    _write_bytes(archive_path, _build_vehicle_positions_bytes())
    already_loaded = _build_snapshot(archive_path, "vehicle_positions")
    connection = CountAwareConnection({"vehicle_positions": 1})
    bronze_storage = FakeBronzeStorage(archive_path.read_bytes())

    result = realtime_silver_module.load_realtime_snapshots_to_silver(
        connection,
        provider_id="stm",
        snapshots=[already_loaded],
        bronze_storage=bronze_storage,
        skip_existing=True,
    )

    assert result.loaded_count == 0
    assert result.skipped_existing_snapshot_ids == [already_loaded.realtime_snapshot_id]
    assert result.row_counts == {}
    assert result.results == []
    assert bronze_storage.read_calls == [already_loaded.storage_path]


def test_load_realtime_snapshots_to_silver_loads_zero_row_snapshot_instead_of_skipping(
    tmp_path: Path,
) -> None:
    archive_path = tmp_path / "vehicle_positions.pb"
    _write_bytes(archive_path, _build_empty_feed_bytes())
    snapshot = _build_snapshot(archive_path, "vehicle_positions")
    connection = CountAwareConnection({"vehicle_positions": 0})
    bronze_storage = FakeBronzeStorage(archive_path.read_bytes())

    result = realtime_silver_module.load_realtime_snapshots_to_silver(
        connection,
        provider_id="stm",
        snapshots=[snapshot],
        bronze_storage=bronze_storage,
        skip_existing=True,
    )

    assert result.loaded_count == 1
    assert result.skipped_existing_snapshot_ids == []
    assert result.row_counts == {"vehicle_positions": 0}
    assert result.results[0].row_counts == {"vehicle_positions": 0}


def test_load_realtime_snapshots_to_silver_fails_existing_without_skip(
    tmp_path: Path,
) -> None:
    archive_path = tmp_path / "trip_updates.pb"
    _write_bytes(archive_path, _build_trip_updates_bytes())
    already_loaded = _build_snapshot(archive_path, "trip_updates")
    connection = ExistingAwareConnection({already_loaded.realtime_snapshot_id})
    bronze_storage = FakeBronzeStorage(archive_path.read_bytes())

    with pytest.raises(ValueError, match="already loaded"):
        realtime_silver_module.load_realtime_snapshots_to_silver(
            connection,
            provider_id="stm",
            snapshots=[already_loaded],
            bronze_storage=bronze_storage,
            skip_existing=False,
        )


def test_load_realtime_snapshots_to_silver_preserves_provider_for_empty_batch() -> None:
    result = realtime_silver_module.load_realtime_snapshots_to_silver(
        ExistingAwareConnection(),
        provider_id="stm",
        snapshots=[],
        bronze_storage=FakeBronzeStorage(b""),
        skip_existing=True,
    )

    payload = result.display_dict()

    assert result.provider_id == "stm"
    assert result.loaded_count == 0
    assert result.skipped_existing_snapshot_ids == []
    assert result.row_counts == {}
    assert result.results == []
    assert payload == {
        "provider_id": "stm",
        "loaded_count": 0,
        "skipped_existing_snapshot_ids": [],
        "row_counts": {},
        "results": [],
    }


def test_realtime_silver_batch_load_result_display_dict_serializes_nested_datetimes(
    tmp_path: Path,
) -> None:
    archive_path = tmp_path / "trip_updates.pb"
    _write_bytes(archive_path, _build_trip_updates_bytes())
    snapshot = _build_snapshot(archive_path, "trip_updates")
    load_result = load_realtime_snapshot_to_silver(
        RecordingConnection(),
        snapshot=snapshot,
        bronze_storage=FakeBronzeStorage(archive_path.read_bytes()),
    )
    batch_result = realtime_silver_module.RealtimeSilverBatchLoadResult(
        provider_id="stm",
        loaded_count=1,
        skipped_existing_snapshot_ids=[],
        row_counts=load_result.row_counts,
        results=[load_result],
    )

    payload = batch_result.display_dict()

    assert payload["results"][0]["feed_timestamp_utc"] == "2026-03-25T00:00:00+00:00"
    assert payload["results"][0]["captured_at_utc"] == "2026-03-25T00:00:05+00:00"


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
        DATABASE_URL="postgresql://user:pass@example.com/transit",
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
        DATABASE_URL="postgresql://user:pass@example.com/transit",
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
