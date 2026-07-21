from __future__ import annotations

import logging
import ssl
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError

from google.protobuf.message import DecodeError
from google.transit import gtfs_realtime_pb2
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from transit_ops.core.models import ProviderManifest
from transit_ops.db.connection import make_engine
from transit_ops.ingestion.common import (
    DownloadedArtifact,
    build_bronze_object_storage_path,
    build_request_details,
    download_to_tempfile,
    get_feed_endpoint_id,
    insert_ingestion_object,
    insert_ingestion_run,
    mark_ingestion_run_failed,
    mark_ingestion_run_succeeded,
    project_root,
    utc_now,
)
from transit_ops.ingestion.storage import (
    BronzeStorageResolver,
    get_bronze_storage,
    resolve_local_bronze_root,
)
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings, get_settings

logger = logging.getLogger(__name__)


def _best_effort_delete_orphan(bronze_storage: object, storage_path: str) -> None:
    """Best-effort delete of an uploaded Bronze object after a downstream failure.

    Swallows and logs any delete error so it never masks the original exception.
    """

    try:
        bronze_storage.delete_object(storage_path)
    except Exception:
        logger.exception(
            "Failed to delete orphaned Bronze object after metadata failure: %s",
            storage_path,
        )


def _project_root() -> Path:
    return project_root()


@dataclass(frozen=True)
class RealtimeIngestionConfig:
    provider_id: str
    endpoint_key: str
    feed_kind: str
    source_format: str
    source_url: str
    request_url: str
    request_headers: dict[str, str]
    storage_backend: str
    bronze_root: Path
    refresh_interval_seconds: int


@dataclass(frozen=True)
class RealtimeMessageMetadata:
    provider_id: str
    endpoint_key: str
    feed_kind: str
    # None when the feed omits / zeroes its FeedHeader.timestamp (GTFS-RT
    # spec-required, but real feeds skip it). The capture resolves it to the
    # capture time before persisting, so it never aborts the download.
    feed_timestamp_utc: datetime | None
    entity_count: int

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["feed_timestamp_utc"] = (
            self.feed_timestamp_utc.isoformat()
            if self.feed_timestamp_utc is not None
            else None
        )
        return payload


@dataclass(frozen=True)
class RealtimeIngestionResult:
    provider_id: str
    endpoint_key: str
    feed_kind: str
    source_url: str
    storage_backend: str
    storage_path: str
    archive_full_path: str
    byte_size: int
    checksum_sha256: str
    http_status_code: int
    ingestion_run_id: int
    ingestion_object_id: int
    realtime_snapshot_id: int
    feed_timestamp_utc: datetime
    entity_count: int
    status: str
    started_at_utc: datetime
    completed_at_utc: datetime

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["feed_timestamp_utc"] = self.feed_timestamp_utc.isoformat()
        payload["started_at_utc"] = self.started_at_utc.isoformat()
        payload["completed_at_utc"] = self.completed_at_utc.isoformat()
        return payload


def build_realtime_ingestion_config(
    manifest: ProviderManifest,
    settings: Settings,
    endpoint_key: str,
) -> RealtimeIngestionConfig:
    realtime_feed = manifest.realtime_feed(endpoint_key)
    source_url = realtime_feed.resolved_source_url(settings)
    if not source_url:
        raise ValueError(
            "Realtime feed for provider "
            f"'{manifest.provider.provider_id}' and endpoint '{endpoint_key}' "
            "does not have a resolved URL."
        )
    request_details = build_request_details(
        source_url=source_url,
        auth=realtime_feed.auth,
        settings=settings,
    )
    request_headers = dict(request_details.request_headers)
    request_headers.setdefault("Accept", "application/x-protobuf")
    request_headers.setdefault("User-Agent", "transit-ops/0.1.0")
    return RealtimeIngestionConfig(
        provider_id=manifest.provider.provider_id,
        endpoint_key=realtime_feed.endpoint_key,
        feed_kind=realtime_feed.feed_kind.value,
        source_format=realtime_feed.source_format.value,
        source_url=source_url,
        request_url=request_details.request_url,
        request_headers=request_headers,
        storage_backend=settings.BRONZE_STORAGE_BACKEND,
        bronze_root=Path(settings.BRONZE_LOCAL_ROOT),
        refresh_interval_seconds=realtime_feed.refresh_interval_seconds,
    )


def build_realtime_object_storage_path(
    provider_id: str,
    endpoint_key: str,
    captured_at_utc: datetime,
    checksum_sha256: str,
) -> str:
    return build_bronze_object_storage_path(
        provider_id=provider_id,
        endpoint_key=endpoint_key,
        partition_label="captured_at_utc",
        observed_at_utc=captured_at_utc,
        object_name=f"{endpoint_key}.pb",
        checksum_sha256=checksum_sha256,
    )


def extract_realtime_metadata(
    payload_bytes: bytes,
    *,
    provider_id: str,
    endpoint_key: str,
) -> RealtimeMessageMetadata:
    message = gtfs_realtime_pb2.FeedMessage()
    try:
        message.ParseFromString(payload_bytes)
    except DecodeError as exc:
        raise ValueError(f"Failed to parse GTFS-RT protobuf payload: {exc}") from exc

    # GTFS-RT requires FeedHeader.timestamp, but real feeds omit / zero it, and
    # some emit a value outside datetime's range. Treat any unusable header
    # timestamp as "absent" (None) rather than aborting the capture; the caller
    # falls back to the capture time so the snapshot still persists.
    header_timestamp = int(message.header.timestamp or 0)
    feed_timestamp_utc: datetime | None = None
    if header_timestamp > 0:
        try:
            feed_timestamp_utc = datetime.fromtimestamp(header_timestamp, tz=UTC)
        except (OverflowError, OSError, ValueError):
            logger.warning(
                "GTFS-RT feed header timestamp %r for %s/%s is out of range; "
                "falling back to capture time.",
                header_timestamp,
                provider_id,
                endpoint_key,
            )
    else:
        logger.info(
            "GTFS-RT feed for %s/%s omits its header timestamp; "
            "falling back to capture time.",
            provider_id,
            endpoint_key,
        )

    return RealtimeMessageMetadata(
        provider_id=provider_id,
        endpoint_key=endpoint_key,
        feed_kind=endpoint_key,
        feed_timestamp_utc=feed_timestamp_utc,
        entity_count=len(message.entity),
    )


def _get_feed_endpoint_id(connection: Connection, provider_id: str, endpoint_key: str) -> int:
    return get_feed_endpoint_id(
        connection,
        provider_id=provider_id,
        endpoint_key=endpoint_key,
        missing_message=(
            "Realtime feed endpoint was not found in core.feed_endpoints. "
            "Run seed-core before capture-realtime."
        ),
    )


def _insert_realtime_snapshot_index(
    connection: Connection,
    *,
    ingestion_run_id: int,
    ingestion_object_id: int,
    provider_id: str,
    feed_endpoint_id: int,
    feed_timestamp_utc: datetime,
    entity_count: int,
    captured_at_utc: datetime,
) -> int:
    result = connection.execute(
        text(
            """
            INSERT INTO raw.realtime_snapshot_index (
                ingestion_run_id,
                ingestion_object_id,
                provider_id,
                feed_endpoint_id,
                feed_timestamp_utc,
                entity_count,
                captured_at_utc
            )
            VALUES (
                :ingestion_run_id,
                :ingestion_object_id,
                :provider_id,
                :feed_endpoint_id,
                :feed_timestamp_utc,
                :entity_count,
                :captured_at_utc
            )
            RETURNING realtime_snapshot_id
            """
        ),
        {
            "ingestion_run_id": ingestion_run_id,
            "ingestion_object_id": ingestion_object_id,
            "provider_id": provider_id,
            "feed_endpoint_id": feed_endpoint_id,
            "feed_timestamp_utc": feed_timestamp_utc,
            "entity_count": entity_count,
            "captured_at_utc": captured_at_utc,
        },
    )
    return int(result.scalar_one())


def _build_realtime_ssl_context() -> ssl.SSLContext:
    # Floor only: require TLS 1.2+ but let the handshake negotiate the highest
    # mutually-supported version. Pinning the maximum to 1.2 rejected TLS-1.3-only
    # endpoints, which any GTFS-RT provider is free to be.
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    return context


def _download_to_tempfile(config: RealtimeIngestionConfig, temp_dir: Path) -> DownloadedArtifact:
    return download_to_tempfile(
        source_url=config.request_url,
        temp_dir=temp_dir,
        headers=config.request_headers,
        default_filename=f"{config.endpoint_key}.pb",
        ssl_context=_build_realtime_ssl_context(),
    )


def _capture_realtime_feed(
    provider_id: str,
    endpoint_key: str,
    *,
    settings: Settings,
    registry: ProviderRegistry | None = None,
    engine: Engine | None = None,
    bronze_storage_resolver: BronzeStorageResolver,
) -> RealtimeIngestionResult:
    registry = registry or ProviderRegistry.from_project_root(
        project_root=_project_root(),
        settings=settings,
    )
    manifest = registry.get_provider(provider_id)
    config = build_realtime_ingestion_config(manifest, settings, endpoint_key)
    bronze_root = resolve_local_bronze_root(settings, project_root=_project_root())
    bronze_storage = bronze_storage_resolver(config.storage_backend)
    started_at_utc = utc_now()

    engine = engine or make_engine(settings)
    with engine.begin() as connection:
        feed_endpoint_id = _get_feed_endpoint_id(
            connection,
            provider_id=config.provider_id,
            endpoint_key=config.endpoint_key,
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
        artifact = _download_to_tempfile(config, bronze_root / ".tmp")
        metadata = extract_realtime_metadata(
            artifact.temp_path.read_bytes(),
            provider_id=config.provider_id,
            endpoint_key=config.endpoint_key,
        )
        storage_path = build_realtime_object_storage_path(
            provider_id=config.provider_id,
            endpoint_key=config.endpoint_key,
            captured_at_utc=started_at_utc,
            checksum_sha256=artifact.checksum_sha256,
        )
        archive_reference = bronze_storage.persist_temp_file(artifact.temp_path, storage_path)
        persisted = True

        completed_at_utc = utc_now()
        # Feeds that omit their header timestamp fall back to the capture time so
        # the snapshot index / freshness signal stays non-null and monotonic.
        feed_timestamp_utc = metadata.feed_timestamp_utc or completed_at_utc
        with engine.begin() as connection:
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
            realtime_snapshot_id = _insert_realtime_snapshot_index(
                connection,
                ingestion_run_id=ingestion_run_id,
                ingestion_object_id=ingestion_object_id,
                provider_id=config.provider_id,
                feed_endpoint_id=feed_endpoint_id,
                feed_timestamp_utc=feed_timestamp_utc,
                entity_count=metadata.entity_count,
                captured_at_utc=completed_at_utc,
            )
            mark_ingestion_run_succeeded(
                connection,
                ingestion_run_id=ingestion_run_id,
                completed_at_utc=completed_at_utc,
                http_status_code=artifact.http_status_code,
                entity_count=metadata.entity_count,
                feed_timestamp_utc=feed_timestamp_utc,
            )

        return RealtimeIngestionResult(
            provider_id=config.provider_id,
            endpoint_key=config.endpoint_key,
            feed_kind=config.feed_kind,
            source_url=config.source_url,
            storage_backend=config.storage_backend,
            storage_path=storage_path,
            archive_full_path=archive_reference,
            byte_size=artifact.byte_size,
            checksum_sha256=artifact.checksum_sha256,
            http_status_code=artifact.http_status_code,
            ingestion_run_id=ingestion_run_id,
            ingestion_object_id=ingestion_object_id,
            realtime_snapshot_id=realtime_snapshot_id,
            feed_timestamp_utc=feed_timestamp_utc,
            entity_count=metadata.entity_count,
            status="succeeded",
            started_at_utc=started_at_utc,
            completed_at_utc=completed_at_utc,
        )
    except HTTPError as exc:
        completed_at_utc = utc_now()
        with engine.begin() as connection:
            mark_ingestion_run_failed(
                connection,
                ingestion_run_id=ingestion_run_id,
                completed_at_utc=completed_at_utc,
                http_status_code=exc.code,
                error_message=f"HTTP {exc.code}: {exc.reason}",
            )
        if artifact is not None:
            artifact.temp_path.unlink(missing_ok=True)
        if persisted and storage_path is not None:
            _best_effort_delete_orphan(bronze_storage, storage_path)
        raise
    except Exception as exc:
        completed_at_utc = utc_now()
        http_status_code = artifact.http_status_code if artifact else None
        with engine.begin() as connection:
            mark_ingestion_run_failed(
                connection,
                ingestion_run_id=ingestion_run_id,
                completed_at_utc=completed_at_utc,
                http_status_code=http_status_code,
                error_message=str(exc),
            )
        if artifact is not None:
            artifact.temp_path.unlink(missing_ok=True)
        if persisted and storage_path is not None:
            _best_effort_delete_orphan(bronze_storage, storage_path)
        raise


def capture_realtime_feed(
    provider_id: str,
    endpoint_key: str,
    *,
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    engine: Engine | None = None,
) -> RealtimeIngestionResult:
    settings = settings or get_settings()
    return _capture_realtime_feed(
        provider_id,
        endpoint_key,
        settings=settings,
        registry=registry,
        engine=engine,
        bronze_storage_resolver=lambda storage_backend: get_bronze_storage(
            settings,
            project_root=_project_root(),
            storage_backend=storage_backend,
        ),
    )
