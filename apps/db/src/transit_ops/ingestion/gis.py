from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy.engine import Engine

from transit_ops.core.models import ProviderManifest
from transit_ops.db.connection import make_engine
from transit_ops.ingestion._versioned_capture import (
    VersionedCaptureSpec,
    _run_versioned_capture,
)
from transit_ops.ingestion.common import (
    DownloadedArtifact,
    build_bronze_object_storage_path,
    download_to_tempfile,
    project_root,
    safe_filename,
)
from transit_ops.ingestion.common import (
    compute_sha256_hex as _compute_sha256_hex,
)
from transit_ops.ingestion.storage import get_bronze_storage, resolve_local_bronze_root
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings, get_settings

logger = logging.getLogger(__name__)


def _safe_filename(source_url: str) -> str:
    return safe_filename(Path(urlparse(source_url).path).name, default_filename="stm_sig.zip")


def compute_sha256_hex(file_path: Path) -> str:
    return _compute_sha256_hex(file_path)


def build_gis_object_storage_path(
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
class GisIngestionConfig:
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
class GisIngestionResult:
    provider_id: str
    endpoint_key: str
    source_url: str
    storage_backend: str
    storage_path: str | None
    archive_full_path: str | None
    byte_size: int
    checksum_sha256: str
    http_status_code: int
    ingestion_run_id: int
    ingestion_object_id: int | None
    status: str
    started_at_utc: datetime
    completed_at_utc: datetime
    content_changed: bool = True
    dataset_version_id: int | None = None
    first_seen_at_utc: datetime | None = None
    last_seen_at_utc: datetime | None = None
    observed_from_utc: datetime | None = None
    observed_until_utc: datetime | None = None
    skipped_reason: str | None = None

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["started_at_utc"] = self.started_at_utc.isoformat()
        payload["completed_at_utc"] = self.completed_at_utc.isoformat()
        for key in (
            "first_seen_at_utc",
            "last_seen_at_utc",
            "observed_from_utc",
            "observed_until_utc",
        ):
            value = payload[key]
            if isinstance(value, datetime):
                payload[key] = value.isoformat()
        return payload


def build_gis_ingestion_config(
    manifest: ProviderManifest,
    settings: Settings,
) -> GisIngestionConfig:
    gis_feed = manifest.gis_feed()
    source_url = gis_feed.resolved_source_url(settings)
    if not source_url:
        raise ValueError(
            "GIS feed for provider "
            f"'{manifest.provider.provider_id}' does not have a resolved URL."
        )
    return GisIngestionConfig(
        provider_id=manifest.provider.provider_id,
        endpoint_key=gis_feed.endpoint_key,
        feed_kind=gis_feed.feed_kind.value,
        source_format=gis_feed.source_format.value,
        source_url=source_url,
        storage_backend=settings.BRONZE_STORAGE_BACKEND,
        bronze_root=Path(settings.BRONZE_LOCAL_ROOT),
        refresh_interval_seconds=gis_feed.refresh_interval_seconds,
    )


def _download_to_tempfile(source_url: str, temp_dir: Path) -> DownloadedArtifact:
    return download_to_tempfile(
        source_url=source_url,
        temp_dir=temp_dir,
        headers=None,
        default_filename="stm_sig.zip",
    )


_MISSING_ENDPOINT_MESSAGE = (
    "GIS feed endpoint was not found in core.feed_endpoints. "
    "Run seed-core before ingest-gis."
)


def ingest_gis_feed(
    provider_id: str,
    *,
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    engine: Engine | None = None,
) -> GisIngestionResult:
    settings = settings or get_settings()
    registry = registry or ProviderRegistry.from_project_root(
        project_root=project_root(),
        settings=settings,
    )
    manifest = registry.get_provider(provider_id)
    config = build_gis_ingestion_config(manifest, settings)
    bronze_root = resolve_local_bronze_root(settings, project_root=project_root())
    bronze_storage = get_bronze_storage(
        settings,
        project_root=project_root(),
        storage_backend=config.storage_backend,
    )

    spec = VersionedCaptureSpec(
        dataset_kind="gis_static",
        skipped_reason="gis_content_unchanged",
        build_config=build_gis_ingestion_config,
        build_storage_path=build_gis_object_storage_path,
        download=lambda source_url, temp_dir: _download_to_tempfile(source_url, temp_dir),
        missing_endpoint_message=_MISSING_ENDPOINT_MESSAGE,
    )
    outcome = _run_versioned_capture(
        provider_id,
        spec=spec,
        manifest=manifest,
        settings=settings,
        registry=registry,
        engine=engine or make_engine(settings),
        bronze_root=bronze_root,
        bronze_storage=bronze_storage,
    )

    return GisIngestionResult(
        provider_id=outcome.provider_id,
        endpoint_key=outcome.endpoint_key,
        source_url=outcome.source_url,
        storage_backend=outcome.storage_backend,
        storage_path=outcome.storage_path,
        archive_full_path=outcome.archive_full_path,
        byte_size=outcome.byte_size,
        checksum_sha256=outcome.checksum_sha256,
        http_status_code=outcome.http_status_code,
        ingestion_run_id=outcome.ingestion_run_id,
        ingestion_object_id=outcome.ingestion_object_id,
        status=outcome.status,
        started_at_utc=outcome.started_at_utc,
        completed_at_utc=outcome.completed_at_utc,
        content_changed=outcome.content_changed,
        dataset_version_id=outcome.dataset_version_id,
        first_seen_at_utc=outcome.first_seen_at_utc,
        last_seen_at_utc=outcome.last_seen_at_utc,
        observed_from_utc=outcome.observed_from_utc,
        observed_until_utc=outcome.observed_until_utc,
        skipped_reason=outcome.skipped_reason,
    )
