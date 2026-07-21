from __future__ import annotations

import inspect
import json
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

import transit_ops.ingestion.i3 as i3_ingestion
from transit_ops.ingestion.common import DownloadedArtifact, compute_sha256_hex
from transit_ops.ingestion.i3 import (
    _insert_i3_alert_snapshot,
    build_i3_ingestion_config,
    build_i3_object_storage_path,
    capture_i3_alerts,
    extract_i3_metadata,
)
from transit_ops.providers.registry import ProviderRegistry
from transit_ops.settings import Settings


class FakeResult:
    def __init__(self, scalar_value: int | None) -> None:
        self.scalar_value = scalar_value

    def scalar_one(self) -> int:
        if self.scalar_value is None:
            raise AssertionError("Expected scalar value.")
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
            return FakeResult(44)
        if "RETURNING ingestion_run_id" in sql_text:
            return FakeResult(101)
        if "RETURNING ingestion_object_id" in sql_text:
            return FakeResult(202)
        if "RETURNING i3_alert_snapshot_id" in sql_text:
            return FakeResult(505)
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


def test_i3_manifest_config_uses_json_accept_header_and_url_override() -> None:
    settings = Settings(
        _env_file=None,
        STM_API_KEY="demo-key",
        STM_I3_ALERTS_URL="https://override.example.com/i3/messages",
        BRONZE_STORAGE_BACKEND="local",
        BRONZE_LOCAL_ROOT="./bronze",
    )
    registry = ProviderRegistry.from_project_root(
        project_root=Path(__file__).resolve().parents[1],
        settings=settings,
    )

    config = build_i3_ingestion_config(registry.get_provider("stm"), settings)

    assert config.provider_id == "stm"
    assert config.endpoint_key == "i3_alerts"
    assert config.source_format == "api_i3_json"
    assert config.source_url == "https://override.example.com/i3/messages"
    assert config.request_headers == {
        "apiKey": "demo-key",
        "Accept": "application/json",
        "User-Agent": "transit-ops/0.1.0",
    }


def test_i3_storage_path_uses_json_name() -> None:
    captured_at_utc = datetime(2026, 5, 25, 4, 5, 6, 123456, tzinfo=UTC)

    assert build_i3_object_storage_path(
        provider_id="stm",
        captured_at_utc=captured_at_utc,
        checksum_sha256="f" * 64,
    ) == (
        "stm/i3_alerts/captured_at_utc=2026-05-25/"
        "20260525T040506123456Z__ffffffffffff__i3_alerts.json"
    )


def test_extract_i3_metadata_accepts_alerts_or_messages_payloads() -> None:
    payload = {
        "apiVersion": "2",
        "alerts": [{"id": "a1"}, {"id": "a2"}],
    }

    metadata = extract_i3_metadata(
        json.dumps(payload).encode("utf-8"),
        provider_id="stm",
    )

    assert metadata.provider_id == "stm"
    assert metadata.endpoint_key == "i3_alerts"
    assert metadata.api_version == "2"
    assert metadata.alert_count == 2
    assert metadata.raw_payload_json == payload


def test_i3_database_registration_inserts_raw_snapshot() -> None:
    connection = RecordingConnection()
    captured_at_utc = datetime(2026, 5, 25, 4, 5, 6, tzinfo=UTC)

    snapshot_id = _insert_i3_alert_snapshot(
        connection,
        ingestion_run_id=101,
        ingestion_object_id=202,
        provider_id="stm",
        feed_endpoint_id=44,
        source_url="https://example.com/i3",
        http_status_code=200,
        captured_at_utc=captured_at_utc,
        storage_backend="s3",
        storage_path="stm/i3_alerts/sample.json",
        checksum_sha256="f" * 64,
        byte_size=123,
        api_version="2",
        alert_count=2,
        raw_payload_json={"alerts": [{"id": "a1"}, {"id": "a2"}]},
    )

    assert snapshot_id == 505
    assert "INSERT INTO raw.i3_alert_snapshots" in connection.calls[0][0]
    assert connection.calls[0][1]["alert_count"] == 2


def test_capture_i3_alerts_persists_payload_and_registers_snapshot(
    tmp_path: Path,
    monkeypatch,
) -> None:
    payload = json.dumps({"alerts": [{"id": "a1"}]}).encode("utf-8")
    temp_path = tmp_path / "i3_alerts.json"
    temp_path.write_bytes(payload)
    artifact = DownloadedArtifact(
        temp_path=temp_path,
        byte_size=len(payload),
        checksum_sha256=compute_sha256_hex(temp_path),
        http_status_code=200,
        source_url="https://example.com/i3",
    )
    fake_storage = FakeBronzeStorage("s3://bronze-bucket")
    connection = RecordingConnection()
    settings = Settings(
        _env_file=None,
        DATABASE_URL="postgresql://user:pass@example.com/transit",
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

    monkeypatch.setattr(i3_ingestion, "download_to_tempfile", lambda **kwargs: artifact)
    monkeypatch.setattr(
        i3_ingestion,
        "get_bronze_storage",
        lambda settings, project_root, storage_backend: fake_storage,
    )

    result = capture_i3_alerts(
        "stm",
        settings=settings,
        registry=registry,
        engine=FakeEngine(connection),
    )

    assert result.storage_backend == "s3"
    assert result.archive_full_path == f"s3://bronze-bucket/{result.storage_path}"
    assert result.i3_alert_snapshot_id == 505
    assert result.alert_count == 1
    assert fake_storage.persisted[0][1] == result.storage_path
    assert connection.calls[1][1]["run_kind"] == "i3_alerts"
    assert connection.calls[2][1]["object_kind"] == "api_i3_json"
    assert "INSERT INTO raw.i3_alert_snapshots" in connection.calls[3][0]


@pytest.mark.parametrize(
    ("private_name", "builder_name", "metadata_name", "endpoint_key", "source_format"),
    [
        (
            "_capture_i3_alerts",
            "build_i3_ingestion_config",
            "extract_i3_metadata",
            "i3_alerts",
            "api_i3_json",
        ),
        (
            "_capture_service_alerts",
            "build_service_alerts_ingestion_config",
            "extract_service_alerts_metadata",
            "service_alerts",
            "gtfs_rt_alerts",
        ),
    ],
)
def test_worker_private_alert_capture_uses_injected_storage_resolver(
    tmp_path: Path,
    monkeypatch,
    private_name: str,
    builder_name: str,
    metadata_name: str,
    endpoint_key: str,
    source_format: str,
) -> None:
    payload = b"normalized-alert-payload"
    temp_path = tmp_path / f"{endpoint_key}.bin"
    temp_path.write_bytes(payload)
    artifact = DownloadedArtifact(
        temp_path=temp_path,
        byte_size=len(payload),
        checksum_sha256=compute_sha256_hex(temp_path),
        http_status_code=200,
        source_url=f"https://example.com/{endpoint_key}",
    )
    config = i3_ingestion.I3IngestionConfig(
        provider_id="stm",
        endpoint_key=endpoint_key,
        feed_kind=endpoint_key,
        source_format=source_format,
        source_url=artifact.source_url,
        request_url=artifact.source_url,
        request_headers={},
        storage_backend="s3",
        bronze_root=tmp_path / "bronze",
        refresh_interval_seconds=300,
    )
    fake_storage = FakeBronzeStorage("s3://bronze-bucket")
    resolved_backends: list[str] = []

    monkeypatch.setattr(i3_ingestion, builder_name, lambda manifest, settings: config)
    monkeypatch.setattr(i3_ingestion, "download_to_tempfile", lambda **kwargs: artifact)
    monkeypatch.setattr(
        i3_ingestion,
        metadata_name,
        lambda payload_bytes, provider_id: i3_ingestion.I3Metadata(
            provider_id=provider_id,
            endpoint_key=endpoint_key,
            api_version="2.0",
            alert_count=1,
            raw_payload_json={"alerts": [{"id": "a1"}]},
        ),
    )

    result = getattr(i3_ingestion, private_name)(
        "stm",
        settings=Settings(
            _env_file=None,
            DATABASE_URL="postgresql://user:pass@example.com/transit",
        ),
        registry=SimpleNamespace(get_provider=lambda provider_id: object()),
        engine=FakeEngine(RecordingConnection()),
        bronze_storage_resolver=lambda backend: (
            resolved_backends.append(backend),
            fake_storage,
        )[1],
    )

    assert resolved_backends == ["s3"]
    assert result.endpoint_key == endpoint_key
    assert result.storage_backend == "s3"
    assert fake_storage.persisted[0][1] == result.storage_path


def test_alert_capture_public_signatures_are_unchanged() -> None:
    for capture in (i3_ingestion.capture_i3_alerts, i3_ingestion.capture_service_alerts):
        signature = inspect.signature(capture)
        assert list(signature.parameters) == ["provider_id", "settings", "registry", "engine"]
        assert signature.parameters["settings"].default is None
        assert signature.parameters["registry"].default is None
        assert signature.parameters["engine"].default is None
