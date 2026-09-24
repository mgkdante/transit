"""Capture changed static and GIS archives to Bronze with durable source lineage.

Static dataset promotion belongs to the transactional Silver load.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Engine

from transit_ops.ingestion.common import (
    DownloadedArtifact,
    finish_failed_capture,
    get_feed_endpoint_id,
    insert_ingestion_object,
    insert_ingestion_run,
    mark_ingestion_run_succeeded,
    utc_now,
)
from transit_ops.ingestion.dataset_versions import register_or_touch_dataset_version
from transit_ops.ingestion.storage import BronzeStorage
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings


@dataclass(frozen=True)
class _DatasetVersionObservation:
    first_seen_at_utc: datetime
    last_seen_at_utc: datetime
    observed_from_utc: datetime
    observed_until_utc: datetime


def _dataset_version_observation(
    connection,  # noqa: ANN001
    *,
    dataset_version_id: int | None,
    fallback_observed_at_utc: datetime,
) -> _DatasetVersionObservation:
    row = None if dataset_version_id is None else (
        connection.execute(
            text(
                """
                SELECT
                    first_seen_at_utc,
                    last_seen_at_utc,
                    observed_from_utc,
                    observed_until_utc
                FROM core.dataset_versions
                WHERE dataset_version_id = :dataset_version_id
                """
            ),
            {"dataset_version_id": dataset_version_id},
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        return _DatasetVersionObservation(
            first_seen_at_utc=fallback_observed_at_utc,
            last_seen_at_utc=fallback_observed_at_utc,
            observed_from_utc=fallback_observed_at_utc,
            observed_until_utc=fallback_observed_at_utc,
        )
    return _DatasetVersionObservation(
        first_seen_at_utc=row["first_seen_at_utc"] or fallback_observed_at_utc,
        last_seen_at_utc=row["last_seen_at_utc"] or fallback_observed_at_utc,
        observed_from_utc=row["observed_from_utc"] or fallback_observed_at_utc,
        observed_until_utc=row["observed_until_utc"] or fallback_observed_at_utc,
    )


def _set_dataset_version_source_object(
    connection,  # noqa: ANN001
    *,
    dataset_version_id: int,
    ingestion_object_id: int,
) -> None:
    connection.execute(
        text(
            """
            UPDATE core.dataset_versions
            SET source_ingestion_object_id = :ingestion_object_id
            WHERE dataset_version_id = :dataset_version_id
            """
        ),
        {
            "dataset_version_id": dataset_version_id,
            "ingestion_object_id": ingestion_object_id,
        },
    )


@dataclass(frozen=True)
class VersionedCaptureSpec:
    """Per-feed knobs that drive :func:`_run_versioned_capture`.

    The two adapters differ only in these callbacks / constants; the
    orchestration body itself is identical.
    """

    dataset_kind: str
    skipped_reason: str
    build_config: Callable[..., object]
    build_storage_path: Callable[..., str]
    download: Callable[[str, Path], DownloadedArtifact]
    missing_endpoint_message: str


@dataclass(frozen=True)
class _VersionedCaptureOutcome:
    """Flat carrier with every field both result dataclasses need.

    The adapters copy this into their own ``StaticIngestionResult`` /
    ``GisIngestionResult`` so the two public types stay distinct.
    """

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
    content_changed: bool
    dataset_version_id: int | None
    first_seen_at_utc: datetime | None
    last_seen_at_utc: datetime | None
    observed_from_utc: datetime | None
    observed_until_utc: datetime | None
    skipped_reason: str | None


def _run_versioned_capture(
    provider_id: str,
    *,
    spec: VersionedCaptureSpec,
    manifest: object,
    settings: Settings,
    registry: ProviderRegistry,
    engine: Engine,
    bronze_root: Path,
    bronze_storage: BronzeStorage,
) -> _VersionedCaptureOutcome:
    """Record the run, download the archive, then atomically register its capture."""

    config = spec.build_config(manifest, settings)
    started_at_utc = utc_now()

    with engine.begin() as connection:
        feed_endpoint_id = get_feed_endpoint_id(
            connection,
            provider_id=config.provider_id,
            endpoint_key=config.endpoint_key,
            missing_message=spec.missing_endpoint_message,
        )
        ingestion_run_id = insert_ingestion_run(
            connection,
            provider_id=config.provider_id,
            feed_endpoint_id=feed_endpoint_id,
            run_kind=config.feed_kind,
            requested_at_utc=started_at_utc,
            started_at_utc=started_at_utc,
        )

    artifact: DownloadedArtifact | None = None
    storage_path: str | None = None
    persisted = False
    try:
        artifact = spec.download(config.source_url, bronze_root / ".tmp")
        storage_path = spec.build_storage_path(
            provider_id=config.provider_id,
            endpoint_key=config.endpoint_key,
            started_at_utc=started_at_utc,
            source_url=config.source_url,
            checksum_sha256=artifact.checksum_sha256,
        )

        observed_at_utc = utc_now()
        with engine.begin() as connection:
            dataset_version = register_or_touch_dataset_version(
                connection,
                provider_id=config.provider_id,
                feed_endpoint_id=feed_endpoint_id,
                dataset_kind=spec.dataset_kind,
                checksum_sha256=artifact.checksum_sha256,
                source_url=config.source_url,
                storage_backend=config.storage_backend,
                storage_path=storage_path,
                byte_size=artifact.byte_size,
                observed_at_utc=observed_at_utc,
                parser_version="slice-8.4",
                source_ingestion_run_id=ingestion_run_id,
                source_ingestion_object_id=None,
            )
            observation = _dataset_version_observation(
                connection,
                dataset_version_id=dataset_version.dataset_version_id,
                fallback_observed_at_utc=observed_at_utc,
            )
            if not dataset_version.content_changed:
                completed_at_utc = utc_now()
                mark_ingestion_run_succeeded(
                    connection,
                    ingestion_run_id=ingestion_run_id,
                    completed_at_utc=completed_at_utc,
                    http_status_code=artifact.http_status_code,
                )
                artifact.temp_path.unlink(missing_ok=True)
                return _VersionedCaptureOutcome(
                    provider_id=config.provider_id,
                    endpoint_key=config.endpoint_key,
                    source_url=config.source_url,
                    storage_backend=config.storage_backend,
                    storage_path=None,
                    archive_full_path=None,
                    byte_size=artifact.byte_size,
                    checksum_sha256=artifact.checksum_sha256,
                    http_status_code=artifact.http_status_code,
                    ingestion_run_id=ingestion_run_id,
                    ingestion_object_id=None,
                    status=dataset_version.status,
                    started_at_utc=started_at_utc,
                    completed_at_utc=completed_at_utc,
                    content_changed=False,
                    dataset_version_id=dataset_version.dataset_version_id,
                    first_seen_at_utc=observation.first_seen_at_utc,
                    last_seen_at_utc=observation.last_seen_at_utc,
                    observed_from_utc=observation.observed_from_utc,
                    observed_until_utc=observation.observed_until_utc,
                    skipped_reason=spec.skipped_reason,
                )

            archive_reference = bronze_storage.persist_temp_file(artifact.temp_path, storage_path)
            persisted = True
            ingestion_object_id = insert_ingestion_object(
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
            if dataset_version.dataset_version_id is not None:
                _set_dataset_version_source_object(
                    connection,
                    dataset_version_id=dataset_version.dataset_version_id,
                    ingestion_object_id=ingestion_object_id,
                )
            completed_at_utc = utc_now()
            mark_ingestion_run_succeeded(
                connection,
                ingestion_run_id=ingestion_run_id,
                completed_at_utc=completed_at_utc,
                http_status_code=artifact.http_status_code,
            )

        return _VersionedCaptureOutcome(
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
            content_changed=True,
            dataset_version_id=dataset_version.dataset_version_id,
            first_seen_at_utc=observation.first_seen_at_utc,
            last_seen_at_utc=observation.last_seen_at_utc,
            observed_from_utc=observation.observed_from_utc,
            observed_until_utc=observation.observed_until_utc,
            skipped_reason=None,
        )
    except Exception as exc:
        finish_failed_capture(
            engine=engine,
            ingestion_run_id=ingestion_run_id,
            error=exc,
            artifact=artifact,
            bronze_storage=bronze_storage,
            orphan_storage_path=storage_path if persisted else None,
        )
        raise
