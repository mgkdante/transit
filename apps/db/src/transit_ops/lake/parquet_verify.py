"""File checks for a table copy; row equality is a separate proof."""

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Literal

import duckdb

from transit_ops.ingestion.storage import BronzeStorage
from transit_ops.lake.parquet_codec import connect, read_canonical_csv
from transit_ops.lake.table_schema import TableSchema


@dataclass(frozen=True)
class Expected:
    content_sha256: str
    rows: int
    object_sha256: str | None


@dataclass(frozen=True)
class FileChecks:
    rows: int
    content_sha256: str
    object_sha256: str
    object_bytes: int
    schema_sha256: str
    checked_with: str


Reason = Literal[
    "content_digest",
    "object_digest",
    "rows",
    "schema",
    "metadata",
    "types",
    "missing_rows",
    "extra_rows",
    "key_order",
]


class CopyDiffers(ValueError):
    def __init__(self, reason: Reason, detail: str) -> None:
        self.reason, self.detail = reason, detail
        super().__init__(f"{reason}: {detail}")


def _literal_path(path: Path) -> None:
    if any(character in str(path) for character in "*?[]{}"):
        raise ValueError(f"Glob characters in path: {path}")


def _digest(path: Path) -> tuple[str, int]:
    digest, size = hashlib.sha256(), 0
    with path.open("rb") as source:
        while chunk := source.read(64 * 1024):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def check_window_files(
    csv_path: Path, parquet_path: Path, schema: TableSchema, *, expect: Expected, temp_dir: Path
) -> FileChecks:
    """Check digests, metadata, ordered types and counts, without claiming equality.

    Callers must keep both files unchanged throughout the checks.
    """
    for path in (csv_path, parquet_path, temp_dir):
        _literal_path(path)
    content, _ = _digest(csv_path)
    if content != expect.content_sha256:
        raise CopyDiffers("content_digest", "CSV SHA-256 differs from expected")
    object_sha, object_bytes = _digest(parquet_path)
    if expect.object_sha256 is not None and object_sha != expect.object_sha256:
        raise CopyDiffers("object_digest", "Parquet SHA-256 differs from expected")
    with connect(temp_dir) as connection:
        metadata = dict(
            connection.execute(
                "SELECT key, value FROM parquet_kv_metadata(?)", [str(parquet_path)]
            ).fetchall()
        )
        for key, value in {
            b"transit.schema": schema.to_json(),
            b"transit.content_sha256": expect.content_sha256.encode(),
            b"transit.rows": str(expect.rows).encode(),
        }.items():
            if metadata.get(key) != value:
                raise CopyDiffers("metadata", f"{key.decode()} differs from expected")
        parquet = connection.read_parquet(str(parquet_path), hive_partitioning=False)
        types = schema.duckdb_types()
        if parquet.columns != list(types) or parquet.types != [
            duckdb.sqltype(value) for value in types.values()
        ]:
            raise CopyDiffers("types", "Parquet column names, order or types differ")
        csv = read_canonical_csv(connection, csv_path, schema)
        for name, relation in (("CSV", csv), ("Parquet", parquet)):
            count = int(relation.aggregate("count(*)").fetchall()[0][0])
            if count != expect.rows:
                raise CopyDiffers("rows", f"{name} has {count} rows; expected {expect.rows}")
    return FileChecks(
        expect.rows, content, object_sha, object_bytes, schema.columns_sha256(), duckdb.__version__
    )


def read_back(storage: BronzeStorage, key: str, destination: Path) -> tuple[str, int]:
    """Stream into a private file and publish exclusively after a complete read."""
    _literal_path(destination)
    if destination.exists():
        raise FileExistsError(destination)
    digest, size = hashlib.sha256(), 0
    with TemporaryDirectory(prefix=".readback-", dir=destination.parent) as directory:
        temporary = Path(directory) / "object"
        with temporary.open("xb") as target, storage.open_stream(key) as source:
            while chunk := source.read(64 * 1024):
                target.write(chunk)
                digest.update(chunk)
                size += len(chunk)
            target.flush()
            os.fsync(target.fileno())
        os.link(temporary, destination)
    return digest.hexdigest(), size
