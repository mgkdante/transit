from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from versioned_capture_fixtures import FakeEngine, FakeResult, RecordingConnection, prepare_capture

import transit_ops.ingestion.static_gtfs as static_gtfs
from transit_ops.ingestion.common import (
    insert_ingestion_object,
    insert_ingestion_run,
    mark_ingestion_run_succeeded,
)
from transit_ops.ingestion.static_gtfs import (
    _get_feed_endpoint_id,
    build_static_ingestion_config,
    build_static_object_storage_path,
    compute_sha256_hex,
    ingest_static_feed,
)
from transit_ops.providers.registry import ProviderRegistry
from transit_ops.settings import Settings


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
    ingestion_run_id = insert_ingestion_run(
        connection,
        provider_id="stm",
        feed_endpoint_id=feed_endpoint_id,
        run_kind="static_schedule",
        requested_at_utc=started_at_utc,
        started_at_utc=started_at_utc,
    )
    ingestion_object_id = insert_ingestion_object(
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
    mark_ingestion_run_succeeded(
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
    artifact, fake_storage, settings, registry = prepare_capture(
        tmp_path,
        monkeypatch,
        static_gtfs,
        filename="download.zip",
        payload=b"gtfs-static-zip",
        source_url="https://override.example.com/stm.zip",
        url_setting="STM_STATIC_GTFS_URL",
    )
    connection = RecordingConnection()

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
    object_params = next(
        params for sql, params in connection.calls if "INSERT INTO raw.ingestion_objects" in sql
    )
    assert object_params["storage_backend"] == "s3"
    assert object_params["storage_path"] == result.storage_path


def test_ingest_static_feed_skips_unchanged_zip_without_bronze_or_raw_object(
    tmp_path: Path,
    monkeypatch,
) -> None:
    artifact, fake_storage, settings, registry = prepare_capture(
        tmp_path,
        monkeypatch,
        static_gtfs,
        filename="download.zip",
        payload=b"same-static-zip",
        source_url="https://override.example.com/stm.zip",
        url_setting="STM_STATIC_GTFS_URL",
    )
    temp_path = artifact.temp_path
    checksum = artifact.checksum_sha256
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

    result = ingest_static_feed(
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
    assert result.skipped_reason == "static_content_unchanged"
    assert result.first_seen_at_utc == dataset_window["first_seen_at_utc"]
    assert result.last_seen_at_utc == dataset_window["last_seen_at_utc"]
    assert result.observed_from_utc == dataset_window["observed_from_utc"]
    assert result.observed_until_utc == dataset_window["observed_until_utc"]
    assert fake_storage.persisted == []
    assert not any("INSERT INTO raw.ingestion_objects" in sql for sql, _ in connection.calls)
    assert any("UPDATE core.dataset_versions" in sql for sql, _ in connection.calls)
    assert any("UPDATE raw.ingestion_runs" in sql for sql, _ in connection.calls)
    assert not temp_path.exists()


def test_ingest_static_feed_persists_changed_zip_without_promoting_dataset(
    tmp_path: Path,
    monkeypatch,
) -> None:
    artifact, fake_storage, settings, registry = prepare_capture(
        tmp_path,
        monkeypatch,
        static_gtfs,
        filename="download.zip",
        payload=b"changed-static-zip",
        source_url="https://override.example.com/stm.zip",
        url_setting="STM_STATIC_GTFS_URL",
    )
    connection = RecordingConnection(
        current_dataset_checksum="0" * 64,
        current_dataset_version_id=76,
        inserted_dataset_version_id=88,
    )

    result = ingest_static_feed(
        "stm",
        settings=settings,
        registry=registry,
        engine=FakeEngine(connection),
    )

    assert result.status == "succeeded"
    assert result.content_changed is True
    assert result.dataset_version_id is None
    assert result.ingestion_object_id == 202
    assert result.storage_path is not None
    assert result.archive_full_path == f"s3://bronze-bucket/{result.storage_path}"
    assert fake_storage.persisted[0][1] == result.storage_path
    assert any("INSERT INTO raw.ingestion_objects" in sql for sql, _ in connection.calls)
    assert not any(
        "INSERT INTO core.dataset_versions" in sql or "UPDATE core.dataset_versions" in sql
        for sql, _ in connection.calls
    )


class _MetadataFailingConnection(RecordingConnection):

    def __init__(self, fail_marker: str, error: Exception, **kwargs: object) -> None:
        super().__init__(**kwargs)
        self.fail_marker = fail_marker
        self.error = error

    def execute(self, statement, params: dict[str, object]) -> FakeResult:  # noqa: ANN001
        sql_text = str(statement)
        if self.fail_marker in sql_text:
            self.calls.append((sql_text, params))
            raise self.error
        return super().execute(statement, params)


def test_ingest_static_feed_deletes_orphan_object_when_metadata_write_fails(
    tmp_path: Path,
    monkeypatch,
) -> None:
    artifact, fake_storage, settings, registry = prepare_capture(
        tmp_path,
        monkeypatch,
        static_gtfs,
        filename="download.zip",
        payload=b"changed-static-zip",
        source_url="https://override.example.com/stm.zip",
        url_setting="STM_STATIC_GTFS_URL",
    )
    boom = RuntimeError("metadata transaction blew up")
    connection = _MetadataFailingConnection(
        "INSERT INTO raw.ingestion_objects",
        boom,
        current_dataset_checksum="0" * 64,
        current_dataset_version_id=76,
        inserted_dataset_version_id=88,
    )

    with pytest.raises(RuntimeError) as exc_info:
        ingest_static_feed(
            "stm",
            settings=settings,
            registry=registry,
            engine=FakeEngine(connection),
        )

    assert exc_info.value is boom
    assert len(fake_storage.persisted) == 1
    persisted_storage_path = fake_storage.persisted[0][1]
    assert fake_storage.deleted == [persisted_storage_path]


def test_ingest_static_feed_swallows_delete_failure_and_propagates_original(
    tmp_path: Path,
    monkeypatch,
) -> None:
    artifact, fake_storage, settings, registry = prepare_capture(
        tmp_path,
        monkeypatch,
        static_gtfs,
        filename="download.zip",
        payload=b"changed-static-zip",
        source_url="https://override.example.com/stm.zip",
        url_setting="STM_STATIC_GTFS_URL",
    )
    fake_storage.delete_should_raise = True
    boom = RuntimeError("metadata transaction blew up")
    connection = _MetadataFailingConnection(
        "INSERT INTO raw.ingestion_objects",
        boom,
        current_dataset_checksum="0" * 64,
        current_dataset_version_id=76,
        inserted_dataset_version_id=88,
    )

    with pytest.raises(RuntimeError) as exc_info:
        ingest_static_feed(
            "stm",
            settings=settings,
            registry=registry,
            engine=FakeEngine(connection),
        )

    assert exc_info.value is boom
    assert fake_storage.deleted == [fake_storage.persisted[0][1]]
