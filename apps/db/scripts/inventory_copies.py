"""Dormant readers. Only local evidence is written; restore/deletion proof stays pending."""

import argparse
import json
import os
import re
import sys
import time
from collections.abc import Callable, Iterator
from contextlib import closing
from dataclasses import asdict
from datetime import UTC, date, datetime, timedelta
from functools import partial
from hashlib import sha256
from itertools import count
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, cast

from botocore.exceptions import ClientError
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.pool import NullPool

from transit_ops.backups import BACKUP_KEY_PATTERN
from transit_ops.history.datasets import HISTORY_DATASETS
from transit_ops.history.seal_captures import _prefix as archive_prefix
from transit_ops.ingestion.common import build_bronze_object_storage_path, utc_now
from transit_ops.ingestion.common import compute_sha256_hex as file_hash
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
EVIDENCE = {
    "core.snapshot_historic_gc_marks": (
        "provider_id object_key etag content_length "
        "object_last_modified_utc first_unreachable_utc last_confirmed_unreachable_utc last_scan_id"
    ),
    "core.snapshot_historic_receipts": (
        "provider_id family entity_key receipt_schema_version "
        "scope_count first_scope_start last_scope_end entity_receipt_sha256"
    ),
    "core.history_event": "event_id at_utc kind dataset_id provider_id revision window_key",
}


class Refusal(ValueError):
    pass


class EvidenceLimit(RuntimeError):
    pass


def file_id(path: Path | int) -> list[int]:
    stat = os.fstat(path) if isinstance(path, int) else path.stat()
    if not stat.st_ino:
        raise ValueError("file identity unavailable")
    return [stat.st_dev, stat.st_ino]


def refusal(exc: Exception) -> str:
    if isinstance(exc, Refusal):
        return str(exc)
    code = getattr(getattr(exc, "orig", exc), "sqlstate", None)
    if isinstance(exc, TimeoutError) or code == "57014":
        return "phase_timeout"
    return "read_denied" if isinstance(exc, PermissionError) or code == "42501" else "read_failure"


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


class LocalFile:
    def __init__(self, path: Path, limit: int, saved: Row | None = None) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        if saved:
            recover(path, saved["size"], saved["sha256"], saved["owner"])
        self.path, self.limit = path, limit
        self.file = path.open("r+b" if saved else "x+b")
        self.file.seek(0, 2)
        if saved and file_id(self.file.fileno()) != saved["owner"]:
            raise ValueError("unowned evidence")

    def close(self) -> None:
        self.file.close()

    def write(self, data: bytes) -> None:
        if self.file.tell() + len(data) > self.limit:
            raise EvidenceLimit("spool_limit")
        self.file.write(data)

    def record(self) -> Row:
        self.file.flush()
        os.fsync(self.file.fileno())
        return dict(
            size=self.file.tell(), sha256=file_hash(self.path), owner=file_id(self.file.fileno())
        )

    def emit(self, value: Row) -> None:
        data = (json.dumps(value, default=str, sort_keys=True) + "\n").encode()
        limited = self.file.tell() + len(data) > self.limit - 256
        if limited:
            data = (
                b'{"kind":"truncation","reason":"receipt_limit","complete":false,"stable":false}\n'
            )
        self.write(data)
        self.file.flush()
        os.fsync(self.file.fileno())
        if limited:
            raise EvidenceLimit("receipt_limit")


def receipt(path: Path, value: Row, max_bytes: int = 2**26) -> None:
    if max_bytes < 512:
        raise ValueError("invalid evidence limit")
    with closing(LocalFile(path, max_bytes)) as local:
        local.emit(value)


def policy(table: str, settings: Settings) -> Row:
    rule: Row = dict(eligible_from=None, rule_source="unclassified; dependencies unresolved")
    if table in GOLD_FACT_TABLES:
        rule["retention_days"] = settings.GOLD_FACT_RETENTION_DAYS
        rule["eligibility"] = "strict-before captured_at_utc + positive retention; batch delay"
        rule["batch"] = settings.GOLD_FACT_PRUNE_BATCH
        rule["rule_source"] = "maintenance/gold.py:214"
    elif table in GOLD_AGGREGATE_TABLES:
        rule.update(age_deletion="disabled", rule_source="maintenance/gold.py:284")
    return rule


def classify(key: str) -> Row:
    kind = "backup" if BACKUP_KEY_PATTERN.search(key) else "unknown"
    result: Row = dict(classification=kind)
    try:
        parts = key.split("/")
        if parts[:3] == ["archive", "v1", "captures"]:
            provider, feed = parts[3:5]
            day = parts[7].split(".c", 1)[0]
            valid = key.startswith(archive_prefix(provider, feed, date.fromisoformat(day)))
            kind, basis = "archive", "archive prefix round-trip"
        else:
            provider, feed, partition, filename = key.split("/", 3)
            label, day = partition.split("=", 1)
            if label not in ("capture_date", "captured_at_utc", "ingested_at_utc"):
                return result
            stamp, digest, name = filename.split("__", 2)
            at = datetime.strptime(stamp, "%Y%m%dT%H%M%S%fZ").replace(tzinfo=UTC)
            valid = key == build_bronze_object_storage_path(
                provider_id=provider,
                endpoint_key=feed,
                partition_label=label,
                observed_at_utc=at,
                object_name=name,
                checksum_sha256=digest,
            )
            kind = "edition" if label == "ingested_at_utc" else "capture"
            basis = "capture builder round-trip"
        if valid:
            dataset = HISTORY_DATASETS.get("capture." + feed) if kind != "edition" else None
            result.update(
                classification=kind,
                provider=provider,
                feed=feed,
                day=day,
                dataset=dataset.dataset_id if dataset else None,
                attribution_basis=basis,
            )
    except (ValueError, TypeError, IndexError):
        pass
    return result


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
    # Ordinary cursors keep control/probe SQL out of DECLARE ... CURSOR FOR.
    with engine.connect().execution_options(stream_results=False) as conn, conn.begin():
        # Offset pages share one snapshot and a deterministic whole-row ordering.
        conn.exec_driver_sql("SET TRANSACTION READ ONLY, ISOLATION LEVEL REPEATABLE READ")
        conn.exec_driver_sql("SET LOCAL lock_timeout='1s'")
        conn.exec_driver_sql("SET LOCAL idle_in_transaction_session_timeout='15s'")
        conn.exec_driver_sql("SET LOCAL max_parallel_workers_per_gather=0")
        conn.exec_driver_sql("SET LOCAL TimeZone='UTC'")
        if indexed:
            conn.exec_driver_sql("SET LOCAL enable_seqscan=off")
        for offset in count(0, 1000):
            left = end - clock()
            if left <= 0:
                raise TimeoutError
            conn.exec_driver_sql(f"SET LOCAL statement_timeout={max(1, int(min(60, left) * 1000))}")
            query = text(f"SELECT * FROM ({sql}) AS p ORDER BY p LIMIT 1000 OFFSET {offset}")
            rows = conn.execute(query, params or {}).mappings().all()
            for row in rows:
                if clock() >= end:
                    raise TimeoutError
                yield dict(row)
            if len(rows) < 1000:
                break


def fact_bounds(read: Read, relation: str, provider: str) -> Row:
    sql = "SELECT min(captured_at_utc) AS first_observed,max(captured_at_utc) AS last_observed "
    query = sql + f"FROM {relation} WHERE provider_id=:provider"
    bounds = list(read(query, {"provider": provider}, indexed=True))[0]
    return dict(provider_id=provider, row_count=None, row_count_basis=FAILED, **bounds)


def measurement_sql(row: Row, quote: Callable[[str], str]) -> str:
    columns, group = row["columns"] or {}, []
    relation = quote(row["schema"]) + "." + quote(row["name"])
    if row["schema"] in ("core", "ops", "raw"):
        required = set(EVIDENCE.get(f"{row['schema']}.{row['name']}", "").split())
        if not required <= columns.keys():
            raise Refusal("unsupported_evidence_shape")
        selected = [
            f"{quote(k)}::text AS {quote(k)}" if "timestamp" in t else quote(k)
            for k, t in columns.items()
            if SAFE.fullmatch(k) or k in required
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
    value = os.environ.get("LS03_STATIC_WARM_FINISHED_AT")
    if not value:
        raise Refusal("missing_admission")
    try:
        admitted = datetime.fromisoformat(value)
    except ValueError:
        raise Refusal("invalid_admission") from None
    if admitted.tzinfo is None:
        raise Refusal("invalid_admission")
    if admitted < last_start:
        raise Refusal("stale_admission")
    if admitted > now:
        raise Refusal("future_admission")
    if now.hour == 5 and now.minute >= 45:
        raise Refusal("exclusion_window")
    if row["relkind"] in ("f", "v"):
        raise Refusal("unsupported_relation")
    if any(read("SELECT 1 FROM pg_locks WHERE mode='AccessExclusiveLock' AND NOT granted")):
        raise Refusal("queued_exclusive_lock")
    table = f"{row['schema']}.{row['name']}"
    if table not in GOLD_FACT_TABLES and not row["name"].startswith("fact_"):
        yield from read(measurement_sql(row, quote))
        return
    if not any(
        re.search(r"\(provider_id, captured_at_utc(?: DESC)?(?:,|\))", i)
        for i in row["indexes"] or []
    ):
        raise Refusal("missing_index")
    providers = list(read("SELECT provider_id FROM core.providers"))
    relation = quote(row["schema"]) + "." + quote(row["name"])
    for provider in providers:
        bounds = fact_bounds(read, relation, provider["provider_id"])
        bounds["eligible_from"] = None
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


def envelope(source: Row, **fields: Any) -> Row:
    for key in sorted(source, key=len):
        name = key
        while name in fields:
            name = "source_" + name
        fields[name] = source[key]
    return fields


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
                emit(envelope(measured, kind="measurement", table=table, watermark=utc_now()))
        except EvidenceLimit:
            raise
        except Exception as exc:
            emit(dict(kind=FAILED, table=table, cursor=table, reason=refusal(exc)))


def identity(item: Row) -> list[Any]:
    size = item.get("Size", item.get("ContentLength"))
    return [item.get("ETag"), size, str(item.get("LastModified"))]


def recent(path: Path | None, keys: set[str], good: bool = True) -> dict[str, Row]:
    return {
        r["key"]: r
        for r in records(path)
        if r.get("kind") in ("object", "pending")
        and r["key"] in keys
        and (not good or r.get("verification") in OK)
    }


def recover(path: Path, size: int, digest: str, owner: list[int]) -> None:
    with path.open("r+b") as local:
        if file_id(local.fileno()) != owner:
            raise ValueError("unowned evidence")
        actual, left = sha256(), size
        while left:
            chunk = local.read(min(65536, left))
            if not chunk:
                raise ValueError("missing durable evidence")
            actual.update(chunk)
            left -= len(chunk)
        if actual.hexdigest() != digest:
            raise ValueError("durable evidence changed")
        local.truncate(size)


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
        self.spools, self.rescan = cursor.with_suffix(".part"), rescan
        self.part = self.spools
        self.limits = dict(output=2**26, spool=2**32) | limits
        paths = [p.resolve() for p in (output, cursor, self.spools, cursor.with_suffix(".tmp"))]
        if len(set(paths)) != len(paths) or rescan and rescan.resolve() in paths:
            raise ValueError("evidence paths must differ")
        target = f"{bucket}:{store}:{getattr(getattr(client, 'meta', None), 'endpoint_url', None)}"
        self.target = sha256(target.encode()).hexdigest()
        source_hash = file_hash(rescan) if rescan else None
        binding = sha256(
            f"{target}:{paths}:{source_hash}:{self.limits['output']}:{self.limits['spool']}".encode()
        ).hexdigest()
        self.state: Row = dict(binding=binding, token=None, phase="list", failures=0)
        if cursor.exists():
            if cursor.stat().st_size > 16384:
                raise ValueError("oversized checkpoint")
            self.state = json.loads(cursor.read_text())
            if self.state["binding"] != binding:
                raise ValueError("cursor target mismatch")
        else:
            if output.exists() or self.spools.exists():
                raise ValueError("existing evidence requires its cursor")
            with cursor.open("xb"):
                pass
            self.spools.mkdir()
        self.evidence = LocalFile(output, self.limits["output"], self.state.get("receipt"))
        if not self.state.get("receipt"):
            self.emit("run", target=self.target, method_sha256=file_hash(Path(__file__)))
        self.state["spool_bytes"] = sum(p.stat().st_size for p in self.spools.iterdir())
        self.counts: Row = dict(keys=0, get_bytes=0, failures=0, LIST=0, HEAD=0, GET=0)

    def emit(self, kind: str, **fields: Any) -> None:
        if self.state.get("truncated"):
            if kind == "summary":
                return
            raise EvidenceLimit("receipt_limit")
        try:
            self.evidence.emit(dict(kind=kind, store=self.store, observed=utc_now(), **fields))
        except EvidenceLimit:
            self.state["truncated"] = True
            raise

    def request(self, verb: str, **fields: Any) -> Row:
        methods = dict(LIST="list_objects_v2", HEAD="head_object", GET="get_object")
        method = methods[verb]
        self.counts[verb] += 1
        return cast(Row, getattr(self.client, method)(Bucket=self.bucket, **fields))

    def save(self) -> None:
        self.state["receipt"] = self.evidence.record()
        with NamedTemporaryFile(dir=self.cursor.parent, delete=False) as temp:
            temp.write(json.dumps(self.state).encode())
            temp.flush()
            os.fsync(temp.fileno())
        Path(temp.name).replace(self.cursor)

    def hash_object(self, item: Row) -> tuple[str | None, str]:
        observed, key, saved = identity(item), item["Key"], self.state.get("partial", {})
        same_object = saved.get("identity") == observed and saved.get("key") == key
        self.part = self.spools / (sha256(repr((key, observed)).encode()).hexdigest() + ".part")
        offset = saved["file"]["size"] if same_object else 0
        space = self.limits["spool"] - self.state["spool_bytes"]
        if space <= 0:
            self.spool_limit()
        allowance = min(
            item["Size"] - offset, self.limits["bytes"] - self.counts["get_bytes"], space
        )
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
        self.state["partial"] = dict(key=key, identity=observed, file=self.spool_record)
        if offset + received < item["Size"]:
            if received == space:
                self.spool_limit()
            return None, "partial_get"
        self.state.pop("partial", None)
        return self.spool_record["sha256"], FRESH

    def spool(self, body: Any, offset: int, allowance: int) -> int:
        saved = self.state["partial"]["file"] if offset else None
        limit = offset + self.limits["spool"] - self.state["spool_bytes"]
        with closing(LocalFile(self.part, limit, saved)) as local, body:
            received = 0
            while chunk := body.read(min(65536, allowance - received)):
                received += len(chunk)
                self.counts["get_bytes"] += len(chunk)
                self.state["spool_bytes"] += len(chunk)
                local.write(chunk)
            self.spool_record = local.record()
        return received

    def spool_limit(self) -> None:
        self.emit("truncation", reason="spool_limit", complete=False, stable=False)
        raise EvidenceLimit("spool_limit")

    def observe(self, item: Row, previous: Row) -> Row:
        key = item["Key"]
        unknown = "sha256 eligible_from provider dataset row_count row_count_basis"
        row: Row = dict.fromkeys(unknown.split())
        row.update(
            key=key,
            identity=identity(item),
            verification="unknown",
            source_digest_basis="unknown",
            byte_size=item["Size"],
            byte_size_basis="S3 LIST",
        )
        row.update(classify(key))
        if self.store == "published":
            try:
                row["sha256"], row["verification"] = self.hash_object(item)
            except EvidenceLimit:
                raise
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
        observations = (
            (path, row)
            for path in (self.rescan, self.output)
            for row in records(path)
            if path != self.output or row.get("kind") == "pending"
        )
        for index, (path, previous) in enumerate(observations):
            if index < self.state.get("delta_offset", 0):
                continue
            if (
                previous.get("kind") in ("object", "pending")
                and previous == recent(path, {previous["key"]}, False)[previous["key"]]
            ):
                if self.counts["keys"] >= self.limits["keys"]:
                    return
                self.counts["keys"] += 1
                try:
                    current = identity(self.request("HEAD", Key=previous["key"]))
                    status = "unchanged" if current == previous.get("identity") else CHANGED
                    if status == "unchanged" and path == self.output:
                        status = previous["verification"]
                except (ClientError, FileNotFoundError) as exc:
                    code = exc.response["Error"]["Code"] if isinstance(exc, ClientError) else "404"
                    status = "disappeared" if code in MISSING else FAILED
                except Exception:
                    status = FAILED
                self.emit(
                    "delta",
                    key=previous["key"],
                    verification=status,
                    prior_hashing_status=previous.get("verification", "unknown"),
                )
                self.state["failures"] += status != "unchanged"
                self.counts["failures"] += status != "unchanged"
            self.state["delta_offset"] = index + 1
        self.state["phase"] = "done"

    def run(self) -> Row:
        if self.state.get("truncated"):
            raise EvidenceLimit("receipt_limit")
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
        except EvidenceLimit:
            self.state["failures"] += 1
            self.counts["failures"] += 1
            raise
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

    def close(self) -> None:
        self.evidence.close()


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
    max_output_bytes: int = 2**26,
    max_spool_bytes: int = 2**32,
) -> Row:
    if not 1 <= max_keys <= 10000 or not 0 <= max_bytes <= 1073741824 or not 1 <= page_size <= 1000:
        raise ValueError("inventory budget exceeded")
    if store not in ("raw", "published"):
        raise ValueError("unknown store")
    with evidence_lock(cursor.parent):
        if max_output_bytes < 512 or max_spool_bytes < 1:
            raise ValueError("invalid evidence limit")
        limits = dict(
            keys=max_keys,
            bytes=max_bytes,
            page=page_size,
            output=max_output_bytes,
            spool=max_spool_bytes,
        )
        with closing(ObjectScan(client, bucket, store, output, cursor, limits, rescan)) as scan:
            return scan.run()


def guarded(action: Callable[[], Any]) -> int:
    try:
        action()
        return 0
    except Exception:
        sys.stderr.write("inventory failed; details withheld\n")
        return 1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("database", "objects"))
    for flag in ("output", "cursor", "rescan"):
        parser.add_argument("--" + flag, type=Path, required=flag == "output")
    parser.add_argument("--not-after", type=datetime.fromisoformat)
    parser.add_argument("--store", choices=("raw", "published"))
    for flag, default in (
        ("max-keys", 10000),
        ("max-get-bytes", 2**30),
        ("max-output-bytes", 2**26),
        ("max-spool-bytes", 2**32),
    ):
        parser.add_argument("--" + flag, type=int, default=default)
    args, settings = parser.parse_args(), get_settings()
    if args.mode == "database":
        if args.not_after is None or args.max_output_bytes < 512:
            raise ValueError("deadline and valid evidence limit required")
        local = LocalFile(args.output, args.max_output_bytes)
        engine = create_engine(
            settings.sqlalchemy_database_url or "",
            poolclass=NullPool,
            hide_parameters=True,
            connect_args={"connect_timeout": 10, "options": "-c default_transaction_read_only=on"},
        )
        try:
            database(engine, settings, local.emit, args.not_after)
        finally:
            engine.dispose()
            local.close()
    else:
        if args.store is None or args.cursor is None:
            raise ValueError("store and cursor required")
        field: BucketSetting = "BRONZE_S3_BUCKET" if args.store == "raw" else "SNAPSHOT_R2_BUCKET"
        _, bucket = validated_s3_target(settings, bucket_setting=field)
        client: Any = build_s3_client(settings, bucket_setting=field)
        with closing(client):
            objects(
                client,
                bucket,
                args.store,
                args.output,
                args.cursor,
                args.max_keys,
                args.max_get_bytes,
                rescan=args.rescan,
                max_output_bytes=args.max_output_bytes,
                max_spool_bytes=args.max_spool_bytes,
            )


if __name__ == "__main__":
    sys.exit(guarded(main))
