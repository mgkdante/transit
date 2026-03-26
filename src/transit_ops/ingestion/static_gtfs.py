from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError

from sqlalchemy.engine import Engine

from transit_ops.core.models import ProviderManifest
from transit_ops.db.connection import make_engine
from transit_ops.ingestion.common import (
    DownloadedArtifact,
    build_bronze_object_storage_path,
    download_to_tempfile,
    get_feed_endpoint_id,
    insert_ingestion_object,
    insert_ingestion_run,
    mark_ingestion_run_failed,
    mark_ingestion_run_succeeded,
    project_root,
    safe_filename,
    utc_now,
)
from transit_ops.ingestion.common import (
    compute_sha256_hex as _compute_sha256_hex,
)
from transit_ops.ingestion.storage import get_bronze_storage, resolve_local_bronze_root
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings, get_settings


def _project_root() -> Path:
    return project_root()


def _safe_filename(source_url: str) -> str:
    return safe_filename(source_url, default_filename="download.zip")


def compute_sha256_hex(file_path: Path) -> str:
    return _compute_sha256_hex(file_path)


def build_static_object_storage_path(
    provider_id: str,
    endpoint_key: str,
    started_at_utc: datetime,
    source_url: str,
    checksum_sha256: str,
) -> str:
    return build_bronze_object_storage_path(
        provider_id=provider_id,
        endpoint_key=endpoint_key,
        partition_label="ingested_at_utc",
        observed_at_utc=started_at_utc,
        object_name=_safe_filename(source_url),
        checksum_sha256=checksum_sha256,
    )


@dataclass(frozen=True)
class StaticIngestionConfig:
    provider_id: str
    endpoint_key: str
    feed_kind: str
    source_format: str
    source_url: str
    storage_backend: str
    bronze_root: Path
    refresh_interval_seconds: int

    def as_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["bronze_root"] = str(self.bronze_root)
        return payload


@dataclass(frozen=True)
class StaticIngestionResult:
    provider_id: str
    endpoint_key: str
    source_url: str
    storage_backend: str
    storage_path: str
    archive_full_path: str
    byte_size: int
    checksum_sha256: str
    http_status_code: int
    ingestion_run_id: int
    ingestion_object_id: int
    status: str
    started_at_utc: datetime
    completed_at_utc: datetime

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["started_at_utc"] = self.started_at_utc.isoformat()
        payload["completed_at_utc"] = self.completed_at_utc.isoformat()
        return payload


def build_static_ingestion_config(
    manifest: ProviderManifest,
    settings: Settings,
) -> StaticIngestionConfig:
    static_feed = manifest.static_feed()
    source_url = static_feed.resolved_source_url(settings)
    if not source_url:
        raise ValueError(
            "Static feed for provider "
            f"'{manifest.provider.provider_id}' does not have a resolved URL."
        )
    return StaticIngestionConfig(
        provider_id=manifest.provider.provider_id,
        endpoint_key=static_feed.endpoint_key,
        feed_kind=static_feed.feed_kind.value,
        source_format=static_feed.source_format.value,
        source_url=source_url,
        storage_backend=settings.BRONZE_STORAGE_BACKEND,
        bronze_root=Path(settings.BRONZE_LOCAL_ROOT),
        refresh_interval_seconds=static_feed.refresh_interval_seconds,
    )


def _download_to_tempfile(source_url: str, temp_dir: Path) -> DownloadedArtifact:
    return download_to_tempfile(
        source_url=source_url,
        temp_dir=temp_dir,
        headers=None,
        default_filename="download.zip",
    )


def _get_feed_endpoint_id(connection, provider_id: str, endpoint_key: str) -> int:  # noqa: ANN001
    return get_feed_endpoint_id(
        connection,
        provider_id=provider_id,
        endpoint_key=endpoint_key,
        missing_message=(
            "Static feed endpoint was not found in core.feed_endpoints. "
            "Run seed-core before ingest-static."
        ),
    )


def _insert_ingestion_run(connection, **kwargs) -> int:  # noqa: ANN003, ANN001
    return insert_ingestion_run(connection, **kwargs)


def _mark_ingestion_run_succeeded(connection, **kwargs) -> None:  # noqa: ANN003, ANN001
    mark_ingestion_run_succeeded(connection, **kwargs)


def _mark_ingestion_run_failed(connection, **kwargs) -> None:  # noqa: ANN003, ANN001
    mark_ingestion_run_failed(connection, **kwargs)


def _insert_ingestion_object(connection, **kwargs) -> int:  # noqa: ANN003, ANN001
    return insert_ingestion_object(connection, **kwargs)


def ingest_static_feed(
    provider_id: str,
    *,
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    engine: Engine | None = None,
) -> StaticIngestionResult:
    settings = settings or get_settings()
    registry = registry or ProviderRegistry.from_project_root(
        project_root=_project_root(),
        settings=settings,
    )
    manifest = registry.get_provider(provider_id)
    config = build_static_ingestion_config(manifest, settings)
    bronze_root = resolve_local_bronze_root(settings, project_root=_project_root())
    bronze_storage = get_bronze_storage(
        settings,
        project_root=_project_root(),
        storage_backend=config.storage_backend,
    )
    started_at_utc = utc_now()

    engine = engine or make_engine(settings)
    with engine.begin() as connection:
        feed_endpoint_id = _get_feed_endpoint_id(
            connection,
            provider_id=config.provider_id,
            endpoint_key=config.endpoint_key,
        )
        ingestion_run_id = _insert_ingestion_run(
            connection,
            provider_id=config.provider_id,
            feed_endpoint_id=feed_endpoint_id,
            run_kind=config.feed_kind,
            requested_at_utc=started_at_utc,
            started_at_utc=started_at_utc,
        )

    artifact: DownloadedArtifact | None = None
    try:
        artifact = _download_to_tempfile(config.source_url, bronze_root / ".tmp")
        storage_path = build_static_object_storage_path(
            provider_id=config.provider_id,
            endpoint_key=config.endpoint_key,
            started_at_utc=started_at_utc,
            source_url=config.source_url,
            checksum_sha256=artifact.checksum_sha256,
        )
        archive_reference = bronze_storage.persist_temp_file(artifact.temp_path, storage_path)

        completed_at_utc = utc_now()
        with engine.begin() as connection:
            ingestion_object_id = _insert_ingestion_object(
                connection,
                ingestion_run_id=ingestion_run_id,
                provider_id=config.provider_id,
                object_kind=config.source_format,
                storage_backend=config.storage_backend,
                storage_path=storage_path,
                source_url=config.source_url,
                checksum_sha256=artifact.checksum_sha256,
                byte_size=artifact.byte_size,
            )
            _mark_ingestion_run_succeeded(
                connection,
                ingestion_run_id=ingestion_run_id,
                completed_at_utc=completed_at_utc,
                http_status_code=artifact.http_status_code,
            )

        return StaticIngestionResult(
            provider_id=config.provider_id,
            endpoint_key=config.endpoint_key,
            source_url=config.source_url,
            storage_backend=config.storage_backend,
            storage_path=storage_path,
            archive_full_path=archive_reference,
            byte_size=artifact.byte_size,
            checksum_sha256=artifact.checksum_sha256,
            http_status_code=artifact.http_status_code,
            ingestion_run_id=ingestion_run_id,
            ingestion_object_id=ingestion_object_id,
            status="succeeded",
            started_at_utc=started_at_utc,
            completed_at_utc=completed_at_utc,
        )
    except HTTPError as exc:
        completed_at_utc = utc_now()
        with engine.begin() as connection:
            _mark_ingestion_run_failed(
                connection,
                ingestion_run_id=ingestion_run_id,
                completed_at_utc=completed_at_utc,
                http_status_code=exc.code,
                error_message=f"HTTP {exc.code}: {exc.reason}",
            )
        if artifact is not None:
            artifact.temp_path.unlink(missing_ok=True)
        raise
    except Exception as exc:
        completed_at_utc = utc_now()
        http_status_code = artifact.http_status_code if artifact else None
        with engine.begin() as connection:
            _mark_ingestion_run_failed(
                connection,
                ingestion_run_id=ingestion_run_id,
                completed_at_utc=completed_at_utc,
                http_status_code=http_status_code,
                error_message=str(exc),
            )
        if artifact is not None:
            artifact.temp_path.unlink(missing_ok=True)
        raise
