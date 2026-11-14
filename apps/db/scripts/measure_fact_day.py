"""Dormant closed-day measurement; production reads require separate owner approval."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import signal
import socket
import sys
import tempfile
import threading
import time
import tracemalloc
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from subprocess import PIPE, Popen, TimeoutExpired
from types import SimpleNamespace
from typing import Any

import duckdb

from transit_ops.history.probe import peak_rss  # type: ignore[import-untyped]

HOST = sys.platform + ":" + socket.gethostname()
RECOVERY_ERRORS = (
    "scratch_ownership_invalid scratch_owner_proof_unavailable "
    "scratch_cleanup_failed scratch_recovery_incomplete"
).split()

_spec = importlib.util.spec_from_file_location(
    "fact_measurement_rescue", Path(__file__).with_name("rescue_fact_day.py")
)
assert _spec and _spec.loader
rescue = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rescue)
TRIP, VEHICLE = rescue.SCHEMAS
ORDERS = {
    TRIP: "route_id trip_id start_date captured_at_utc realtime_snapshot_id entity_index".split(),
    VEHICLE: ["vehicle_id", "captured_at_utc", "realtime_snapshot_id", "entity_index"],
}


def local_connection(folder: Path) -> Any:
    conn = duckdb.connect(
        ":memory:",
        config={
            "threads": "1",
            "memory_limit": "512MiB",
            "max_temp_directory_size": "2GiB",
            "temp_directory": str(folder / "spill"),
            "autoinstall_known_extensions": "false",
            "autoload_known_extensions": "false",
            "default_collation": "binary",
        },
    )
    try:
        conn.execute("LOAD icu")
        conn.execute("SET TimeZone='UTC'")
    except Exception as error:
        conn.close()
        raise ValueError("bundled_timezone_unavailable") from error
    return conn


def load_csv(conn: Any, folder: Path, table: str) -> None:
    columns = {n: t for n, t, _ in rescue.SCHEMAS[table]}
    conn.read_csv(
        str(folder / (table + ".csv")),
        columns=columns,
        header=True,
        auto_detect=False,
        na_values="",
        allow_quoted_nulls=False,
    ).create(table)


def consume(cursor: Any) -> dict[str, Any]:
    count, digest = 0, hashlib.sha256()
    while rows := cursor.fetchmany(1024):
        for row in rows:
            digest.update(
                json.dumps(row, default=str, ensure_ascii=False, separators=(",", ":")).encode()
                + b"\n"
            )
            count += 1
    return dict(rows=count, sha256=digest.hexdigest())


def timed_query(conn: Any, query: str, params: Any = None) -> dict[str, Any]:
    started = time.monotonic()
    result = consume(conn.execute(query, params))
    result["seconds"] = time.monotonic() - started
    return result


def queries(conn: Any) -> list[dict[str, Any]]:
    trip = conn.execute(
        f"SELECT trip_id FROM {TRIP} WHERE trip_id IS NOT NULL ORDER BY trip_id LIMIT 1"
    ).fetchone()
    outcome = ("empty_string" if trip[0] == "" else "selected") if trip else "null_only"
    if not trip and not conn.execute(f"SELECT 1 FROM {TRIP} LIMIT 1").fetchone():
        outcome = "no_rows"
    definitions = [
        f"SELECT route_id, CAST(date_trunc('hour', captured_at_utc) AS VARCHAR), "
        f"quantile_cont(delay_seconds, 0.9) FROM {TRIP} GROUP BY 1,2 ORDER BY 1,2",
        "SELECT CAST(date_trunc('hour', captured_at_utc) AS VARCHAR), "
        "count(DISTINCT vehicle_id) "
        f"FROM {VEHICLE} GROUP BY 1 ORDER BY 1",
        f"SELECT * REPLACE (CAST(captured_at_utc AS VARCHAR) AS captured_at_utc, "
        f"CAST(feed_timestamp_utc AS VARCHAR) AS feed_timestamp_utc) FROM {TRIP} "
        "WHERE trip_id = ? ORDER BY captured_at_utc, "
        "realtime_snapshot_id, entity_index",
    ]
    result = []
    for index, query in enumerate(definitions):
        params = [trip[0] if trip else None] if index == 2 else None
        first, warm = timed_query(conn, query, params), timed_query(conn, query, params)
        first.update(definition=query, units="seconds; delay_seconds", cache_state="uncontrolled")
        first.update({f"warm_{key}": warm[key] for key in ("seconds", "sha256")})
        result.append(first)
    result[-1]["trip_outcome"] = outcome
    return result


def candidate(conn: Any, folder: Path, table: str, level: int, order: str, group: int) -> Any:
    path = folder / "candidate.parquet"
    columns = rescue.PK if order == "primary" else ORDERS[table]
    sort = ", ".join(name + " ASC NULLS LAST" for name in columns)
    started = time.monotonic()
    try:
        conn.execute(
            f"COPY (SELECT * FROM {table} ORDER BY {sort}) TO ? "
            f"(FORMAT PARQUET, COMPRESSION ZSTD, COMPRESSION_LEVEL {level}, "
            f"ROW_GROUP_SIZE {group})",
            [str(path)],
        )
        written = time.monotonic() - started
        started = time.monotonic()
        conn.read_parquet(str(path)).create_view("candidate")
        count = conn.execute("SELECT count(*) FROM candidate").fetchone()[0]
        different = conn.execute(
            f"SELECT EXISTS ((SELECT * FROM {table} EXCEPT ALL "
            "SELECT * FROM candidate) UNION ALL (SELECT * FROM candidate "
            f"EXCEPT ALL SELECT * FROM {table}))"
        ).fetchone()[0]
        if different or count != conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]:
            raise ValueError("parquet_row_mismatch")
        verified = time.monotonic() - started
        groups = conn.execute(
            "SELECT DISTINCT row_group_id, row_group_num_rows FROM parquet_metadata(?) ORDER BY 1",
            [str(path)],
        ).fetchall()
        with path.open("rb") as stream:
            digest, size = rescue.digest(stream)
        return dict(
            level=level,
            order=order,
            requested_row_group_rows=group,
            actual_row_group_rows=[row[1] for row in groups],
            rows=count,
            bytes=size,
            sha256=digest,
            write_seconds=written,
            verification_seconds=verified,
        )
    finally:
        conn.execute("DROP VIEW IF EXISTS candidate")
        path.unlink(missing_ok=True)


def codecs(conn: Any, folder: Path, table: str) -> dict[str, Any]:
    source = folder / (table + ".csv")
    compressed = rescue.compress(source)
    source.with_suffix(".csv.gz").unlink()
    candidates = [
        candidate(conn, folder, table, level, order, group)
        for level in (3, 9, 19)
        for order in ("primary", "analytical")
        for group in (122880, 1048576)
    ]
    return dict(
        csv_bytes=compressed["csv_bytes"],
        csv_sha256=compressed["csv_sha256"],
        gzip_bytes=compressed["object_bytes"],
        gzip_seconds=compressed["compress_seconds"],
        gzip_level=9,
        parquet=candidates,
        text_order="binary",
        null_order="last",
    )


def read_source(args: Any, folder: Path) -> dict[str, Any]:
    started = time.monotonic()
    with rescue.connect() as source, rescue.guarded(source, args) as conn:
        with conn.transaction():
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            conn.execute("""SET LOCAL TimeZone='UTC'; SET LOCAL DateStyle='ISO, YMD';
                SET LOCAL IntervalStyle='iso_8601'; SET LOCAL extra_float_digits=1;
                SET LOCAL bytea_output='hex'; SET LOCAL client_encoding='UTF8';
                SET LOCAL lock_timeout='1s'; SET LOCAL idle_in_transaction_session_timeout='15s';
                SET LOCAL work_mem='16MB'; SET LOCAL max_parallel_workers_per_gather=0;
                SET LOCAL statement_timeout='60s'""")
            now, version = conn.execute(
                "SELECT clock_timestamp(), current_setting('server_version')"
            ).fetchone()
            identity = rescue.bounds(args, now)
            conn.prove_visibility()
            provider = conn.execute(
                "SELECT timezone FROM gold.dim_provider WHERE provider_id=%s", (args.provider,)
            ).fetchone()
            if not provider:
                raise ValueError("provider_not_declared")
            tables = {
                table: rescue.copy_fact_table(
                    conn,
                    table=table,
                    provider_id=args.provider,
                    start_utc=rescue.stamp(identity["start"]),
                    end_utc=rescue.stamp(identity["end"]),
                    destination=folder / (table + ".csv"),
                )
                for table in rescue.SCHEMAS
            }
    return dict(
        **identity,
        timezone=provider[0],
        tables=tables,
        server_version=version,
        database_read_seconds=time.monotonic() - started,
        snapshot_time=now.isoformat(),
    )


def measure(args: Any) -> dict[str, Any]:
    tracing = tracemalloc.is_tracing()
    if not tracing:
        tracemalloc.start()
    try:
        with tempfile.TemporaryDirectory(prefix="transit-measure-") as directory:
            folder = Path(directory)
            args.spool_dir = directory
            report = read_source(args, folder)
            with local_connection(folder) as conn:
                for table in rescue.SCHEMAS:
                    load_csv(conn, folder, table)
                    report["tables"][table]["codecs"] = codecs(conn, folder, table)
                report["queries"] = queries(conn)
            rss, reason = peak_rss()
            report.update(
                duckdb_version=duckdb.__version__,
                python_version=sys.version.split()[0],
                python_traced_peak_bytes=tracemalloc.get_traced_memory()[1],
                memory_basis="Python traced peak excludes native allocations; process lifetime RSS",
                native_peak_rss_bytes=rss,
                native_peak_rss_reason=reason,
                family_comparison="pending_second_change",
            )
            return report
    finally:
        if not tracing:
            tracemalloc.stop()


def options(argv: list[str] | None = None) -> Any:
    parser = rescue.SafeParser(description=__doc__)
    for name in ("provider", "date", "not-after"):
        parser.add_argument("--" + name, required=True)
    return SimpleNamespace(
        **vars(parser.parse_args(argv)),
        statement_timeout_s=60,
        db_phase_s=180,
        inventory=False,
        as_of=None,
        spool_dir="temporary",
    )


WORKER = (
    "import runpy,sys,tempfile; tempfile.tempdir=sys.argv[2]; "
    "n=runpy.run_path(sys.argv[1]); sys.exit(n['main'](sys.argv[3:],worker=True))"
)
BOOT = (
    "import runpy,sys; n=runpy.run_path(sys.argv[1]); code=sys.argv.pop(4); "
    "proof=sys.argv.pop(3); n['lifeline'](sys.argv[2],proof); exec(code)"
)


def process_birth(pid: int) -> str | None:
    if sys.platform == "linux":
        boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        try:
            fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
            return None if fields[0] == "Z" else HOST + "@" + boot + ":" + fields[19]
        except FileNotFoundError:
            return None
    if sys.platform != "win32":
        raise OSError("process identity unavailable")
    import ctypes as c

    api = c.WinDLL("kernel32", use_last_error=True)
    api.OpenProcess.restype = c.c_void_p
    handle = api.OpenProcess(0x101000, False, pid)
    if not handle:
        if c.get_last_error() == 87:
            return None
        raise OSError("process identity unavailable")
    try:
        state = api.WaitForSingleObject(c.c_void_p(handle), 0)
        if state == 0:
            return None
        stamps = [c.c_ulonglong() for _ in range(4)]
        if state != 258 or not api.GetProcessTimes(c.c_void_p(handle), *map(c.byref, stamps)):
            raise OSError("process identity unavailable")
        return HOST + "@" + str(stamps[0].value)
    finally:
        api.CloseHandle(c.c_void_p(handle))


def owner(root: Path) -> dict[str, Any] | None:
    marker = root / ".owner"
    if root.is_symlink() or root.resolve() != root or marker.is_symlink() or not marker.is_file():
        return None
    try:
        data = json.loads(marker.read_text(encoding="utf-8"))
        pid, start, proof = data.get("pid"), data.get("start"), data.get("invocation")
        if (
            data.get("path") == str(root)
            and type(pid) is int
            and 0 < pid < 2**31
            and isinstance(proof, str)
            and len(proof) == 32
            and (start is None or isinstance(start, str) and start.startswith(HOST + "@"))
        ):
            return data
    except (ValueError, UnicodeError, AttributeError):
        pass
    return None


def write_owner(root: Path, data: dict[str, Any]) -> None:
    if root.is_symlink() or root.resolve() != root:
        raise ValueError("scratch_ownership_invalid")
    try:
        part = root / (".owner-" + os.urandom(8).hex())
        with part.open("x", encoding="utf-8") as stream:
            json.dump(data, stream)
        part.replace(root / ".owner")
    except OSError:
        raise ValueError("scratch_cleanup_failed", str(root)) from None


def remove_scratch(root: Path, proof: str, *, keep: bool = False) -> bool:
    deadline = time.monotonic() + (0.2 if keep else 2)
    while root.exists():
        try:
            data = owner(root)
            if data is None or data["invocation"] != proof:
                raise ValueError("scratch_ownership_invalid")
            for path in root.iterdir():
                if path.name != ".owner":
                    if path.is_dir() and not path.is_symlink():
                        shutil.rmtree(path)
                    else:
                        path.unlink()
            if not keep:
                (root / ".owner").unlink()
                try:
                    root.rmdir()
                except OSError:
                    write_owner(root, data)
                    raise
            return not keep
        except OSError:
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.05)
    return True


def sweep(parent: Path) -> dict[str, list[str]]:
    eligible = []
    root = None
    try:
        if process_birth(os.getpid()) is None:
            raise OSError("process identity unavailable")
        for root in parent.glob("transit-measure-*"):
            data = owner(root)
            if data is not None:
                birth = process_birth(data["pid"])
                if birth is None or data.get("start") is not None and birth != data["start"]:
                    eligible.append((root, data["invocation"]))
    except OSError:
        raise ValueError("scratch_owner_proof_unavailable", root) from None
    swept: list[str] = []
    left: list[str] = []
    for root, proof in eligible:
        try:
            removed = remove_scratch(root, proof)
        except (OSError, ValueError):
            removed = False
        (swept if removed else left).append(str(root))
    return dict(swept_paths=swept, leftover_paths=left)


@contextmanager
def scratch(parent: Path) -> Any:
    birth = process_birth(os.getpid())
    if birth is None:
        raise ValueError("scratch_owner_proof_unavailable")
    proof = os.urandom(16).hex()
    root = Path(tempfile.mkdtemp(prefix="transit-measure-", dir=parent)).resolve()
    write_owner(root, dict(invocation=proof, path=str(root), pid=os.getpid(), start=birth))
    try:
        yield root, proof
    finally:
        if root.exists() and not remove_scratch(root, proof):
            raise ValueError("scratch_cleanup_failed", str(root))


def lifeline(directory: str, proof: str) -> None:
    root, marker = Path(directory), Path(directory) / ".owner"
    if root.is_symlink() or marker.is_symlink() or root.resolve() != root:
        raise ValueError("scratch_ownership_invalid")
    data = json.loads(marker.read_text(encoding="utf-8"))
    if (data.get("invocation"), data.get("path")) != (proof, str(root)):
        raise ValueError("scratch_ownership_invalid")
    os.set_blocking(0, False)

    def watch() -> None:
        while True:
            try:
                os.read(0, 1)
            except BlockingIOError:
                time.sleep(0.2)
                continue
            try:
                remove_scratch(root, proof, keep=True)
            finally:
                try:
                    if root.exists():
                        os.write(
                            2,
                            (
                                json.dumps(dict(status="failed", leftover_paths=[str(root)])) + "\n"
                            ).encode(),
                        )
                finally:
                    os._exit(1)

    threading.Thread(target=watch, daemon=True).start()


def _supervise(
    argv: list[str], worker: str, scratch_root: Path, recovery: dict[str, list[str]]
) -> tuple[int, str]:
    status, previous, root = [], {}, None
    try:
        for name in ("SIGINT", "SIGTERM", "SIGBREAK"):
            if hasattr(signal, name):
                number = getattr(signal, name)
                previous[number] = signal.signal(number, lambda n, f: status.append(128 + n))
        recovery.update(sweep(scratch_root))
        if status or recovery["leftover_paths"]:
            return (status[0] if status else 1), ""
        with scratch(scratch_root) as (root, proof):
            with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as report:
                script, base = str(Path(__file__).resolve()), vars(sys)["_base_executable"]
                windows = sys.platform == "win32" and sys.executable != base
                executable = base if windows else sys.executable
                env = {**os.environ, "__PYVENV_LAUNCHER__": sys.executable} if windows else None
                payload = [str(root), proof, worker, *argv]
                command = [executable, "-I", "-c", BOOT, script, *payload]
                process = Popen(command, stdin=PIPE, stdout=report, env=env)
                assert process.stdin is not None
                try:
                    while not status:
                        try:
                            process.wait(timeout=0.2)
                            break
                        except TimeoutExpired:
                            pass
                finally:
                    try:
                        if process.poll() is None:
                            process.terminate()
                            try:
                                process.wait(timeout=2)
                            except TimeoutExpired:
                                process.kill()
                                process.wait(timeout=2)
                    finally:
                        process.stdin.close()
                report.seek(0)
                stdout = "" if status else report.read()
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)
    code = status[0] if status else process.wait()
    return (code if code >= 0 else 128 - code), (
        stdout or '{"status":"failed","reason":"measurement_failed"}\n'
    )


def supervise(argv: list[str], *, worker: str = WORKER, scratch_root: Path | None = None) -> int:
    recovery: dict[str, list[str]] = dict(swept_paths=[], leftover_paths=[])
    try:
        parent = (scratch_root or Path(tempfile.gettempdir())).resolve()
        code, text = _supervise(argv, worker, parent, recovery)
        fallback = "scratch_recovery_incomplete" if recovery["leftover_paths"] else "interrupted"
        output = json.loads(text) if text else dict(status="failed", reason=fallback)
    except Exception as error:
        reason = (
            error.args[0]
            if error.args and error.args[0] in RECOVERY_ERRORS
            else "measurement_failed"
        )
        if reason in RECOVERY_ERRORS and len(error.args) > 1 and error.args[1] is not None:
            recovery["leftover_paths"].append(str(error.args[1]))
        code, output = 1, dict(status="failed", reason=reason)
    output.update(recovery)
    sys.stdout.write(json.dumps(output) + "\n")
    return code


def main(argv: list[str] | None = None, *, worker: bool = False) -> int:
    try:
        args = options(argv)
    except ValueError:
        sys.stdout.write(json.dumps(dict(status="failed", reason="invalid_arguments")) + "\n")
        return 2
    try:
        rescue.bounds(args, datetime.now(UTC))
        if not worker:
            return supervise(sys.argv[1:] if argv is None else argv)
        result = measure(args)
    except Exception:
        sys.stdout.write(json.dumps(dict(status="failed", reason="measurement_failed")) + "\n")
        return 1
    sys.stdout.write(json.dumps(result, sort_keys=True, default=str) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
