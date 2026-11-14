"""Upload receipt-pinned interim CSVs. No database connections; no deletion."""

from __future__ import annotations

import csv
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any

from rescue_fact_day import (
    SCHEMAS,
    RetainedUpload,
    SafeParser,
    compress,
    digest,
    finish_file,
    sync_directory,
    sync_file,
    validate_csv,
    write_record,
)

from transit_ops.history.storage import history_storage  # type: ignore[import-untyped]
from transit_ops.ingestion.storage import ObjectAlreadyExists  # type: ignore[import-untyped]


class InterimStorage:
    """Narrow create/read boundary; the reviewed facts adapter has a different prefix."""

    def __init__(self, storage: Any) -> None:
        self.__storage = storage

    @staticmethod
    def _key(key: str) -> str:
        if not re.fullmatch(
            r"rescue/v1/interim/[a-z0-9-]+/(fact_trip_delay_snapshot\.csv\.gz|"
            r"fact_vehicle_snapshot\.csv\.gz|manifest\.json)",
            key,
        ):
            raise ValueError("unsafe_key")
        return key

    def put_if_absent(self, path: Path, key: str) -> None:
        self.__storage.put_if_absent(RetainedUpload(path), self._key(key))

    def open_stream(self, key: str) -> Any:
        return self.__storage.open_stream(self._key(key))

    def head(self, key: str) -> bool:
        return bool(self.__storage.exists(self._key(key)))


def verify(storage: InterimStorage, path: Path, key: str, meta: dict[str, Any] | None) -> None:
    try:
        storage.put_if_absent(path, key)
    except ObjectAlreadyExists:
        pass
    # Full byte comparison, including short stream reads and trailing bytes.
    partial = path.with_name(path.name + ".readback.partial")
    with path.open("rb") as expected, storage.open_stream(key) as actual, partial.open("xb") as out:
        while remaining := expected.read(1024 * 1024):
            while remaining:
                block = actual.read(len(remaining))
                if not block or not remaining.startswith(block):
                    raise ValueError("object_conflict")
                out.write(block)
                remaining = remaining[len(block) :]
        if actual.read(1):
            raise ValueError("object_conflict")
        sync_file(out)
    target = path.with_name(path.name + ".readback")
    finish_file(partial, target)
    if meta is not None:
        validate_csv(target, meta)


def pairs(values: list[str]) -> dict[str, str]:
    result = {}
    for value in values:
        key, separator, content = value.partition("=")
        if not separator or not key or not content or key in result:
            raise ValueError("invalid_pair")
        result[key] = content
    return result


def inputs(argv: list[str] | None) -> tuple[Any, dict[str, str], dict[str, str]]:
    parser = SafeParser(add_help=False)
    for name in ("source-dir", "copy-label", "spool-dir"):
        parser.add_argument("--" + name, required=True)
    for name in ("expect", "note"):
        parser.add_argument("--" + name, action="append", required=True)
    args = parser.parse_args(argv)
    expected, notes = pairs(args.expect), pairs(args.note)
    source, spool = Path(args.source_dir).resolve(), Path(args.spool_dir).resolve()
    if (
        not re.fullmatch(r"[a-z0-9-]+", args.copy_label)
        or set(expected) != set(SCHEMAS)
        or not {"snapshot_now", "bounds", "method"} <= notes.keys()
        or source == spool
        or source in spool.parents
        or spool in source.parents
    ):
        raise ValueError("invalid_arguments")
    for table, sha in expected.items():
        path = source / (table + ".csv")
        if not re.fullmatch(r"[0-9a-f]{64}", sha) or not path.is_file():
            raise ValueError("invalid_source")
        with path.open("rb") as stream:
            if digest(stream)[0] != sha:
                raise ValueError("digest_mismatch")
        with path.open("r", encoding="utf-8", newline="") as stream:
            reader = csv.reader(stream, strict=True)
            if next(reader) != [column[0] for column in SCHEMAS[table]]:
                raise ValueError("csv_header")
            for row in reader:
                if len(row) != 20:
                    raise ValueError("csv_shape")
    return args, expected, notes


def main(argv: list[str] | None = None) -> int:
    phase = "input"
    try:
        args, expected, notes = inputs(argv)
        phase = "spool"
        spool = Path(args.spool_dir)
        missing = [path for path in (spool, *spool.parents) if not path.exists()]
        spool.mkdir(parents=True, exist_ok=True)
        for created in reversed(missing):
            sync_directory(created.parent)
        folder = Path(tempfile.mkdtemp(prefix=args.copy_label + "-", dir=spool))
        sync_directory(spool)
        tables = {}
        for table, sha in expected.items():
            path = folder / (table + ".csv")
            partial = path.with_suffix(".csv.partial")
            with (
                (Path(args.source_dir) / path.name).open("rb") as source,
                partial.open("xb") as out,
            ):
                shutil.copyfileobj(source, out)
                sync_file(out)
            finish_file(partial, path)
            meta = compress(path)
            if meta["csv_sha256"] != sha:
                raise ValueError("source_changed")
            meta["schema"] = SCHEMAS[table]
            validate_csv(path.with_suffix(".csv.gz"), meta)
            tables[table] = meta
        phase = "upload_readback"
        scope = history_storage()
        prefix = f"rescue/v1/interim/{args.copy_label}/"
        try:
            storage = InterimStorage(scope.resolve("s3"))
            for table, meta in tables.items():
                verify(storage, folder / (table + ".csv.gz"), prefix + table + ".csv.gz", meta)
            manifest = dict(
                format_version=1,
                copy_label=args.copy_label,
                kind="interim_unordered_csv",
                notes=notes,
                statement="rows unordered; not the canonical LS0.4 format; oldest day partial",
                tables={
                    table: {
                        key: meta[key]
                        for key in ("rows", "csv_bytes", "csv_sha256", "object_sha256")
                    }
                    for table, meta in tables.items()
                },
            )
            write_record(folder, "manifest.json", manifest)
            verify(storage, folder / "manifest.json", prefix + "manifest.json", None)
        finally:
            scope.close()
        print(json.dumps(dict(outcome="verified", prefix=prefix)))
        return 0
    except (Exception, KeyboardInterrupt):
        print(json.dumps(dict(outcome="failed", phase=phase, reason="refused_or_failed")))
        return 2 if phase == "input" else 1


if __name__ == "__main__":
    sys.exit(main())
