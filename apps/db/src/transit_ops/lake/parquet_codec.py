"""Typed table copies retaining the canonical CSV content digest."""

import hashlib
import json
import os
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Final, Literal

import duckdb

from transit_ops.lake.table_schema import TableSchema


class CsvHeaderMismatch(ValueError):
    """The CSV header differs from the ordered schema."""


class RequiredValueMissing(ValueError):
    """A required column contains NULL."""


@dataclass(frozen=True)
class ParquetCodec:
    compression: Literal["zstd"] = "zstd"
    level: int = 9
    row_group_rows: int = 122_880


DEFAULT_CODEC: Final = ParquetCodec()


@dataclass(frozen=True)
class WrittenWindow:
    path: Path
    rows: int
    byte_size: int
    sha256: str
    content_sha256: str
    content_bytes: int
    schema: TableSchema
    codec: ParquetCodec
    writer_version: str

    def details(self) -> dict[str, object]:
        return dict(
            codec="parquet",
            codec_params=asdict(self.codec),
            writer="duckdb",
            writer_version=self.writer_version,
            schema_sha256=self.schema.columns_sha256(),
            content_digest="canonical_csv_sha256",
        )


def connect(temp_dir: Path) -> duckdb.DuckDBPyConnection:
    connection = duckdb.connect(
        database=":memory:",
        config={
            "threads": 1,
            "preserve_insertion_order": True,
            "autoinstall_known_extensions": False,
            "autoload_known_extensions": False,
            "temp_directory": str(temp_dir),
        },
    )
    try:
        connection.execute("SET TimeZone='UTC'")
    except Exception:
        connection.close()
        raise
    return connection


def read_canonical_csv(
    connection: duckdb.DuckDBPyConnection, csv_path: Path, schema: TableSchema
) -> duckdb.DuckDBPyRelation:
    _literal_path(csv_path)
    return connection.sql(
        "SELECT * FROM read_csv(?, columns=?, auto_detect=false, header=true, "
        "delim=',', quote='\"', escape='\"', nullstr='', allow_quoted_nulls=false, "
        "strict_mode=true, ignore_errors=false, hive_partitioning=false)",
        params=[str(csv_path), schema.duckdb_types()],
    )


def _digest(path: Path, header: bytes | None = None) -> tuple[str, int]:
    digest, size = hashlib.sha256(), 0
    with path.open("rb") as source:
        if header is not None:
            first = source.readline()
            if first != header:
                raise CsvHeaderMismatch(f"Expected header {header!r}, got {first!r}")
            digest.update(first)
            size += len(first)
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def _metadata(
    metadata: Mapping[str, str], schema: TableSchema, content: str, count: int, codec: ParquetCodec
) -> dict[str, str]:
    return dict(
        metadata,
        **{
            "transit.schema": schema.to_json().decode(),
            "transit.content_sha256": content,
            "transit.rows": str(count),
            "transit.codec": json.dumps(asdict(codec), sort_keys=True, separators=(",", ":")),
        },
    )


def _readback(connection: duckdb.DuckDBPyConnection, path: Path, schema: TableSchema) -> int:
    written = connection.read_parquet(str(path), hive_partitioning=False)
    for column in schema.columns:
        name = '"' + column.name.replace('"', '""') + '"'
        if (
            column.not_null
            and written.filter(f"{name} IS NULL").aggregate("count(*)").fetchall()[0][0]
        ):
            raise RequiredValueMissing(column.name)
    return int(written.aggregate("count(*)").fetchall()[0][0])


def _literal_path(path: Path) -> None:
    if any(character in str(path) for character in "*?[]{}"):
        raise ValueError(f"Glob characters in path: {path}")


def write_window(
    csv_path: Path,
    schema: TableSchema,
    parquet_path: Path,
    *,
    metadata: Mapping[str, str],
    temp_dir: Path,
    codec: ParquetCodec = DEFAULT_CODEC,
) -> WrittenWindow:
    for path in (csv_path, parquet_path, temp_dir):
        _literal_path(path)
    if parquet_path.exists():
        raise FileExistsError(parquet_path)
    with TemporaryDirectory(prefix=".transit-", dir=parquet_path.parent) as directory:
        output = Path(directory) / "window.parquet"
        if any(key.startswith("transit.") for key in metadata):
            raise ValueError("Caller metadata cannot use the transit. prefix")
        content, content_bytes = _digest(
            csv_path, (",".join(column.name for column in schema.columns) + "\n").encode()
        )
        with connect(temp_dir) as connection:
            relation = read_canonical_csv(connection, csv_path, schema)
            count = relation.aggregate("count(*)").fetchall()[0][0]
            kv = _metadata(metadata, schema, content, count, codec)
            relation.create_view("window_rows")
            connection.execute(
                "COPY (SELECT * FROM window_rows) TO ? (FORMAT parquet, "
                "COMPRESSION zstd, COMPRESSION_LEVEL ?, ROW_GROUP_SIZE ?, KV_METADATA ?)",
                [str(output), codec.level, codec.row_group_rows, dict(sorted(kv.items()))],
            )
            count = _readback(connection, output, schema)
        sha256, byte_size = _digest(output)
        os.link(output, parquet_path)
        return WrittenWindow(
            parquet_path,
            count,
            byte_size,
            sha256,
            content,
            content_bytes,
            schema,
            codec,
            duckdb.__version__,
        )
