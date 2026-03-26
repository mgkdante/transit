from __future__ import annotations

import hashlib
import os
import re
import ssl
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qsl, unquote, urlencode, urlparse, urlsplit, urlunsplit
from urllib.request import Request, urlopen

from sqlalchemy import text
from sqlalchemy.engine import Connection

from transit_ops.core.models import AuthConfig, AuthType
from transit_ops.settings import Settings

CHUNK_SIZE_BYTES = 1024 * 1024


@dataclass(frozen=True)
class DownloadedArtifact:
    temp_path: Path
    byte_size: int
    checksum_sha256: str
    http_status_code: int
    source_url: str


@dataclass(frozen=True)
class RequestDetails:
    request_url: str
    request_headers: dict[str, str]


def utc_now() -> datetime:
    return datetime.now(UTC)


def project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def safe_filename(source_name: str, *, default_filename: str) -> str:
    parsed = urlparse(source_name)
    filename = Path(unquote(parsed.path)).name or source_name or default_filename
    sanitized = re.sub(r"[^A-Za-z0-9._-]+", "_", filename).strip("._")
    return sanitized or default_filename


def compute_sha256_hex(file_path: Path) -> str:
    hasher = hashlib.sha256()
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK_SIZE_BYTES), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def build_bronze_object_storage_path(
    *,
    provider_id: str,
    endpoint_key: str,
    partition_label: str,
    observed_at_utc: datetime,
    object_name: str,
    checksum_sha256: str,
) -> str:
    timestamp_fragment = observed_at_utc.astimezone(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    date_fragment = observed_at_utc.astimezone(UTC).strftime("%Y-%m-%d")
    filename = safe_filename(object_name, default_filename="artifact.bin")
    return PurePosixPath(
        provider_id,
        endpoint_key,
        f"{partition_label}={date_fragment}",
        f"{timestamp_fragment}__{checksum_sha256[:12]}__{filename}",
    ).as_posix()


def build_request_details(
    *,
    source_url: str,
    auth: AuthConfig,
    settings: Settings,
) -> RequestDetails:
    if auth.auth_type == AuthType.NONE:
        return RequestDetails(request_url=source_url, request_headers={})

    if auth.auth_type != AuthType.API_KEY:
        raise ValueError(f"Unsupported auth type '{auth.auth_type}'.")

    if not auth.credential_env_var:
        raise ValueError("API-key auth requires credential_env_var.")

    credential = getattr(settings, auth.credential_env_var, None)
    if not credential:
        raise ValueError(
            f"Environment variable '{auth.credential_env_var}' must be configured "
            "for this feed."
        )

    request_url = source_url
    request_headers: dict[str, str] = {}

    if auth.auth_header_name:
        request_headers[auth.auth_header_name] = credential

    if auth.auth_query_param:
        parts = urlsplit(source_url)
        query_items = parse_qsl(parts.query, keep_blank_values=True)
        query_items.append((auth.auth_query_param, credential))
        request_url = urlunsplit(
            (
                parts.scheme,
                parts.netloc,
                parts.path,
                urlencode(query_items),
                parts.fragment,
            )
        )

    return RequestDetails(request_url=request_url, request_headers=request_headers)


def download_to_tempfile(
    *,
    source_url: str,
    temp_dir: Path,
    headers: dict[str, str] | None = None,
    default_filename: str,
    ssl_context: ssl.SSLContext | None = None,
) -> DownloadedArtifact:
    temp_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(safe_filename(source_url, default_filename=default_filename)).suffix or ".bin"
    fd, temp_name = tempfile.mkstemp(prefix="download_", suffix=suffix, dir=temp_dir)
    os.close(fd)

    request = Request(source_url, headers=headers or {}, method="GET")
    temp_path = Path(temp_name)
    byte_size = 0

    try:
        with urlopen(request, timeout=120, context=ssl_context) as response, temp_path.open(
            "wb"
        ) as handle:
            http_status_code = getattr(response, "status", 200) or 200
            for chunk in iter(lambda: response.read(CHUNK_SIZE_BYTES), b""):
                handle.write(chunk)
                byte_size += len(chunk)
        return DownloadedArtifact(
            temp_path=temp_path,
            byte_size=byte_size,
            checksum_sha256=compute_sha256_hex(temp_path),
            http_status_code=http_status_code,
            source_url=source_url,
        )
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def get_feed_endpoint_id(
    connection: Connection,
    *,
    provider_id: str,
    endpoint_key: str,
    missing_message: str,
) -> int:
    result = connection.execute(
        text(
            """
            SELECT feed_endpoint_id
            FROM core.feed_endpoints
            WHERE provider_id = :provider_id
              AND endpoint_key = :endpoint_key
            """
        ),
        {"provider_id": provider_id, "endpoint_key": endpoint_key},
    ).scalar_one_or_none()
    if result is None:
        raise ValueError(missing_message)
    return int(result)


def insert_ingestion_run(
    connection: Connection,
    *,
    provider_id: str,
    feed_endpoint_id: int,
    run_kind: str,
    requested_at_utc: datetime,
    started_at_utc: datetime,
) -> int:
    result = connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs (
                provider_id,
                feed_endpoint_id,
                run_kind,
                status,
                requested_at_utc,
                started_at_utc
            )
            VALUES (
                :provider_id,
                :feed_endpoint_id,
                :run_kind,
                'running',
                :requested_at_utc,
                :started_at_utc
            )
            RETURNING ingestion_run_id
            """
        ),
        {
            "provider_id": provider_id,
            "feed_endpoint_id": feed_endpoint_id,
            "run_kind": run_kind,
            "requested_at_utc": requested_at_utc,
            "started_at_utc": started_at_utc,
        },
    )
    return int(result.scalar_one())


def mark_ingestion_run_succeeded(
    connection: Connection,
    *,
    ingestion_run_id: int,
    completed_at_utc: datetime,
    http_status_code: int,
    entity_count: int | None = None,
    feed_timestamp_utc: datetime | None = None,
) -> None:
    connection.execute(
        text(
            """
            UPDATE raw.ingestion_runs
            SET status = 'succeeded',
                completed_at_utc = :completed_at_utc,
                http_status_code = :http_status_code,
                entity_count = :entity_count,
                feed_timestamp_utc = :feed_timestamp_utc,
                error_message = NULL
            WHERE ingestion_run_id = :ingestion_run_id
            """
        ),
        {
            "ingestion_run_id": ingestion_run_id,
            "completed_at_utc": completed_at_utc,
            "http_status_code": http_status_code,
            "entity_count": entity_count,
            "feed_timestamp_utc": feed_timestamp_utc,
        },
    )


def mark_ingestion_run_failed(
    connection: Connection,
    *,
    ingestion_run_id: int,
    completed_at_utc: datetime,
    http_status_code: int | None,
    error_message: str,
) -> None:
    connection.execute(
        text(
            """
            UPDATE raw.ingestion_runs
            SET status = 'failed',
                completed_at_utc = :completed_at_utc,
                http_status_code = :http_status_code,
                error_message = :error_message
            WHERE ingestion_run_id = :ingestion_run_id
            """
        ),
        {
            "ingestion_run_id": ingestion_run_id,
            "completed_at_utc": completed_at_utc,
            "http_status_code": http_status_code,
            "error_message": error_message[:2000],
        },
    )


def insert_ingestion_object(
    connection: Connection,
    *,
    ingestion_run_id: int,
    provider_id: str,
    object_kind: str,
    storage_backend: str,
    storage_path: str,
    source_url: str,
    checksum_sha256: str,
    byte_size: int,
) -> int:
    result = connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_objects (
                ingestion_run_id,
                provider_id,
                object_kind,
                storage_backend,
                storage_path,
                source_url,
                checksum_sha256,
                byte_size
            )
            VALUES (
                :ingestion_run_id,
                :provider_id,
                :object_kind,
                :storage_backend,
                :storage_path,
                :source_url,
                :checksum_sha256,
                :byte_size
            )
            RETURNING ingestion_object_id
            """
        ),
        {
            "ingestion_run_id": ingestion_run_id,
            "provider_id": provider_id,
            "object_kind": object_kind,
            "storage_backend": storage_backend,
            "storage_path": storage_path,
            "source_url": source_url,
            "checksum_sha256": checksum_sha256,
            "byte_size": byte_size,
        },
    )
    return int(result.scalar_one())
