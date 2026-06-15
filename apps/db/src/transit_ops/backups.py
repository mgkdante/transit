"""Nightly logical Postgres backups streamed from pg_dump straight to Bronze R2.

One process owns guard + dump + upload + abort so a failed pg_dump can never
persist a truncated dump as a successful backup, and the dump never touches
VM disk.
"""

from __future__ import annotations

import io
import re
import subprocess
import tempfile
import time
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from boto3.s3.transfer import TransferConfig
from sqlalchemy import text

from transit_ops.db.connection import make_engine
from transit_ops.ingestion.storage import build_s3_client
from transit_ops.settings import Settings

BACKUP_KEY_PATTERN = re.compile(r"transit-\d{8}T\d{6}Z\.dump$")
MULTIPART_CHUNKSIZE_BYTES = 64 * 1024 * 1024
# boto3's default max_concurrency=10 on a non-seekable stream can buffer
# ~640MB inside the worker container on the shared A1 host; 2 caps it at
# roughly 128-192MB while keeping the multipart ceiling at ~640GB.
MAX_UPLOAD_CONCURRENCY = 2
STDERR_TAIL_CHARS = 2000


class BackupError(RuntimeError):
    """Raised when a database backup cannot be produced or stored safely."""


@dataclass
class BackupResult:
    key: str
    bucket: str
    bytes_uploaded: int
    duration_seconds: float
    pruned_keys: list[str]
    retained_count: int

    def display_dict(self) -> dict[str, object]:
        return {
            "key": self.key,
            "bucket": self.bucket,
            "bytes_uploaded": self.bytes_uploaded,
            "duration_seconds": round(self.duration_seconds, 3),
            "pruned_keys": list(self.pruned_keys),
            "retained_count": self.retained_count,
        }


class _CountingStream:
    """Wrap a binary stream and count the bytes handed to the uploader."""

    def __init__(self, raw) -> None:  # noqa: ANN001
        self.raw = raw
        self.bytes_read = 0

    def read(self, size: int = -1) -> bytes:
        chunk = self.raw.read(size)
        self.bytes_read += len(chunk)
        return chunk


def backup_object_key(prefix: str, now: datetime) -> str:
    timestamp = now.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
    return f"{prefix.strip('/')}/transit-{timestamp}.dump"


def verify_excluded_tables_exist(settings: Settings, *, engine_factory=make_engine) -> None:  # noqa: ANN001
    """Abort before dumping when any excluded table no longer exists.

    pg_dump treats a non-matching --exclude-table-data as a SILENT no-op
    (exit 0, full data dumped), so a renamed or dropped exclusion target must
    fail the backup loudly instead of quietly re-inflating the dump.
    """

    tables = settings.backup_exclude_tables
    if not tables:
        return

    engine = engine_factory(settings)
    try:
        with engine.connect() as connection:
            missing = [
                table
                for table in tables
                if connection.execute(
                    text("SELECT to_regclass(:tbl)"), {"tbl": table}
                ).scalar_one()
                is None
            ]
    finally:
        engine.dispose()

    if missing:
        raise BackupError(
            "Excluded table(s) missing from the database: "
            + ", ".join(missing)
            + ". pg_dump silently ignores non-matching --exclude-table-data; "
            "update BACKUP_EXCLUDE_TABLE_DATA before backing up."
        )


def build_pg_dump_command(settings: Settings) -> list[str]:
    if not settings.DATABASE_URL:
        raise ValueError("DATABASE_URL is required for backup-database.")
    return [
        "pg_dump",
        "--format=custom",
        f"--compress={settings.BACKUP_COMPRESSION}",
        "--no-password",
        "--lock-wait-timeout=5min",
        *(f"--exclude-table-data={table}" for table in settings.backup_exclude_tables),
        # pg_dump needs the raw postgresql:// URI, not the +psycopg SQLAlchemy form.
        settings.DATABASE_URL,
    ]


def run_database_backup(
    settings: Settings,
    *,
    client=None,  # noqa: ANN001
    popen=subprocess.Popen,  # noqa: ANN001
    engine_factory=make_engine,  # noqa: ANN001
    now: datetime | None = None,
) -> BackupResult:
    command = build_pg_dump_command(settings)
    verify_excluded_tables_exist(settings, engine_factory=engine_factory)

    if client is None:
        client = build_s3_client(settings)
    bucket = _require_bucket(settings)
    key = backup_object_key(settings.BACKUP_S3_PREFIX, now or datetime.now(UTC))

    started = time.monotonic()
    with tempfile.TemporaryFile() as stderr_sink:
        # stderr goes to a real file, never a pipe: a full stderr pipe would
        # deadlock pg_dump while we drain stdout.
        proc = popen(command, stdout=subprocess.PIPE, stderr=stderr_sink)
        stream = _CountingStream(proc.stdout)
        try:
            client.upload_fileobj(
                stream,
                bucket,
                key,
                ExtraArgs={"ContentType": "application/octet-stream"},
                Config=TransferConfig(
                    multipart_chunksize=MULTIPART_CHUNKSIZE_BYTES,
                    max_concurrency=MAX_UPLOAD_CONCURRENCY,
                ),
            )
        except Exception as exc:
            if proc.poll() is None:
                proc.kill()
            proc.wait()
            _delete_object_best_effort(client, bucket, key)
            raise BackupError(f"Upload to s3://{bucket}/{key} failed: {exc}") from exc

        returncode = proc.wait()
        if returncode != 0:
            _delete_object_best_effort(client, bucket, key)
            raise BackupError(
                f"pg_dump exited with code {returncode}: {_stderr_tail(stderr_sink)}"
            )

    pruned_keys = prune_old_backups(
        client,
        bucket=bucket,
        prefix=settings.BACKUP_S3_PREFIX,
        keep=settings.BACKUP_RETENTION_COUNT,
    )
    retained_count = len(
        _eligible_backup_keys(client, bucket=bucket, prefix=settings.BACKUP_S3_PREFIX)
    )
    return BackupResult(
        key=key,
        bucket=bucket,
        bytes_uploaded=stream.bytes_read,
        duration_seconds=time.monotonic() - started,
        pruned_keys=pruned_keys,
        retained_count=retained_count,
    )


def prune_old_backups(client, *, bucket: str, prefix: str, keep: int) -> list[str]:  # noqa: ANN001
    if keep < 1:
        raise ValueError("keep must be >= 1 so prune can never delete every backup.")

    eligible = _eligible_backup_keys(client, bucket=bucket, prefix=prefix)
    to_delete = eligible[:-keep] if len(eligible) > keep else []
    for key in to_delete:
        client.delete_object(Bucket=bucket, Key=key)
    return to_delete


def list_database_backups(settings: Settings, *, client=None) -> list[dict[str, object]]:  # noqa: ANN001
    if client is None:
        client = build_s3_client(settings)
    bucket = _require_bucket(settings)

    entries: list[dict[str, object]] = []
    for obj in _iter_object_summaries(client, bucket=bucket, prefix=settings.BACKUP_S3_PREFIX):
        key = str(obj["Key"])
        if not BACKUP_KEY_PATTERN.search(key):
            continue
        last_modified = obj.get("LastModified")
        entries.append(
            {
                "key": key,
                "size": obj.get("Size"),
                "last_modified": (
                    last_modified.isoformat()
                    if isinstance(last_modified, datetime)
                    else last_modified
                ),
            }
        )
    entries.sort(key=lambda entry: str(entry["key"]), reverse=True)
    return entries


def download_latest_backup(
    settings: Settings,
    dest: Path,
    *,
    client=None,  # noqa: ANN001
) -> dict[str, object]:
    if client is None:
        client = build_s3_client(settings)
    bucket = _require_bucket(settings)

    backups = list_database_backups(settings, client=client)
    if not backups:
        raise BackupError(
            f"No backups found under {settings.BACKUP_S3_PREFIX}/ in bucket {bucket}."
        )

    latest = backups[0]
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    client.download_file(bucket, str(latest["key"]), str(dest))
    return {"key": latest["key"], "size": latest["size"], "dest": str(dest)}


def _require_bucket(settings: Settings) -> str:
    if not settings.BRONZE_S3_BUCKET:
        raise BackupError("BRONZE_S3_BUCKET is required for database backups.")
    return settings.BRONZE_S3_BUCKET


def _iter_object_summaries(client, *, bucket: str, prefix: str) -> Iterator[dict]:  # noqa: ANN001
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=f"{prefix.strip('/')}/"):
        yield from page.get("Contents", [])


def _eligible_backup_keys(client, *, bucket: str, prefix: str) -> list[str]:  # noqa: ANN001
    # Timestamped names sort lexicographically, so sorted == chronological.
    return sorted(
        str(obj["Key"])
        for obj in _iter_object_summaries(client, bucket=bucket, prefix=prefix)
        if BACKUP_KEY_PATTERN.search(str(obj["Key"]))
    )


def _delete_object_best_effort(client, bucket: str, key: str) -> None:  # noqa: ANN001
    try:
        client.delete_object(Bucket=bucket, Key=key)
    except Exception:  # noqa: BLE001 - cleanup must never mask the original failure
        pass


def _stderr_tail(stderr_sink, limit: int = STDERR_TAIL_CHARS) -> str:  # noqa: ANN001
    try:
        stderr_sink.seek(0, io.SEEK_END)
        size = stderr_sink.tell()
        stderr_sink.seek(max(0, size - limit))
        data = stderr_sink.read(limit)
    except (OSError, ValueError):
        return ""
    if isinstance(data, bytes):
        return data.decode("utf-8", errors="replace").strip()
    return str(data).strip()
