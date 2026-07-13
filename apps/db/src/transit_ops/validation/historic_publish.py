"""Fail-closed proof that a historic publication is current and publicly readable."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from http.client import HTTPException
from pathlib import Path
from typing import Literal, TypeVar
from urllib.parse import unquote, urlsplit
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
    Manifest,
    ManifestHistoricFiles,
    Receipt,
    ReceiptsIndex,
    RouteReliability,
    RouteReliabilityIndex,
)
from transit_ops.snapshots.gate import check_alert_archive_index

SYNC_MAX_AGE = timedelta(hours=6)
GATE_MAX_AGE = timedelta(hours=36)
FUTURE_SKEW = timedelta(minutes=5)

FetchBytes = Callable[[str], bytes]


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
_PERCENT_ESCAPE = re.compile(r"%([0-9a-fA-F]{2})")
_ENCODED_UNSAFE_BYTES = {ord(character) for character in "./\\?#:@"}
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


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


def _safe_public_path(path: str) -> str:
    canonical = path
    while True:
        if any(
            int(match.group(1), 16) in _ENCODED_UNSAFE_BYTES
            for match in _PERCENT_ESCAPE.finditer(canonical)
        ):
            raise ValueError("unsafe_public_path")
        decoded = unquote(canonical, errors="strict")
        if decoded == canonical:
            break
        canonical = decoded

    parsed = urlsplit(canonical)
    segments = canonical.split("/")
    if (
        not canonical
        or parsed.scheme
        or parsed.netloc
        or canonical.startswith("/")
        or "\\" in canonical
        or "%" in canonical
        or parsed.query
        or parsed.fragment
        or any(segment in {"", ".", ".."} for segment in segments)
        or any(
            character.isspace() or ord(character) < 0x20 or ord(character) == 0x7F
            for character in canonical
        )
    ):
        raise ValueError("unsafe_public_path")
    return canonical


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
    try:
        raw = fetch_bytes(url)
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


def _check_sync_expectations(
    sync_values: dict[str, object],
    expectations: AlertExpectations,
    failures: list[str],
) -> None:
    if sync_values.get("source_count") != expectations.total_alerts:
        _add_failure(failures, "sync_source_count_mismatch")
    expected_from = (
        date.fromisoformat(expectations.first_available_date)
        if expectations.first_available_date is not None
        else None
    )
    expected_to = (
        date.fromisoformat(expectations.last_available_date)
        if expectations.last_available_date is not None
        else None
    )
    if (
        sync_values.get("source_from") != expected_from
        or sync_values.get("source_to") != expected_to
    ):
        _add_failure(failures, "sync_source_bounds_mismatch")


def _index_evidence(
    path: str,
    payload: AlertArchiveIndex | ReceiptsIndex | RouteReliabilityIndex,
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
    return {
        "path": path,
        "generated_utc": payload.generated_utc,
        "route_ids": list(payload.route_ids),
    }


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
    elif database_source_text_count is None or public_source_text_count is None:
        status = "unavailable"
    elif database_source_text_count <= 0 or public_source_text_count <= 0:
        status = "missing"
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
) -> HistoricPublishProofReport:
    resolved_settings = settings or get_settings()
    now = (now_utc or datetime.now(UTC)).astimezone(UTC)
    failures: list[str] = []
    artifacts: dict[str, dict[str, object]] = {}

    sync, parsed_sync = _parse_sync_receipt(
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
        else:
            _check_sync_expectations(parsed_sync, expectations, failures)

    public_root = _public_root(resolved_settings, provider_id, failures)
    public: dict[str, object] = {
        "base_url": public_root,
        "manifest": {},
        "indexes": {},
        "boundary_receipts": [],
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

    if expectations is not None and expectations.total_alerts > 0:
        if expectations.archive_source_text_count <= 0 or not archive_public_source_text_count:
            _add_failure(failures, "archive_source_text_missing")
        if expectations.archive_description_count > 0 and not archive_public_description_count:
            _add_failure(failures, "archive_source_description_missing")
    if expectations is not None and expectations.legacy_alert_count > 0:
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


__all__ = [
    "AlertExpectations",
    "HistoricPublishProofReport",
    "MigrationEvidence",
    "build_historic_publish_proof",
]
