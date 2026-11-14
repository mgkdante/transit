"""Verified, create-only copies of explicitly selected schedule editions."""

import hashlib
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Literal

from sqlalchemy import Connection, RowMapping, text

from transit_ops.ingestion.storage import BronzeStorage, BronzeStorageResolver
from transit_ops.lake.objects import object_digest, put_create_only


@dataclass(frozen=True)
class ScheduleZipArchive:
    provider_id: str
    dataset_version_id: int
    checksum_sha256: str
    byte_size: int
    storage_backend: str
    storage_path: str
    outcome: Literal["created", "already_equal"]


def _edition(connection: Connection, provider: str, edition: int) -> RowMapping:
    row = (
        connection.execute(
            text("""
        SELECT COALESCE(dv.checksum_sha256, dv.content_hash) AS checksum_sha256,
               dv.byte_size, dv.storage_backend, dv.storage_path,
               dv.source_ingestion_object_id, io.ingestion_object_id AS raw_id,
               io.checksum_sha256 AS raw_checksum, io.byte_size AS raw_size,
               io.storage_backend AS raw_backend, io.storage_path AS raw_path
        FROM core.dataset_versions dv
        LEFT JOIN raw.ingestion_objects io
          ON io.ingestion_object_id = dv.source_ingestion_object_id
         AND io.provider_id = dv.provider_id
         AND io.ingestion_run_id = dv.source_ingestion_run_id
        WHERE dv.provider_id = :provider_id AND dv.dataset_version_id = :edition
          AND dv.dataset_kind = 'static_schedule'
        FOR SHARE OF dv
    """),
            dict(provider_id=provider, edition=edition),
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        raise ValueError("Schedule edition not found")
    return row


def _metadata(row: RowMapping) -> tuple[str, int | None, str, str]:
    checksum = str(row["checksum_sha256"]).lower()
    if not re.fullmatch(r"[0-9a-f]{64}", checksum):
        raise ValueError("Invalid edition checksum")
    if row["source_ingestion_object_id"] is not None and row["raw_id"] is None:
        raise ValueError("Source object does not belong to the edition provider and run")
    if row["raw_checksum"] is not None and str(row["raw_checksum"]).lower() != checksum:
        raise ValueError("Contradictory source checksum")
    for value in (row["byte_size"], row["raw_size"]):
        if value is not None and value <= 0:
            raise ValueError("Source size must be positive")
    size = row["byte_size"] if row["byte_size"] is not None else row["raw_size"]
    if row["raw_size"] is not None and row["raw_size"] != size:
        raise ValueError("Contradictory source size")
    backend = row["storage_backend"] or row["raw_backend"]
    source_key = row["storage_path"] or row["raw_path"]
    if not backend or not source_key:
        raise ValueError("Missing source location")
    return checksum, size, str(backend), str(source_key)


def _copy(source: BronzeStorage, key: str, path: Path) -> tuple[str, int]:
    digest, size = hashlib.sha256(), 0
    try:
        with source.open_stream(key) as reader, path.open("wb") as target:
            while chunk := reader.read(64 * 1024):
                target.write(chunk)
                digest.update(chunk)
                size += len(chunk)
    except Exception as exc:
        if not source.exists(key):
            raise FileNotFoundError("Schedule original is missing") from exc
        raise
    return digest.hexdigest(), size


def archive_schedule_zip(
    connection: Connection,
    storage: BronzeStorageResolver,
    *,
    provider_id: str,
    dataset_version_id: int,
    archive_backend: str,
) -> ScheduleZipArchive:
    """Archive an edition in the caller's transaction; return only verified bytes."""
    if not connection.in_transaction():
        raise ValueError("An active caller transaction is required")
    if (
        not provider_id
        or provider_id in {".", ".."}
        or provider_id.endswith((".", " "))
        or any(c in '/\\:<>"|?*' or unicodedata.category(c) == "Cc" for c in provider_id)
    ):
        raise ValueError("Provider must be a safe key segment")
    checksum, size, backend, source_key = _metadata(
        _edition(connection, provider_id, dataset_version_id)
    )
    destination = storage(archive_backend)
    key = f"archive/v1/schedules/{provider_id}/{checksum}.zip"
    outcome: Literal["created", "already_equal"] = "already_equal"
    if not destination.exists(key):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "schedule.zip"
            actual, measured = _copy(storage(backend), source_key, path)
            if actual != checksum or (size is not None and measured != size):
                raise ValueError("Source digest or size mismatch")
            size = measured
            outcome = put_create_only(destination, path, key, expected=(checksum, measured))
    actual, measured = object_digest(destination, key)
    if actual != checksum or (size is not None and measured != size):
        raise ValueError("Destination digest or size mismatch")
    return ScheduleZipArchive(
        provider_id, dataset_version_id, checksum, measured, archive_backend, key, outcome
    )
