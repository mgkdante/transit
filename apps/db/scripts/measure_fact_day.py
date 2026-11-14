"""Dormant closed-day measurement; production reads require separate owner approval."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import signal
import sys
import tempfile
import threading
import time
import tracemalloc
from datetime import UTC, datetime
from pathlib import Path
from subprocess import PIPE, Popen, TimeoutExpired
from types import SimpleNamespace
from typing import Any

import duckdb

from transit_ops.history.probe import peak_rss  # type: ignore[import-untyped]

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
            context = dict(**identity, timezone=provider[0], snapshot_time=now.isoformat())
            oracle = family_oracle(conn, context, folder)
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
        family_oracle=oracle,
        timezone=provider[0],
        tables=tables,
        server_version=version,
        database_read_seconds=time.monotonic()
        - started
        - sum(r["seconds"] for r in oracle.values()),
        oracle_query_seconds=sum(r["seconds"] for r in oracle.values()),
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
                report["family_comparison"] = family_compare(
                    conn, report.pop("family_oracle"), folder
                )
            rss, reason = peak_rss()
            report.update(
                duckdb_version=duckdb.__version__,
                python_version=sys.version.split()[0],
                python_traced_peak_bytes=tracemalloc.get_traced_memory()[1],
                memory_basis="Python traced peak excludes native allocations; process lifetime RSS",
                native_peak_rss_bytes=rss,
                native_peak_rss_reason=reason,
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
                try:
                    shutil.rmtree(root)
                except OSError:
                    if root.exists() and root.resolve() == root and not marker.is_symlink():
                        marker.write_text(json.dumps(data), encoding="utf-8")
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


def supervise(argv: list[str], *, worker: str = WORKER) -> int:
    status, previous, root = [], {}, None
    try:
        for name in ("SIGINT", "SIGTERM", "SIGBREAK"):
            if hasattr(signal, name):
                number = getattr(signal, name)
                previous[number] = signal.signal(number, lambda n, f: status.append(128 + n))
        with tempfile.TemporaryDirectory(prefix="transit-measure-") as directory:
            root, proof = Path(directory).resolve(), os.urandom(16).hex()
            data = dict(invocation=proof, path=str(root), pid=os.getpid())
            with (root / ".owner").open("x", encoding="utf-8") as marker:
                json.dump(data, marker)
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
    sys.stdout.write(stdout or '{"status":"failed","reason":"measurement_failed"}\n')
    return code if code >= 0 else 128 - code


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
    except Exception as error:
        reason = (
            "bundled_timezone_unavailable"
            if str(error) == "bundled_timezone_unavailable"
            else "measurement_failed"
        )
        sys.stdout.write(json.dumps(dict(status="failed", reason=reason)) + "\n")
        return 1
    sys.stdout.write(json.dumps(result, sort_keys=True, default=str) + "\n")
    return 0


OCCUPANCY_FIELDS = (
    "observation_count empty_count many_seats_count few_seats_count standing_count full_count"
)


def family_sql(kind: str) -> str:
    # Reviewed SELECT copies of rollups._occupancy_upsert and crowding boundary.
    sample = "provider_id=:p AND captured_at_utc>=:start AND captured_at_utc<:end"
    prefix = f"WITH v AS (SELECT * FROM gold.{VEHICLE} WHERE {sample}), "
    prefix += f"t AS (SELECT * FROM gold.{TRIP} WHERE {sample}) "
    stamp = (
        "CAST(EXTRACT(EPOCH FROM CAST(:built AS timestamptz))*1000000 AS bigint) AS built_at_utc"
    )
    if kind == "crowding":
        return (
            prefix
            + f'''SELECT * FROM (SELECT provider_id AS provider_id,
          CAST(:day AS date) AS provider_local_date, route_id AS route_id,
          CASE occupancy_status WHEN 0 THEN 'empty' WHEN 1 THEN 'many_seats'
          WHEN 2 THEN 'few_seats' WHEN 3 THEN 'standing' WHEN 4 THEN 'standing'
          WHEN 5 THEN 'full' END AS band, COUNT(*)::integer AS delay_observation_count,
          SUM(delay_seconds)::numeric(38,0) AS sum_delay_seconds,
          ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY delay_seconds)::numeric,2)
            ::numeric(38,2) AS p50_delay_seconds, {stamp}
          FROM t WHERE route_id IS NOT NULL AND occupancy_status IN (0,1,2,3,4,5)
          AND delay_seconds IS NOT NULL AND ABS(delay_seconds)<=3600
          AND captured_at_utc>=timezone(:tz, CAST(:day AS date)::timestamp)
          AND captured_at_utc<timezone(:tz, (CAST(:day AS date)+INTERVAL '1 day')::timestamp)
          GROUP BY provider_id, route_id, band) AS result
          ORDER BY provider_id COLLATE "C",2,route_id COLLATE "C",band COLLATE "C"'''
        )
    identity = "stop_id" if kind == "stop" else "COALESCE(route_id,'__unrouted__')"
    hour = "EXTRACT(HOUR FROM timezone(:tz,captured_at_utc))::smallint"
    entity = "stop_id" if kind == "stop" else "route_id"
    keys = (
        "provider_id AS provider_id, CAST(:day AS date) AS provider_local_date, "
        f"{identity} AS {entity}"
    )
    if kind == "hourly":
        keys += ", " + hour + " AS hour_of_day_local"
    bands = ["IN (0,1,2,3,4,5)", "=0", "=1", "=2", "IN (3,4)", "=5"]
    counts = ", ".join(
        f"COUNT(*) FILTER (WHERE occupancy_status {b})::integer AS {n}"
        for b, n in zip(bands, OCCUPANCY_FIELDS.split(), strict=True)
    )
    stop = "AND stop_id IS NOT NULL" if kind == "stop" else ""
    groups = f"provider_id, {identity}" + (", " + hour if kind == "hourly" else "")
    return (
        prefix
        + f'''SELECT * FROM (SELECT {keys}, {counts}, {stamp} FROM v
        WHERE snapshot_date_key=:key {stop} GROUP BY {groups}) AS result
        ORDER BY provider_id COLLATE "C",2,{entity} COLLATE "C"'''
        + (",4" if kind == "hourly" else "")
    )


def family_query(kind: str, params: dict[str, Any], *, local: bool) -> str:
    query = family_sql(kind)
    for key in params:
        query = query.replace(":" + key, "$" + key if local else "%(" + key + ")s")
    return query.replace("gold.", "").replace('COLLATE "C"', 'COLLATE "binary"') if local else query


def execute_family(conn: Any, kind: str, params: dict[str, Any], *, local: bool) -> Any:
    used = {k: v for k, v in params.items() if ":" + k in family_sql(kind)}
    return conn.execute(family_query(kind, used, local=local), used)


def write_result(cursor: Any, destination: Path) -> dict[str, Any]:
    from decimal import Decimal

    rows, digest = 0, hashlib.sha256()
    fields = [column[0] for column in cursor.description]
    with destination.open("wb") as output:
        while batch := cursor.fetchmany(1024):
            for row in batch:
                values = [format(v.normalize(), "f") if isinstance(v, Decimal) else v for v in row]
                serialized = json.dumps(
                    values, default=str, ensure_ascii=False, separators=(",", ":")
                )
                encoded = serialized.encode() + b"\n"
                output.write(encoded)
                digest.update(encoded)
                rows += 1
    return dict(rows=rows, sha256=digest.hexdigest(), fields=fields)


def compare(left: Path, right: Path, fields: list[str], *, key_count: int) -> dict[str, Any]:
    with left.open("rb") as a, right.open("rb") as b:
        ordinal = 0
        while True:
            x, y = a.readline(), b.readline()
            if x != y:
                old, new = json.loads(x) if x else [], json.loads(y) if y else []
                index = next(
                    (i for i, pair in enumerate(zip(old, new, strict=False)) if pair[0] != pair[1]),
                    None,
                )
                return dict(
                    status="different",
                    row=ordinal,
                    first_field=fields[index] if index is not None else "row_count",
                    safe_key_sha256=hashlib.sha256(
                        rescue.encoded((old or new)[:key_count])
                    ).hexdigest(),
                )
            if not x:
                return dict(status="equal")
            ordinal += 1


def family_oracle(conn: Any, report: dict[str, Any], folder: Path) -> dict[str, Any]:
    query = f"""SELECT DISTINCT snapshot_local_date FROM gold.{VEHICLE}
      WHERE provider_id=%s AND captured_at_utc>=%s AND captured_at_utc<%s
      UNION SELECT DISTINCT timezone(%s,captured_at_utc)::date FROM gold.{TRIP}
      WHERE provider_id=%s AND captured_at_utc>=%s AND captured_at_utc<%s
      UNION SELECT DISTINCT timezone(%s,captured_at_utc)::date FROM gold.{VEHICLE}
      WHERE provider_id=%s AND captured_at_utc>=%s AND captured_at_utc<%s ORDER BY 1"""
    p, start, end, tz = (report[k] for k in ("provider", "start", "end", "timezone"))
    days = conn.execute(query, (p, start, end, tz, p, start, end, tz, p, start, end)).fetchall()
    results = {}
    for (day,) in days:
        params = dict(
            p=p,
            start=start,
            end=end,
            tz=tz,
            day=day,
            key=int(day.strftime("%Y%m%d")),
            built=report["snapshot_time"],
        )
        for kind in ("route", "hourly", "stop", "crowding"):
            name = f"{day}-{kind}"
            sql = family_query(kind, params, local=False)
            before = time.monotonic()
            result = write_result(
                execute_family(conn, kind, params, local=False), folder / (name + ".oracle")
            )
            result.update(
                seconds=time.monotonic() - before,
                params=params,
                source_query_sha256=hashlib.sha256(sql.encode()).hexdigest(),
                kind=kind,
            )
            results[name] = result
    return results


def family_compare(conn: Any, oracle: dict[str, Any], folder: Path) -> dict[str, Any]:
    results = {}
    for name, expected in oracle.items():
        path = folder / (name + ".local")
        attempts = []
        for _ in range(2):
            started = time.monotonic()
            actual = write_result(
                execute_family(conn, expected["kind"], expected["params"], local=True), path
            )
            attempts.append(
                dict(
                    **actual,
                    seconds=time.monotonic() - started,
                    **compare(
                        folder / (name + ".oracle"),
                        path,
                        expected["fields"],
                        key_count=4 if expected["kind"] in ("hourly", "crowding") else 3,
                    ),
                )
            )
        results[name] = dict(
            postgres=expected,
            duckdb=attempts,
            deterministic=attempts[0]["sha256"] == attempts[1]["sha256"],
        )
    return dict(
        scope="family-shaped bounded UTC slice; not a complete local-day rebuild",
        outputs=results,
        status="not_applicable_empty_sample"
        if not results
        else "equal"
        if all(
            r["deterministic"] and all(a["status"] == "equal" for a in r["duckdb"])
            for r in results.values()
        )
        else "different",
    )


if __name__ == "__main__":
    raise SystemExit(main())
