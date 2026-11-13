"""Disposable local Parquet payload scan; cache state is uncontrolled."""

import hashlib
import importlib
from pathlib import Path
from time import monotonic
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from transit_ops.history.seal_captures import LocalPack

from transit_ops.history.pack import PackCorrupt, read_pack
from transit_ops.history.poll_record import CaptureEntry


def _metadata(capture: CaptureEntry) -> tuple[int, str, str, int]:
    stamp = capture.captured_at_utc.isoformat()
    return capture.capture_row_id, stamp, capture.sha256, capture.byte_size


def benchmark(local: "LocalPack", directory: Path) -> dict[str, object]:
    fields = """duckdb_version duckdb_reason duckdb_prepare_seconds duckdb_read_seconds
                duckdb_capture_count duckdb_byte_count""".split()
    result: dict[str, object] = dict.fromkeys(fields)
    result.update(
        duckdb_status="not_applicable", duckdb_basis="local_parquet_capture_bytes_with_checksum"
    )
    if local.pack is None:
        return result
    try:
        duckdb = importlib.import_module("duckdb")
    except ModuleNotFoundError as error:
        if error.name != "duckdb":
            raise
        result.update(
            duckdb_status="deferred",
            duckdb_reason="DuckDB is not installed; read timing is a later addition.",
        )
        return result
    assert local.path is not None
    config = {
        "temp_directory": str(directory),
        "enable_external_access": "true",
        "autoinstall_known_extensions": "false",
        "autoload_known_extensions": "false",
    }
    path = directory / "captures.parquet"
    start = monotonic()
    captures = [c for c in local.record.captures if c.packed]
    with duckdb.connect(database=":memory:", config=config) as connection:
        connection.execute(
            "CREATE TABLE captures (ordinal BIGINT, identity BIGINT, "
            "captured VARCHAR, digest VARCHAR, size BIGINT, payload BLOB)"
        )
        with local.path.open("rb") as source:
            payloads = read_pack(source, local.pack.streams, local.pack.captures)
            for ordinal, payload in enumerate(payloads):
                values = (ordinal, *_metadata(captures[ordinal]), payload)
                connection.execute("INSERT INTO captures VALUES (?, ?, ?, ?, ?, ?)", values)
        connection.execute("COPY captures TO ? (FORMAT PARQUET)", [str(path)])
    prepared = monotonic() - start
    count = size = 0
    with duckdb.connect(database=":memory:", config=config) as connection:
        start = monotonic()
        cursor = connection.execute("SELECT * FROM read_parquet(?) ORDER BY ordinal", [str(path)])
        while rows := cursor.fetchmany(1):
            for row in rows:
                expected, payload = captures[count], row[-1]
                if (
                    row[:-1] != (count, *_metadata(expected))
                    or len(payload) != expected.byte_size
                    or hashlib.sha256(payload).hexdigest() != expected.sha256
                ):
                    raise PackCorrupt("Parquet payload differs from packed capture")
                count += 1
                size += len(payload)
        if count != len(captures):
            raise PackCorrupt("Parquet capture count differs")
        elapsed = monotonic() - start
    result.update(
        duckdb_status="measured",
        duckdb_version=duckdb.__version__,
        duckdb_prepare_seconds=prepared,
        duckdb_read_seconds=elapsed,
        duckdb_capture_count=count,
        duckdb_byte_count=size,
    )
    return result
