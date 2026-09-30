from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from versioned_capture_fixtures import FakeEngine, RecordingConnection, prepare_capture

import transit_ops.ingestion.gis as gis_ingestion
from transit_ops.ingestion.gis import (
    build_gis_ingestion_config,
    build_gis_object_storage_path,
    ingest_gis_feed,
)
from transit_ops.providers.registry import ProviderRegistry
from transit_ops.settings import Settings


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
    artifact, fake_storage, settings, registry = prepare_capture(
        tmp_path,
        monkeypatch,
        gis_ingestion,
        filename="stm_sig.zip",
        payload=b"changed-gis-zip",
        source_url="https://override.example.com/stm_sig.zip",
        url_setting="STM_GIS_URL",
    )
    connection = RecordingConnection(
        feed_endpoint_id=12,
        current_dataset_checksum="0" * 64,
        current_dataset_version_id=76,
        inserted_dataset_version_id=88,
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
        params for sql, params in connection.calls if "INSERT INTO raw.ingestion_objects" in sql
    )
    assert object_params["object_kind"] == "stm_gis_zip"
    assert object_params["storage_path"] == result.storage_path
    insert_params = next(
        params for sql, params in connection.calls if "INSERT INTO core.dataset_versions" in sql
    )
    assert insert_params["dataset_kind"] == "gis_static"
    assert insert_params["source_ingestion_run_id"] == 101
    assert insert_params["source_ingestion_object_id"] is None
    assert insert_params["storage_path"] == result.storage_path
    assert insert_params["parser_version"] == "slice-8.4"
    assert any(
        "UPDATE core.dataset_versions" in sql and "source_ingestion_object_id" in sql
        for sql, _ in connection.calls
    )


def test_ingest_gis_feed_skips_unchanged_zip_without_bronze_or_raw_object(
    tmp_path: Path,
    monkeypatch,
) -> None:
    artifact, fake_storage, settings, registry = prepare_capture(
        tmp_path,
        monkeypatch,
        gis_ingestion,
        filename="stm_sig.zip",
        payload=b"same-gis-zip",
        source_url="https://override.example.com/stm_sig.zip",
        url_setting="STM_GIS_URL",
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
        feed_endpoint_id=12,
        current_dataset_checksum=checksum,
        current_dataset_version_id=77,
        dataset_window=dataset_window,
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
