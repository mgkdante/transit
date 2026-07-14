"""Fail-closed proof that a historic publication is current and publicly readable."""

from __future__ import annotations

import hashlib
import json
import re
import time
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import Future, ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from contextvars import ContextVar
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, timedelta
from http.client import HTTPException
from multiprocessing import get_context
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Literal, TypeVar, cast
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from uuid import uuid4

from alembic.config import Config
from alembic.script import ScriptDirectory
from pydantic import BaseModel, ValidationError
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

from transit_ops.db.connection import make_engine
from transit_ops.settings import Settings, get_settings
from transit_ops.snapshots import builders
from transit_ops.snapshots.contract import (
    AlertArchiveIndex,
    AlertArchivePage,
    AlertHistory,
    HistoricAvailabilityIndex,
    HistoricCollectionIndex,
    HistoricEntityDirectoryIndex,
    HistoricFamilyAvailability,
    HistoricHotspotsDay,
    HistoricPartitionRef,
    HistoricRepeatOffendersDay,
    LineHistoryPartition,
    Manifest,
    ManifestHistoricFiles,
    NetworkHistoryPartition,
    Receipt,
    ReceiptsIndex,
    RouteReliability,
    RouteReliabilityIndex,
    StopHistoryPartition,
)
from transit_ops.snapshots.gate import (
    CheckResult,
    Severity,
    check_alert_archive_index,
    check_history_availability_graph,
    check_history_availability_index,
    check_line_history_directory,
    check_line_history_index,
    check_line_history_partition,
    check_line_history_partition_ref,
    check_network_history_index,
    check_network_history_partition,
    check_network_history_partition_ref,
    check_point_history_day,
    check_point_history_index,
    check_stop_history_directory,
    check_stop_history_index,
    check_stop_history_partition,
    check_stop_history_partition_ref,
)
from transit_ops.snapshots.paths import safe_public_path as _safe_public_path

SYNC_MAX_AGE = timedelta(hours=6)
GATE_MAX_AGE = timedelta(hours=36)
FUTURE_SKEW = timedelta(minutes=5)
HISTORIC_PROOF_FETCH_CONCURRENCY = 8
HISTORIC_PROOF_TIMEOUT_SECONDS = 35 * 60
RANGE_PARTITION_SAMPLE_LIMIT_PER_FAMILY = 8
RANGE_PARTITION_SAMPLING_METHOD = "sha256-generation-seeded-boundary-interior-v1"

FetchBytes = Callable[[str], bytes]
MonotonicClock = Callable[[], float]


class HistoricProofDeadlineExceeded(TimeoutError):
    """Raised internally when public proof work reaches its monotonic deadline."""


@dataclass
class _HistoricProofDeadline:
    budget_seconds: float
    monotonic: MonotonicClock
    started_monotonic: float = field(init=False)
    exceeded: bool = False
    exceeded_elapsed_seconds: float | None = None
    skipped_request_count: int = 0
    cancelled_request_count: int = 0
    abandoned_request_count: int = 0
    whole_proof_process_terminated_count: int = 0
    max_batch_size: int = 0

    def __post_init__(self) -> None:
        if self.budget_seconds <= 0:
            raise ValueError("proof_timeout_seconds must be greater than zero")
        self.started_monotonic = self.monotonic()

    def elapsed_seconds(self) -> float:
        return max(0.0, self.monotonic() - self.started_monotonic)

    def remaining_seconds(self) -> float:
        return max(0.0, self.budget_seconds - self.elapsed_seconds())

    def is_expired(self) -> bool:
        return self.exceeded or self.remaining_seconds() <= 0

    def mark_exceeded(self, failures: list[str], *, skipped: int = 0) -> None:
        if not self.exceeded:
            self.exceeded = True
            self.exceeded_elapsed_seconds = self.elapsed_seconds()
        self.skipped_request_count += skipped
        _add_failure(failures, "historic_proof_deadline_exceeded")

    def record_batch(self, size: int) -> None:
        self.max_batch_size = max(self.max_batch_size, size)

    def record_shutdown(self, *, cancelled: int, abandoned: int) -> None:
        self.cancelled_request_count += cancelled
        self.abandoned_request_count += abandoned

    def record_whole_proof_process_terminated(self) -> None:
        self.whole_proof_process_terminated_count += 1

    def evidence(self) -> dict[str, object]:
        elapsed = self.exceeded_elapsed_seconds
        if elapsed is None:
            elapsed = self.elapsed_seconds()
        return {
            "budget_seconds": self.budget_seconds,
            "elapsed_seconds": round(elapsed, 6),
            "exceeded": self.exceeded,
            "failure": "historic_proof_deadline_exceeded" if self.exceeded else None,
            "fetch_batch_size_limit": HISTORIC_PROOF_FETCH_CONCURRENCY,
            "max_batch_size": self.max_batch_size,
            "skipped_request_count": self.skipped_request_count,
            "cancelled_request_count": self.cancelled_request_count,
            "abandoned_request_count": self.abandoned_request_count,
            "whole_proof_process_terminated_count": self.whole_proof_process_terminated_count,
        }


_ACTIVE_PROOF_DEADLINE: ContextVar[_HistoricProofDeadline | None] = ContextVar(
    "historic_publish_proof_deadline",
    default=None,
)


@dataclass(frozen=True)
class MigrationEvidence:
    repository_heads: Sequence[str]
    database_heads: Sequence[str]


@dataclass(frozen=True)
class AlertExpectations:
    collection_generation_id: str
    total_alerts: int
    first_available_date: str | None
    last_available_date: str | None
    archive_source_text_count: int
    archive_description_count: int
    legacy_alert_count: int
    legacy_source_text_count: int
    legacy_description_count: int


MigrationReader = Callable[[Settings, Engine], MigrationEvidence]
ExpectationsReader = Callable[[str, str, Engine], AlertExpectations]


@dataclass(frozen=True)
class HistoricPublishProofReport:
    provider_id: str
    verified_at_utc: datetime
    status: Literal["pass", "fail"]
    migration: dict[str, object]
    sync: dict[str, object]
    gate: dict[str, object]
    public: dict[str, object]
    source_messages: dict[str, object]
    failures: Sequence[str]

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "verified_at_utc": self.verified_at_utc.isoformat(),
            "status": self.status,
            "migration": self.migration,
            "sync": self.sync,
            "gate": self.gate,
            "public": self.public,
            "source_messages": self.source_messages,
            "failures": list(self.failures),
        }


OperationalErrorTypes = (OSError, ValueError, SQLAlchemyError)
PayloadT = TypeVar("PayloadT", bound=BaseModel)
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
PointFamily = Literal["hotspots", "repeat_offenders"]
_POINT_DAY_MODELS: dict[
    PointFamily,
    type[HistoricHotspotsDay] | type[HistoricRepeatOffendersDay],
] = {
    "hotspots": HistoricHotspotsDay,
    "repeat_offenders": HistoricRepeatOffendersDay,
}


def _has_source_text(alert: object) -> bool:
    return any(
        isinstance(value, str) and value.strip()
        for value in (
            getattr(alert, "header_text", None),
            getattr(alert, "header_text_en", None),
            getattr(alert, "description", None),
            getattr(alert, "description_en", None),
        )
    )


def _has_description(alert: object) -> bool:
    return any(
        isinstance(value, str) and value.strip()
        for value in (
            getattr(alert, "description", None),
            getattr(alert, "description_en", None),
        )
    )


def _add_failure(
    failures: list[str],
    code: str,
    artifact: dict[str, object] | None = None,
) -> None:
    if code not in failures:
        failures.append(code)
    if artifact is None:
        return
    artifact_failures = artifact.setdefault("failures", [])
    if not isinstance(artifact_failures, list):  # pragma: no cover - internal invariant
        raise TypeError("artifact failures must be a list")
    if code not in artifact_failures:
        artifact_failures.append(code)
    artifact["status"] = "fail"


def _artifact_entry(
    artifacts: dict[str, dict[str, object]],
    path: str,
    *,
    url: str | None,
    model_name: str,
) -> dict[str, object]:
    key = path or "<empty>"
    artifact = {
        "path": path,
        "url": url,
        "model": model_name,
        "status": "pending",
        "failures": [],
    }
    artifacts[key] = artifact
    return artifact


def _default_fetch_bytes(url: str) -> bytes:
    request = Request(url, headers={"Accept": "application/json", "Cache-Control": "no-cache"})
    with urlopen(request, timeout=30) as response:  # noqa: S310
        return response.read()


def _public_root(settings: Settings, provider_id: str, failures: list[str]) -> str | None:
    raw_base = settings.SNAPSHOT_PUBLIC_BASE_URL
    if not raw_base:
        _add_failure(failures, "snapshot_public_base_url_missing")
        return None
    try:
        parsed = urlsplit(raw_base)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        _add_failure(failures, "snapshot_public_base_url_invalid")
        return None
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or hostname is None
        or port == 0
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or any(
            character.isspace() or ord(character) < 0x20 or ord(character) == 0x7F
            for character in raw_base
        )
    ):
        _add_failure(failures, "snapshot_public_base_url_invalid")
        return None
    try:
        safe_provider = _safe_public_path(provider_id)
    except ValueError:
        _add_failure(failures, "unsafe_public_path")
        return None
    return f"{raw_base.rstrip('/')}/v1/{safe_provider}/"


def _fetch_model(
    path: str,
    model_type: type[PayloadT],
    *,
    public_root: str,
    fetch_bytes: FetchBytes,
    artifacts: dict[str, dict[str, object]],
    failures: list[str],
    query: str | None = None,
    gate_digests: Mapping[str, object] | None = None,
    bind_gate_digest: bool = False,
) -> tuple[PayloadT | None, bytes | None, dict[str, object]]:
    try:
        safe_path = _safe_public_path(path)
    except ValueError:
        artifact = _artifact_entry(
            artifacts,
            path,
            url=None,
            model_name=model_type.__name__,
        )
        _add_failure(failures, "unsafe_public_path", artifact)
        return None, None, artifact

    url = f"{public_root}{safe_path}"
    if query is not None:
        url = f"{url}?{query}"
    artifact = _artifact_entry(
        artifacts,
        safe_path,
        url=url,
        model_name=model_type.__name__,
    )
    deadline = _ACTIVE_PROOF_DEADLINE.get()
    if deadline is not None and deadline.is_expired():
        deadline.mark_exceeded(failures, skipped=1)
        artifact["error_type"] = HistoricProofDeadlineExceeded.__name__
        _add_failure(failures, "historic_proof_deadline_exceeded", artifact)
        return None, None, artifact
    try:
        raw = fetch_bytes(url)
    except HistoricProofDeadlineExceeded:
        if deadline is not None:
            deadline.mark_exceeded(failures, skipped=1)
        artifact["error_type"] = HistoricProofDeadlineExceeded.__name__
        _add_failure(failures, "historic_proof_deadline_exceeded", artifact)
        return None, None, artifact
    except (*OperationalErrorTypes, HTTPException) as exc:
        artifact["error_type"] = type(exc).__name__
        _add_failure(failures, "public_artifact_fetch_failed", artifact)
        return None, None, artifact

    artifact["byte_size"] = len(raw)
    actual_sha256 = hashlib.sha256(raw).hexdigest()
    artifact["sha256"] = actual_sha256
    if bind_gate_digest:
        if gate_digests is None or safe_path not in gate_digests:
            _add_failure(failures, "public_gate_digest_missing", artifact)
        else:
            expected_sha256 = gate_digests[safe_path]
            if (
                not isinstance(expected_sha256, str)
                or _SHA256_RE.fullmatch(expected_sha256) is None
            ):
                _add_failure(failures, "public_gate_digest_invalid", artifact)
            else:
                artifact["gate_sha256"] = expected_sha256
                artifact["gate_sha256_matches"] = actual_sha256 == expected_sha256
                if actual_sha256 != expected_sha256:
                    _add_failure(failures, "public_gate_digest_mismatch", artifact)
    try:
        payload = model_type.model_validate_json(raw)
    except (ValidationError, UnicodeError):
        artifact["error_type"] = "contract_validation"
        _add_failure(failures, "public_artifact_invalid", artifact)
        return None, raw, artifact
    if artifact["status"] == "pending":
        artifact["status"] = "pass"
    return payload, raw, artifact


ModelFetchResult = tuple[BaseModel | None, bytes | None, dict[str, object]]


def _fetch_models_bounded(
    requests: Sequence[tuple[str, type[BaseModel]]],
    *,
    public_root: str,
    fetch_bytes: FetchBytes,
    artifacts: dict[str, dict[str, object]],
    failures: list[str],
    query: str,
    gate_digests: Mapping[str, object] | None,
    bind_gate_digest: bool = True,
) -> list[ModelFetchResult]:
    """Fetch fixed-size windows and validate each window in stable input order."""

    if not requests:
        return []
    deadline = _ACTIVE_PROOF_DEADLINE.get()
    results: list[ModelFetchResult] = []

    def deadline_results(count: int) -> list[ModelFetchResult]:
        if count <= 0:
            return []
        if deadline is not None:
            deadline.mark_exceeded(failures, skipped=count)
        key = "<historic-proof-deadline>"
        artifact = artifacts.get(key)
        if artifact is None:
            artifact = _artifact_entry(
                artifacts,
                key,
                url=None,
                model_name="HistoricProofDeadline",
            )
        artifact["skipped_request_count"] = int(artifact.get("skipped_request_count", 0)) + count
        _add_failure(failures, "historic_proof_deadline_exceeded", artifact)
        return [(None, None, artifact)] * count

    def prefetched_reader(future_map: Mapping[str, Future[bytes]]) -> FetchBytes:
        def prefetched(url: str) -> bytes:
            future = future_map.get(url)
            if future is None:
                if deadline is not None and deadline.is_expired():
                    raise HistoricProofDeadlineExceeded
                raise ValueError("unsafe public path was not prefetched")
            if deadline is None:
                return future.result()
            remaining = deadline.remaining_seconds()
            if remaining <= 0:
                raise HistoricProofDeadlineExceeded
            try:
                return future.result(timeout=remaining)
            except FutureTimeoutError as exc:
                if deadline.is_expired():
                    raise HistoricProofDeadlineExceeded from exc
                raise

        return prefetched

    for offset in range(0, len(requests), HISTORIC_PROOF_FETCH_CONCURRENCY):
        if deadline is not None and deadline.is_expired():
            results.extend(deadline_results(len(requests) - offset))
            break

        batch = requests[offset : offset + HISTORIC_PROOF_FETCH_CONCURRENCY]
        worker_count = min(HISTORIC_PROOF_FETCH_CONCURRENCY, len(batch))
        executor = ThreadPoolExecutor(max_workers=worker_count)
        futures: dict[str, Future[bytes]] = {}
        try:
            for path, _ in batch:
                if deadline is not None and deadline.is_expired():
                    deadline.mark_exceeded(failures)
                    break
                try:
                    safe_path = _safe_public_path(path)
                except ValueError:
                    continue
                url = f"{public_root}{safe_path}?{query}"
                if url not in futures:
                    futures[url] = executor.submit(fetch_bytes, url)
            if deadline is not None:
                deadline.record_batch(len(futures))
            prefetched = prefetched_reader(futures)

            for path, model_type in batch:
                payload, raw, artifact = _fetch_model(
                    path,
                    model_type,
                    public_root=public_root,
                    fetch_bytes=prefetched,
                    artifacts=artifacts,
                    failures=failures,
                    query=query,
                    gate_digests=gate_digests,
                    bind_gate_digest=bind_gate_digest,
                )
                results.append((payload, raw, artifact))
        finally:
            cancelled = 0
            abandoned = 0
            for future in futures.values():
                if future.done():
                    continue
                if future.cancel():
                    cancelled += 1
                elif not future.done():
                    abandoned += 1
            if deadline is not None:
                deadline.record_shutdown(cancelled=cancelled, abandoned=abandoned)
            executor.shutdown(wait=False, cancel_futures=True)

        if deadline is not None and deadline.is_expired():
            remaining_count = len(requests) - offset - len(batch)
            results.extend(deadline_results(remaining_count))
            break

    return results


def _read_migration_evidence(settings: Settings, engine: Engine) -> MigrationEvidence:
    db_root = Path(__file__).resolve().parents[3]
    config = Config(str(db_root / "alembic.ini"))
    config.set_main_option(
        "script_location",
        str(db_root / "src/transit_ops/db/migrations"),
    )
    repository_heads = tuple(ScriptDirectory.from_config(config).get_heads())
    with engine.connect() as connection:
        database_heads = tuple(
            connection.execute(
                text("SELECT version_num FROM alembic_version ORDER BY version_num")
            ).scalars()
        )
    return MigrationEvidence(repository_heads, database_heads)


def _read_alert_expectations(
    provider_id: str,
    generated_utc: str,
    engine: Engine,
) -> AlertExpectations:
    with engine.connect() as connection:
        archive = builders.build_alert_archive(
            connection,
            provider_id,
            generated_utc=generated_utc,
        )
        legacy = builders.build_alert_history(
            connection,
            provider_id,
            generated_utc=generated_utc,
        )
    archive_alerts = [alert for _, page in archive.page_items for alert in page.alerts]
    return AlertExpectations(
        collection_generation_id=archive.index.collection_generation_id,
        total_alerts=archive.index.total_alerts,
        first_available_date=archive.index.first_available_date,
        last_available_date=archive.index.last_available_date,
        archive_source_text_count=sum(_has_source_text(alert) for alert in archive_alerts),
        archive_description_count=sum(_has_description(alert) for alert in archive_alerts),
        legacy_alert_count=len(legacy.alerts),
        legacy_source_text_count=sum(_has_source_text(alert) for alert in legacy.alerts),
        legacy_description_count=sum(_has_description(alert) for alert in legacy.alerts),
    )


def _parse_date(value: object) -> date | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("date must be an ISO string")
    return date.fromisoformat(value)


def _parse_datetime(value: object) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    else:
        raise ValueError("timestamp must be an ISO string")
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include a UTC offset")
    return parsed.astimezone(UTC)


def _nonnegative_int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _parse_sync_receipt(
    provider_id: str,
    receipt: Mapping[str, object],
    *,
    now_utc: datetime,
    failures: list[str],
) -> tuple[dict[str, object], dict[str, object]]:
    provider = receipt.get("provider_id")
    if provider != provider_id:
        _add_failure(failures, "sync_provider_mismatch")

    dry_run = receipt.get("dry_run")
    if dry_run is not False:
        _add_failure(failures, "sync_dry_run")

    counts = {
        key: _nonnegative_int(receipt.get(key))
        for key in (
            "source_count",
            "inserted_count",
            "updated_count",
            "unchanged_count",
        )
    }
    count_arithmetic_valid = all(value is not None for value in counts.values()) and (
        counts["source_count"]
        == counts["inserted_count"] + counts["updated_count"] + counts["unchanged_count"]  # type: ignore[operator]
    )
    if not count_arithmetic_valid:
        _add_failure(failures, "sync_count_mismatch")

    parsed_dates: dict[str, date | None] = {}
    date_values_valid = True
    for key in ("requested_from", "requested_to", "source_from", "source_to"):
        try:
            parsed_dates[key] = _parse_date(receipt.get(key))
        except ValueError:
            parsed_dates[key] = None
            date_values_valid = False

    requested_from = parsed_dates["requested_from"]
    requested_to = parsed_dates["requested_to"]
    source_from = parsed_dates["source_from"]
    source_to = parsed_dates["source_to"]
    bounds_valid = bool(
        date_values_valid
        and requested_from is not None
        and requested_to is not None
        and requested_from <= requested_to
    )
    source_count = counts["source_count"]
    if bounds_valid and source_count == 0:
        bounds_valid = source_from is None and source_to is None
    elif bounds_valid and source_count is not None and source_count > 0:
        bounds_valid = bool(
            source_from is not None
            and source_to is not None
            and requested_from <= source_from <= source_to <= requested_to  # type: ignore[operator]
        )
    else:
        bounds_valid = False
    if not bounds_valid:
        _add_failure(failures, "sync_bounds_invalid")

    synced_at: datetime | None
    try:
        synced_at = _parse_datetime(receipt.get("synced_at_utc"))
    except ValueError:
        synced_at = None
        _add_failure(failures, "sync_receipt_stale")
    if synced_at is not None and not (now_utc - SYNC_MAX_AGE <= synced_at <= now_utc + FUTURE_SKEW):
        _add_failure(failures, "sync_receipt_stale")

    display = {
        "provider_id": provider if isinstance(provider, str) else None,
        "requested_from": requested_from.isoformat() if requested_from is not None else None,
        "requested_to": requested_to.isoformat() if requested_to is not None else None,
        "source_from": source_from.isoformat() if source_from is not None else None,
        "source_to": source_to.isoformat() if source_to is not None else None,
        **counts,
        "dry_run": dry_run if isinstance(dry_run, bool) else None,
        "synced_at_utc": synced_at.isoformat() if synced_at is not None else None,
        "count_arithmetic_valid": count_arithmetic_valid,
        "bounds_valid": bounds_valid,
    }
    parsed: dict[str, object] = {
        **parsed_dates,
        **counts,
    }
    return display, parsed


def _parse_gate_report(
    provider_id: str,
    report: Mapping[str, object],
    *,
    now_utc: datetime,
    failures: list[str],
) -> tuple[dict[str, object], str | None, Mapping[str, object] | None]:
    provider = report.get("provider_id")
    if provider != provider_id:
        _add_failure(failures, "gate_provider_mismatch")
    tier = report.get("tier")
    if tier != "historic":
        _add_failure(failures, "gate_tier_mismatch")

    errors = _nonnegative_int(report.get("errors"))
    checks_run = _nonnegative_int(report.get("checks_run"))
    payloads_checked = _nonnegative_int(report.get("payloads_checked"))
    if (
        errors != 0
        or checks_run is None
        or checks_run <= 0
        or payloads_checked is None
        or payloads_checked <= 0
    ):
        _add_failure(failures, "gate_failed")

    generated: datetime | None
    generated_raw = report.get("generated_utc")
    try:
        generated = _parse_datetime(generated_raw)
    except ValueError:
        generated = None
        _add_failure(failures, "gate_generation_stale")
    if generated is not None and not (now_utc - GATE_MAX_AGE <= generated <= now_utc + FUTURE_SKEW):
        _add_failure(failures, "gate_generation_stale")

    raw_payload_sha256 = report.get("payload_sha256")
    payload_sha256: dict[str, object] | None = None
    display_payload_sha256: dict[str, str] = {}
    digest_mapping_valid = isinstance(raw_payload_sha256, Mapping)
    if isinstance(raw_payload_sha256, Mapping):
        payload_sha256 = {}
        for path, digest in raw_payload_sha256.items():
            if not isinstance(path, str):
                digest_mapping_valid = False
                continue
            payload_sha256[path] = digest
            try:
                safe_path = _safe_public_path(path)
            except ValueError:
                digest_mapping_valid = False
                continue
            if (
                safe_path != path
                or not isinstance(digest, str)
                or _SHA256_RE.fullmatch(digest) is None
            ):
                digest_mapping_valid = False
                continue
            display_payload_sha256[path] = digest
    if not digest_mapping_valid:
        _add_failure(failures, "gate_payload_sha256_invalid")

    generated_text = generated_raw if isinstance(generated_raw, str) else None
    display = {
        "provider_id": provider if isinstance(provider, str) else None,
        "tier": tier if isinstance(tier, str) else None,
        "generated_utc": generated_text,
        "checks_run": checks_run,
        "payloads_checked": payloads_checked,
        "errors": errors,
        "payload_sha256": dict(sorted(display_payload_sha256.items())),
    }
    return display, generated_text, payload_sha256


def _index_evidence(
    path: str,
    payload: (AlertArchiveIndex | ReceiptsIndex | RouteReliabilityIndex | HistoricCollectionIndex),
) -> dict[str, object]:
    if isinstance(payload, AlertArchiveIndex):
        return {
            "path": path,
            "generated_utc": payload.generated_utc,
            "collection_generation_id": payload.collection_generation_id,
            "first_available_date": payload.first_available_date,
            "last_available_date": payload.last_available_date,
            "total_alerts": payload.total_alerts,
            "page_count": sum(len(month.pages) for month in payload.months),
        }
    if isinstance(payload, ReceiptsIndex):
        return {
            "path": path,
            "generated_utc": payload.generated_utc,
            "dates": list(payload.dates),
        }
    if isinstance(payload, HistoricCollectionIndex):
        return {
            "path": path,
            "family": payload.family,
            "selection_mode": payload.selection_mode.value,
            "generated_utc": payload.generated_utc,
            "publish_generation_id": payload.publish_generation_id,
            "collection_generation_id": payload.collection_generation_id,
            "first_available_date": payload.first_available_date,
            "last_available_date": payload.last_available_date,
            "available_dates": list(payload.available_dates),
            "gaps": [gap.model_dump(mode="json") for gap in payload.gaps],
            "partition_count": len(payload.partitions),
        }
    return {
        "path": path,
        "generated_utc": payload.generated_utc,
        "route_ids": list(payload.route_ids),
    }


def _record_checker_failures(
    findings: Sequence[CheckResult],
    *,
    failures: list[str],
    artifact: dict[str, object],
    failure_code: str,
) -> bool:
    errors = [finding for finding in findings if finding.severity is Severity.ERROR]
    if findings:
        artifact["contract_findings"] = [finding.to_dict() for finding in findings]
    if errors:
        _add_failure(failures, failure_code, artifact)
    return not errors


def _history_root_evidence(
    path: str,
    root: HistoricAvailabilityIndex,
) -> dict[str, object]:
    return {
        "path": path,
        "generated_utc": root.generated_utc,
        "publish_generation_id": root.publish_generation_id,
        "families": [family.model_dump(mode="json") for family in root.families],
    }


def _point_family_edge(
    root: HistoricAvailabilityIndex,
    family: PointFamily,
) -> HistoricFamilyAvailability | None:
    matches = [candidate for candidate in root.families if candidate.family == family]
    return matches[0] if len(matches) == 1 else None


def _bind_partition_refs_to_gate(
    refs: Sequence[HistoricPartitionRef],
    *,
    gate_digests: Mapping[str, object] | None,
    failures: list[str],
    failure_prefix: str,
) -> dict[str, object]:
    bound_count = 0
    failure_count = 0
    mismatch_count = 0
    failure_paths: list[str] = []
    for ref in refs:
        path = ref.path
        failure_code: str | None = None
        try:
            safe_path = _safe_public_path(path)
        except ValueError:
            safe_path = path
            failure_code = f"{failure_prefix}_path_invalid"
        advertised_digest = ref.sha256
        gate_digest = gate_digests.get(safe_path) if gate_digests is not None else None
        if failure_code is None and (
            advertised_digest is None or _SHA256_RE.fullmatch(advertised_digest) is None
        ):
            failure_code = f"{failure_prefix}_ref_digest_invalid"
        elif failure_code is None and (gate_digests is None or safe_path not in gate_digests):
            failure_code = f"{failure_prefix}_gate_digest_missing"
        elif failure_code is None and (
            not isinstance(gate_digest, str) or _SHA256_RE.fullmatch(gate_digest) is None
        ):
            failure_code = f"{failure_prefix}_gate_digest_invalid"
        elif failure_code is None and gate_digest != advertised_digest:
            failure_code = f"{failure_prefix}_gate_digest_mismatch"
            mismatch_count += 1

        if failure_code is None:
            bound_count += 1
            continue
        failure_count += 1
        if len(failure_paths) < 32:
            failure_paths.append(path)
        _add_failure(failures, failure_code)

    return {
        "scope": "all_partition_refs",
        "candidate_count": len(refs),
        "gate_digest_bound_count": bound_count,
        "gate_digest_failure_count": failure_count,
        "gate_digest_mismatch_count": mismatch_count,
        "gate_digest_failure_paths": failure_paths,
        "gate_digest_failure_paths_truncated": failure_count > len(failure_paths),
    }


def _verify_point_history_family(
    family: PointFamily,
    *,
    root: HistoricAvailabilityIndex,
    root_artifact: dict[str, object],
    expected_publish_generation_id: str | None,
    public_root: str,
    fetch_bytes: FetchBytes,
    artifacts: dict[str, dict[str, object]],
    indexes: dict[str, object],
    failures: list[str],
    query: str,
    gate_digests: Mapping[str, object] | None,
) -> tuple[list[str], HistoricCollectionIndex | None]:
    edge = _point_family_edge(root, family)
    if edge is None:
        _add_failure(failures, "public_history_root_invalid", root_artifact)
        return [], None

    index, raw, index_artifact = _fetch_model(
        edge.index_path,
        HistoricCollectionIndex,
        public_root=public_root,
        fetch_bytes=fetch_bytes,
        artifacts=artifacts,
        failures=failures,
        query=query,
        gate_digests=gate_digests,
        bind_gate_digest=True,
    )
    if index is None:
        return [], None
    indexes[family] = _index_evidence(edge.index_path, index)

    path_match = re.fullmatch(
        rf"historic/history/{family}/generations/([0-9a-f]{{64}})/index\.json",
        edge.index_path,
    )
    raw_sha256 = hashlib.sha256(raw).hexdigest() if raw is not None else None
    advertised_path_sha256 = path_match.group(1) if path_match is not None else None
    path_sha256_matches = (
        raw_sha256 is not None
        and advertised_path_sha256 is not None
        and raw_sha256 == advertised_path_sha256
    )
    index_artifact["path_sha256"] = advertised_path_sha256
    index_artifact["path_sha256_matches"] = path_sha256_matches
    if raw is not None and not path_sha256_matches:
        _add_failure(
            failures,
            "public_point_index_path_digest_mismatch",
            index_artifact,
        )

    index_is_valid = _record_checker_failures(
        check_point_history_index(
            index,
            rel_key=edge.index_path,
            family=family,
        ),
        failures=failures,
        artifact=index_artifact,
        failure_code="public_point_index_invalid",
    )
    if (
        expected_publish_generation_id is not None
        and index.publish_generation_id != expected_publish_generation_id
    ):
        _add_failure(
            failures,
            "public_point_index_generation_mismatch",
            index_artifact,
        )

    expected_edge = HistoricFamilyAvailability(
        family=family,
        selection_mode=index.selection_mode,
        index_path=edge.index_path,
        collection_generation_id=index.collection_generation_id,
        first_available_date=index.first_available_date,
        last_available_date=index.last_available_date,
        gaps=index.gaps,
        metrics=index.metrics,
    )
    if edge.model_dump(mode="json") != expected_edge.model_dump(mode="json"):
        _add_failure(
            failures,
            "public_history_point_edge_mismatch",
            root_artifact,
        )

    if not index_is_valid or not path_sha256_matches:
        return [], index

    refs = index.partitions
    partition_gate_binding = _bind_partition_refs_to_gate(
        refs,
        gate_digests=gate_digests,
        failures=failures,
        failure_prefix="public_point_partition",
    )
    family_index_evidence = indexes.get(family)
    if isinstance(family_index_evidence, dict):
        family_index_evidence["partition_gate_binding"] = partition_gate_binding
    boundary_refs = [] if not refs else [refs[0], *([] if len(refs) == 1 else [refs[-1]])]
    boundary_dates = [ref.coverage_start for ref in boundary_refs]
    model_type = _POINT_DAY_MODELS[family]
    for ref in boundary_refs:
        payload, day_raw, day_artifact = _fetch_model(
            ref.path,
            model_type,
            public_root=public_root,
            fetch_bytes=fetch_bytes,
            artifacts=artifacts,
            failures=failures,
            query=query,
            gate_digests=gate_digests,
            bind_gate_digest=True,
        )
        if day_raw is not None:
            day_sha256 = hashlib.sha256(day_raw).hexdigest()
            day_artifact["advertised_sha256"] = ref.sha256
            day_artifact["advertised_byte_size"] = ref.byte_size
            day_artifact["sha256_matches"] = day_sha256 == ref.sha256
            day_artifact["byte_size_matches"] = len(day_raw) == ref.byte_size
            if day_sha256 != ref.sha256:
                _add_failure(
                    failures,
                    "public_point_day_sha256_mismatch",
                    day_artifact,
                )
            if len(day_raw) != ref.byte_size:
                _add_failure(
                    failures,
                    "public_point_day_byte_size_mismatch",
                    day_artifact,
                )
        if payload is None:
            continue
        day_artifact["expected_date"] = ref.coverage_start
        day_artifact["actual_date"] = payload.date
        day_artifact["date_matches"] = (
            payload.date == ref.coverage_start == ref.coverage_end and ref.count == 1
        )
        if not day_artifact["date_matches"]:
            _add_failure(
                failures,
                "public_point_day_date_mismatch",
                day_artifact,
            )
        if payload.publish_generation_id is not None:
            _add_failure(
                failures,
                "public_point_day_generation_mismatch",
                day_artifact,
            )
        _record_checker_failures(
            check_point_history_day(payload, rel_key=ref.path),
            failures=failures,
            artifact=day_artifact,
            failure_code="public_point_day_invalid",
        )
    return boundary_dates, index


@dataclass(frozen=True)
class _RangeHistoryGraph:
    network_index: HistoricCollectionIndex | None
    line_directory: HistoricEntityDirectoryIndex | None
    line_indexes: tuple[HistoricCollectionIndex, ...]
    stop_directory: HistoricEntityDirectoryIndex | None
    stop_indexes: tuple[HistoricCollectionIndex, ...]
    remote_sample_evidence: dict[str, object]


@dataclass(frozen=True)
class _RangePartitionCandidate:
    family: Literal["network", "lines", "stops"]
    ref: HistoricPartitionRef
    model_type: type[BaseModel]
    payload_checker: Callable[..., Sequence[CheckResult]]
    ref_checker: Callable[[object, object], Sequence[CheckResult]]
    parent_index_path: str
    parent_index_gate_bound: bool
    parent_index_gate_mismatch: bool


def _bind_range_candidates_to_parent_indexes(
    candidates: Sequence[_RangePartitionCandidate],
    *,
    failures: list[str],
) -> dict[str, object]:
    """Bind refs through the exact gate-digest-bound index that advertises them."""

    bound_count = 0
    failure_count = 0
    mismatch_count = 0
    failure_paths: list[str] = []
    for candidate in candidates:
        if candidate.parent_index_gate_bound:
            bound_count += 1
            continue
        failure_count += 1
        mismatch_count += candidate.parent_index_gate_mismatch
        if len(failure_paths) < 32:
            failure_paths.append(candidate.ref.path)
        _add_failure(failures, "public_range_partition_parent_index_unbound")

    parent_paths = sorted({candidate.parent_index_path for candidate in candidates})
    return {
        "scope": "all_partition_refs",
        "binding_source": "exact_gate_bound_parent_indexes",
        "candidate_count": len(candidates),
        "parent_index_count": len(parent_paths),
        "parent_index_paths": parent_paths,
        "gate_digest_bound_count": bound_count,
        "gate_digest_failure_count": failure_count,
        "gate_digest_mismatch_count": mismatch_count,
        "gate_digest_failure_paths": failure_paths,
        "gate_digest_failure_paths_truncated": failure_count > len(failure_paths),
    }


def _verify_range_partition(
    ref: object,
    model_type: type[PayloadT],
    *,
    payload_checker: Callable[..., Sequence[CheckResult]],
    ref_checker: Callable[[object, object], Sequence[CheckResult]],
    family: str,
    public_root: str,
    fetch_bytes: FetchBytes,
    artifacts: dict[str, dict[str, object]],
    failures: list[str],
    query: str,
    gate_digests: Mapping[str, object] | None,
    loaded: ModelFetchResult | None = None,
) -> None:
    path = getattr(ref, "path", "")
    if loaded is None:
        payload, _, artifact = _fetch_model(
            path,
            model_type,
            public_root=public_root,
            fetch_bytes=fetch_bytes,
            artifacts=artifacts,
            failures=failures,
            query=query,
            gate_digests=gate_digests,
            bind_gate_digest=False,
        )
    else:
        payload, _, artifact = loaded
    if payload is None:
        return
    _record_checker_failures(
        payload_checker(payload, rel_key=path),
        failures=failures,
        artifact=artifact,
        failure_code=f"public_{family}_history_partition_invalid",
    )
    _record_checker_failures(
        ref_checker(ref, payload),
        failures=failures,
        artifact=artifact,
        failure_code=f"public_{family}_history_partition_ref_mismatch",
    )


def _partition_candidate_key(candidate: _RangePartitionCandidate) -> tuple[str, str, str]:
    return (
        candidate.ref.coverage_start,
        candidate.ref.coverage_end,
        candidate.ref.path,
    )


def _sample_range_partition_candidates(
    candidates: Sequence[_RangePartitionCandidate],
    *,
    seed: str,
) -> tuple[_RangePartitionCandidate, ...]:
    sampled: list[_RangePartitionCandidate] = []
    for family in ("network", "lines", "stops"):
        ordered = sorted(
            (candidate for candidate in candidates if candidate.family == family),
            key=_partition_candidate_key,
        )
        if len(ordered) <= RANGE_PARTITION_SAMPLE_LIMIT_PER_FAMILY:
            sampled.extend(ordered)
            continue

        boundaries = [ordered[0], ordered[-1]]
        interiors = ordered[1:-1]
        interiors.sort(
            key=lambda candidate: (
                hashlib.sha256(f"{seed}\0{family}\0{candidate.ref.path}".encode()).hexdigest(),
                _partition_candidate_key(candidate),
            )
        )
        chosen = [
            *boundaries,
            *interiors[: RANGE_PARTITION_SAMPLE_LIMIT_PER_FAMILY - len(boundaries)],
        ]
        sampled.extend(sorted(chosen, key=_partition_candidate_key))
    return tuple(sampled)


def _verify_range_partition_samples(
    candidates: Sequence[_RangePartitionCandidate],
    *,
    seed: str,
    public_root: str,
    fetch_bytes: FetchBytes,
    artifacts: dict[str, dict[str, object]],
    failures: list[str],
    query: str,
    gate_digests: Mapping[str, object] | None,
) -> dict[str, object]:
    family_names = ("network", "lines", "stops")
    family_evidence: dict[str, dict[str, object]] = {
        family: {
            "sample_count": 0,
            "boundary_paths": [],
            "sampled_paths": [],
        }
        for family in family_names
    }
    gate_digest_bound_count = 0
    gate_digest_failure_count = 0
    gate_digest_mismatch_count = 0
    gate_digest_failure_paths: list[str] = []

    for family in family_names:
        family_candidates = [candidate for candidate in candidates if candidate.family == family]
        binding = _bind_range_candidates_to_parent_indexes(
            family_candidates,
            failures=failures,
        )
        family_evidence[family].update(binding)
        gate_digest_bound_count += cast(int, binding["gate_digest_bound_count"])
        gate_digest_failure_count += cast(int, binding["gate_digest_failure_count"])
        gate_digest_mismatch_count += cast(int, binding["gate_digest_mismatch_count"])
        remaining = 32 - len(gate_digest_failure_paths)
        if remaining > 0:
            gate_digest_failure_paths.extend(
                cast(list[str], binding["gate_digest_failure_paths"])[:remaining]
            )

    sampled = _sample_range_partition_candidates(candidates, seed=seed)
    for family in family_names:
        ordered = sorted(
            (candidate for candidate in candidates if candidate.family == family),
            key=_partition_candidate_key,
        )
        boundaries = [] if not ordered else [ordered[0].ref.path]
        if len(ordered) > 1:
            boundaries.append(ordered[-1].ref.path)
        family_samples = [candidate.ref.path for candidate in sampled if candidate.family == family]
        family_evidence[family]["boundary_paths"] = boundaries
        family_evidence[family]["sampled_paths"] = family_samples
        family_evidence[family]["sample_count"] = len(family_samples)

    fetched = _fetch_models_bounded(
        [(candidate.ref.path, candidate.model_type) for candidate in sampled],
        public_root=public_root,
        fetch_bytes=fetch_bytes,
        artifacts=artifacts,
        failures=failures,
        query=query,
        gate_digests=gate_digests,
        bind_gate_digest=False,
    )
    for candidate, loaded in zip(sampled, fetched, strict=True):
        _verify_range_partition(
            candidate.ref,
            candidate.model_type,
            payload_checker=candidate.payload_checker,
            ref_checker=candidate.ref_checker,
            family=candidate.family,
            public_root=public_root,
            fetch_bytes=fetch_bytes,
            artifacts=artifacts,
            failures=failures,
            query=query,
            gate_digests=gate_digests,
            loaded=loaded,
        )

    return {
        "sampling_method": RANGE_PARTITION_SAMPLING_METHOD,
        "sampling_seed": seed,
        "sample_limit_per_family": RANGE_PARTITION_SAMPLE_LIMIT_PER_FAMILY,
        "remote_existence_scope": "deterministic_samples_only",
        "local_gate_binding_scope": "all_partition_refs",
        "binding_source": "exact_gate_bound_parent_indexes",
        "candidate_count": len(candidates),
        "sample_count": len(sampled),
        "sampled_paths": [candidate.ref.path for candidate in sampled],
        "gate_digest_bound_count": gate_digest_bound_count,
        "gate_digest_failure_count": gate_digest_failure_count,
        "gate_digest_mismatch_count": gate_digest_mismatch_count,
        "gate_digest_failure_paths": gate_digest_failure_paths,
        "gate_digest_failure_paths_truncated": gate_digest_failure_count
        > len(gate_digest_failure_paths),
        "parent_index_count": len({candidate.parent_index_path for candidate in candidates}),
        "families": family_evidence,
    }


def _verify_network_history_family(
    *,
    edge: HistoricFamilyAvailability,
    expected_publish_generation_id: str | None,
    public_root: str,
    fetch_bytes: FetchBytes,
    artifacts: dict[str, dict[str, object]],
    indexes: dict[str, object],
    failures: list[str],
    query: str,
    gate_digests: Mapping[str, object] | None,
    loaded_index: ModelFetchResult,
) -> tuple[HistoricCollectionIndex | None, tuple[_RangePartitionCandidate, ...]]:
    index = cast(HistoricCollectionIndex | None, loaded_index[0])
    artifact = loaded_index[2]
    if index is None:
        return None, ()
    indexes["network"] = _index_evidence(edge.index_path, index)
    _record_checker_failures(
        check_network_history_index(index, rel_key=edge.index_path),
        failures=failures,
        artifact=artifact,
        failure_code="public_network_history_index_invalid",
    )
    if (
        expected_publish_generation_id is not None
        and index.publish_generation_id != expected_publish_generation_id
    ):
        _add_failure(failures, "public_network_history_generation_mismatch", artifact)
    return index, tuple(
        _RangePartitionCandidate(
            family="network",
            ref=ref,
            model_type=NetworkHistoryPartition,
            payload_checker=check_network_history_partition,
            ref_checker=check_network_history_partition_ref,
            parent_index_path=edge.index_path,
            parent_index_gate_bound=artifact.get("gate_sha256_matches") is True,
            parent_index_gate_mismatch=(
                "public_gate_digest_mismatch" in artifact.get("failures", [])
            ),
        )
        for ref in index.partitions
    )


def _verify_entity_history_family(
    family: Literal["lines", "stops"],
    *,
    edge: HistoricFamilyAvailability,
    expected_publish_generation_id: str | None,
    public_root: str,
    fetch_bytes: FetchBytes,
    artifacts: dict[str, dict[str, object]],
    indexes: dict[str, object],
    failures: list[str],
    query: str,
    gate_digests: Mapping[str, object] | None,
    loaded_directory: ModelFetchResult,
) -> tuple[
    HistoricEntityDirectoryIndex | None,
    tuple[HistoricCollectionIndex, ...],
    tuple[_RangePartitionCandidate, ...],
]:
    if family == "lines":
        directory_checker = check_line_history_directory
        index_checker = check_line_history_index
        partition_model = LineHistoryPartition
        partition_checker = check_line_history_partition
        ref_checker = check_line_history_partition_ref
    else:
        directory_checker = check_stop_history_directory
        index_checker = check_stop_history_index
        partition_model = StopHistoryPartition
        partition_checker = check_stop_history_partition
        ref_checker = check_stop_history_partition_ref

    directory = cast(HistoricEntityDirectoryIndex | None, loaded_directory[0])
    directory_artifact = loaded_directory[2]
    if directory is None:
        return None, (), ()
    indexes[family] = {
        "path": edge.index_path,
        "family": directory.family,
        "generated_utc": directory.generated_utc,
        "publish_generation_id": directory.publish_generation_id,
        "collection_generation_id": directory.collection_generation_id,
        "first_available_date": directory.first_available_date,
        "last_available_date": directory.last_available_date,
        "entity_count": len(directory.entities),
    }
    _record_checker_failures(
        directory_checker(directory, rel_key=edge.index_path),
        failures=failures,
        artifact=directory_artifact,
        failure_code=f"public_{family}_history_directory_invalid",
    )
    if (
        expected_publish_generation_id is not None
        and directory.publish_generation_id != expected_publish_generation_id
    ):
        _add_failure(failures, f"public_{family}_history_generation_mismatch", directory_artifact)

    children: list[HistoricCollectionIndex] = []
    candidates: list[_RangePartitionCandidate] = []
    child_fetches = _fetch_models_bounded(
        [(child_edge.index_path, HistoricCollectionIndex) for child_edge in directory.entities],
        public_root=public_root,
        fetch_bytes=fetch_bytes,
        artifacts=artifacts,
        failures=failures,
        query=query,
        gate_digests=gate_digests,
    )
    for child_edge, loaded_child in zip(directory.entities, child_fetches, strict=True):
        child = cast(HistoricCollectionIndex | None, loaded_child[0])
        child_artifact = loaded_child[2]
        if child is None:
            continue
        children.append(child)
        _record_checker_failures(
            index_checker(child, rel_key=child_edge.index_path),
            failures=failures,
            artifact=child_artifact,
            failure_code=f"public_{family}_history_index_invalid",
        )
        if (
            child.entity_id != child_edge.entity_id
            or child.collection_generation_id != child_edge.collection_generation_id
            or child.first_available_date != child_edge.first_available_date
            or child.last_available_date != child_edge.last_available_date
        ):
            _add_failure(failures, f"public_{family}_history_edge_mismatch", child_artifact)
        if (
            expected_publish_generation_id is not None
            and child.publish_generation_id != expected_publish_generation_id
        ):
            _add_failure(failures, f"public_{family}_history_generation_mismatch", child_artifact)
        for ref in child.partitions:
            candidates.append(
                _RangePartitionCandidate(
                    family=family,
                    ref=ref,
                    model_type=partition_model,
                    payload_checker=partition_checker,
                    ref_checker=ref_checker,
                    parent_index_path=child_edge.index_path,
                    parent_index_gate_bound=child_artifact.get("gate_sha256_matches") is True,
                    parent_index_gate_mismatch=(
                        "public_gate_digest_mismatch" in child_artifact.get("failures", [])
                    ),
                )
            )
    return directory, tuple(children), tuple(candidates)


def _verify_range_history_graph(
    *,
    root: HistoricAvailabilityIndex,
    root_artifact: dict[str, object],
    expected_publish_generation_id: str | None,
    public_root: str,
    fetch_bytes: FetchBytes,
    artifacts: dict[str, dict[str, object]],
    indexes: dict[str, object],
    failures: list[str],
    query: str,
    gate_digests: Mapping[str, object] | None,
) -> _RangeHistoryGraph:
    edges = {edge.family: edge for edge in root.families}
    required = ("network", "lines", "stops")
    if any(family not in edges for family in required):
        _add_failure(failures, "public_history_root_invalid", root_artifact)
        empty_evidence = _verify_range_partition_samples(
            (),
            seed=expected_publish_generation_id or root.publish_generation_id or root.generated_utc,
            public_root=public_root,
            fetch_bytes=fetch_bytes,
            artifacts=artifacts,
            failures=failures,
            query=query,
            gate_digests=gate_digests,
        )
        return _RangeHistoryGraph(None, None, (), None, (), empty_evidence)

    top_level_fetches = _fetch_models_bounded(
        [
            (edges["network"].index_path, HistoricCollectionIndex),
            (edges["lines"].index_path, HistoricEntityDirectoryIndex),
            (edges["stops"].index_path, HistoricEntityDirectoryIndex),
        ],
        public_root=public_root,
        fetch_bytes=fetch_bytes,
        artifacts=artifacts,
        failures=failures,
        query=query,
        gate_digests=gate_digests,
    )

    network_index, network_candidates = _verify_network_history_family(
        edge=edges["network"],
        expected_publish_generation_id=expected_publish_generation_id,
        public_root=public_root,
        fetch_bytes=fetch_bytes,
        artifacts=artifacts,
        indexes=indexes,
        failures=failures,
        query=query,
        gate_digests=gate_digests,
        loaded_index=top_level_fetches[0],
    )
    line_directory, line_indexes, line_candidates = _verify_entity_history_family(
        "lines",
        edge=edges["lines"],
        expected_publish_generation_id=expected_publish_generation_id,
        public_root=public_root,
        fetch_bytes=fetch_bytes,
        artifacts=artifacts,
        indexes=indexes,
        failures=failures,
        query=query,
        gate_digests=gate_digests,
        loaded_directory=top_level_fetches[1],
    )
    stop_directory, stop_indexes, stop_candidates = _verify_entity_history_family(
        "stops",
        edge=edges["stops"],
        expected_publish_generation_id=expected_publish_generation_id,
        public_root=public_root,
        fetch_bytes=fetch_bytes,
        artifacts=artifacts,
        indexes=indexes,
        failures=failures,
        query=query,
        gate_digests=gate_digests,
        loaded_directory=top_level_fetches[2],
    )
    remote_sample_evidence = _verify_range_partition_samples(
        (*network_candidates, *line_candidates, *stop_candidates),
        seed=expected_publish_generation_id or root.publish_generation_id or root.generated_utc,
        public_root=public_root,
        fetch_bytes=fetch_bytes,
        artifacts=artifacts,
        failures=failures,
        query=query,
        gate_digests=gate_digests,
    )
    return _RangeHistoryGraph(
        network_index,
        line_directory,
        line_indexes,
        stop_directory,
        stop_indexes,
        remote_sample_evidence,
    )


def _boundary_values(
    values: Sequence[str],
    *,
    failures: list[str],
    artifact: dict[str, object],
    order_failure: str,
    duplicate_failure: str,
) -> list[str]:
    ordered = list(values)
    if ordered != sorted(ordered):
        _add_failure(failures, order_failure, artifact)
    if len(set(ordered)) != len(ordered):
        _add_failure(failures, duplicate_failure, artifact)
    unique = sorted(set(ordered))
    if not unique:
        return []
    return list(dict.fromkeys((unique[0], unique[-1])))


def _message_section(
    *,
    expected_alert_count: int | None,
    public_alert_count: int | None,
    database_source_text_count: int | None,
    public_source_text_count: int | None,
    database_description_count: int | None,
    public_description_count: int | None,
) -> dict[str, object]:
    if expected_alert_count == 0 and public_alert_count == 0:
        status = "no_data"
    elif expected_alert_count is None or public_alert_count is None:
        status = "unavailable"
    elif expected_alert_count != public_alert_count:
        status = "mismatch"
    elif database_source_text_count is None or public_source_text_count is None:
        status = "unavailable"
    elif database_source_text_count <= 0 or public_source_text_count <= 0:
        status = "missing"
    elif (
        database_source_text_count != public_source_text_count
        or database_description_count != public_description_count
    ):
        status = "mismatch"
    else:
        status = "ok"
    return {
        "status": status,
        "expected_alert_count": expected_alert_count,
        "public_alert_count": public_alert_count,
        "database_source_text_count": database_source_text_count,
        "public_source_text_count": public_source_text_count,
        "database_description_count": database_description_count,
        "public_description_count": public_description_count,
    }


def _build_historic_publish_proof(
    provider_id: str,
    *,
    sync_receipt: Mapping[str, object],
    gate_report: Mapping[str, object],
    settings: Settings | None = None,
    engine: Engine | None = None,
    fetch_bytes: FetchBytes | None = None,
    migration_reader: MigrationReader | None = None,
    expectations_reader: ExpectationsReader | None = None,
    now_utc: datetime | None = None,
) -> HistoricPublishProofReport:
    resolved_settings = settings or get_settings()
    now = (now_utc or datetime.now(UTC)).astimezone(UTC)
    failures: list[str] = []
    artifacts: dict[str, dict[str, object]] = {}

    sync, _ = _parse_sync_receipt(
        provider_id,
        sync_receipt,
        now_utc=now,
        failures=failures,
    )
    gate, gate_generation, gate_digests = _parse_gate_report(
        provider_id,
        gate_report,
        now_utc=now,
        failures=failures,
    )

    resolved_engine = engine
    if resolved_engine is None:
        if not resolved_settings.sqlalchemy_database_url:
            _add_failure(failures, "database_url_missing")
        else:
            try:
                resolved_engine = make_engine(resolved_settings)
            except OperationalErrorTypes:
                _add_failure(failures, "database_connection_failed")

    migration: dict[str, object] = {
        "repository_heads": [],
        "database_heads": [],
        "heads_match": False,
    }
    if resolved_engine is not None:
        try:
            migration_evidence = (migration_reader or _read_migration_evidence)(
                resolved_settings,
                resolved_engine,
            )
        except OperationalErrorTypes:
            _add_failure(failures, "migration_read_failed")
        else:
            repository_heads = sorted(set(migration_evidence.repository_heads))
            database_heads = sorted(set(migration_evidence.database_heads))
            heads_match = (
                len(repository_heads) == 1
                and len(database_heads) == 1
                and set(repository_heads) == set(database_heads)
            )
            migration = {
                "repository_heads": repository_heads,
                "database_heads": database_heads,
                "heads_match": heads_match,
            }
            if not heads_match:
                _add_failure(failures, "migration_head_mismatch")

    expectations: AlertExpectations | None = None
    if resolved_engine is not None and gate_generation is not None:
        try:
            expectations = (expectations_reader or _read_alert_expectations)(
                provider_id,
                gate_generation,
                resolved_engine,
            )
        except OperationalErrorTypes:
            _add_failure(failures, "alert_expectations_read_failed")

    public_root = _public_root(resolved_settings, provider_id, failures)
    public: dict[str, object] = {
        "base_url": public_root,
        "manifest": {},
        "history_root": {},
        "indexes": {},
        "boundary_hotspots": [],
        "boundary_receipts": [],
        "boundary_repeat_offenders": [],
        "boundary_routes": [],
        "artifacts": artifacts,
    }
    archive_public_count: int | None = None
    archive_public_source_text_count: int | None = None
    archive_public_description_count: int | None = None
    legacy_public_count: int | None = None
    legacy_public_source_text_count: int | None = None
    legacy_public_description_count: int | None = None

    if public_root is not None:
        resolved_fetch = fetch_bytes or _default_fetch_bytes
        proof_query = f"proof={uuid4().hex}"
        manifest, _, manifest_artifact = _fetch_model(
            "manifest.json",
            Manifest,
            public_root=public_root,
            fetch_bytes=resolved_fetch,
            artifacts=artifacts,
            failures=failures,
            query=proof_query,
        )
        historic_files = ManifestHistoricFiles()
        if manifest is not None:
            historic_files = manifest.files.historic
            public["manifest"] = {
                "path": "manifest.json",
                "provider": manifest.provider,
                "historic": historic_files.model_dump(mode="json"),
            }
            if manifest.provider != provider_id:
                _add_failure(failures, "manifest_provider_mismatch", manifest_artifact)

        history_root, _, history_root_artifact = _fetch_model(
            historic_files.history_index,
            HistoricAvailabilityIndex,
            public_root=public_root,
            fetch_bytes=resolved_fetch,
            artifacts=artifacts,
            failures=failures,
            query=proof_query,
            gate_digests=gate_digests,
            bind_gate_digest=True,
        )
        alerts_index, _, alerts_index_artifact = _fetch_model(
            historic_files.alerts_index,
            AlertArchiveIndex,
            public_root=public_root,
            fetch_bytes=resolved_fetch,
            artifacts=artifacts,
            failures=failures,
            query=proof_query,
            gate_digests=gate_digests,
            bind_gate_digest=True,
        )
        receipts_index, _, receipts_index_artifact = _fetch_model(
            historic_files.receipts_index,
            ReceiptsIndex,
            public_root=public_root,
            fetch_bytes=resolved_fetch,
            artifacts=artifacts,
            failures=failures,
            query=proof_query,
            gate_digests=gate_digests,
            bind_gate_digest=True,
        )
        routes_index, _, routes_index_artifact = _fetch_model(
            historic_files.route_reliability_index,
            RouteReliabilityIndex,
            public_root=public_root,
            fetch_bytes=resolved_fetch,
            artifacts=artifacts,
            failures=failures,
            query=proof_query,
            gate_digests=gate_digests,
            bind_gate_digest=True,
        )
        alert_history, _, history_artifact = _fetch_model(
            historic_files.alert_history,
            AlertHistory,
            public_root=public_root,
            fetch_bytes=resolved_fetch,
            artifacts=artifacts,
            failures=failures,
            query=proof_query,
            gate_digests=gate_digests,
            bind_gate_digest=True,
        )

        indexes = public["indexes"]
        if not isinstance(indexes, dict):  # pragma: no cover - internal invariant
            raise TypeError("public indexes must be a dict")
        index_payloads = (
            ("alerts", historic_files.alerts_index, alerts_index, alerts_index_artifact),
            ("receipts", historic_files.receipts_index, receipts_index, receipts_index_artifact),
            (
                "route_reliability",
                historic_files.route_reliability_index,
                routes_index,
                routes_index_artifact,
            ),
        )
        for name, path, payload, artifact in index_payloads:
            if payload is None:
                continue
            indexes[name] = _index_evidence(path, payload)
            if payload.generated_utc != gate_generation:
                _add_failure(failures, "public_index_generation_mismatch", artifact)

        if history_root is not None:
            public["history_root"] = _history_root_evidence(
                historic_files.history_index,
                history_root,
            )
            root_is_valid = _record_checker_failures(
                check_history_availability_index(
                    history_root,
                    rel_key=historic_files.history_index,
                ),
                failures=failures,
                artifact=history_root_artifact,
                failure_code="public_history_root_invalid",
            )
            expected_publish_generation_id = (
                f"{provider_id}@{gate_generation}" if gate_generation is not None else None
            )
            if (
                expected_publish_generation_id is not None
                and history_root.publish_generation_id != expected_publish_generation_id
            ):
                _add_failure(
                    failures,
                    "public_history_root_generation_mismatch",
                    history_root_artifact,
                )
            if root_is_valid:
                boundary_hotspots, hotspots_history_index = _verify_point_history_family(
                    "hotspots",
                    root=history_root,
                    root_artifact=history_root_artifact,
                    expected_publish_generation_id=expected_publish_generation_id,
                    public_root=public_root,
                    fetch_bytes=resolved_fetch,
                    artifacts=artifacts,
                    indexes=indexes,
                    failures=failures,
                    query=proof_query,
                    gate_digests=gate_digests,
                )
                public["boundary_hotspots"] = boundary_hotspots
                boundary_repeat, repeat_history_index = _verify_point_history_family(
                    "repeat_offenders",
                    root=history_root,
                    root_artifact=history_root_artifact,
                    expected_publish_generation_id=expected_publish_generation_id,
                    public_root=public_root,
                    fetch_bytes=resolved_fetch,
                    artifacts=artifacts,
                    indexes=indexes,
                    failures=failures,
                    query=proof_query,
                    gate_digests=gate_digests,
                )
                public["boundary_repeat_offenders"] = boundary_repeat
                range_graph = _verify_range_history_graph(
                    root=history_root,
                    root_artifact=history_root_artifact,
                    expected_publish_generation_id=expected_publish_generation_id,
                    public_root=public_root,
                    fetch_bytes=resolved_fetch,
                    artifacts=artifacts,
                    indexes=indexes,
                    failures=failures,
                    query=proof_query,
                    gate_digests=gate_digests,
                )
                public["range_partition_remote_sample"] = range_graph.remote_sample_evidence
                root_edges = {edge.family: edge for edge in history_root.families}
                _record_checker_failures(
                    check_history_availability_graph(
                        history_root,
                        alert_index=alerts_index,
                        receipts_index=receipts_index,
                        network_index=range_graph.network_index,
                        line_directory=range_graph.line_directory,
                        line_indexes=list(range_graph.line_indexes),
                        stop_directory=range_graph.stop_directory,
                        stop_indexes=list(range_graph.stop_indexes),
                        hotspots_index=hotspots_history_index,
                        repeat_offenders_index=repeat_history_index,
                        fallback_generated_utc=gate_generation or history_root.generated_utc,
                        alert_index_path=root_edges["alerts"].index_path,
                        receipt_index_path=root_edges["receipts"].index_path,
                        network_index_path=root_edges["network"].index_path,
                        line_directory_path=root_edges["lines"].index_path,
                        stop_directory_path=root_edges["stops"].index_path,
                        hotspots_index_path=root_edges["hotspots"].index_path,
                        repeat_offenders_index_path=root_edges["repeat_offenders"].index_path,
                    ),
                    failures=failures,
                    artifact=history_root_artifact,
                    failure_code="public_history_graph_invalid",
                )

        if alerts_index is not None:
            generation_findings = check_alert_archive_index(
                alerts_index,
                rel_key=historic_files.alerts_index,
            )
            if expectations is not None:
                expected_generation_index = alerts_index.model_copy(
                    update={
                        "collection_generation_id": expectations.collection_generation_id,
                    }
                )
                generation_findings.extend(
                    check_alert_archive_index(
                        expected_generation_index,
                        rel_key=historic_files.alerts_index,
                    )
                )
            if any(finding.check == "collection_generation_id" for finding in generation_findings):
                _add_failure(
                    failures,
                    "public_archive_generation_binding_mismatch",
                    alerts_index_artifact,
                )

            refs = [ref for month in alerts_index.months for ref in month.pages]
            if expectations is not None:
                if alerts_index.collection_generation_id != expectations.collection_generation_id:
                    _add_failure(
                        failures,
                        "public_archive_generation_mismatch",
                        alerts_index_artifact,
                    )
                if alerts_index.total_alerts != expectations.total_alerts:
                    _add_failure(failures, "public_archive_total_mismatch", alerts_index_artifact)
                if (
                    alerts_index.first_available_date != expectations.first_available_date
                    or alerts_index.last_available_date != expectations.last_available_date
                ):
                    _add_failure(failures, "public_archive_bounds_mismatch", alerts_index_artifact)
                if sum(ref.count for ref in refs) != expectations.total_alerts:
                    _add_failure(
                        failures,
                        "public_archive_page_total_mismatch",
                        alerts_index_artifact,
                    )

            archive_alerts: list[object] = []
            for ref in refs:
                page, raw, page_artifact = _fetch_model(
                    ref.path,
                    AlertArchivePage,
                    public_root=public_root,
                    fetch_bytes=resolved_fetch,
                    artifacts=artifacts,
                    failures=failures,
                    query=proof_query,
                    gate_digests=gate_digests,
                    bind_gate_digest=True,
                )
                if raw is not None:
                    raw_sha256 = hashlib.sha256(raw).hexdigest()
                    page_artifact["advertised_sha256"] = ref.sha256
                    page_artifact["advertised_byte_size"] = ref.byte_size
                    page_artifact["sha256_matches"] = raw_sha256 == ref.sha256
                    page_artifact["byte_size_matches"] = len(raw) == ref.byte_size
                    if raw_sha256 != ref.sha256:
                        _add_failure(
                            failures,
                            "alert_page_sha256_mismatch",
                            page_artifact,
                        )
                    if len(raw) != ref.byte_size:
                        _add_failure(
                            failures,
                            "alert_page_byte_size_mismatch",
                            page_artifact,
                        )
                if page is None:
                    continue
                actual_count = len(page.alerts)
                page_artifact["advertised_count"] = ref.count
                page_artifact["actual_count"] = actual_count
                page_artifact["count_matches"] = actual_count == ref.count
                if actual_count != ref.count:
                    _add_failure(
                        failures,
                        "alert_page_count_mismatch",
                        page_artifact,
                    )
                archive_alerts.extend(page.alerts)

            archive_public_count = len(archive_alerts)
            archive_public_source_text_count = sum(
                _has_source_text(alert) for alert in archive_alerts
            )
            archive_public_description_count = sum(
                _has_description(alert) for alert in archive_alerts
            )
            if archive_public_count != alerts_index.total_alerts:
                _add_failure(failures, "public_archive_total_mismatch", alerts_index_artifact)
            if expectations is not None and archive_public_count != expectations.total_alerts:
                _add_failure(failures, "public_archive_total_mismatch", alerts_index_artifact)

        if alert_history is not None:
            if alert_history.generated_utc != gate_generation:
                _add_failure(failures, "public_history_generation_mismatch", history_artifact)
            legacy_public_count = len(alert_history.alerts)
            legacy_public_source_text_count = sum(
                _has_source_text(alert) for alert in alert_history.alerts
            )
            legacy_public_description_count = sum(
                _has_description(alert) for alert in alert_history.alerts
            )
            if expectations is not None and legacy_public_count != expectations.legacy_alert_count:
                _add_failure(failures, "public_legacy_count_mismatch", history_artifact)

        if receipts_index is not None:
            receipt_boundaries = _boundary_values(
                receipts_index.dates,
                failures=failures,
                artifact=receipts_index_artifact,
                order_failure="receipts_index_order_invalid",
                duplicate_failure="receipts_index_duplicate_values",
            )
            public["boundary_receipts"] = receipt_boundaries
            for receipt_date in receipt_boundaries:
                receipt_path = f"{historic_files.receipts_prefix}{receipt_date}.json"
                receipt, _, receipt_artifact = _fetch_model(
                    receipt_path,
                    Receipt,
                    public_root=public_root,
                    fetch_bytes=resolved_fetch,
                    artifacts=artifacts,
                    failures=failures,
                    query=proof_query,
                    gate_digests=gate_digests,
                    bind_gate_digest=True,
                )
                if receipt is None:
                    continue
                receipt_artifact["expected_date"] = receipt_date
                receipt_artifact["actual_date"] = receipt.date
                if receipt.date != receipt_date:
                    _add_failure(failures, "receipt_date_mismatch", receipt_artifact)
                if (
                    receipt.generated_utc != receipts_index.generated_utc
                    or receipt.generated_utc != gate_generation
                ):
                    _add_failure(failures, "public_receipt_generation_mismatch", receipt_artifact)

        if routes_index is not None:
            route_boundaries = _boundary_values(
                routes_index.route_ids,
                failures=failures,
                artifact=routes_index_artifact,
                order_failure="route_reliability_index_order_invalid",
                duplicate_failure="route_reliability_index_duplicate_values",
            )
            public["boundary_routes"] = route_boundaries
            for route_id in route_boundaries:
                route_path = f"{historic_files.route_reliability_prefix}{route_id}.json"
                route, _, route_artifact = _fetch_model(
                    route_path,
                    RouteReliability,
                    public_root=public_root,
                    fetch_bytes=resolved_fetch,
                    artifacts=artifacts,
                    failures=failures,
                    query=proof_query,
                    gate_digests=gate_digests,
                    bind_gate_digest=True,
                )
                if route is None:
                    continue
                route_artifact["expected_id"] = route_id
                route_artifact["actual_id"] = route.id
                if route.id != route_id:
                    _add_failure(
                        failures,
                        "route_reliability_id_mismatch",
                        route_artifact,
                    )
                if (
                    route.generated_utc != routes_index.generated_utc
                    or route.generated_utc != gate_generation
                ):
                    _add_failure(failures, "public_route_generation_mismatch", route_artifact)

    if expectations is not None:
        if archive_public_source_text_count != expectations.archive_source_text_count:
            _add_failure(failures, "archive_source_text_count_mismatch")
        if archive_public_description_count != expectations.archive_description_count:
            _add_failure(failures, "archive_source_description_count_mismatch")
        if legacy_public_source_text_count != expectations.legacy_source_text_count:
            _add_failure(failures, "legacy_source_text_count_mismatch")
        if legacy_public_description_count != expectations.legacy_description_count:
            _add_failure(failures, "legacy_source_description_count_mismatch")

        if expectations.total_alerts > 0:
            if expectations.archive_source_text_count <= 0 or not archive_public_source_text_count:
                _add_failure(failures, "archive_source_text_missing")
            if expectations.archive_description_count > 0 and not archive_public_description_count:
                _add_failure(failures, "archive_source_description_missing")
        if expectations.legacy_alert_count > 0:
            if expectations.legacy_source_text_count <= 0 or not legacy_public_source_text_count:
                _add_failure(failures, "legacy_source_text_missing")
            if expectations.legacy_description_count > 0 and not legacy_public_description_count:
                _add_failure(failures, "legacy_source_description_missing")

    source_messages = {
        "archive": _message_section(
            expected_alert_count=expectations.total_alerts if expectations is not None else None,
            public_alert_count=archive_public_count,
            database_source_text_count=(
                expectations.archive_source_text_count if expectations is not None else None
            ),
            public_source_text_count=archive_public_source_text_count,
            database_description_count=(
                expectations.archive_description_count if expectations is not None else None
            ),
            public_description_count=archive_public_description_count,
        ),
        "legacy": _message_section(
            expected_alert_count=(
                expectations.legacy_alert_count if expectations is not None else None
            ),
            public_alert_count=legacy_public_count,
            database_source_text_count=(
                expectations.legacy_source_text_count if expectations is not None else None
            ),
            public_source_text_count=legacy_public_source_text_count,
            database_description_count=(
                expectations.legacy_description_count if expectations is not None else None
            ),
            public_description_count=legacy_public_description_count,
        ),
    }

    return HistoricPublishProofReport(
        provider_id=provider_id,
        verified_at_utc=now,
        status="fail" if failures else "pass",
        migration=migration,
        sync=sync,
        gate=gate,
        public=public,
        source_messages=source_messages,
        failures=tuple(failures),
    )


def _deadline_failure_report(
    provider_id: str,
    *,
    verified_at_utc: datetime,
    deadline: _HistoricProofDeadline,
) -> HistoricPublishProofReport:
    return HistoricPublishProofReport(
        provider_id=provider_id,
        verified_at_utc=verified_at_utc,
        status="fail",
        migration={"status": "unavailable"},
        sync={"status": "unavailable"},
        gate={"status": "unavailable"},
        public={
            "base_url": None,
            "manifest": {},
            "history_root": {},
            "indexes": {},
            "artifacts": {},
            "deadline": deadline.evidence(),
        },
        source_messages={
            "archive": {"status": "unavailable"},
            "legacy": {"status": "unavailable"},
        },
        failures=("historic_proof_deadline_exceeded",),
    )


def _report_from_display_dict(payload: Mapping[str, object]) -> HistoricPublishProofReport:
    return HistoricPublishProofReport(
        provider_id=cast(str, payload["provider_id"]),
        verified_at_utc=datetime.fromisoformat(cast(str, payload["verified_at_utc"])),
        status=cast(Literal["pass", "fail"], payload["status"]),
        migration=cast(dict[str, object], payload["migration"]),
        sync=cast(dict[str, object], payload["sync"]),
        gate=cast(dict[str, object], payload["gate"]),
        public=cast(dict[str, object], payload["public"]),
        source_messages=cast(dict[str, object], payload["source_messages"]),
        failures=tuple(cast(Sequence[str], payload["failures"])),
    )


def _isolated_proof_worker(
    outcome_path: str,
    provider_id: str,
    sync_receipt: Mapping[str, object],
    gate_report: Mapping[str, object],
    settings: Settings | None,
    engine: Engine | None,
    fetch_bytes: FetchBytes | None,
    migration_reader: MigrationReader | None,
    expectations_reader: ExpectationsReader | None,
    verified_at_utc: datetime,
    proof_timeout_seconds: float,
    monotonic: MonotonicClock | None,
) -> None:
    try:
        outcome = {
            "outcome": "result",
            "report": build_historic_publish_proof(
                provider_id,
                sync_receipt=sync_receipt,
                gate_report=gate_report,
                settings=settings,
                engine=engine,
                fetch_bytes=fetch_bytes,
                migration_reader=migration_reader,
                expectations_reader=expectations_reader,
                now_utc=verified_at_utc,
                proof_timeout_seconds=proof_timeout_seconds,
                monotonic=monotonic,
                isolate_process=False,
            ).display_dict(),
        }
    except BaseException as exc:
        outcome = {
            "outcome": "error",
            "error_type": type(exc).__name__,
        }
    Path(outcome_path).write_text(json.dumps(outcome, sort_keys=True), encoding="utf-8")


def build_historic_publish_proof(
    provider_id: str,
    *,
    sync_receipt: Mapping[str, object],
    gate_report: Mapping[str, object],
    settings: Settings | None = None,
    engine: Engine | None = None,
    fetch_bytes: FetchBytes | None = None,
    migration_reader: MigrationReader | None = None,
    expectations_reader: ExpectationsReader | None = None,
    now_utc: datetime | None = None,
    proof_timeout_seconds: float = HISTORIC_PROOF_TIMEOUT_SECONDS,
    monotonic: MonotonicClock | None = None,
    isolate_process: bool = True,
    isolation_start_method: Literal["spawn", "fork"] = "spawn",
) -> HistoricPublishProofReport:
    """Build one proof inside a verifier-owned monotonic deadline."""

    verified_at_utc = (now_utc or datetime.now(UTC)).astimezone(UTC)
    deadline = _HistoricProofDeadline(
        budget_seconds=proof_timeout_seconds,
        monotonic=monotonic or time.monotonic,
    )

    def run_proof() -> HistoricPublishProofReport:
        token = _ACTIVE_PROOF_DEADLINE.set(deadline)
        try:
            report = _build_historic_publish_proof(
                provider_id,
                sync_receipt=sync_receipt,
                gate_report=gate_report,
                settings=settings,
                engine=engine,
                fetch_bytes=fetch_bytes,
                migration_reader=migration_reader,
                expectations_reader=expectations_reader,
                now_utc=verified_at_utc,
            )
            if deadline.is_expired():
                failures = list(report.failures)
                deadline.mark_exceeded(failures)
                report = replace(report, status="fail", failures=tuple(failures))
            report.public["deadline"] = deadline.evidence()
            return report
        finally:
            _ACTIVE_PROOF_DEADLINE.reset(token)

    if not isolate_process:
        return run_proof()

    start_method = isolation_start_method
    context = get_context(start_method)
    with NamedTemporaryFile(
        prefix="historic-publish-proof-",
        suffix=".json",
        delete=False,
    ) as handle:
        outcome_path = Path(handle.name)

    process = context.Process(
        target=_isolated_proof_worker,
        args=(
            str(outcome_path),
            provider_id,
            sync_receipt,
            gate_report,
            settings,
            engine,
            fetch_bytes,
            migration_reader,
            expectations_reader,
            verified_at_utc,
            proof_timeout_seconds,
            monotonic,
        ),
        name="historic-publish-proof",
        daemon=True,
    )
    try:
        process.start()
        supervisor_headroom = min(5.0, proof_timeout_seconds * 0.1)
        worker_timeout = max(0.0, deadline.remaining_seconds() - supervisor_headroom)
        process.join(timeout=worker_timeout)
        if process.is_alive():
            process.terminate()
            process.join(timeout=0.05)
            if process.is_alive():
                process.kill()
                process.join(timeout=0.05)
            failures: list[str] = []
            deadline.mark_exceeded(failures)
            deadline.record_whole_proof_process_terminated()
            report = _deadline_failure_report(
                provider_id,
                verified_at_utc=verified_at_utc,
                deadline=deadline,
            )
            cast(dict[str, object], report.public["deadline"])["isolation_start_method"] = (
                start_method
            )
            return report

        raw_outcome = json.loads(outcome_path.read_text(encoding="utf-8"))
        if not isinstance(raw_outcome, dict):
            raise RuntimeError("historic proof worker wrote an invalid outcome")
        if raw_outcome.get("outcome") == "error":
            error_type = raw_outcome.get("error_type")
            raise RuntimeError(f"historic proof worker failed ({error_type})")
        report_payload = raw_outcome.get("report")
        if not isinstance(report_payload, dict):
            raise RuntimeError("historic proof worker omitted its report")
        report = _report_from_display_dict(report_payload)
        deadline_evidence = report.public.get("deadline")
        if isinstance(deadline_evidence, dict):
            deadline_evidence["isolation_start_method"] = start_method
        if deadline.is_expired():
            failures = list(report.failures)
            deadline.mark_exceeded(failures)
            final_deadline_evidence = deadline.evidence()
            final_deadline_evidence["isolation_start_method"] = start_method
            return replace(
                report,
                status="fail",
                failures=tuple(failures),
                public={**report.public, "deadline": final_deadline_evidence},
            )
        return report
    finally:
        outcome_path.unlink(missing_ok=True)


__all__ = [
    "AlertExpectations",
    "HISTORIC_PROOF_TIMEOUT_SECONDS",
    "HistoricPublishProofReport",
    "MigrationEvidence",
    "build_historic_publish_proof",
]
