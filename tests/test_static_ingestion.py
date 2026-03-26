from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import transit_ops.ingestion.static_gtfs as static_gtfs
from transit_ops.ingestion.common import DownloadedArtifact
from transit_ops.ingestion.static_gtfs import (
    _get_feed_endpoint_id,
    _insert_ingestion_object,
    _insert_ingestion_run,
    _mark_ingestion_run_succeeded,
    build_static_ingestion_config,
    build_static_object_storage_path,
    compute_sha256_hex,
    ingest_static_feed,
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
            return FakeResult(11)
        if "RETURNING ingestion_run_id" in sql_text:
            return FakeResult(101)
        if "RETURNING ingestion_object_id" in sql_text:
            return FakeResult(202)
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


def test_build_static_object_storage_path() -> None:
    started_at_utc = datetime(2026, 3, 24, 11, 2, 3, 456789, tzinfo=UTC)

    storage_path = build_static_object_storage_path(
        provider_id="stm",
        endpoint_key="static_schedule",
        started_at_utc=started_at_utc,
        source_url="https://example.com/files/gtfs_stm.zip",
        checksum_sha256="a" * 64,
    )

    assert storage_path == (
        "stm/static_schedule/ingested_at_utc=2026-03-24/"
        "20260324T110203456789Z__aaaaaaaaaaaa__gtfs_stm.zip"
    )


def test_compute_sha256_hex(tmp_path: Path) -> None:
    file_path = tmp_path / "feed.zip"
    file_path.write_bytes(b"stm-static-feed")

    assert compute_sha256_hex(file_path) == (
        "1521aad99aa1294034da3b95d3159a73b475a28969162840d1e41ada2c92bb35"
    )


def test_manifest_driven_static_ingestion_config_uses_url_override() -> None:
    registry = ProviderRegistry.from_project_root(
        project_root=Path(__file__).resolve().parents[1],
        settings=Settings(
            _env_file=None,
            STM_STATIC_GTFS_URL="https://override.example.com/stm.zip",
            BRONZE_LOCAL_ROOT="./custom-bronze",
            BRONZE_STORAGE_BACKEND="local",
        ),
    )
    settings = Settings(
        _env_file=None,
        STM_STATIC_GTFS_URL="https://override.example.com/stm.zip",
        BRONZE_LOCAL_ROOT="./custom-bronze",
        BRONZE_STORAGE_BACKEND="local",
    )

    config = build_static_ingestion_config(registry.get_provider("stm"), settings)

    assert config.provider_id == "stm"
    assert config.endpoint_key == "static_schedule"
    assert config.source_url == "https://override.example.com/stm.zip"
    assert config.bronze_root == Path("./custom-bronze")
    assert config.storage_backend == "local"


def test_manifest_driven_static_ingestion_config_supports_s3_backend() -> None:
    settings = Settings(
        _env_file=None,
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

    config = build_static_ingestion_config(registry.get_provider("stm"), settings)

    assert config.storage_backend == "s3"
    assert config.bronze_root == Path("./data/bronze")


def test_database_registration_helpers_capture_expected_values() -> None:
    connection = RecordingConnection()
    started_at_utc = datetime(2026, 3, 24, 11, 0, 0, tzinfo=UTC)
    completed_at_utc = datetime(2026, 3, 24, 11, 0, 30, tzinfo=UTC)

    feed_endpoint_id = _get_feed_endpoint_id(
        connection,
        provider_id="stm",
        endpoint_key="static_schedule",
    )
    ingestion_run_id = _insert_ingestion_run(
        connection,
        provider_id="stm",
        feed_endpoint_id=feed_endpoint_id,
        run_kind="static_schedule",
        requested_at_utc=started_at_utc,
        started_at_utc=started_at_utc,
    )
    ingestion_object_id = _insert_ingestion_object(
        connection,
        ingestion_run_id=ingestion_run_id,
        provider_id="stm",
        object_kind="gtfs_schedule_zip",
        storage_backend="local",
        storage_path=(
            "stm/static_schedule/ingested_at_utc=2026-03-24/"
            "20260324T110000000000Z__aaaaaaaaaaaa__gtfs_stm.zip"
        ),
        source_url="https://www.stm.info/sites/default/files/gtfs/gtfs_stm.zip",
        checksum_sha256="a" * 64,
        byte_size=123456,
    )
    _mark_ingestion_run_succeeded(
        connection,
        ingestion_run_id=ingestion_run_id,
        completed_at_utc=completed_at_utc,
        http_status_code=200,
    )

    assert feed_endpoint_id == 11
    assert ingestion_run_id == 101
    assert ingestion_object_id == 202
    assert "SELECT feed_endpoint_id" in connection.calls[0][0]
    assert "INSERT INTO raw.ingestion_runs" in connection.calls[1][0]
    assert connection.calls[1][1]["provider_id"] == "stm"
    assert connection.calls[1][1]["run_kind"] == "static_schedule"
    assert "INSERT INTO raw.ingestion_objects" in connection.calls[2][0]
    assert connection.calls[2][1]["storage_backend"] == "local"
    assert connection.calls[2][1]["byte_size"] == 123456
    assert "UPDATE raw.ingestion_runs" in connection.calls[3][0]
    assert connection.calls[3][1]["http_status_code"] == 200


def test_ingest_static_feed_uses_storage_abstraction_for_s3(
    tmp_path: Path,
    monkeypatch,
) -> None:
    temp_path = tmp_path / "download.zip"
    payload = b"gtfs-static-zip"
    temp_path.write_bytes(payload)
    artifact = DownloadedArtifact(
        temp_path=temp_path,
        byte_size=len(payload),
        checksum_sha256=compute_sha256_hex(temp_path),
        http_status_code=200,
        source_url="https://override.example.com/stm.zip",
    )
    fake_storage = FakeBronzeStorage("s3://bronze-bucket")
    connection = RecordingConnection()
    settings = Settings(
        _env_file=None,
        NEON_DATABASE_URL="postgresql://user:pass@example.com/neondb",
        STM_STATIC_GTFS_URL="https://override.example.com/stm.zip",
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

    monkeypatch.setattr(static_gtfs, "_download_to_tempfile", lambda source_url, temp_dir: artifact)
    monkeypatch.setattr(
        static_gtfs,
        "get_bronze_storage",
        lambda settings, project_root, storage_backend: fake_storage,
    )

    result = ingest_static_feed(
        "stm",
        settings=settings,
        registry=registry,
        engine=FakeEngine(connection),
    )

    assert result.storage_backend == "s3"
    assert result.archive_full_path == f"s3://bronze-bucket/{result.storage_path}"
    assert result.storage_path.startswith("stm/static_schedule/ingested_at_utc=")
    assert fake_storage.persisted[0][1] == result.storage_path
    assert connection.calls[2][1]["storage_backend"] == "s3"
    assert connection.calls[2][1]["storage_path"] == result.storage_path
