from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import transit_ops.ingestion.gis as gis_ingestion
from transit_ops.ingestion.common import DownloadedArtifact
from transit_ops.ingestion.gis import (
    build_gis_ingestion_config,
    build_gis_object_storage_path,
    compute_sha256_hex,
    ingest_gis_feed,
)
from transit_ops.providers.registry import ProviderRegistry
from transit_ops.settings import Settings


class FakeResult:
    def __init__(
        self,
        scalar_value: int | None = None,
        mapping_value: dict[str, object] | None = None,
    ) -> None:
        self.scalar_value = scalar_value
        self.mapping_value = mapping_value

    def scalar_one(self) -> int:
        if self.scalar_value is None:
            raise AssertionError("Expected a scalar value.")
        return self.scalar_value

    def scalar_one_or_none(self) -> int | None:
        return self.scalar_value

    def mappings(self) -> FakeResult:
        return self

    def one_or_none(self) -> dict[str, object] | None:
        return self.mapping_value


class RecordingConnection:
    def __init__(
        self,
        *,
        current_dataset_checksum: str | None = None,
        current_dataset_version_id: int | None = None,
        inserted_dataset_version_id: int = 303,
        dataset_window: dict[str, datetime] | None = None,
    ) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.current_dataset_checksum = current_dataset_checksum
        self.current_dataset_version_id = current_dataset_version_id
        self.inserted_dataset_version_id = inserted_dataset_version_id
        self.dataset_window = dataset_window

    def execute(self, statement, params: dict[str, object]) -> FakeResult:  # noqa: ANN001
        sql_text = str(statement)
        self.calls.append((sql_text, params))
        if "SELECT feed_endpoint_id" in sql_text:
            return FakeResult(12)
        if "SELECT" in sql_text and "first_seen_at_utc" in sql_text:
            return FakeResult(mapping_value=self.dataset_window)
        if "SELECT" in sql_text and "core.dataset_versions" in sql_text:
            if (
                self.current_dataset_checksum is None
                or self.current_dataset_version_id is None
            ):
                return FakeResult(mapping_value=None)
            return FakeResult(
                mapping_value={
                    "dataset_version_id": self.current_dataset_version_id,
                    "checksum_sha256": self.current_dataset_checksum,
                }
            )
        if "RETURNING ingestion_run_id" in sql_text:
            return FakeResult(101)
        if "RETURNING dataset_version_id" in sql_text:
            return FakeResult(self.inserted_dataset_version_id)
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


def test_build_gis_object_storage_path() -> None:
    started_at_utc = datetime(2026, 5, 25, 11, 2, 3, 456789, tzinfo=UTC)

    storage_path = build_gis_object_storage_path(
        provider_id="stm",
        endpoint_key="gis_static",
        started_at_utc=started_at_utc,
        source_url="https://example.com/files/stm_sig.zip",
        checksum_sha256="b" * 64,
    )

    assert storage_path == (
        "stm/gis_static/ingested_at_utc=2026-05-25/"
        "20260525T110203456789Z__bbbbbbbbbbbb__stm_sig.zip"
    )


def test_build_gis_object_storage_path_uses_default_stm_sig_filename() -> None:
    started_at_utc = datetime(2026, 5, 25, 11, 2, 3, 456789, tzinfo=UTC)

    storage_path = build_gis_object_storage_path(
        provider_id="stm",
        endpoint_key="gis_static",
        started_at_utc=started_at_utc,
        source_url="https://example.com/",
        checksum_sha256="b" * 64,
    )

    assert storage_path == (
        "stm/gis_static/ingested_at_utc=2026-05-25/"
        "20260525T110203456789Z__bbbbbbbbbbbb__stm_sig.zip"
    )


def test_build_gis_ingestion_config_uses_url_override() -> None:
    settings = Settings(
        _env_file=None,
        STM_GIS_URL="https://override.example.com/custom-gis.zip",
        BRONZE_LOCAL_ROOT="./custom-bronze",
        BRONZE_STORAGE_BACKEND="local",
    )
    registry = ProviderRegistry.from_project_root(
        project_root=Path(__file__).resolve().parents[1],
        settings=settings,
    )

    config = build_gis_ingestion_config(registry.get_provider("stm"), settings)

    assert config.provider_id == "stm"
    assert config.endpoint_key == "gis_static"
    assert config.feed_kind == "gis_static"
    assert config.source_format == "stm_gis_zip"
    assert config.source_url == "https://override.example.com/custom-gis.zip"
    assert config.bronze_root == Path("./custom-bronze")
    assert config.storage_backend == "local"


def test_ingest_gis_feed_persists_changed_zip_and_registers_dataset_version(
    tmp_path: Path,
    monkeypatch,
) -> None:
    temp_path = tmp_path / "stm_sig.zip"
    payload = b"changed-gis-zip"
    temp_path.write_bytes(payload)
    checksum = compute_sha256_hex(temp_path)
    artifact = DownloadedArtifact(
        temp_path=temp_path,
        byte_size=len(payload),
        checksum_sha256=checksum,
        http_status_code=200,
        source_url="https://override.example.com/stm_sig.zip",
    )
    fake_storage = FakeBronzeStorage("s3://bronze-bucket")
    connection = RecordingConnection(
        current_dataset_checksum="0" * 64,
        current_dataset_version_id=76,
        inserted_dataset_version_id=88,
    )
    settings = Settings(
        _env_file=None,
        DATABASE_URL="postgresql://user:pass@example.com/transit",
        STM_GIS_URL="https://override.example.com/stm_sig.zip",
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

    monkeypatch.setattr(
        gis_ingestion,
        "_download_to_tempfile",
        lambda source_url, temp_dir: artifact,
    )
    monkeypatch.setattr(
        gis_ingestion,
        "get_bronze_storage",
        lambda settings, project_root, storage_backend: fake_storage,
    )

    result = ingest_gis_feed(
        "stm",
        settings=settings,
        registry=registry,
        engine=FakeEngine(connection),
    )

    assert result.status == "succeeded"
    assert result.content_changed is True
    assert result.dataset_version_id == 88
    assert result.ingestion_object_id == 202
    assert result.storage_path is not None
    assert result.archive_full_path == f"s3://bronze-bucket/{result.storage_path}"
    assert fake_storage.persisted[0][1] == result.storage_path
    object_params = next(
        params for sql, params in connection.calls
        if "INSERT INTO raw.ingestion_objects" in sql
    )
    assert object_params["object_kind"] == "stm_gis_zip"
    assert object_params["storage_path"] == result.storage_path
    insert_params = next(
        params for sql, params in connection.calls
        if "INSERT INTO core.dataset_versions" in sql
    )
    assert insert_params["dataset_kind"] == "gis_static"
    assert insert_params["source_ingestion_run_id"] == 101
    assert insert_params["source_ingestion_object_id"] is None
    assert insert_params["storage_path"] == result.storage_path
    assert insert_params["parser_version"] == "slice-8.4"
    assert any(
        "UPDATE core.dataset_versions" in sql
        and "source_ingestion_object_id" in sql
        for sql, _ in connection.calls
    )


def test_ingest_gis_feed_skips_unchanged_zip_without_bronze_or_raw_object(
    tmp_path: Path,
    monkeypatch,
) -> None:
    temp_path = tmp_path / "stm_sig.zip"
    payload = b"same-gis-zip"
    temp_path.write_bytes(payload)
    checksum = compute_sha256_hex(temp_path)
    artifact = DownloadedArtifact(
        temp_path=temp_path,
        byte_size=len(payload),
        checksum_sha256=checksum,
        http_status_code=200,
        source_url="https://override.example.com/stm_sig.zip",
    )
    fake_storage = FakeBronzeStorage("s3://bronze-bucket")
    dataset_window = {
        "first_seen_at_utc": datetime(2026, 5, 24, 10, 0, 0, tzinfo=UTC),
        "last_seen_at_utc": datetime(2026, 5, 25, 10, 0, 0, tzinfo=UTC),
        "observed_from_utc": datetime(2026, 5, 24, 10, 0, 0, tzinfo=UTC),
        "observed_until_utc": datetime(2026, 5, 25, 10, 0, 0, tzinfo=UTC),
    }
    connection = RecordingConnection(
        current_dataset_checksum=checksum,
        current_dataset_version_id=77,
        dataset_window=dataset_window,
    )
    settings = Settings(
        _env_file=None,
        DATABASE_URL="postgresql://user:pass@example.com/transit",
        STM_GIS_URL="https://override.example.com/stm_sig.zip",
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

    monkeypatch.setattr(
        gis_ingestion,
        "_download_to_tempfile",
        lambda source_url, temp_dir: artifact,
    )
    monkeypatch.setattr(
        gis_ingestion,
        "get_bronze_storage",
        lambda settings, project_root, storage_backend: fake_storage,
    )

    result = ingest_gis_feed(
        "stm",
        settings=settings,
        registry=registry,
        engine=FakeEngine(connection),
    )

    assert result.status == "skipped_unchanged"
    assert result.content_changed is False
    assert result.dataset_version_id == 77
    assert result.ingestion_run_id == 101
    assert result.ingestion_object_id is None
    assert result.storage_path is None
    assert result.archive_full_path is None
    assert result.skipped_reason == "gis_content_unchanged"
    assert result.first_seen_at_utc == dataset_window["first_seen_at_utc"]
    assert result.last_seen_at_utc == dataset_window["last_seen_at_utc"]
    assert result.observed_from_utc == dataset_window["observed_from_utc"]
    assert result.observed_until_utc == dataset_window["observed_until_utc"]
    assert fake_storage.persisted == []
    assert not any("INSERT INTO raw.ingestion_objects" in sql for sql, _ in connection.calls)
    assert any("UPDATE core.dataset_versions" in sql for sql, _ in connection.calls)
    assert any("UPDATE raw.ingestion_runs" in sql for sql, _ in connection.calls)
    assert not temp_path.exists()
