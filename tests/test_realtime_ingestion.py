from __future__ import annotations

import hashlib
import ssl
from datetime import UTC, datetime
from pathlib import Path

import pytest
from google.transit import gtfs_realtime_pb2

import transit_ops.ingestion.realtime_gtfs as realtime_gtfs
from transit_ops.ingestion.common import DownloadedArtifact, compute_sha256_hex
from transit_ops.ingestion.realtime_gtfs import (
    _build_realtime_ssl_context,
    _get_feed_endpoint_id,
    _insert_ingestion_object,
    _insert_ingestion_run,
    _insert_realtime_snapshot_index,
    _mark_ingestion_run_succeeded,
    build_realtime_ingestion_config,
    build_realtime_object_storage_path,
    capture_realtime_feed,
    extract_realtime_metadata,
)
from transit_ops.providers.registry import ProviderRegistry
from transit_ops.settings import Settings


class FakeResult:
    def __init__(self, scalar_value: int | None) -> None:
        self.scalar_value = scalar_value

    def scalar_one(self) -> int:
        if self.scalar_value is None:
            raise AssertionError("Expected a scalar value.")
        return self.scalar_value

    def scalar_one_or_none(self) -> int | None:
        return self.scalar_value


class RecordingConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def execute(self, statement, params: dict[str, object]) -> FakeResult:  # noqa: ANN001
        sql_text = str(statement)
        self.calls.append((sql_text, params))
        if "SELECT feed_endpoint_id" in sql_text:
            return FakeResult(12)
        if "RETURNING ingestion_run_id" in sql_text:
            return FakeResult(101)
        if "RETURNING ingestion_object_id" in sql_text:
            return FakeResult(202)
        if "RETURNING realtime_snapshot_id" in sql_text:
            return FakeResult(303)
        return FakeResult(None)


class _ContextManager:
    def __init__(self, connection: RecordingConnection) -> None:
        self.connection = connection

    def __enter__(self) -> RecordingConnection:
        return self.connection

    def __exit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001
        return False


class FakeEngine:
    def __init__(self, connection: RecordingConnection) -> None:
        self.connection = connection

    def begin(self) -> _ContextManager:
        return _ContextManager(self.connection)


class FakeBronzeStorage:
    def __init__(self, prefix: str) -> None:
        self.prefix = prefix.rstrip("/")
        self.persisted: list[tuple[Path, str]] = []

    def persist_temp_file(self, temp_path: Path, storage_path: str) -> str:
        self.persisted.append((temp_path, storage_path))
        temp_path.unlink(missing_ok=True)
        return f"{self.prefix}/{storage_path}"


def _build_feed_message_bytes(
    *,
    timestamp: int,
    entity_count: int,
    endpoint_key: str,
) -> bytes:
    message = gtfs_realtime_pb2.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    message.header.timestamp = timestamp

    for entity_index in range(entity_count):
        entity = message.entity.add()
        entity.id = f"{endpoint_key}-{entity_index}"
        if endpoint_key == "trip_updates":
            entity.trip_update.trip.trip_id = f"trip-{entity_index}"
        else:
            entity.vehicle.trip.trip_id = f"trip-{entity_index}"

    return message.SerializeToString()


def test_build_realtime_object_storage_path() -> None:
    captured_at_utc = datetime(2026, 3, 24, 12, 15, 16, 987654, tzinfo=UTC)

    storage_path = build_realtime_object_storage_path(
        provider_id="stm",
        endpoint_key="trip_updates",
        captured_at_utc=captured_at_utc,
        checksum_sha256="b" * 64,
    )

    assert storage_path == (
        "stm/trip_updates/captured_at_utc=2026-03-24/"
        "20260324T121516987654Z__bbbbbbbbbbbb__trip_updates.pb"
    )


def test_manifest_driven_realtime_config_uses_api_key_header_and_override() -> None:
    settings = Settings(
        _env_file=None,
        STM_API_KEY="demo-key",
        STM_RT_TRIP_UPDATES_URL="https://override.example.com/tripUpdates",
        BRONZE_LOCAL_ROOT="./custom-bronze",
        BRONZE_STORAGE_BACKEND="local",
    )
    registry = ProviderRegistry.from_project_root(
        project_root=Path(__file__).resolve().parents[1],
        settings=settings,
    )

    config = build_realtime_ingestion_config(
        registry.get_provider("stm"),
        settings,
        "trip_updates",
    )

    assert config.provider_id == "stm"
    assert config.endpoint_key == "trip_updates"
    assert config.source_url == "https://override.example.com/tripUpdates"
    assert config.request_url == "https://override.example.com/tripUpdates"
    assert config.request_headers == {
        "apiKey": "demo-key",
        "Accept": "application/x-protobuf",
        "User-Agent": "transit-ops/0.1.0",
    }
    assert config.bronze_root == Path("./custom-bronze")
    assert config.storage_backend == "local"


def test_manifest_driven_realtime_config_supports_s3_backend() -> None:
    settings = Settings(
        _env_file=None,
        STM_API_KEY="demo-key",
        BRONZE_STORAGE_BACKEND="s3",
        BRONZE_S3_ENDPOINT="https://example.r2.cloudflarestorage.com",
        BRONZE_S3_BUCKET="bronze-bucket",
        BRONZE_S3_ACCESS_KEY="access",
        BRONZE_S3_SECRET_KEY="secret",
        BRONZE_S3_REGION="auto",
    )
    registry = ProviderRegistry.from_project_root(
        project_root=Path(__file__).resolve().parents[1],
        settings=settings,
    )

    config = build_realtime_ingestion_config(
        registry.get_provider("stm"),
        settings,
        "vehicle_positions",
    )

    assert config.storage_backend == "s3"
    assert config.bronze_root == Path("./data/bronze")


def test_build_realtime_ssl_context_pins_tls_1_2() -> None:
    context = _build_realtime_ssl_context()

    assert context.minimum_version == ssl.TLSVersion.TLSv1_2
    assert context.maximum_version == ssl.TLSVersion.TLSv1_2


def test_realtime_checksum_uses_sha256(tmp_path: Path) -> None:
    file_path = tmp_path / "trip_updates.pb"
    payload = b"gtfs-rt-snapshot"
    file_path.write_bytes(payload)

    assert compute_sha256_hex(file_path) == hashlib.sha256(payload).hexdigest()


def test_extract_realtime_metadata_from_protobuf_bytes() -> None:
    payload_bytes = _build_feed_message_bytes(
        timestamp=1_774_750_400,
        entity_count=2,
        endpoint_key="trip_updates",
    )

    metadata = extract_realtime_metadata(
        payload_bytes,
        provider_id="stm",
        endpoint_key="trip_updates",
    )

    assert metadata.provider_id == "stm"
    assert metadata.endpoint_key == "trip_updates"
    assert metadata.feed_kind == "trip_updates"
    assert metadata.entity_count == 2
    assert metadata.feed_timestamp_utc == datetime.fromtimestamp(1_774_750_400, tz=UTC)


def test_extract_realtime_metadata_rejects_missing_header_timestamp() -> None:
    message = gtfs_realtime_pb2.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    message.entity.add().id = "missing-ts"

    with pytest.raises(ValueError, match="timestamp is missing or invalid"):
        extract_realtime_metadata(
            message.SerializeToString(),
            provider_id="stm",
            endpoint_key="vehicle_positions",
        )


def test_realtime_database_registration_helpers_capture_expected_values() -> None:
    connection = RecordingConnection()
    started_at_utc = datetime(2026, 3, 24, 12, 0, 0, tzinfo=UTC)
    completed_at_utc = datetime(2026, 3, 24, 12, 0, 15, tzinfo=UTC)
    feed_timestamp_utc = datetime(2026, 3, 24, 11, 59, 45, tzinfo=UTC)

    feed_endpoint_id = _get_feed_endpoint_id(
        connection,
        provider_id="stm",
        endpoint_key="trip_updates",
    )
    ingestion_run_id = _insert_ingestion_run(
        connection,
        provider_id="stm",
        feed_endpoint_id=feed_endpoint_id,
        run_kind="trip_updates",
        requested_at_utc=started_at_utc,
        started_at_utc=started_at_utc,
    )
    ingestion_object_id = _insert_ingestion_object(
        connection,
        ingestion_run_id=ingestion_run_id,
        provider_id="stm",
        object_kind="gtfs_rt_trip_updates",
        storage_backend="local",
        storage_path=(
            "stm/trip_updates/captured_at_utc=2026-03-24/"
            "20260324T120000000000Z__bbbbbbbbbbbb__trip_updates.pb"
        ),
        source_url="https://api.stm.info/pub/od/gtfs-rt/ic/v2/tripUpdates",
        checksum_sha256="b" * 64,
        byte_size=4567,
    )
    realtime_snapshot_id = _insert_realtime_snapshot_index(
        connection,
        ingestion_run_id=ingestion_run_id,
        ingestion_object_id=ingestion_object_id,
        provider_id="stm",
        feed_endpoint_id=feed_endpoint_id,
        feed_timestamp_utc=feed_timestamp_utc,
        entity_count=17,
        captured_at_utc=completed_at_utc,
    )
    _mark_ingestion_run_succeeded(
        connection,
        ingestion_run_id=ingestion_run_id,
        completed_at_utc=completed_at_utc,
        http_status_code=200,
        entity_count=17,
        feed_timestamp_utc=feed_timestamp_utc,
    )

    assert feed_endpoint_id == 12
    assert ingestion_run_id == 101
    assert ingestion_object_id == 202
    assert realtime_snapshot_id == 303
    assert "SELECT feed_endpoint_id" in connection.calls[0][0]
    assert "INSERT INTO raw.ingestion_runs" in connection.calls[1][0]
    assert connection.calls[1][1]["run_kind"] == "trip_updates"
    assert "INSERT INTO raw.ingestion_objects" in connection.calls[2][0]
    assert connection.calls[2][1]["object_kind"] == "gtfs_rt_trip_updates"
    assert "INSERT INTO raw.realtime_snapshot_index" in connection.calls[3][0]
    assert connection.calls[3][1]["entity_count"] == 17
    assert "UPDATE raw.ingestion_runs" in connection.calls[4][0]
    assert connection.calls[4][1]["feed_timestamp_utc"] == feed_timestamp_utc


def test_capture_realtime_feed_uses_storage_abstraction_for_s3(
    tmp_path: Path,
    monkeypatch,
) -> None:
    payload = _build_feed_message_bytes(
        timestamp=1_774_750_400,
        entity_count=2,
        endpoint_key="vehicle_positions",
    )
    temp_path = tmp_path / "vehicle_positions.pb"
    temp_path.write_bytes(payload)
    artifact = DownloadedArtifact(
        temp_path=temp_path,
        byte_size=len(payload),
        checksum_sha256=compute_sha256_hex(temp_path),
        http_status_code=200,
        source_url="https://example.com/vehiclePositions",
    )
    fake_storage = FakeBronzeStorage("s3://bronze-bucket")
    connection = RecordingConnection()
    settings = Settings(
        _env_file=None,
        NEON_DATABASE_URL="postgresql://user:pass@example.com/neondb",
        STM_API_KEY="demo-key",
        BRONZE_STORAGE_BACKEND="s3",
        BRONZE_S3_ENDPOINT="https://example.r2.cloudflarestorage.com",
        BRONZE_S3_BUCKET="bronze-bucket",
        BRONZE_S3_ACCESS_KEY="access",
        BRONZE_S3_SECRET_KEY="secret",
        BRONZE_S3_REGION="auto",
    )
    registry = ProviderRegistry.from_project_root(
        project_root=Path(__file__).resolve().parents[1],
        settings=settings,
    )

    monkeypatch.setattr(realtime_gtfs, "_download_to_tempfile", lambda config, temp_dir: artifact)
    monkeypatch.setattr(
        realtime_gtfs,
        "get_bronze_storage",
        lambda settings, project_root, storage_backend: fake_storage,
    )

    result = capture_realtime_feed(
        "stm",
        "vehicle_positions",
        settings=settings,
        registry=registry,
        engine=FakeEngine(connection),
    )

    assert result.storage_backend == "s3"
    assert result.archive_full_path == f"s3://bronze-bucket/{result.storage_path}"
    assert result.storage_path.startswith("stm/vehicle_positions/captured_at_utc=")
    assert fake_storage.persisted[0][1] == result.storage_path
    assert connection.calls[2][1]["storage_backend"] == "s3"
    assert connection.calls[2][1]["storage_path"] == result.storage_path
