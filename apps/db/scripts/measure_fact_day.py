"""Dormant closed-day measurement; production reads require separate owner approval."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
import tempfile
import time
import tracemalloc
from datetime import UTC, datetime
from pathlib import Path
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
    started, count, digest = time.monotonic(), 0, hashlib.sha256()
    while rows := cursor.fetchmany(1024):
        for row in rows:
            digest.update(
                json.dumps(row, default=str, ensure_ascii=False, separators=(",", ":")).encode()
                + b"\n"
            )
            count += 1
    return dict(
        rows=count, sha256=digest.hexdigest(), consumption_seconds=time.monotonic() - started
    )


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
        (
            f"SELECT route_id, CAST(date_trunc('hour', captured_at_utc) AS VARCHAR), "
            f"quantile_cont(delay_seconds, 0.9) FROM {TRIP} GROUP BY 1,2 ORDER BY 1,2",
            None,
        ),
        (
            "SELECT CAST(date_trunc('hour', captured_at_utc) AS VARCHAR), "
            "count(DISTINCT vehicle_id) "
            f"FROM {VEHICLE} GROUP BY 1 ORDER BY 1",
            None,
        ),
        (
            f"SELECT * REPLACE (CAST(captured_at_utc AS VARCHAR) AS captured_at_utc, "
            f"CAST(feed_timestamp_utc AS VARCHAR) AS feed_timestamp_utc) FROM {TRIP} "
            "WHERE trip_id = ? ORDER BY captured_at_utc, "
            "realtime_snapshot_id, entity_index",
            [trip[0] if trip else None],
        ),
    ]
    result = []
    for index, (query, params) in enumerate(definitions):
        first, warm = timed_query(conn, query, params), timed_query(conn, query, params)
        result.append(
            dict(
                **first,
                definition=query,
                units="seconds; delay_seconds",
                warm_seconds=warm["seconds"],
                warm_sha256=warm["sha256"],
                cache_state="uncontrolled",
                **({"trip_outcome": outcome} if index == 2 else {}),
            )
        )
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
            settings = dict(
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
                statement_timeout="60s",
            )
            for key, value in settings.items():
                conn.execute("SELECT set_config(%s, %s, true)", (key, value))
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("provider", "date", "not-after"):
        parser.add_argument("--" + name, required=True)
    parsed = parser.parse_args(argv)
    args = SimpleNamespace(
        **vars(parsed),
        statement_timeout_s=60,
        db_phase_s=180,
        inventory=False,
        as_of=None,
        upload=False,
        spool_dir="temporary",
    )
    try:
        rescue.bounds(args, datetime.now(UTC))
        result = measure(args)
    except Exception:
        sys.stdout.write(json.dumps(dict(status="failed", reason="measurement_failed")) + "\n")
        return 1
    sys.stdout.write(json.dumps(result, sort_keys=True, default=str) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
