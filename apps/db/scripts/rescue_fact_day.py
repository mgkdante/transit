"""One provider-day emergency snapshot. Production invocations require owner approval."""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import re
import shutil
import sys
import tempfile
import threading
import time
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlsplit, urlunsplit

import psycopg
from psycopg import sql
from psycopg.pq import TransactionStatus

from transit_ops.history.datasets import utc_day_closes_at  # type: ignore[import-untyped]
from transit_ops.history.storage import history_storage  # type: ignore[import-untyped]
from transit_ops.ingestion.storage import (  # type: ignore[import-untyped]
    BronzeStorage,
    ObjectAlreadyExists,
)
from transit_ops.settings import get_settings  # type: ignore[import-untyped]

COMMON = "provider_id:t realtime_snapshot_id:b entity_index:i snapshot_date_key:i "
COMMON += "snapshot_local_date:d feed_timestamp_utc:z captured_at_utc:z"
TAILS = {
    "fact_trip_delay_snapshot": "entity_id:t trip_id:t route_id:t direction_id:i start_date:d "
    "vehicle_id:t trip_schedule_relationship:i delay_seconds:i stop_time_update_count:i! "
    "delay_stop_id:t delay_stop_sequence:i skipped_stop_count:i! occupancy_status:i",
    "fact_vehicle_snapshot": "position_timestamp_utc:z entity_id:t vehicle_id:t trip_id:t "
    "route_id:t stop_id:t current_stop_sequence:i current_status:i occupancy_status:i "
    "latitude:f longitude:f bearing:f speed:f",
}
TYPES = dict(
    t="text", b="bigint", i="integer", d="date", z="timestamp with time zone", f="double precision"
)
SCHEMAS = {
    table: [
        [name, TYPES[kind.rstrip("!")], index < 7 or kind.endswith("!")]
        for index, (name, kind) in enumerate(
            token.split(":") for token in (COMMON + " " + tail).split()
        )
    ]
    for table, tail in TAILS.items()
}
PK = ["provider_id", "realtime_snapshot_id", "entity_index"]


def encoded(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def digest(stream: Any) -> tuple[str, int]:
    hasher, size = hashlib.sha256(), 0
    while block := stream.read(1024 * 1024):
        hasher.update(block)
        size += len(block)
    return hasher.hexdigest(), size


def stamp(value: str) -> datetime:
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.utcoffset() != timedelta(0):
        raise ValueError("utc_required")
    return result


class SafeParser(argparse.ArgumentParser):
    def error(self, message: str) -> Any:
        raise ValueError("invalid_arguments")


def parser() -> argparse.ArgumentParser:
    result = SafeParser()
    for name in ("provider", "date", "spool-dir", "as-of"):
        result.add_argument("--" + name)
    result.add_argument("--not-after", required=True)
    result.add_argument("--statement-timeout-s", type=int, required=True)
    result.add_argument("--db-phase-s", type=int, required=True)
    result.add_argument("--inventory", action="store_true")
    result.add_argument("--upload", action="store_true")
    return result


def bounds(args: Any, now: datetime) -> dict[str, Any]:
    deadline = stamp(args.not_after)
    if not (1 <= args.statement_timeout_s <= 900 and 1 <= args.db_phase_s <= 1800):
        raise ValueError("invalid_timeout")
    if deadline.hour != 5 or deadline.minute != 45 or deadline.second or deadline.microsecond:
        raise ValueError("invalid_deadline")
    if now + timedelta(seconds=args.db_phase_s) >= deadline:
        raise ValueError("insufficient_budget")
    if args.inventory:
        if any((args.provider, args.date, args.spool_dir, args.as_of, args.upload)):
            raise ValueError("inventory_only")
        return {}
    if not args.provider or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", args.provider):
        raise ValueError("unsafe_provider")
    if not args.spool_dir or not args.date:
        raise ValueError("missing_bounds")
    day = date.fromisoformat(args.date)
    start = datetime.combine(day, datetime.min.time(), UTC)
    end = start + timedelta(days=1)
    if args.as_of:
        end = stamp(args.as_of)
        if day != now.date() or not start < end <= now:
            raise ValueError("invalid_asof")
    elif now < utc_day_closes_at(day):
        raise ValueError("day_not_closed")
    prefix = f"rescue/v1/facts/{args.provider}/{day.isoformat()}/"
    if args.as_of:
        prefix += "asof-" + end.strftime("%Y%m%dT%H%M%S%fZ") + "/"
    return dict(
        format_version=1,
        provider=args.provider,
        day=day.isoformat(),
        start=start.isoformat(),
        end=end.isoformat(),
        prefix=prefix,
        status="partial_asof" if args.as_of else "closed_emergency_snapshot",
    )


def copy_fact_table(
    connection: Any,
    *,
    table: str,
    provider_id: str,
    start_utc: datetime,
    end_utc: datetime,
    destination: Path,
) -> dict[str, Any]:
    """Stream uncompressed COPY bytes in the caller's active read-only transaction (R3)."""
    if table not in SCHEMAS or connection.info.transaction_status != TransactionStatus.INTRANS:
        raise ValueError("transaction_or_table")
    if connection.execute("SHOW transaction_read_only").fetchone()[0] != "on":
        raise ValueError("read_only_required")
    schema = [
        list(row)
        for row in connection.execute(
            "SELECT attname, format_type(atttypid, atttypmod), attnotnull FROM pg_attribute "
            "WHERE attrelid = %s::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum",
            ("gold." + table,),
        )
    ]
    pk = connection.execute(
        "SELECT array_agg(a.attname ORDER BY k.n) FROM pg_index i "
        "CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,n) "
        "JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum "
        "WHERE i.indrelid=%s::regclass AND i.indisprimary",
        ("gold." + table,),
    ).fetchone()[0]
    if schema != SCHEMAS[table] or pk != PK:
        raise ValueError("schema_drift")
    query = sql.SQL(
        "COPY (SELECT {} FROM gold.{} WHERE provider_id=%s "
        "AND captured_at_utc >= %s AND captured_at_utc < %s "
        'ORDER BY provider_id COLLATE "C", realtime_snapshot_id, entity_index) '
        "TO STDOUT WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')"
    ).format(sql.SQL(", ").join(sql.Identifier(row[0]) for row in schema), sql.Identifier(table))
    started, hasher, size = time.monotonic(), hashlib.sha256(), 0
    with destination.open("xb") as output, connection.cursor() as cursor:
        with cursor.copy(query, (provider_id, start_utc, end_utc)) as copy:
            for block in copy:
                output.write(block)
                hasher.update(block)
                size += len(block)
        rows = cursor.rowcount
    return dict(
        schema=schema,
        schema_sha256=hashlib.sha256(encoded(schema)).hexdigest(),
        csv_sha256=hasher.hexdigest(),
        csv_bytes=size,
        copy_rows=rows,
        export_seconds=time.monotonic() - started,
    )


def compress(source: Path) -> dict[str, Any]:
    started = time.monotonic()
    target = source.with_suffix(".csv.gz")
    with source.open("rb") as stream:
        csv_hash, csv_bytes = digest(stream)
    with source.open("r", encoding="utf-8", newline="") as stream:
        reader = csv.reader(stream, strict=True)
        header = next(reader)
        rows = 0
        for row in reader:
            if len(row) != len(header):
                raise ValueError("csv_shape")
            rows += 1
    with source.open("rb") as stream, target.open("xb") as output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=output, compresslevel=9, mtime=0) as gz:
            shutil.copyfileobj(stream, gz)
    with target.open("rb") as stream:
        object_hash, object_bytes = digest(stream)
    return dict(
        rows=rows,
        csv_sha256=csv_hash,
        csv_bytes=csv_bytes,
        object_sha256=object_hash,
        object_bytes=object_bytes,
        compress_seconds=time.monotonic() - started,
        outcome="empty_at_snapshot" if rows == 0 else "surviving_rows",
    )


def resume(folder: Path, identity: dict[str, Any]) -> dict[str, Any]:
    checkpoint = cast(dict[str, Any], json.loads((folder / "checkpoint.json").read_bytes()))
    if any(checkpoint.get(key) != value for key, value in identity.items()):
        raise ValueError("checkpoint_bounds")
    if set(checkpoint["tables"]) != set(SCHEMAS):
        raise ValueError("incomplete_checkpoint")
    for table, meta in checkpoint["tables"].items():
        path = folder / (table + ".csv.gz")
        if (
            meta["schema"] != SCHEMAS[table]
            or meta["schema_sha256"] != hashlib.sha256(encoded(SCHEMAS[table])).hexdigest()
        ):
            raise ValueError("schema_drift")
        with path.open("rb") as stream:
            if digest(stream) != (meta["object_sha256"], meta["object_bytes"]):
                raise ValueError("spool_corrupt")
        validate_csv(path, meta)
    return checkpoint


def validate_csv(path: Path, meta: dict[str, Any]) -> None:
    with gzip.open(path, "rb") as stream:
        if digest(stream) != (meta["csv_sha256"], meta["csv_bytes"]):
            raise ValueError("csv_corrupt")
    with gzip.open(path, "rt", encoding="utf-8", newline="") as stream:
        reader = csv.reader(stream, strict=True)
        if next(reader) != [row[0] for row in meta["schema"]]:
            raise ValueError("csv_header")
        count = 0
        for row in reader:
            if len(row) != len(meta["schema"]):
                raise ValueError("csv_shape")
            count += 1
        if count != meta["rows"]:
            raise ValueError("csv_count")


class RescueObjects:
    """Only create and read are reachable through this adapter."""

    def __init__(self, storage: BronzeStorage) -> None:
        self.__storage = storage
        self.created = False

    def ensure(self, path: Path, key: str, meta: dict[str, Any] | None = None) -> int:
        if not key.startswith("rescue/v1/facts/") or ".." in key or "\\" in key:
            raise ValueError("unsafe_key")
        with tempfile.TemporaryDirectory(dir=path.parent) as temporary:
            disposable = Path(temporary) / "upload"
            shutil.copyfile(path, disposable)
            try:
                self.__storage.put_if_absent(disposable, key)
                self.created = True
            except ObjectAlreadyExists:
                self.created = False
            downloaded = Path(temporary) / "readback"
            with (
                path.open("rb") as expected,
                self.__storage.open_stream(key) as actual,
                downloaded.open("wb") as output,
            ):
                size = 0
                hasher = hashlib.sha256()
                while block := expected.read(1024 * 1024):
                    remaining = block
                    while remaining:
                        received = actual.read(len(remaining))
                        if not received or not remaining.startswith(received):
                            raise ValueError("object_conflict")
                        size += len(received)
                        output.write(received)
                        hasher.update(received)
                        remaining = remaining[len(received) :]
                if actual.read(1):
                    raise ValueError("object_conflict")
            if meta is not None:
                if (hasher.hexdigest(), size) != (meta["object_sha256"], meta["object_bytes"]):
                    raise ValueError("object_corrupt")
                validate_csv(downloaded, meta)
            return size


def connect() -> Any:
    url = get_settings().DATABASE_URL
    if not url:
        raise ValueError("database_not_configured")
    parts = urlsplit(url)
    return psycopg.connect(
        urlunsplit(parts._replace(scheme="postgresql")),
        connect_timeout=5,
        autocommit=True,
        options="-c statement_timeout=1000 -c lock_timeout=1000",
    )


@contextmanager
def guarded(connection: Any, args: Any, *, deadline: float | None = None) -> Any:
    """Independent visibility monitor cancels only the exporting connection."""
    stop, failed, ready = threading.Event(), threading.Event(), threading.Event()
    monitor = connect()
    monitor.execute("SET statement_timeout = '1s'")
    visible = monitor.execute(
        "SELECT pg_has_role(current_user, 'pg_monitor', 'MEMBER') "
        "OR (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)"
    ).fetchone()[0]
    if not visible:
        monitor.close()
        raise ValueError("lock_visibility_required")
    pid = connection.info.backend_pid
    phase_end = deadline if deadline is not None else time.monotonic() + args.db_phase_s

    def cancel() -> None:
        failed.set()
        ready.set()
        try:
            connection.cancel_safe(timeout=2)
        except Exception:
            pass

    timer = threading.Timer(max(0, phase_end - time.monotonic()), cancel)
    timer.daemon = True

    def watch() -> None:
        try:
            while not stop.is_set():
                blocked = monitor.execute(
                    "SELECT EXISTS (SELECT FROM pg_stat_activity WHERE pid <> %s "
                    "AND %s = ANY(pg_blocking_pids(pid))) OR EXISTS (SELECT FROM pg_locks "
                    "WHERE NOT granted AND mode='AccessExclusiveLock' AND relation IN "
                    "('gold.fact_trip_delay_snapshot'::regclass, "
                    "'gold.fact_vehicle_snapshot'::regclass))",
                    (pid, pid),
                ).fetchone()[0]
                if blocked or time.monotonic() >= phase_end:
                    raise ValueError("interference_or_deadline")
                ready.set()
                stop.wait(0.2)
        except Exception:
            cancel()
        finally:
            ready.set()
            monitor.close()

    # Check visibility and queued locks before the first source query.
    thread = threading.Thread(target=watch, daemon=True)
    timer.start()
    thread.start()
    try:
        ready.wait()
        if failed.is_set():
            raise ValueError("interference_or_deadline")
        yield failed
        if failed.is_set():
            raise ValueError("interference_or_deadline")
    finally:
        stop.set()
        timer.cancel()
        thread.join(timeout=2)
        if thread.is_alive():
            raise ValueError("monitor_unavailable")


def inventory(connection: Any) -> list[Any]:
    result = []
    providers = connection.execute(
        "SELECT provider_id FROM core.providers ORDER BY provider_id"
    ).fetchall()
    for (provider,) in providers:
        for table in SCHEMAS:
            extrema = []
            for direction in ("ASC", "DESC"):
                row = connection.execute(
                    sql.SQL(
                        "SELECT captured_at_utc FROM gold.{} WHERE provider_id=%s "
                        "ORDER BY captured_at_utc {} LIMIT 1"
                    ).format(sql.Identifier(table), sql.SQL(direction)),
                    (provider,),
                ).fetchone()
                extrema.append(row[0].isoformat() if row else None)
            result.append(
                dict(provider=provider, table=table, minimum=extrema[0], maximum=extrema[1])
            )
    return result


def export(args: Any, identity: dict[str, Any], folder: Path) -> dict[str, Any]:
    metadata: dict[str, Any] = {}
    started = time.monotonic()
    with (
        connect() as connection,
        guarded(connection, args, deadline=started + args.db_phase_s) as failed,
    ):
        with connection.transaction():
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            connection.execute(
                "SELECT set_config('statement_timeout', %s, true)",
                (str(args.statement_timeout_s * 1000),),
            )
            for setting, value in dict(
                TimeZone="UTC",
                DateStyle="ISO, YMD",
                IntervalStyle="iso_8601",
                extra_float_digits="1",
                bytea_output="hex",
                client_encoding="UTF8",
                lock_timeout="1s",
                idle_in_transaction_session_timeout="15s",
                work_mem="16MB",
                max_parallel_workers_per_gather="0",
            ).items():
                connection.execute("SELECT set_config(%s, %s, true)", (setting, value))
            now, version = connection.execute(
                "SELECT clock_timestamp(), current_setting('server_version')"
            ).fetchone()
            bounds(args, now)
            ranges = inventory(connection)
            if args.inventory:
                return dict(snapshot_time=now.isoformat(), ranges=ranges)
            for table in SCHEMAS:
                remaining = args.db_phase_s - (time.monotonic() - started)
                if failed.is_set() or remaining <= 0:
                    raise ValueError("database_deadline")
                connection.execute(
                    "SELECT set_config('statement_timeout', %s, true)",
                    (str(int(min(args.statement_timeout_s, remaining) * 1000)),),
                )
                metadata[table] = copy_fact_table(
                    connection,
                    table=table,
                    provider_id=identity["provider"],
                    start_utc=stamp(identity["start"]),
                    end_utc=stamp(identity["end"]),
                    destination=folder / (table + ".csv.partial"),
                )
                observed = next(
                    row
                    for row in ranges
                    if row["table"] == table and row["provider"] == identity["provider"]
                )
                oldest = observed["minimum"]
                metadata[table]["leading_interval_unobserved"] = (
                    [identity["start"], min(oldest, identity["end"])]
                    if oldest is not None and oldest > identity["start"]
                    else None
                )
                metadata[table]["coverage"] = "emergency_snapshot_completeness_unknown"
    # No compression or object I/O holds a source transaction or connection open.
    for table, meta in metadata.items():
        (folder / (table + ".csv.partial")).rename(folder / (table + ".csv"))
        compressed = compress(folder / (table + ".csv"))
        if any(meta[key] != compressed[key] for key in ("csv_sha256", "csv_bytes")):
            raise ValueError("csv_changed")
        if meta["copy_rows"] >= 0 and meta["copy_rows"] != compressed["rows"]:
            raise ValueError("copy_count_mismatch")
        meta.update(compressed)
        validate_csv(folder / (table + ".csv.gz"), meta)
    checkpoint = dict(
        **identity,
        tables=metadata,
        snapshot_time=now.isoformat(),
        server_version=version,
        ranges=ranges,
        retention_days=get_settings().GOLD_FACT_RETENTION_DAYS,
    )
    with (folder / "checkpoint.json").open("xb") as output:
        output.write(encoded(checkpoint))
    return checkpoint


def publish(checkpoint: dict[str, Any], folder: Path) -> dict[str, Any]:
    scope, size, uploaded, outcomes = history_storage(), 0, 0, {}
    started = time.monotonic()
    try:
        objects = RescueObjects(scope.resolve("s3"))
        receipt = {
            key: value
            for key, value in checkpoint.items()
            if key not in ("snapshot_time", "server_version", "ranges", "tables", "retention_days")
        }
        receipt["tables"] = {}
        for table, meta in checkpoint["tables"].items():
            key = checkpoint["prefix"] + table + ".csv.gz"
            size += objects.ensure(folder / (table + ".csv.gz"), key, meta)
            uploaded += meta["object_bytes"] if objects.created else 0
            outcomes[table] = "created_readback" if objects.created else "equal_collision_readback"
            receipt["tables"][table] = {k: v for k, v in meta.items() if not k.endswith("_seconds")}
            receipt["tables"][table]["key"] = key
        with tempfile.TemporaryDirectory(dir=folder) as temporary:
            path = Path(temporary) / "receipt.json"
            path.write_bytes(encoded(receipt))
            size += objects.ensure(path, checkpoint["prefix"] + "receipt.json")
        return dict(
            object_get_bytes=size,
            compressed_upload_bytes=uploaded,
            outcomes=outcomes,
            upload_readback_seconds=time.monotonic() - started,
        )
    finally:
        scope.close()


def main(argv: list[str] | None = None) -> int:
    phase, args = "arguments", None
    started = time.monotonic()
    try:
        args = parser().parse_args(argv)
        identity = bounds(args, datetime.now(UTC))
    except ValueError as error:
        refused = str(error) in {"insufficient_budget", "day_not_closed"}
        print(json.dumps(dict(phase=phase, reason=str(error) if refused else "invalid_arguments")))
        return 1 if refused else 2
    lock = Path(tempfile.gettempdir()) / "transit-ls04-rescue.lock"
    owned = False
    try:
        phase = "process_lock"
        lock.mkdir()
        owned = True
        folder = Path(args.spool_dir) if args.spool_dir else Path(tempfile.gettempdir())
        if not args.inventory:
            folder.mkdir(parents=True, exist_ok=True)
        phase = "resume" if (folder / "checkpoint.json").exists() else "export"
        reused = phase == "resume"
        if not reused and not args.inventory and any(folder.iterdir()):
            raise ValueError("incomplete_spool")
        checkpoint = resume(folder, identity) if reused else export(args, identity, folder)
        phase = "upload_readback"
        object_report = publish(checkpoint, folder) if args.upload else {}
        print(
            json.dumps(
                dict(
                    outcome="readback_complete" if args.upload else "local_complete",
                    reused_spool=reused,
                    checkpoint=checkpoint,
                    object_io=object_report,
                    script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                    command=[sys.executable, "scripts/rescue_fact_day.py", *(argv or sys.argv[1:])],
                    started_at=datetime.fromtimestamp(
                        time.time() - (time.monotonic() - started), UTC
                    ).isoformat(),
                    ended_at=datetime.now(UTC).isoformat(),
                    statement_timeout_s=args.statement_timeout_s,
                    db_phase_s=args.db_phase_s,
                    total_seconds=time.monotonic() - started,
                )
            )
        )
        return 0
    except Exception:
        print(
            json.dumps(
                dict(
                    phase=phase, provider=args.provider, date=args.date, reason="refused_or_failed"
                )
            )
        )
        return 1
    finally:
        if owned:
            lock.rmdir()


if __name__ == "__main__":
    sys.exit(main())
