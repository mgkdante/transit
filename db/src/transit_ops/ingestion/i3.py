from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError

from sqlalchemy import bindparam, text
from sqlalchemy.dialects import postgresql
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
from transit_ops.ingestion.storage import get_bronze_storage, resolve_local_bronze_root
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings, get_settings

I3_ENDPOINT_KEY = "i3_alerts"

INSERT_I3_ALERT_SNAPSHOT = text(
    """
    INSERT INTO raw.i3_alert_snapshots (
        ingestion_run_id,
        ingestion_object_id,
        provider_id,
        feed_endpoint_id,
        source_url,
        http_status_code,
        captured_at_utc,
        storage_backend,
        storage_path,
        checksum_sha256,
        byte_size,
        api_version,
        alert_count,
        raw_payload_json
    )
    VALUES (
        :ingestion_run_id,
        :ingestion_object_id,
        :provider_id,
        :feed_endpoint_id,
        :source_url,
        :http_status_code,
        :captured_at_utc,
        :storage_backend,
        :storage_path,
        :checksum_sha256,
        :byte_size,
        :api_version,
        :alert_count,
        :raw_payload_json
    )
    RETURNING i3_alert_snapshot_id
    """
).bindparams(bindparam("raw_payload_json", type_=postgresql.JSONB))


def _project_root() -> Path:
    return project_root()


@dataclass(frozen=True)
class I3IngestionConfig:
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
class I3Metadata:
    provider_id: str
    endpoint_key: str
    api_version: str | None
    alert_count: int
    raw_payload_json: object

    def display_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class I3IngestionResult:
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
    i3_alert_snapshot_id: int
    api_version: str | None
    alert_count: int
    status: str
    started_at_utc: datetime
    completed_at_utc: datetime

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["started_at_utc"] = self.started_at_utc.isoformat()
        payload["completed_at_utc"] = self.completed_at_utc.isoformat()
        return payload


def build_i3_ingestion_config(
    manifest: ProviderManifest,
    settings: Settings,
) -> I3IngestionConfig:
    i3_feed = manifest.i3_alerts_feed()
    source_url = i3_feed.resolved_source_url(settings)
    if not source_url:
        raise ValueError(
            f"i3 alert feed for provider '{manifest.provider.provider_id}' "
            "does not have a resolved URL."
        )
    request_details = build_request_details(
        source_url=source_url,
        auth=i3_feed.auth,
        settings=settings,
    )
    request_headers = dict(request_details.request_headers)
    request_headers.setdefault("Accept", "application/json")
    request_headers.setdefault("User-Agent", "transit-ops/0.1.0")
    return I3IngestionConfig(
        provider_id=manifest.provider.provider_id,
        endpoint_key=i3_feed.endpoint_key,
        feed_kind=i3_feed.feed_kind.value,
        source_format=i3_feed.source_format.value,
        source_url=source_url,
        request_url=request_details.request_url,
        request_headers=request_headers,
        storage_backend=settings.BRONZE_STORAGE_BACKEND,
        bronze_root=Path(settings.BRONZE_LOCAL_ROOT),
        refresh_interval_seconds=i3_feed.refresh_interval_seconds,
    )


def build_i3_object_storage_path(
    *,
    provider_id: str,
    captured_at_utc: datetime,
    checksum_sha256: str,
) -> str:
    return build_bronze_object_storage_path(
        provider_id=provider_id,
        endpoint_key=I3_ENDPOINT_KEY,
        partition_label="captured_at_utc",
        observed_at_utc=captured_at_utc,
        object_name="i3_alerts.json",
        checksum_sha256=checksum_sha256,
    )


def _alert_items(payload: object) -> list[object]:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        raise ValueError("i3 JSON payload must be an object or an array.")
    for key in ("alerts", "messages", "data", "items", "results"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
    return []


def extract_i3_metadata(payload_bytes: bytes, *, provider_id: str) -> I3Metadata:
    try:
        payload = json.loads(payload_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Failed to parse i3 JSON payload: {exc}") from exc

    api_version = None
    if isinstance(payload, dict):
        raw_version = (
            payload.get("apiVersion")
            or payload.get("api_version")
            or payload.get("version")
        )
        api_version = str(raw_version) if raw_version is not None else None

    return I3Metadata(
        provider_id=provider_id,
        endpoint_key=I3_ENDPOINT_KEY,
        api_version=api_version,
        alert_count=len(_alert_items(payload)),
        raw_payload_json=payload,
    )


def _get_feed_endpoint_id(connection: Connection, provider_id: str) -> int:
    return get_feed_endpoint_id(
        connection,
        provider_id=provider_id,
        endpoint_key=I3_ENDPOINT_KEY,
        missing_message=(
            "i3 alert feed endpoint was not found in core.feed_endpoints. "
            "Run seed-core before capture-i3."
        ),
    )


def _download_to_tempfile(config: I3IngestionConfig, temp_dir: Path) -> DownloadedArtifact:
    return download_to_tempfile(
        source_url=config.request_url,
        temp_dir=temp_dir,
        headers=config.request_headers,
        default_filename="i3_alerts.json",
    )


def _insert_i3_alert_snapshot(
    connection: Connection,
    *,
    ingestion_run_id: int,
    ingestion_object_id: int,
    provider_id: str,
    feed_endpoint_id: int,
    source_url: str,
    http_status_code: int,
    captured_at_utc: datetime,
    storage_backend: str,
    storage_path: str,
    checksum_sha256: str,
    byte_size: int,
    api_version: str | None,
    alert_count: int,
    raw_payload_json: object,
) -> int:
    return int(
        connection.execute(
            INSERT_I3_ALERT_SNAPSHOT,
            {
                "ingestion_run_id": ingestion_run_id,
                "ingestion_object_id": ingestion_object_id,
                "provider_id": provider_id,
                "feed_endpoint_id": feed_endpoint_id,
                "source_url": source_url,
                "http_status_code": http_status_code,
                "captured_at_utc": captured_at_utc,
                "storage_backend": storage_backend,
                "storage_path": storage_path,
                "checksum_sha256": checksum_sha256,
                "byte_size": byte_size,
                "api_version": api_version,
                "alert_count": alert_count,
                "raw_payload_json": raw_payload_json,
            },
        ).scalar_one()
    )


def capture_i3_alerts(
    provider_id: str,
    *,
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    engine: Engine | None = None,
) -> I3IngestionResult:
    settings = settings or get_settings()
    registry = registry or ProviderRegistry.from_project_root(
        project_root=_project_root(),
        settings=settings,
    )
    manifest = registry.get_provider(provider_id)
    config = build_i3_ingestion_config(manifest, settings)
    bronze_root = resolve_local_bronze_root(settings, project_root=_project_root())
    bronze_storage = get_bronze_storage(
        settings,
        project_root=_project_root(),
        storage_backend=config.storage_backend,
    )
    started_at_utc = utc_now()

    engine = engine or make_engine(settings)
    with engine.begin() as connection:
        feed_endpoint_id = _get_feed_endpoint_id(connection, config.provider_id)
        ingestion_run_id = insert_ingestion_run(
            connection,
            provider_id=config.provider_id,
            feed_endpoint_id=feed_endpoint_id,
            run_kind=config.feed_kind,
            requested_at_utc=started_at_utc,
            started_at_utc=started_at_utc,
        )

    artifact: DownloadedArtifact | None = None
    try:
        artifact = _download_to_tempfile(config, bronze_root / ".tmp")
        metadata = extract_i3_metadata(
            artifact.temp_path.read_bytes(),
            provider_id=config.provider_id,
        )
        storage_path = build_i3_object_storage_path(
            provider_id=config.provider_id,
            captured_at_utc=started_at_utc,
            checksum_sha256=artifact.checksum_sha256,
        )
        archive_reference = bronze_storage.persist_temp_file(artifact.temp_path, storage_path)
        completed_at_utc = utc_now()

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
            i3_alert_snapshot_id = _insert_i3_alert_snapshot(
                connection,
                ingestion_run_id=ingestion_run_id,
                ingestion_object_id=ingestion_object_id,
                provider_id=config.provider_id,
                feed_endpoint_id=feed_endpoint_id,
                source_url=config.source_url,
                http_status_code=artifact.http_status_code,
                captured_at_utc=completed_at_utc,
                storage_backend=config.storage_backend,
                storage_path=storage_path,
                checksum_sha256=artifact.checksum_sha256,
                byte_size=artifact.byte_size,
                api_version=metadata.api_version,
                alert_count=metadata.alert_count,
                raw_payload_json=metadata.raw_payload_json,
            )
            mark_ingestion_run_succeeded(
                connection,
                ingestion_run_id=ingestion_run_id,
                completed_at_utc=completed_at_utc,
                http_status_code=artifact.http_status_code,
                entity_count=metadata.alert_count,
                feed_timestamp_utc=completed_at_utc,
            )

        return I3IngestionResult(
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
            i3_alert_snapshot_id=i3_alert_snapshot_id,
            api_version=metadata.api_version,
            alert_count=metadata.alert_count,
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
        raise
