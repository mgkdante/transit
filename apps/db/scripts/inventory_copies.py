"""Dormant readers. Only local evidence is written; restore/deletion proof stays pending."""

import json
import os
import re
import sys
import time
from collections.abc import Callable, Iterator
from contextlib import closing
from dataclasses import asdict
from datetime import datetime, timedelta
from functools import partial
from hashlib import sha256
from pathlib import Path
from typing import Annotated, Any, cast

import typer
from botocore.exceptions import ClientError
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.pool import NullPool

from transit_ops.backups import BACKUP_KEY_PATTERN
from transit_ops.history.datasets import HISTORY_DATASETS
from transit_ops.ingestion.common import compute_sha256_hex as file_hash
from transit_ops.ingestion.common import utc_now
from transit_ops.maintenance.gold import GOLD_AGGREGATE_TABLES, GOLD_FACT_TABLES
from transit_ops.s3 import BucketSetting, build_s3_client, validated_s3_target
from transit_ops.settings import Settings, get_settings
from transit_ops.snapshots.storage import _exclusive_directory_lock as evidence_lock

type Row = dict[str, Any]
type Read = Callable[..., Iterator[Row]]
FRESH, CHANGED, FAILED = "fresh_get_sha256", "changed_during_scan", "not_measured"
PENDING = {"partial_get", "not_measured_byte_budget"}
OK = {"unknown", FRESH}
CHANGES = {"404", "NoSuchKey", "412", "PreconditionFailed"}
MISSING = {"404", "NoSuchKey", "NotFound"}
TAGS = ("rescue", "history", "generations", "static", "receipt.json", "manifest.json")
app = typer.Typer(add_completion=False, pretty_exceptions_enable=False)
SAFE = re.compile(
    r"^(provider_id|is_active|dataset_id|dataset_version_id|revision|window_.*|"
    r".*_at_utc|.*sha256|storage_path|storage_backend|manifest_path|object_key|byte_size|record_count|"
    r"hold_.*|working_state|content_version|current_version|switch_key|enabled|"
    r".*generation_id|ingestion_.*_id|feed_endpoint_id|endpoint_key|status|event_id|kind)$"
)
CATALOG = """SELECT n.nspname AS schema, c.relname AS name,
    CASE WHEN c.reltuples>=0 THEN c.reltuples END AS row_count,
    CASE WHEN c.relkind IN ('r','p','m') THEN pg_total_relation_size(c.oid) END AS byte_size,
    c.relkind, (SELECT jsonb_object_agg(a.attname,format_type(a.atttypid,a.atttypmod))
      FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
    (SELECT jsonb_agg(pg_get_constraintdef(x.oid)) FROM pg_constraint x
      WHERE x.conrelid=c.oid) AS constraints,
    (SELECT jsonb_agg(pg_get_indexdef(i.indexrelid)) FROM pg_index i
      WHERE i.indrelid=c.oid AND i.indisvalid AND i.indpred IS NULL) AS indexes
    FROM pg_namespace n LEFT JOIN pg_class c ON n.oid=c.relnamespace
    AND c.relkind IN ('r','p','m','f','v')
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' ORDER BY 1,2"""


def records(path: Path | None) -> Iterator[Row]:
    if path and path.exists():
        with path.open(encoding="utf-8") as source:
            for line in source:
                yield json.loads(line)


def receipt(path: Path, value: Row, mode: str = "a") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open(mode, encoding="utf-8", newline="\n") as out:
        out.write(json.dumps(value, default=str, sort_keys=True) + "\n")
        out.flush()
        os.fsync(out.fileno())


def policy(table: str, settings: Settings) -> Row:
    rule: Row = dict(eligible_from=None, rule_source="unclassified; dependencies unresolved")
    if table in GOLD_FACT_TABLES:
        rule["retention_days"] = settings.GOLD_FACT_RETENTION_DAYS
        rule["eligibility"] = "strict-before captured_at_utc + positive retention; batch delay"
        rule["batch"] = settings.GOLD_FACT_PRUNE_BATCH
        rule["rule_source"] = "maintenance/gold.py:214"
    elif table in GOLD_AGGREGATE_TABLES:
        rule.update(age_deletion="disabled", rule_source="maintenance/gold.py:284")
    elif table.startswith("silver."):
        rule["eligibility"] = "conditional on editions, holds and replay dependencies"
        rule["rule_source"] = "maintenance/silver.py; settings.STATIC_DATASET_RETENTION_COUNT"
    return rule


def read_only(
    engine: Engine,
    end: float,
    clock: Callable[[], float],
    sql: str,
    params: Row | None = None,
    indexed: bool = False,
) -> Iterator[Row]:
    if clock() >= end:
        raise TimeoutError
    with engine.connect() as conn, conn.begin():
        conn.exec_driver_sql("SET TRANSACTION READ ONLY")
        for setting in (
            "lock_timeout='1s'",
            "idle_in_transaction_session_timeout='15s'",
            "max_parallel_workers_per_gather=0",
            "TimeZone='UTC'",
        ):
            conn.exec_driver_sql("SET LOCAL " + setting)
        if indexed:
            conn.exec_driver_sql("SET LOCAL enable_seqscan=off")
        left = end - clock()
        if left <= 0:
            raise TimeoutError
        conn.exec_driver_sql(f"SET LOCAL statement_timeout={max(1, int(min(60, left) * 1000))}")
        result = conn.execution_options(stream_results=True).execute(text(sql), params or {})
        for row in result.mappings():
            if clock() >= end:
                raise TimeoutError
            yield dict(row)


def fact_bounds(read: Read, relation: str, provider: str) -> Row:
    sql = "SELECT min(captured_at_utc) AS first_observed,max(captured_at_utc) AS last_observed "
    bounds = list(
        read(
            sql + f"FROM {relation} WHERE provider_id=:provider",
            {"provider": provider},
            indexed=True,
        )
    )[0]
    return dict(provider_id=provider, row_count=None, row_count_basis=FAILED, **bounds)


def measurement_sql(row: Row, quote: Callable[[str], str]) -> str:
    columns, group = row["columns"] or {}, []
    relation = quote(row["schema"]) + "." + quote(row["name"])
    if row["schema"] in ("core", "ops", "raw"):
        selected = [
            f"{quote(k)}::text AS {quote(k)}" if "timestamp" in t else quote(k)
            for k, t in columns.items()
            if SAFE.fullmatch(k)
        ]
        if not selected:
            raise ValueError("no permitted evidence columns")
        return f"SELECT {','.join(selected)} FROM {relation}"
    group = [quote(k) for k in ("provider_id", "dataset_version_id") if k in columns]
    time_columns = ("captured_at_utc", "provider_local_date", "period_start_utc")
    day = next((k for k in time_columns if k in columns), None)
    if day and "dataset_version_id" not in columns:
        group.append(f"{quote(day)}::date AS day")
    fields = [*group, "count(*) AS row_count"]
    if day:
        fields += [f"min({quote(day)}) AS first_observed", f"max({quote(day)}) AS last_observed"]
    suffix = " GROUP BY " + ",".join(str(i + 1) for i in range(len(group))) if group else ""
    return f"SELECT {','.join(fields)} FROM {relation}{suffix}"


def measure_table(
    read: Read, row: Row, quote: Callable[[str], str], settings: Settings
) -> Iterator[Row]:
    now = utc_now()
    last_start = (now - timedelta(hours=6)).replace(hour=6, minute=0, second=0, microsecond=0)
    admitted = datetime.fromisoformat(os.environ["LS03_STATIC_WARM_FINISHED_AT"])
    if not last_start <= admitted <= now or (now.hour == 5 and now.minute >= 45):
        raise ValueError("static/warm exclusion window")
    if row["relkind"] in ("f", "v"):
        raise ValueError("virtual or external relation; catalog only")
    if any(read("SELECT 1 FROM pg_locks WHERE mode='AccessExclusiveLock' AND NOT granted")):
        raise ValueError("exclusive lock queued")
    table = f"{row['schema']}.{row['name']}"
    if table not in GOLD_FACT_TABLES and not row["name"].startswith("fact_"):
        yield from read(measurement_sql(row, quote))
        return
    if not any(
        re.search(r"\(provider_id, captured_at_utc(?: DESC)?(?:,|\))", i)
        for i in row["indexes"] or []
    ):
        raise ValueError("required provider/time index absent")
    providers = list(read("SELECT provider_id FROM core.providers"))
    relation = quote(row["schema"]) + "." + quote(row["name"])
    for provider in providers:
        bounds = fact_bounds(read, relation, provider["provider_id"])
        if bounds["first_observed"] and settings.GOLD_FACT_RETENTION_DAYS > 0:
            bounds["eligible_from"] = bounds["first_observed"] + timedelta(
                days=settings.GOLD_FACT_RETENTION_DAYS
            )
        yield bounds


def snapshot(settings: Settings, tables: list[Row], now: datetime) -> Row:
    schemas = {r["schema"] for r in tables}
    retention_fields = (k for k in type(settings).model_fields if "RETENTION" in k)
    return dict(
        kind="snapshot",
        at=now,
        schemas=sorted(schemas),
        restore_proof="pending",
        absent_schemas=sorted({"raw", "silver", "gold", "core", "ops"} - schemas),
        declarations=[asdict(d) for d in HISTORY_DATASETS.values()],
        method_sha256=file_hash(Path(__file__)),
        retention={k: getattr(settings, k) for k in retention_fields},
    )


def database(
    engine: Engine,
    settings: Settings,
    emit: Callable[[Row], None],
    not_after: datetime,
    clock: Callable[[], float] = time.monotonic,
) -> None:
    now = utc_now()
    if not_after.tzinfo is None or not_after <= now:
        raise ValueError("future UTC deadline required")
    cutoff = now.replace(hour=5, minute=45, second=0, microsecond=0)
    cutoff += timedelta(days=now >= cutoff)
    seconds = min(180, (min(cutoff, not_after) - now).total_seconds())
    read = partial(read_only, engine, clock() + seconds, clock)
    tables = list(read(CATALOG))
    emit(snapshot(settings, tables, now))
    for row in (r for r in tables if r["name"] is not None):
        table = f"{row['schema']}.{row['name']}"
        emit(
            dict(
                kind="table",
                table=table,
                store="database",
                watermark=utc_now(),
                row_count_basis="catalog estimate",
                byte_size_basis="pg_total_relation_size",
                unclassified_reason="discovered relation",
                **policy(table, settings),
                **row,
            )
        )
        try:
            for measured in measure_table(
                read, row, engine.dialect.identifier_preparer.quote_identifier, settings
            ):
                basis = "exact count" if "row_count" in measured else "source row"
                measured.setdefault("row_count_basis", basis)
                emit(dict(kind="measurement", table=table, watermark=utc_now(), **measured))
        except Exception:
            emit(
                dict(
                    kind=FAILED,
                    table=table,
                    cursor=table,
                    reason="admission, timeout or read failure; details withheld",
                )
            )


def identity(item: Row) -> list[Any]:
    size = item.get("Size", item.get("ContentLength"))
    return [item.get("ETag"), size, str(item.get("LastModified"))]


def recent(path: Path | None, keys: set[str]) -> dict[str, Row]:
    return {r["key"]: r for r in records(path) if r.get("verification") in OK and r["key"] in keys}


def recover(path: Path, size: int, digest: str) -> None:
    if path.stat().st_size < size:
        raise ValueError("missing durable evidence")
    with path.open("r+b") as local:
        local.truncate(size)
    if file_hash(path) != digest:
        raise ValueError("durable evidence changed")


class ObjectScan:
    def __init__(
        self,
        client: Any,
        bucket: str,
        store: str,
        output: Path,
        cursor: Path,
        limits: Row,
        rescan: Path | None,
    ) -> None:
        self.client, self.bucket, self.store = client, bucket, store
        self.output, self.cursor = output, cursor
        self.part, self.rescan = cursor.with_suffix(".part"), rescan
        self.limits = limits
        paths = [p.resolve() for p in (output, cursor, self.part, cursor.with_suffix(".tmp"))]
        if len(set(paths)) != len(paths) or rescan and rescan.resolve() in paths:
            raise ValueError("evidence paths must differ")
        target = f"{bucket}:{store}:{getattr(getattr(client, 'meta', None), 'endpoint_url', None)}"
        self.target = sha256(target.encode()).hexdigest()
        source_hash = file_hash(rescan) if rescan else None
        binding = sha256(f"{target}:{paths}:{source_hash}".encode()).hexdigest()
        self.state: Row = dict(binding=binding, token=None, phase="list", failures=0)
        if cursor.exists():
            if cursor.stat().st_size > 16384:
                raise ValueError("oversized checkpoint")
            self.state = json.loads(cursor.read_text())
            if self.state["binding"] != binding:
                raise ValueError("cursor target mismatch")
            recover(output, self.state["output_size"], self.state["output_sha256"])
        else:
            if output.exists():
                raise ValueError("existing evidence requires its cursor")
            self.emit("run", target=self.target, method_sha256=file_hash(Path(__file__)))
        self.counts: Row = dict(keys=0, get_bytes=0, failures=0, LIST=0, HEAD=0, GET=0)

    def emit(self, kind: str, **fields: Any) -> None:
        receipt(self.output, dict(kind=kind, store=self.store, observed=utc_now(), **fields))

    def request(self, verb: str, **fields: Any) -> Row:
        methods = dict(LIST="list_objects_v2", HEAD="head_object", GET="get_object")
        method = methods[verb]
        self.counts[verb] += 1
        return cast(Row, getattr(self.client, method)(Bucket=self.bucket, **fields))

    def save(self) -> None:
        size = self.output.stat().st_size
        self.state.update(output_size=size, output_sha256=file_hash(self.output))
        temp = self.cursor.with_suffix(".tmp")
        receipt(temp, self.state, mode="w")
        temp.replace(self.cursor)

    def hash_object(self, item: Row) -> tuple[str | None, str]:
        observed, key, saved = identity(item), item["Key"], self.state.get("partial", {})
        same_object = saved.get("identity") == observed and saved.get("key") == key
        offset = saved.get("bytes", 0) if same_object else 0
        if offset:
            recover(self.part, offset, saved["sha256"])
        allowance = min(item["Size"] - offset, self.limits["bytes"] - self.counts["get_bytes"])
        if allowance <= 0 and item["Size"]:
            return None, "not_measured_byte_budget"
        if identity(self.request("HEAD", Key=key)) != observed:
            return None, CHANGED
        request = dict(Key=key, IfMatch=item["ETag"])
        if offset or allowance < item["Size"]:
            request["Range"] = f"bytes={offset}-{offset + allowance - 1}"
        response = self.request("GET", **request)
        span = (
            f"bytes {offset}-{offset + allowance - 1}/{item['Size']}"
            if "Range" in request
            else None
        )
        if response.get("ContentLength") != allowance or response.get("ContentRange") != span:
            response["Body"].close()
            raise ValueError("range not honored")
        received = self.spool(response["Body"], offset, allowance)
        if received != allowance or identity(self.request("HEAD", Key=key)) != observed:
            self.state.pop("partial", None)
            return None, CHANGED
        digest = file_hash(self.part)
        self.state["partial"] = dict(
            key=key, identity=observed, bytes=offset + received, sha256=digest
        )
        if offset + received < item["Size"]:
            return None, "partial_get"
        self.state.pop("partial", None)
        return digest, FRESH

    def spool(self, body: Any, offset: int, allowance: int) -> int:
        with self.part.open("ab" if offset else "wb") as local, body:
            received = 0
            while chunk := body.read(min(65536, allowance - received)):
                received += len(chunk)
                self.counts["get_bytes"] += len(chunk)
                local.write(chunk)
            local.flush()
            os.fsync(local.fileno())
        return received

    def observe(self, item: Row, previous: Row) -> Row:
        key = item["Key"]
        kind = next((p for p in TAGS if p in key.split("/")), "unknown")
        kind = "backup" if BACKUP_KEY_PATTERN.search(key) else kind
        unknown = "sha256 eligible_from provider dataset row_count row_count_basis"
        row: Row = dict.fromkeys(unknown.split())
        row.update(
            key=key,
            identity=identity(item),
            verification="unknown",
            classification=kind,
            source_digest_basis="unknown",
            byte_size=item["Size"],
            byte_size_basis="S3 LIST",
        )
        if self.store == "published":
            try:
                row["sha256"], row["verification"] = self.hash_object(item)
            except (ClientError, FileNotFoundError) as exc:
                code = exc.response["Error"]["Code"] if isinstance(exc, ClientError) else "404"
                row["verification"] = CHANGED if code in CHANGES else FAILED
            except Exception:
                row["verification"] = FAILED
        if row["sha256"] and previous.get("sha256") and "/generations/" in key:
            if row["sha256"] != previous["sha256"]:
                self.emit("immutable_content_failure", key=key)
                row["verification"] = "immutable_content_failure"
        if row["verification"] not in OK | PENDING:
            self.state["failures"] += 1
            self.counts["failures"] += 1
        self.emit("pending" if row["verification"] in PENDING else "object", **row)
        return row

    def page(self) -> bool:
        start, token, before = utc_now(), self.state["token"], dict(self.counts)
        finished, items = False, []
        try:
            args = dict(MaxKeys=min(self.limits["page"], self.limits["keys"] - self.counts["keys"]))
            if token:
                args["ContinuationToken"] = token
            page = self.request("LIST", **args)
            items = page.get("Contents", [])
            keys = {r["Key"] for r in items}
            old, previous = recent(self.output, keys), recent(self.rescan, keys)
            for item in items:
                self.counts["keys"] += 1
                cached = old.get(item["Key"], {})
                known = cached.get("verification") in OK
                if known and cached.get("identity") == identity(item):
                    if identity(self.request("HEAD", Key=item["Key"])) == identity(item):
                        continue
                row = self.observe(item, previous.get(item["Key"], cached))
                if row["verification"] in PENDING:
                    return False
            finished = True
        finally:
            self.emit(
                "page",
                start=start,
                end=utc_now(),
                cursor=token,
                listed_keys=len(items),
                counts={k: self.counts[k] - before[k] for k in self.counts},
                finished=finished,
            )
        following = page.get("NextContinuationToken") if page.get("IsTruncated") else None
        if page.get("IsTruncated") and (not items or not following or following == token):
            raise ValueError("invalid continuation token")
        self.state.update(
            token=following,
            overlap=token,
            rewind=not self.state.pop("replaying", False),
            phase="list" if following else "delta",
        )
        return True

    def delta(self) -> None:
        for index, previous in enumerate(records(self.rescan)):
            if index < self.state.get("delta_offset", 0):
                continue
            if previous.get("kind") == "object":
                if self.counts["keys"] >= self.limits["keys"]:
                    return
                self.counts["keys"] += 1
                try:
                    current = identity(self.request("HEAD", Key=previous["key"]))
                    status = "unchanged" if current == previous.get("identity") else CHANGED
                except (ClientError, FileNotFoundError) as exc:
                    code = exc.response["Error"]["Code"] if isinstance(exc, ClientError) else "404"
                    status = "disappeared" if code in MISSING else FAILED
                except Exception:
                    status = FAILED
                self.emit("delta", key=previous["key"], verification=status)
                self.state["failures"] += status != "unchanged"
            self.state["delta_offset"] = index + 1
        self.state["phase"] = "done"

    def run(self) -> Row:
        if self.state.get("rewind") and self.state["phase"] == "list":
            self.state.update(token=self.state["overlap"], rewind=False, replaying=True)
        self.save()
        try:
            while self.state["phase"] == "list" and self.counts["keys"] < self.limits["keys"]:
                if not self.page():
                    break
                self.save()
            if self.state["phase"] == "delta":
                self.delta()
        finally:
            summary = dict(
                complete=self.state["phase"] == "done" and not self.state["failures"],
                listing_complete=self.state["phase"] != "list",
                reconciliation_complete=self.state["phase"] == "done",
                stable=self.state["phase"] == "done" and not self.state["failures"],
                restore_proof="pending",
                global_snapshot=False,
                **self.counts,
            )
            self.emit("summary", **summary)
            self.save()
        return summary


def objects(
    client: Any,
    bucket: str,
    store: str,
    output: Path,
    cursor: Path,
    max_keys: int = 10000,
    max_bytes: int = 1073741824,
    page_size: int = 1000,
    rescan: Path | None = None,
) -> Row:
    if not 1 <= max_keys <= 10000 or not 0 <= max_bytes <= 1073741824 or not 1 <= page_size <= 1000:
        raise ValueError("inventory budget exceeded")
    if store not in ("raw", "published"):
        raise ValueError("unknown store")
    with evidence_lock(cursor.parent):
        limits = dict(keys=max_keys, bytes=max_bytes, page=page_size)
        return ObjectScan(client, bucket, store, output, cursor, limits, rescan).run()


def guarded(action: Callable[[], Any]) -> int:
    try:
        action()
        return 0
    except Exception:
        sys.stderr.write("inventory failed; details withheld\n")
        return 1


@app.command("database")
def database_command(
    not_after: Annotated[str, typer.Option()], output: Annotated[Path, typer.Option()]
) -> None:
    settings = get_settings()
    engine = create_engine(
        settings.sqlalchemy_database_url or "",
        poolclass=NullPool,
        hide_parameters=True,
        connect_args={"connect_timeout": 10, "options": "-c default_transaction_read_only=on"},
    )
    try:
        database(engine, settings, partial(receipt, output), datetime.fromisoformat(not_after))
    finally:
        engine.dispose()


@app.command("objects")
def objects_command(
    store: Annotated[str, typer.Option()],
    output: Annotated[Path, typer.Option()],
    cursor: Annotated[Path, typer.Option()],
    max_keys: int = 10000,
    max_get_bytes: int = 1073741824,
    rescan: Path | None = None,
) -> None:
    if store not in ("raw", "published"):
        raise ValueError("unknown store")
    settings = get_settings()
    field: BucketSetting = "BRONZE_S3_BUCKET" if store == "raw" else "SNAPSHOT_R2_BUCKET"
    _, bucket = validated_s3_target(settings, bucket_setting=field)
    client: Any = build_s3_client(settings, bucket_setting=field)
    with closing(client):
        objects(client, bucket, store, output, cursor, max_keys, max_get_bytes, rescan=rescan)


if __name__ == "__main__":
    sys.exit(guarded(app))
