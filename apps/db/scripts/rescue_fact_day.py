"""One provider-day emergency snapshot. Production invocations require owner approval."""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import re
import shutil
import signal
import sys
import tempfile
import threading
import time
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

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
_interruption = threading.local()


def request_interrupt(*unused: Any) -> None:
    _interruption.pending = True


def check_interrupt() -> None:
    if getattr(_interruption, "pending", False):
        raise KeyboardInterrupt


@contextmanager
def deferred_signals() -> Any:
    previous = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
    _interruption.pending = False
    try:
        for sig in previous:
            signal.signal(sig, request_interrupt)
        yield
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        _interruption.pending = False


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


def bounds(args: Any, now: datetime, *, new_export: bool = True) -> dict[str, Any]:
    deadline = stamp(args.not_after)
    if not (1 <= args.statement_timeout_s <= 900 and 1 <= args.db_phase_s <= 1800):
        raise ValueError("invalid_timeout")
    if deadline.hour != 5 or deadline.minute != 45 or deadline.second or deadline.microsecond:
        raise ValueError("invalid_deadline")
    if new_export and now + timedelta(seconds=args.db_phase_s) >= deadline:
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
        if not start < end <= start + timedelta(days=1):
            raise ValueError("invalid_asof")
        if new_export and (day != now.date() or end > now):
            raise ValueError("invalid_asof")
    elif new_export and now < utc_day_closes_at(day):
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
                check_interrupt()
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
    partial = target.with_suffix(".gz.partial")
    with source.open("rb") as stream, partial.open("xb") as output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=output, compresslevel=9, mtime=0) as gz:
            shutil.copyfileobj(stream, gz)
    try:
        target.hardlink_to(partial)
    except FileExistsError:
        with target.open("rb") as old, partial.open("rb") as new:
            if digest(old) != digest(new):
                raise ValueError("spool_corrupt") from None
    partial.unlink()
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


def read_record(folder: Path, identity: dict[str, Any], name: str) -> dict[str, Any]:
    checkpoint = cast(dict[str, Any], json.loads((folder / name).read_bytes()))
    if any(checkpoint.get(key) != value for key, value in identity.items()):
        raise ValueError("checkpoint_bounds")
    if set(checkpoint["tables"]) != set(SCHEMAS):
        raise ValueError("incomplete_checkpoint")
    for table, meta in checkpoint["tables"].items():
        if (
            meta["schema"] != SCHEMAS[table]
            or meta["schema_sha256"] != hashlib.sha256(encoded(SCHEMAS[table])).hexdigest()
        ):
            raise ValueError("schema_drift")
    return checkpoint


def resume(folder: Path, identity: dict[str, Any]) -> dict[str, Any]:
    checkpoint = read_record(folder, identity, "checkpoint.json")
    for table, meta in checkpoint["tables"].items():
        path = folder / (table + ".csv.gz")
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
        application_name="transit-ls04-rescue-" + uuid4().hex,
        options="-c statement_timeout=1000 -c lock_timeout=1000",
    )


class GuardedSource:
    """Reject every later statement and stream read once interference is observed."""

    def __init__(self, source: Any, failed: threading.Event) -> None:
        self.source, self.failed, self.info = source, failed, source.info

    def check(self) -> None:
        if self.failed.is_set():
            raise ValueError("interference_or_deadline")

    def prove_visibility(self) -> None:
        for table in SCHEMAS:
            self.execute(sql.SQL("SELECT 1 FROM gold.{} LIMIT 0").format(sql.Identifier(table)))
        observer = connect()
        try:
            # Demonstrated visibility of ordinary read locks, independent of role membership.
            visible = observer.execute(
                "SELECT EXISTS (SELECT FROM pg_stat_activity WHERE pid=%s) AND "
                "(SELECT count(DISTINCT relation) FROM pg_locks WHERE pid=%s AND granted "
                "AND mode='AccessShareLock' AND relation IN "
                "('gold.fact_trip_delay_snapshot'::regclass, "
                "'gold.fact_vehicle_snapshot'::regclass))=2",
                (self.info.backend_pid,) * 2,
            ).fetchone()[0]
            if not visible:
                raise ValueError("lock_visibility_required")
        finally:
            observer.close()

    def execute(self, *args: Any, **kwargs: Any) -> Any:
        self.check()
        result = self.source.execute(*args, **kwargs)
        self.check()
        return result

    @contextmanager
    def transaction(self) -> Any:
        self.check()
        with self.source.transaction():
            yield
            self.check()

    @contextmanager
    def cursor(self) -> Any:
        self.check()
        with self.source.cursor() as cursor:
            yield GuardedCursor(cursor, self)


class GuardedCursor:
    def __init__(self, cursor: Any, source: GuardedSource) -> None:
        self.cursor, self.source = cursor, source

    @property
    def rowcount(self) -> int:
        self.source.check()
        return int(self.cursor.rowcount)

    def blocks(self, copy: Any) -> Any:
        while True:
            self.source.check()
            block = copy.read()
            self.source.check()
            if not block:
                return
            yield block

    @contextmanager
    def copy(self, *args: Any) -> Any:
        self.source.check()
        with self.cursor.copy(*args) as copy:
            yield self.blocks(copy)
            self.source.check()


def terminate_self(controller: Any, pid: int, backend_start: Any, application_name: str) -> None:
    row = controller.execute(
        "SELECT pg_terminate_backend(pid, 500) FROM pg_stat_activity "
        "WHERE pid=%s AND backend_start=%s AND application_name=%s "
        "AND usename=current_user AND xact_start IS NOT NULL",
        (pid, backend_start, application_name),
    ).fetchone()
    if row is not None and not row[0]:
        raise ValueError("self_termination_failed")


@contextmanager
def guarded(connection: Any, args: Any, *, deadline: float | None = None) -> Any:
    """Independent visibility monitor cancels only the exporting connection."""
    stop, failed, ready = threading.Event(), threading.Event(), threading.Event()
    monitor = connect()
    monitor.execute("SET statement_timeout = '1s'")
    terminator = connect()
    terminator.execute("SET statement_timeout = '1s'")
    pid = connection.info.backend_pid
    identity = monitor.execute(
        "SELECT backend_start, application_name FROM pg_stat_activity WHERE pid=%s "
        "AND usename=current_user",
        (pid,),
    ).fetchone()
    if (
        not identity
        or len(identity) != 2
        or not identity[0]
        or not re.fullmatch(r"transit-ls04-rescue-[0-9a-f]{32}", identity[1])
    ):
        monitor.close()
        terminator.close()
        raise ValueError("backend_identity_unavailable")
    phase_end = deadline if deadline is not None else time.monotonic() + args.db_phase_s
    terminating = threading.Lock()
    protected = GuardedSource(connection, failed)

    def cancel() -> None:
        with terminating:
            if stop.is_set() or failed.is_set():
                return
            failed.set()
            try:
                connection.cancel_safe(timeout=2)
            except Exception:
                pass
            # Only our captured exporting pid is signalled, through an independent connection.
            # No source driver lock: <=2 s cancel + .25 s grace + 1 s primary statement
            # + 5 s fallback connect + 1 s fallback statement: under 10 seconds.
            time.sleep(0.25)
            try:
                terminate_self(terminator, pid, *identity)
            except Exception:
                recovery = connect()
                try:
                    terminate_self(recovery, pid, *identity)
                finally:
                    recovery.close()
            finally:
                ready.set()

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
        yield protected
        protected.check()
    finally:
        with terminating:
            stop.set()
            timer.cancel()
        timer.join()
        thread.join()
        terminator.close()


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
    args.completed_tables = set()
    observations: dict[str, Any] = {}
    started = time.monotonic()
    with (
        connect() as source,
        guarded(source, args, deadline=started + args.db_phase_s) as connection,
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
            connection.prove_visibility()
            ranges = inventory(connection)
            if args.inventory:
                return dict(snapshot_time=now.isoformat(), ranges=ranges)
            for table in SCHEMAS:
                check_interrupt()
                remaining = args.db_phase_s - (time.monotonic() - started)
                connection.check()
                if remaining <= 0:
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
                args.completed_tables.add(table)
                observed = next(
                    row
                    for row in ranges
                    if row["table"] == table and row["provider"] == identity["provider"]
                )
                oldest = observed["minimum"]
                observations[table] = (
                    [identity["start"], min(oldest, identity["end"])]
                    if oldest is not None and oldest > identity["start"]
                    else None
                )
                metadata[table]["coverage"] = "emergency_snapshot_completeness_unknown"
    # No compression or object I/O holds a source transaction or connection open.
    checkpoint = dict(
        **identity,
        tables=metadata,
        snapshot_time=now.isoformat(),
        server_version=version,
        ranges=ranges,
        run_observations=dict(leading_interval_unobserved=observations),
        retention_days=get_settings().GOLD_FACT_RETENTION_DAYS,
    )
    write_record(folder, "export.json", checkpoint)
    return finalize(folder, identity)


def write_record(folder: Path, name: str, record: dict[str, Any]) -> None:
    partial = folder / (name + ".partial")
    with partial.open("xb") as output:
        output.write(encoded(record))
    (folder / name).hardlink_to(partial)
    partial.unlink()


def finalize(folder: Path, identity: dict[str, Any]) -> dict[str, Any]:
    checkpoint = read_record(folder, identity, "export.json")
    check_interrupt()
    for table in SCHEMAS:
        partial, source = folder / (table + ".csv.partial"), folder / (table + ".csv")
        if not source.exists():
            partial.rename(source)
    check_interrupt()
    for table, meta in checkpoint["tables"].items():
        source = folder / (table + ".csv")
        with source.open("rb") as stream:
            if digest(stream) != (meta["csv_sha256"], meta["csv_bytes"]):
                raise ValueError("csv_changed")
        compressed = compress(source)
        if any(meta[key] != compressed[key] for key in ("csv_sha256", "csv_bytes")):
            raise ValueError("csv_changed")
        if meta["copy_rows"] >= 0 and meta["copy_rows"] != compressed["rows"]:
            raise ValueError("copy_count_mismatch")
        meta.update(
            {
                key: value
                for key, value in compressed.items()
                if key not in ("csv_sha256", "csv_bytes")
            }
        )
        validate_csv(folder / (table + ".csv.gz"), meta)
    write_record(folder, "checkpoint.json", checkpoint)
    check_interrupt()
    return checkpoint


def publish(checkpoint: dict[str, Any], folder: Path) -> dict[str, Any]:
    scope, size, uploaded, outcomes = history_storage(), 0, 0, {}
    started = time.monotonic()
    try:
        objects = RescueObjects(scope.resolve("s3"))
        receipt = {
            key: checkpoint[key]
            for key in ("format_version", "provider", "day", "start", "end", "prefix", "status")
        }
        receipt["tables"] = {}
        for table, meta in checkpoint["tables"].items():
            key = checkpoint["prefix"] + table + ".csv.gz"
            size += objects.ensure(folder / (table + ".csv.gz"), key, meta)
            uploaded += meta["object_bytes"] if objects.created else 0
            outcomes[table] = "created_readback" if objects.created else "equal_collision_readback"
            receipt["tables"][table] = {
                k: meta[k]
                for k in (
                    "schema",
                    "schema_sha256",
                    "rows",
                    "csv_sha256",
                    "csv_bytes",
                    "object_sha256",
                    "object_bytes",
                )
            }
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


def recover_pending(folder: Path, identity: dict[str, Any]) -> None:
    for name in ("export.json", "checkpoint.json"):
        pending = folder / (name + ".partial")
        if not pending.exists() or (folder / name).exists():
            continue
        record = read_record(folder, identity, pending.name)
        for table, meta in record["tables"].items():
            path = folder / (table + (".csv.gz" if name == "checkpoint.json" else ".csv"))
            if name == "export.json" and not path.exists():
                path = folder / (table + ".csv.partial")
            with path.open("rb") as stream:
                kind = "object" if name == "checkpoint.json" else "csv"
                if digest(stream) != (meta[kind + "_sha256"], meta[kind + "_bytes"]):
                    raise ValueError("spool_corrupt")
            if name == "checkpoint.json":
                validate_csv(path, meta)
        (folder / name).hardlink_to(pending)
        pending.unlink()


def main(argv: list[str] | None = None) -> int:
    with deferred_signals():
        return run(argv)


def run(argv: list[str] | None = None) -> int:
    phase, args = "arguments", None
    started = time.monotonic()
    try:
        args = parser().parse_args(argv)
        folder = Path(args.spool_dir) if args.spool_dir else Path(tempfile.gettempdir())
        reused = not args.inventory and any(
            (folder / name).exists()
            for name in (
                "checkpoint.json",
                "export.json",
                "checkpoint.json.partial",
                "export.json.partial",
            )
        )
        identity = bounds(args, datetime.now(UTC), new_export=not reused)
    except ValueError as error:
        refused = str(error) in {"insufficient_budget", "day_not_closed"}
        print(json.dumps(dict(phase=phase, reason=str(error) if refused else "invalid_arguments")))
        return 1 if refused else 2
    except KeyboardInterrupt:
        print(json.dumps(dict(phase=phase, reason="interrupted")))
        return 1
    lock = Path(tempfile.gettempdir()) / "transit-ls04-rescue.lock"
    owned = False
    export_started = False
    try:
        phase = "process_lock"
        lock.mkdir()
        owned = True
        if not args.inventory:
            folder.mkdir(parents=True, exist_ok=True)
        phase = "resume" if reused else "export"
        if reused:
            recover_pending(folder, identity)
        if not reused and not args.inventory and any(folder.iterdir()):
            remaining = [p for p in folder.iterdir() if not p.name.startswith("abandoned-")]
            if any(p.name not in {t + ".csv.partial" for t in SCHEMAS} for p in remaining):
                raise ValueError("incomplete_spool")
            if remaining:
                archive = Path(tempfile.mkdtemp(prefix="abandoned-", dir=folder))
                for path in remaining:
                    path.rename(archive / path.name)
        export_started = not reused and not args.inventory
        if reused:
            finish = resume if (folder / "checkpoint.json").exists() else finalize
            checkpoint = finish(folder, identity)
        else:
            checkpoint = export(args, identity, folder)
        phase = "upload_readback"
        check_interrupt()
        object_report = publish(checkpoint, folder) if args.upload else {}
        check_interrupt()
        print(
            json.dumps(
                dict(
                    outcome="readback_complete" if args.upload else "local_complete",
                    reused_spool=reused,
                    queried_postgres=not reused,
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
    except (Exception, KeyboardInterrupt) as error:
        interrupted = isinstance(error, KeyboardInterrupt)
        if interrupted and (export_started or reused):
            for name in (
                table + suffix
                for table in SCHEMAS
                for suffix in (".csv.partial", ".csv.gz.partial")
                if suffix != ".csv.partial"
                or (
                    not (folder / "export.json").exists()
                    and table not in getattr(args, "completed_tables", set())
                )
            ):
                (folder / name).unlink(missing_ok=True)
        print(
            json.dumps(
                dict(
                    phase=phase,
                    provider=args.provider,
                    date=args.date,
                    reason="interrupted" if interrupted else "refused_or_failed",
                )
            )
        )
        return 1
    finally:
        if owned:
            lock.rmdir()


if __name__ == "__main__":
    sys.exit(main())
