"""Fail-closed evidence and persistence for historic publish receipts."""

from __future__ import annotations

import ast
import hashlib
import importlib.metadata
import json
import logging
import math
import platform
import re
import sys
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from contextlib import AbstractContextManager, contextmanager, nullcontext
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from enum import Enum
from pathlib import Path
from time import perf_counter_ns
from types import TracebackType
from typing import TYPE_CHECKING, Any, cast

from pydantic import BaseModel

from transit_ops.snapshots.builders.historic.history_common import (
    HistoricScopeClass,
    HistoryScopeCardinality,
    HistoryScopeSourceEvidence,
    classify_historic_scope,
    encode_history_entity_id,
    history_coverage,
    history_date,
    history_utc_timestamp,
)
from transit_ops.snapshots.contract import PAYLOAD_SCHEMA_VERSION, export_schemas
from transit_ops.sql_registry import named_query

if TYPE_CHECKING:
    from sqlalchemy.engine import Connection

    from transit_ops.settings import Settings
    from transit_ops.snapshots.gate import GateReport

logger = logging.getLogger(__name__)

RECEIPT_SCHEMA_VERSION = 1
HISTORIC_RECEIPT_UPSERT_BATCH_SIZE = 250
ROW_FRAME_VERSION = "f7-row-frame-v1"
GROUPED_DIGEST_VERSION = "f7-grouped-digest-v1"
COMMON_ENVELOPE_VERSION = "f7-common-envelope-v1"
CODE_MANIFEST_VERSION = "f7-code-manifest-v1"
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_MONTH = re.compile(r"^[0-9]{4}-(?:0[1-9]|1[0-2])$")
_FAMILIES = frozenset({"network", "lines", "stops"})
_FAMILY_METRICS = {
    "network": (
        "delay",
        "delay_percentiles",
        "vehicles",
        "cancellation",
        "occupancy",
    ),
    "lines": (
        "delay",
        "delay_percentiles",
        "cancellation",
        "occupancy",
        "service_span",
        "skipped_stops",
    ),
    "stops": ("delay", "delay_percentiles", "occupancy"),
}
_FAMILY_MODULE = {
    "network": "snapshots/builders/historic/network_history.py",
    "lines": "snapshots/builders/historic/line_history.py",
    "stops": "snapshots/builders/historic/stop_history.py",
}
_FAMILY_NAMED_QUERY_NAMES = {
    "network": frozenset(
        f"history.network.{source}{suffix}"
        for source in ("delay", "fact", "cancellation", "occupancy")
        for suffix in ("", ".inner")
    ),
    "lines": frozenset(
        f"history.lines.{source}{suffix}"
        for source in (
            "ids",
            "delay",
            "percentiles",
            "cancellation",
            "occupancy",
            "service_span",
            "skipped_stops",
        )
        for suffix in ("", ".inner")
    ),
    "stops": frozenset(
        f"history.stops.{source}{suffix}"
        for source in ("ids", "delay", "percentiles", "occupancy")
        for suffix in ("", ".inner")
    ),
}
_FAMILY_MANIFEST_SHARED = (
    "snapshots/builders/historic/history_common.py",
    "snapshots/contract.py",
    "snapshots/serialization.py",
    "snapshots/publish.py",
    "settings.py",
    "sql_registry.py",
)
_GATE_MANIFEST = (
    "snapshots/gate.py",
    "snapshots/builders/historic/network_history.py",
    "snapshots/builders/historic/line_history.py",
    "snapshots/builders/historic/stop_history.py",
    "snapshots/builders/historic/history_common.py",
    "snapshots/contract.py",
    "snapshots/serialization.py",
)
_CATALOG_RELATIONS = (
    "providers",
    "snapshot_historic_receipts",
    "snapshot_publish_state",
    "dim_provider",
    "route_delay_spine",
    "route_delay_percentile_daily",
    "route_cancellation_daily",
    "route_occupancy_band_daily",
    "route_service_span_daily",
    "route_skipped_stop_daily",
    "stop_delay_spine",
    "stop_delay_percentile_daily",
    "stop_occupancy_band_daily",
    "fact_trip_delay_snapshot",
)

_PROVIDER_RUNTIME_SQL = named_query(
    "snapshot.historic_receipts.provider_runtime",
    """
    SELECT p.timezone,
           timezone(p.timezone, now())::date AS today_local,
           current_setting('server_version_num') AS server_version_num,
           current_setting('server_encoding') AS server_encoding,
           current_setting('TimeZone') AS session_timezone,
           (
               SELECT d.datcollate
               FROM pg_database AS d
               WHERE d.datname = current_database()
           ) AS database_collation,
           (SELECT min(version_num) FROM alembic_version) AS database_alembic_head,
           (SELECT count(*)::integer FROM alembic_version)
               AS database_alembic_head_count
    FROM core.providers AS p
    WHERE p.provider_id = :provider_id
    """,
)
_SCHEMA_CATALOG_SQL = named_query(
    "snapshot.historic_receipts.schema_catalog",
    """
    SELECT n.nspname AS schema_name,
           c.relname AS relation_name,
           c.relkind,
           a.attnum,
           a.attname AS column_name,
           format_type(a.atttypid, a.atttypmod) AS data_type,
           a.attnotnull,
           COALESCE(pg_get_expr(ad.adbin, ad.adrelid), '') AS column_default,
           CASE
             WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid, true)
             ELSE ''
           END AS view_definition,
           COALESCE((
               SELECT string_agg(
                   con.conname || ':' || pg_get_constraintdef(con.oid, true),
                   chr(10)
                   ORDER BY con.conname
               )
               FROM pg_constraint AS con
               WHERE con.conrelid = c.oid
           ), '') AS constraint_definitions,
           COALESCE((
               SELECT string_agg(
                   pg_get_indexdef(idx.indexrelid),
                   chr(10)
                   ORDER BY index_class.relname
               )
               FROM pg_index AS idx
               JOIN pg_class AS index_class ON index_class.oid = idx.indexrelid
               WHERE idx.indrelid = c.oid
           ), '') AS index_definitions
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    LEFT JOIN pg_attribute AS a
      ON a.attrelid = c.oid
     AND a.attnum > 0
     AND NOT a.attisdropped
    LEFT JOIN pg_attrdef AS ad
      ON ad.adrelid = c.oid
     AND ad.adnum = a.attnum
    WHERE n.nspname IN ('core', 'gold')
      AND c.relname = ANY(CAST(:relation_names AS text[]))
    ORDER BY n.nspname, c.relname, a.attnum
    """,
)
_EXISTING_RECEIPTS_SQL = named_query(
    "snapshot.historic_receipts.existing",
    """
    SELECT family,
           entity_key,
           entity_receipt_sha256,
           ARRAY(SELECT jsonb_object_keys(month_receipts)) AS month_keys
    FROM core.snapshot_historic_receipts
    WHERE provider_id = :provider_id
      AND family = ANY(CAST(:families AS text[]))
    ORDER BY family, entity_key
    """,
)
_STALE_RECEIPT_JSON_SQL = named_query(
    "snapshot.historic_receipts.stale_json",
    """
    SELECT entity_key,
           common_envelope,
           month_receipts
    FROM core.snapshot_historic_receipts
    WHERE provider_id = :provider_id
      AND family = :family
      AND entity_key = ANY(CAST(:entity_keys AS text[]))
    ORDER BY entity_key
    """,
)
_UPSERT_RECEIPT_SQL = named_query(
    "snapshot.historic_receipts.upsert",
    """
    INSERT INTO core.snapshot_historic_receipts (
        provider_id,
        family,
        entity_key,
        receipt_schema_version,
        common_envelope,
        common_envelope_sha256,
        month_receipts,
        scope_count,
        first_scope_start,
        last_scope_end,
        entity_receipt_sha256,
        origin_publish_generation_id,
        activated_root_generation_id
    ) VALUES (
        :provider_id,
        :family,
        :entity_key,
        :receipt_schema_version,
        CAST(:common_envelope AS jsonb),
        :common_envelope_sha256,
        CAST(:month_receipts AS jsonb),
        :scope_count,
        :first_scope_start,
        :last_scope_end,
        :entity_receipt_sha256,
        :origin_publish_generation_id,
        :activated_root_generation_id
    )
    ON CONFLICT (provider_id, family, entity_key)
    DO UPDATE SET
        receipt_schema_version = EXCLUDED.receipt_schema_version,
        common_envelope = EXCLUDED.common_envelope,
        common_envelope_sha256 = EXCLUDED.common_envelope_sha256,
        month_receipts = EXCLUDED.month_receipts,
        scope_count = EXCLUDED.scope_count,
        first_scope_start = EXCLUDED.first_scope_start,
        last_scope_end = EXCLUDED.last_scope_end,
        entity_receipt_sha256 = EXCLUDED.entity_receipt_sha256,
        origin_publish_generation_id = EXCLUDED.origin_publish_generation_id,
        activated_root_generation_id = EXCLUDED.activated_root_generation_id,
        updated_at_utc = now()
    WHERE core.snapshot_historic_receipts.entity_receipt_sha256
          IS DISTINCT FROM EXCLUDED.entity_receipt_sha256
    """,
)
_DELETE_STALE_RECEIPTS_SQL = named_query(
    "snapshot.historic_receipts.delete_stale",
    """
    DELETE FROM core.snapshot_historic_receipts
    WHERE provider_id = :provider_id
      AND family = :family
      AND NOT (entity_key = ANY(CAST(:entity_keys AS text[])))
    """,
)


class HistoricReceiptEvidenceError(ValueError):
    """Required stable evidence is missing, escaped, unreadable, or inconsistent."""


def _normalize_json(value: object) -> object:
    if isinstance(value, BaseModel):
        return _normalize_json(value.model_dump(mode="json"))
    if isinstance(value, Enum):
        return _normalize_json(value.value)
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {
            str(key): _normalize_json(child)
            for key, child in sorted(value.items(), key=lambda item: str(item[0]))
        }
    if isinstance(value, set | frozenset):
        return [_normalize_json(child) for child in sorted(value, key=repr)]
    if isinstance(value, tuple | list):
        return [_normalize_json(child) for child in value]
    if isinstance(value, float) and not math.isfinite(value):
        raise HistoricReceiptEvidenceError("receipt evidence contains a non-finite float")
    if value is None or isinstance(value, str | int | float | bool):
        return value
    raise HistoricReceiptEvidenceError(
        f"receipt evidence is not canonically JSON-serializable: {type(value).__name__}"
    )


def _canonical_json_bytes(value: object) -> bytes:
    return json.dumps(
        _normalize_json(value),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _json_sha256(value: object) -> str:
    return hashlib.sha256(_canonical_json_bytes(value)).hexdigest()


def _require_sha256(name: str, value: object) -> str:
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise HistoricReceiptEvidenceError(f"{name} must be a lowercase SHA-256")
    return value


def _manifest_frame(relative_path: str, content: bytes) -> bytes:
    path_bytes = relative_path.encode("utf-8")
    return (
        len(path_bytes).to_bytes(8, "big")
        + path_bytes
        + len(content).to_bytes(8, "big")
        + content
    )


def digest_file_manifest(
    root: Path,
    *,
    required_relative_paths: Sequence[str] | None = None,
) -> str:
    """Hash sorted relative POSIX paths plus length-framed bytes, rejecting escapes."""

    root = root.resolve(strict=True)
    if not root.is_dir():
        raise HistoricReceiptEvidenceError(f"manifest root is not a directory: {root}")
    symlinks = tuple(path for path in root.rglob("*") if path.is_symlink())
    if symlinks:
        symlink_relative = symlinks[0].relative_to(root).as_posix()
        raise HistoricReceiptEvidenceError(
            f"manifest contains a symlink: {symlink_relative}"
        )
    relative_paths = (
        tuple(required_relative_paths)
        if required_relative_paths is not None
        else tuple(
            path.relative_to(root).as_posix()
            for path in sorted(root.rglob("*.py"), key=lambda item: item.as_posix())
        )
    )
    if not relative_paths:
        raise HistoricReceiptEvidenceError(f"manifest has no files: {root}")
    if len(set(relative_paths)) != len(relative_paths):
        raise HistoricReceiptEvidenceError("manifest contains duplicate relative paths")
    digest = hashlib.sha256()
    resolved_files: set[Path] = set()
    for relative_path in sorted(relative_paths):
        relative = Path(relative_path)
        if relative.is_absolute() or ".." in relative.parts:
            raise HistoricReceiptEvidenceError(f"manifest path escapes root: {relative_path}")
        candidate = root / relative
        if candidate.is_symlink():
            raise HistoricReceiptEvidenceError(f"manifest path is a symlink: {relative_path}")
        try:
            resolved = candidate.resolve(strict=True)
        except FileNotFoundError as exc:
            raise HistoricReceiptEvidenceError(
                f"manifest required file is missing: {relative_path}"
            ) from exc
        if not resolved.is_relative_to(root):
            raise HistoricReceiptEvidenceError(f"manifest path escapes root: {relative_path}")
        if resolved in resolved_files:
            raise HistoricReceiptEvidenceError(f"manifest duplicates a file: {relative_path}")
        resolved_files.add(resolved)
        if not resolved.is_file():
            raise HistoricReceiptEvidenceError(
                f"manifest required path is not a file: {relative_path}"
            )
        try:
            content = resolved.read_bytes()
        except OSError as exc:
            raise HistoricReceiptEvidenceError(
                f"manifest file is unreadable: {relative_path}"
            ) from exc
        digest.update(_manifest_frame(relative.as_posix(), content))
    return digest.hexdigest()


def _digest_file(path: Path, *, label: str) -> str:
    if path.is_symlink():
        raise HistoricReceiptEvidenceError(f"{label} must not be a symlink")
    try:
        content = path.read_bytes()
    except FileNotFoundError as exc:
        raise HistoricReceiptEvidenceError(f"{label} is missing: {path}") from exc
    except OSError as exc:
        raise HistoricReceiptEvidenceError(f"{label} is unreadable: {path}") from exc
    return hashlib.sha256(content).hexdigest()


def _migration_evidence(package_root: Path) -> tuple[str, str]:
    versions_root = package_root / "db/migrations/versions"
    files = tuple(
        path.relative_to(versions_root).as_posix()
        for path in sorted(versions_root.glob("*.py"), key=lambda item: item.name)
        if path.name != "__init__.py"
    )
    revisions: set[str] = set()
    parents: set[str] = set()
    for relative_path in files:
        path = versions_root / relative_path
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except (OSError, SyntaxError) as exc:
            raise HistoricReceiptEvidenceError(
                f"cannot parse Alembic revision: {relative_path}"
            ) from exc
        values: dict[str, object] = {}
        for node in tree.body:
            if not isinstance(node, ast.Assign) or len(node.targets) != 1:
                continue
            target = node.targets[0]
            if not isinstance(target, ast.Name) or target.id not in {"revision", "down_revision"}:
                continue
            try:
                values[target.id] = ast.literal_eval(node.value)
            except (TypeError, ValueError) as exc:
                raise HistoricReceiptEvidenceError(
                    f"nonliteral Alembic revision metadata: {relative_path}"
                ) from exc
        revision = values.get("revision")
        if not isinstance(revision, str) or not revision or revision in revisions:
            raise HistoricReceiptEvidenceError(
                f"invalid or duplicate Alembic revision: {relative_path}"
            )
        revisions.add(revision)
        down_revision = values.get("down_revision")
        if isinstance(down_revision, str):
            parents.add(down_revision)
        elif isinstance(down_revision, tuple):
            if not all(isinstance(value, str) for value in down_revision):
                raise HistoricReceiptEvidenceError(
                    f"invalid Alembic down_revision: {relative_path}"
                )
            parents.update(down_revision)
        elif down_revision is not None:
            raise HistoricReceiptEvidenceError(
                f"invalid Alembic down_revision: {relative_path}"
            )
    heads = sorted(revisions - parents)
    if len(heads) != 1:
        raise HistoricReceiptEvidenceError(f"expected one Alembic head, found {heads}")
    return heads[0], digest_file_manifest(
        versions_root,
        required_relative_paths=files,
    )


@dataclass(frozen=True)
class HistoricCommonEnvelope:
    payload: dict[str, Any]
    sha256: str


def build_historic_common_envelope(
    *,
    provider_id: str,
    provider_timezone: str,
    family: str,
    installed_code_sha256: str,
    family_manifest_sha256: str,
    named_query_sha256: Mapping[str, str],
    pyproject_sha256: str,
    uv_lock_sha256: str,
    schema_sha256: str,
    alembic_sha256: str,
    config_sha256: str,
    gate_sha256: str,
    runtime_sha256: str,
    repository_alembic_head: str,
    database_alembic_head: str,
    configuration: Mapping[str, object],
    runtime: Mapping[str, object],
    gate_values: Mapping[str, object],
) -> HistoricCommonEnvelope:
    if not provider_id or not provider_timezone:
        raise HistoricReceiptEvidenceError("provider identity and timezone are required")
    if family not in _FAMILIES:
        raise HistoricReceiptEvidenceError(f"unsupported historic family: {family!r}")
    if not repository_alembic_head or not database_alembic_head:
        raise HistoricReceiptEvidenceError("both Alembic heads are required")
    if repository_alembic_head != database_alembic_head:
        raise HistoricReceiptEvidenceError(
            "repository and database Alembic heads must match"
        )
    query_digests = {
        name: _require_sha256(f"named query {name}", digest)
        for name, digest in sorted(named_query_sha256.items())
    }
    if not query_digests:
        raise HistoricReceiptEvidenceError("named-query evidence is required")
    payload = {
        "common_envelope_version": COMMON_ENVELOPE_VERSION,
        "receipt_schema_version": RECEIPT_SCHEMA_VERSION,
        "row_frame_version": ROW_FRAME_VERSION,
        "grouped_digest_version": GROUPED_DIGEST_VERSION,
        "code_manifest_version": CODE_MANIFEST_VERSION,
        "payload_schema_version": PAYLOAD_SCHEMA_VERSION,
        "history_methodology_version": "history-1",
        "provider_id": provider_id,
        "provider_timezone": provider_timezone,
        "family": family,
        "installed_code_sha256": _require_sha256(
            "installed code digest", installed_code_sha256
        ),
        "family_manifest_sha256": _require_sha256(
            "family manifest digest", family_manifest_sha256
        ),
        "named_query_sha256": query_digests,
        "pyproject_sha256": _require_sha256("pyproject digest", pyproject_sha256),
        "uv_lock_sha256": _require_sha256("uv.lock digest", uv_lock_sha256),
        "schema_sha256": _require_sha256("schema digest", schema_sha256),
        "alembic_sha256": _require_sha256("Alembic digest", alembic_sha256),
        "config_sha256": _require_sha256("configuration digest", config_sha256),
        "gate_sha256": _require_sha256("gate digest", gate_sha256),
        "runtime_sha256": _require_sha256("runtime digest", runtime_sha256),
        "repository_alembic_head": repository_alembic_head,
        "database_alembic_head": database_alembic_head,
        "configuration": _normalize_json(configuration),
        "runtime": _normalize_json(runtime),
        "gate_values": _normalize_json(gate_values),
    }
    normalized = _normalize_json(payload)
    assert isinstance(normalized, dict)
    return HistoricCommonEnvelope(payload=normalized, sha256=_json_sha256(normalized))


def _validate_common_envelope_payload(
    payload: Mapping[str, object],
    *,
    provider_id: str,
    family: str,
    receipt_schema_version: int,
) -> None:
    required = {
        "common_envelope_version",
        "receipt_schema_version",
        "row_frame_version",
        "grouped_digest_version",
        "code_manifest_version",
        "payload_schema_version",
        "history_methodology_version",
        "provider_id",
        "provider_timezone",
        "family",
        "installed_code_sha256",
        "family_manifest_sha256",
        "named_query_sha256",
        "pyproject_sha256",
        "uv_lock_sha256",
        "schema_sha256",
        "alembic_sha256",
        "config_sha256",
        "gate_sha256",
        "runtime_sha256",
        "repository_alembic_head",
        "database_alembic_head",
        "configuration",
        "runtime",
        "gate_values",
    }
    if set(payload) != required:
        raise ValueError("historic receipt common envelope fields are incomplete")
    expected_versions = {
        "common_envelope_version": COMMON_ENVELOPE_VERSION,
        "receipt_schema_version": receipt_schema_version,
        "row_frame_version": ROW_FRAME_VERSION,
        "grouped_digest_version": GROUPED_DIGEST_VERSION,
        "code_manifest_version": CODE_MANIFEST_VERSION,
        "payload_schema_version": PAYLOAD_SCHEMA_VERSION,
        "history_methodology_version": "history-1",
    }
    if any(payload.get(name) != value for name, value in expected_versions.items()):
        raise ValueError("historic receipt common envelope version mismatch")
    if (
        payload.get("provider_id") != provider_id
        or payload.get("family") != family
        or not isinstance(payload.get("provider_timezone"), str)
        or not payload["provider_timezone"]
    ):
        raise ValueError("historic receipt common envelope identity mismatch")
    for name in (
        "installed_code_sha256",
        "family_manifest_sha256",
        "pyproject_sha256",
        "uv_lock_sha256",
        "schema_sha256",
        "alembic_sha256",
        "config_sha256",
        "gate_sha256",
        "runtime_sha256",
    ):
        value = payload.get(name)
        if not isinstance(value, str) or not _SHA256.fullmatch(value):
            raise ValueError(f"historic receipt common envelope {name} is invalid")
    query_digests = payload.get("named_query_sha256")
    if (
        not isinstance(query_digests, Mapping)
        or not query_digests
        or any(
            not isinstance(name, str)
            or not name
            or not isinstance(digest, str)
            or not _SHA256.fullmatch(digest)
            for name, digest in query_digests.items()
        )
    ):
        raise ValueError("historic receipt named-query subdigests are invalid")
    repository_head = payload.get("repository_alembic_head")
    database_head = payload.get("database_alembic_head")
    if (
        not isinstance(repository_head, str)
        or not repository_head
        or repository_head != database_head
    ):
        raise ValueError("historic receipt Alembic heads are invalid")
    if any(
        not isinstance(payload.get(name), Mapping)
        for name in ("configuration", "runtime", "gate_values")
    ):
        raise ValueError("historic receipt common envelope evidence objects are invalid")


@dataclass(frozen=True)
class HistoricProviderContext:
    provider_id: str
    timezone: str
    today_local: date
    open_window_days: int
    fact_retention_days: int
    retention_days: int

    def classify_scope(
        self,
        *,
        family: str,
        scope_start: date,
        scope_end: date,
    ) -> HistoricScopeClass:
        return classify_historic_scope(
            family=family,
            scope_start=scope_start,
            scope_end=scope_end,
            today_local=self.today_local,
            open_window_days=self.open_window_days,
            fact_retention_days=self.fact_retention_days,
            retention_days=self.retention_days,
        )


@dataclass(frozen=True)
class HistoricReceiptPreflight:
    available: bool
    provider: HistoricProviderContext | None
    common_envelope: HistoricCommonEnvelope | None
    unavailable_reason: str | None = None

    def require(self) -> tuple[HistoricProviderContext, HistoricCommonEnvelope]:
        if not self.available or self.provider is None or self.common_envelope is None:
            raise HistoricReceiptEvidenceError(
                self.unavailable_reason or "historic receipt preflight is unavailable"
            )
        return self.provider, self.common_envelope


def historic_receipts_supported(conn: object) -> bool:
    dialect = getattr(conn, "dialect", None)
    return (
        getattr(dialect, "name", None) == "postgresql"
        and callable(getattr(conn, "begin_nested", None))
        and callable(getattr(conn, "execute", None))
    )


def _runtime_versions() -> dict[str, str]:
    packages = {
        "alembic": "alembic",
        "pydantic": "pydantic",
        "pydantic_core": "pydantic-core",
        "psycopg": "psycopg",
        "sqlalchemy": "SQLAlchemy",
    }
    versions: dict[str, str] = {}
    for key, package_name in packages.items():
        try:
            versions[key] = importlib.metadata.version(package_name)
        except importlib.metadata.PackageNotFoundError as exc:
            raise HistoricReceiptEvidenceError(
                f"required runtime package metadata is missing: {package_name}"
            ) from exc
    return versions


def prepare_historic_receipt_preflight(
    conn: Any,
    *,
    provider_id: str,
    settings: Any,
    family: str,
    named_query_sha256: Mapping[str, str],
    partition_upload_batch_size: int,
    package_root: Path | None = None,
    project_root: Path | None = None,
) -> HistoricReceiptPreflight:
    """Collect provider/file/runtime/schema evidence once; non-DB fakes stay receipt-inert."""

    if not historic_receipts_supported(conn):
        return HistoricReceiptPreflight(
            available=False,
            provider=None,
            common_envelope=None,
            unavailable_reason="connection does not expose PostgreSQL receipt capabilities",
        )
    if family not in _FAMILIES:
        raise HistoricReceiptEvidenceError(f"unsupported historic family: {family!r}")
    if partition_upload_batch_size <= 0:
        raise HistoricReceiptEvidenceError("partition upload batch size must be positive")
    expected_query_names = _FAMILY_NAMED_QUERY_NAMES[family]
    if set(named_query_sha256) != expected_query_names:
        missing = sorted(expected_query_names - set(named_query_sha256))
        unknown = sorted(set(named_query_sha256) - expected_query_names)
        raise HistoricReceiptEvidenceError(
            "historic named-query evidence is incomplete or unexpected: "
            f"missing={missing}, unknown={unknown}"
        )
    package_root = (
        Path(__file__).resolve().parents[1] if package_root is None else package_root.resolve()
    )
    project_root = (
        package_root.parent.parent if project_root is None else project_root.resolve()
    )
    runtime_row = conn.execute(
        _PROVIDER_RUNTIME_SQL,
        {"provider_id": provider_id},
    ).mappings().fetchone()
    if runtime_row is None:
        raise HistoricReceiptEvidenceError(
            f"provider runtime evidence is missing for {provider_id!r}"
        )
    runtime_row = dict(runtime_row)
    provider_timezone = runtime_row.get("timezone")
    today_local = runtime_row.get("today_local")
    database_alembic_head = runtime_row.get("database_alembic_head")
    database_alembic_head_count = runtime_row.get("database_alembic_head_count")
    if (
        not isinstance(provider_timezone, str)
        or not isinstance(today_local, date)
        or not isinstance(database_alembic_head, str)
        or database_alembic_head_count != 1
    ):
        raise HistoricReceiptEvidenceError(
            "provider/runtime evidence or sole database Alembic head is missing"
        )
    catalog_rows = [
        dict(row)
        for row in conn.execute(
            _SCHEMA_CATALOG_SQL,
            {"relation_names": list(_CATALOG_RELATIONS)},
        ).mappings()
    ]
    if not catalog_rows:
        raise HistoricReceiptEvidenceError("historic schema catalog evidence is missing")
    expected_relations = {
        ("core", relation)
        if relation in {"providers", "snapshot_historic_receipts", "snapshot_publish_state"}
        else ("gold", relation)
        for relation in _CATALOG_RELATIONS
    }
    actual_relations = {
        (row.get("schema_name"), row.get("relation_name")) for row in catalog_rows
    }
    missing_relations = sorted(expected_relations - actual_relations)
    if missing_relations:
        raise HistoricReceiptEvidenceError(
            f"historic schema catalog relations are missing: {missing_relations}"
        )

    repository_alembic_head, migration_manifest_sha256 = _migration_evidence(package_root)
    if repository_alembic_head != database_alembic_head:
        raise HistoricReceiptEvidenceError(
            "repository and database Alembic heads differ: "
            f"{repository_alembic_head!r} != {database_alembic_head!r}"
        )
    installed_code_sha256 = digest_file_manifest(package_root)
    family_manifest_sha256 = digest_file_manifest(
        package_root,
        required_relative_paths=(
            _FAMILY_MODULE[family],
            *_FAMILY_MANIFEST_SHARED,
        ),
    )
    pyproject_sha256 = _digest_file(project_root / "pyproject.toml", label="pyproject.toml")
    uv_lock_sha256 = _digest_file(project_root / "uv.lock", label="uv.lock")

    schema_evidence = {
        "payload_schema_version": PAYLOAD_SCHEMA_VERSION,
        "schemas": export_schemas(),
        "catalog": catalog_rows,
    }
    schema_sha256 = _json_sha256(schema_evidence)
    alembic_evidence = {
        "repository_head": repository_alembic_head,
        "database_head": database_alembic_head,
        "migration_manifest_sha256": migration_manifest_sha256,
    }
    alembic_sha256 = _json_sha256(alembic_evidence)

    from transit_ops.snapshots import gate
    from transit_ops.snapshots.builders.historic.line_history import (
        LINE_HISTORY_ENTITY_BATCH_SIZE,
    )
    from transit_ops.snapshots.builders.historic.stop_history import (
        STOP_HISTORY_ENTITY_BATCH_SIZE,
    )

    gate_values = {
        name: value
        for name, value in vars(gate).items()
        if name.startswith("GATE_") and name.isupper()
    }
    gate_manifest_sha256 = digest_file_manifest(
        package_root,
        required_relative_paths=_GATE_MANIFEST,
    )
    gate_sha256 = _json_sha256(
        {
            "manifest_sha256": gate_manifest_sha256,
            "values": gate_values,
        }
    )
    configuration = {
        "fact_retention_days": settings.GOLD_FACT_RETENTION_DAYS,
        "open_window_days": settings.GOLD_REPORTING_OPEN_WINDOW_DAYS,
        "retention_days": settings.GOLD_WARM_ROLLUP_RETENTION_DAYS,
        "line_entity_batch_size": LINE_HISTORY_ENTITY_BATCH_SIZE,
        "stop_entity_batch_size": STOP_HISTORY_ENTITY_BATCH_SIZE,
        "partition_upload_batch_size": partition_upload_batch_size,
        "provider_timezone": provider_timezone,
    }
    config_sha256 = _json_sha256(configuration)
    runtime = {
        "python_implementation": platform.python_implementation(),
        "python_version": platform.python_version(),
        "python_hexversion": sys.hexversion,
        "packages": _runtime_versions(),
        "postgresql": {
            "server_version_num": runtime_row.get("server_version_num"),
            "server_encoding": runtime_row.get("server_encoding"),
            "session_timezone": runtime_row.get("session_timezone"),
            "database_collation": runtime_row.get("database_collation"),
        },
    }
    runtime_sha256 = _json_sha256(runtime)
    common = build_historic_common_envelope(
        provider_id=provider_id,
        provider_timezone=provider_timezone,
        family=family,
        installed_code_sha256=installed_code_sha256,
        family_manifest_sha256=family_manifest_sha256,
        named_query_sha256=named_query_sha256,
        pyproject_sha256=pyproject_sha256,
        uv_lock_sha256=uv_lock_sha256,
        schema_sha256=schema_sha256,
        alembic_sha256=alembic_sha256,
        config_sha256=config_sha256,
        gate_sha256=gate_sha256,
        runtime_sha256=runtime_sha256,
        repository_alembic_head=repository_alembic_head,
        database_alembic_head=database_alembic_head,
        configuration=configuration,
        runtime=runtime,
        gate_values=gate_values,
    )
    provider = HistoricProviderContext(
        provider_id=provider_id,
        timezone=provider_timezone,
        today_local=today_local,
        open_window_days=settings.GOLD_REPORTING_OPEN_WINDOW_DAYS,
        fact_retention_days=settings.GOLD_FACT_RETENTION_DAYS,
        retention_days=settings.GOLD_WARM_ROLLUP_RETENTION_DAYS,
    )
    return HistoricReceiptPreflight(
        available=True,
        provider=provider,
        common_envelope=common,
    )


@dataclass(frozen=True)
class HistoricScopeReceipt:
    entity_key: str
    month: str
    payload: dict[str, Any]

    def rehash(self) -> HistoricScopeReceipt:
        payload = dict(self.payload)
        payload["month"] = self.month
        payload.pop("scope_receipt_sha256", None)
        diagnostics = payload.pop("diagnostics", None)
        digest = _json_sha256(payload)
        payload["scope_receipt_sha256"] = digest
        if diagnostics is not None:
            payload["diagnostics"] = _normalize_json(diagnostics)
        return replace(self, payload=payload)


def _artifact_ref_mapping(value: object) -> dict[str, Any]:
    if isinstance(value, BaseModel):
        mapping = value.model_dump(mode="json")
    elif isinstance(value, Mapping):
        mapping = dict(value)
    else:
        raise HistoricReceiptEvidenceError("artifact ref must be a mapping or Pydantic model")
    required = ("path", "coverage_start", "coverage_end", "count", "sha256", "byte_size")
    if any(name not in mapping for name in required):
        raise HistoricReceiptEvidenceError("artifact ref evidence is incomplete")
    path = mapping["path"]
    scope_start = mapping["coverage_start"]
    scope_end = mapping["coverage_end"]
    count = mapping["count"]
    byte_size = mapping["byte_size"]
    if not isinstance(path, str) or not path:
        raise HistoricReceiptEvidenceError("artifact path must be nonempty")
    if not isinstance(scope_start, str) or not isinstance(scope_end, str):
        raise HistoricReceiptEvidenceError("artifact coverage must use ISO dates")
    try:
        start = date.fromisoformat(scope_start)
        end = date.fromisoformat(scope_end)
    except ValueError as exc:
        raise HistoricReceiptEvidenceError("artifact coverage must use ISO dates") from exc
    if start > end or start.strftime("%Y-%m") != end.strftime("%Y-%m"):
        raise HistoricReceiptEvidenceError("artifact coverage must stay within one month")
    if (
        not isinstance(count, int)
        or isinstance(count, bool)
        or count <= 0
        or not isinstance(byte_size, int)
        or isinstance(byte_size, bool)
        or byte_size <= 0
    ):
        raise HistoricReceiptEvidenceError("artifact count and byte size must be positive")
    return {
        "path": path,
        "coverage_start": scope_start,
        "coverage_end": scope_end,
        "count": count,
        "sha256": _require_sha256("artifact digest", mapping["sha256"]),
        "byte_size": byte_size,
    }


def build_historic_detached_contribution(
    *,
    family: str,
    artifact_ref: object,
    partition: object,
) -> dict[str, Any]:
    """Detach the exact compact state needed to rebuild builder and gate summaries."""

    if family not in _FAMILIES:
        raise HistoricReceiptEvidenceError(f"unsupported historic family: {family!r}")
    if isinstance(partition, BaseModel):
        partition_value = partition.model_dump(mode="json")
    elif isinstance(partition, Mapping):
        partition_value = dict(partition)
    else:
        raise HistoricReceiptEvidenceError(
            "historic partition must be a mapping or Pydantic model"
        )
    days = partition_value.get("days")
    if not isinstance(days, list) or not days:
        raise HistoricReceiptEvidenceError("historic partition contribution requires days")

    dates: list[str] = []
    metric_dates: dict[str, list[str]] = {
        metric: [] for metric in _FAMILY_METRICS[family]
    }
    for raw_day in days:
        if isinstance(raw_day, BaseModel):
            day = raw_day.model_dump(mode="json")
        elif isinstance(raw_day, Mapping):
            day = dict(raw_day)
        else:
            raise HistoricReceiptEvidenceError("historic partition day must be an object")
        local_date = day.get("date")
        if not isinstance(local_date, str):
            raise HistoricReceiptEvidenceError("historic partition day date is missing")
        try:
            canonical_date = date.fromisoformat(local_date).isoformat()
        except ValueError as exc:
            raise HistoricReceiptEvidenceError(
                "historic partition day date must be ISO"
            ) from exc
        if canonical_date != local_date:
            raise HistoricReceiptEvidenceError(
                "historic partition day date must be canonical ISO"
            )
        dates.append(local_date)
        for metric in metric_dates:
            if day.get(metric) is not None:
                metric_dates[metric].append(local_date)

    generated_utc = partition_value.get("generated_utc")
    try:
        canonical_generated_utc = history_utc_timestamp(
            generated_utc,
            field="generated_utc",
        )
    except ValueError as exc:
        raise HistoricReceiptEvidenceError(
            "historic partition generated_utc is invalid"
        ) from exc
    month = partition_value.get("month")
    if not isinstance(month, str) or not _MONTH.fullmatch(month):
        raise HistoricReceiptEvidenceError("historic partition month is invalid")
    if any(local_date[:7] != month for local_date in dates):
        raise HistoricReceiptEvidenceError("historic partition dates escape its month")
    entity_key = "" if family == "network" else partition_value.get("entity_id")
    if not isinstance(entity_key, str) or (family != "network" and not entity_key):
        raise HistoricReceiptEvidenceError("historic partition entity identity is invalid")

    first_date, last_date, gaps = history_coverage(dates)
    unique_dates = sorted(set(dates))
    normalized_metric_dates = {
        metric: sorted(set(values)) for metric, values in metric_dates.items()
    }
    ref = _artifact_ref_mapping(artifact_ref)
    if (
        ref["count"] != len(dates)
        or ref["coverage_start"] != first_date
        or ref["coverage_end"] != last_date
    ):
        raise HistoricReceiptEvidenceError(
            "historic detached contribution ref does not match partition days"
        )
    partition_header = {
        key: value for key, value in partition_value.items() if key != "days"
    }
    contribution = {
        "schema_version": 1,
        "family": family,
        "entity_key": entity_key,
        "month": month,
        "artifact_ref": ref,
        "partition_header": partition_header,
        "builder_summary_contribution": {
            "partition_ref": ref,
            "generated_utc": canonical_generated_utc,
            "first_available_date": first_date,
            "last_available_date": last_date,
            "available_dates": dates,
            "gaps": [gap.model_dump(mode="json") for gap in gaps],
            "metric_dates": metric_dates,
        },
        "gate_summary_contribution": {
            "partition_ref": ref,
            "partition_count": 1,
            "generated_utc": canonical_generated_utc,
            "malformed_generated_utc": False,
            "raw_day_count": len(dates),
            "unique_day_count": len(unique_dates),
            "available_date_mask": unique_dates,
            "metric_date_masks": normalized_metric_dates,
            "duplicate_dates": len(dates) != len(unique_dates),
            "dates_strictly_increasing": dates == unique_dates,
        },
    }
    normalized = _normalize_json(contribution)
    assert isinstance(normalized, dict)
    return normalized


def _validated_detached_contribution(
    value: Mapping[str, object],
    *,
    family: str,
    entity_key: str,
    month: str,
    ref: Mapping[str, object],
    raw_day_count: int,
) -> dict[str, Any]:
    detached = _normalize_json(value)
    if not isinstance(detached, dict):
        raise HistoricReceiptEvidenceError("historic detached contribution must be an object")
    required = {
        "schema_version",
        "family",
        "entity_key",
        "month",
        "artifact_ref",
        "partition_header",
        "builder_summary_contribution",
        "gate_summary_contribution",
    }
    if set(detached) != required or detached["schema_version"] != 1:
        raise HistoricReceiptEvidenceError(
            "historic detached contribution has missing or unknown fields"
        )
    if (
        detached["family"] != family
        or detached["entity_key"] != entity_key
        or detached["month"] != month
        or detached["artifact_ref"] != dict(ref)
    ):
        raise HistoricReceiptEvidenceError(
            "historic detached contribution identity or ref mismatch"
        )
    builder = detached["builder_summary_contribution"]
    gate = detached["gate_summary_contribution"]
    header = detached["partition_header"]
    if not isinstance(builder, dict) or not isinstance(gate, dict) or not isinstance(header, dict):
        raise HistoricReceiptEvidenceError(
            "historic detached builder, gate, and header evidence must be objects"
        )
    builder_required = {
        "partition_ref",
        "generated_utc",
        "first_available_date",
        "last_available_date",
        "available_dates",
        "gaps",
        "metric_dates",
    }
    gate_required = {
        "partition_ref",
        "partition_count",
        "generated_utc",
        "malformed_generated_utc",
        "raw_day_count",
        "unique_day_count",
        "available_date_mask",
        "metric_date_masks",
        "duplicate_dates",
        "dates_strictly_increasing",
    }
    if set(builder) != builder_required or set(gate) != gate_required:
        raise HistoricReceiptEvidenceError(
            "historic detached builder or gate evidence has missing or unknown fields"
        )
    dates = builder["available_dates"]
    metric_dates = builder["metric_dates"]
    if not isinstance(dates, list) or not all(isinstance(item, str) for item in dates):
        raise HistoricReceiptEvidenceError("historic detached dates are invalid")
    if not isinstance(metric_dates, dict) or set(metric_dates) != set(_FAMILY_METRICS[family]):
        raise HistoricReceiptEvidenceError("historic detached metric dates are invalid")
    if not all(
        isinstance(values, list)
        and all(isinstance(item, str) for item in values)
        for values in metric_dates.values()
    ):
        raise HistoricReceiptEvidenceError("historic detached metric dates are invalid")
    try:
        canonical_dates = [
            history_date(item, field="detached_available_date")
            for item in dates
        ]
        canonical_metric_dates = {
            metric: [
                history_date(item, field=f"detached_{metric}_date")
                for item in values
            ]
            for metric, values in metric_dates.items()
        }
        canonical_generated_utc = history_utc_timestamp(
            builder["generated_utc"],
            field="detached_generated_utc",
        )
    except ValueError as exc:
        raise HistoricReceiptEvidenceError(
            "historic detached dates or generated timestamp are invalid"
        ) from exc
    available_date_set = set(canonical_dates)
    if (
        canonical_dates != dates
        or canonical_generated_utc != builder["generated_utc"]
        or any(item[:7] != month for item in canonical_dates)
        or any(
            item[:7] != month or item not in available_date_set
            for values in canonical_metric_dates.values()
            for item in values
        )
    ):
        raise HistoricReceiptEvidenceError(
            "historic detached dates or generated timestamp are inconsistent"
        )
    first_date, last_date, gaps = history_coverage(dates)
    expected_gaps = [gap.model_dump(mode="json") for gap in gaps]
    unique_dates = sorted(set(dates))
    expected_metric_masks = {
        metric: sorted(set(values)) for metric, values in metric_dates.items()
    }
    if (
        raw_day_count != len(dates)
        or ref.get("count") != raw_day_count
        or ref.get("coverage_start") != first_date
        or ref.get("coverage_end") != last_date
        or builder["partition_ref"] != dict(ref)
        or builder["first_available_date"] != first_date
        or builder["last_available_date"] != last_date
        or builder["gaps"] != expected_gaps
        or gate["partition_ref"] != dict(ref)
        or gate["partition_count"] != 1
        or gate["generated_utc"] != builder["generated_utc"]
        or gate["malformed_generated_utc"] is not False
        or gate["raw_day_count"] != raw_day_count
        or gate["unique_day_count"] != len(unique_dates)
        or gate["available_date_mask"] != unique_dates
        or gate["metric_date_masks"] != expected_metric_masks
        or gate["duplicate_dates"] is not (len(dates) != len(unique_dates))
        or gate["dates_strictly_increasing"] is not (dates == unique_dates)
        or header.get("generated_utc") != builder["generated_utc"]
        or header.get("month") != month
        or (
            family != "network"
            and header.get("entity_id") != entity_key
        )
    ):
        raise HistoricReceiptEvidenceError(
            "historic detached contribution is internally inconsistent"
        )
    return detached


def _validated_origin_gate(
    value: Mapping[str, object],
) -> tuple[dict[str, Any], bool]:
    gate = _normalize_json(value)
    if not isinstance(gate, dict):
        raise HistoricReceiptEvidenceError("origin gate evidence must be an object")
    required = {"enabled", "force", "verdict", "checks", "errors", "warnings", "complete"}
    if set(gate) != required:
        raise HistoricReceiptEvidenceError(
            "origin gate evidence has missing or unknown fields"
        )
    if (
        not isinstance(gate["enabled"], bool)
        or not isinstance(gate["force"], bool)
        or not isinstance(gate["complete"], bool)
        or any(
            not isinstance(gate[name], int)
            or isinstance(gate[name], bool)
            or gate[name] < 0
            for name in ("checks", "errors", "warnings")
        )
    ):
        raise HistoricReceiptEvidenceError("origin gate evidence has invalid types")
    expected_verdict: str | None
    if not gate["enabled"]:
        expected_verdict = None
    elif gate["errors"]:
        expected_verdict = "ERROR"
    elif gate["warnings"]:
        expected_verdict = "WARN"
    else:
        expected_verdict = "PASS"
    if (
        gate["complete"] is not gate["enabled"]
        or gate["verdict"] != expected_verdict
    ):
        raise HistoricReceiptEvidenceError("origin gate evidence is inconsistent")
    reusable = (
        gate["enabled"] is True
        and gate["complete"] is True
        and gate["errors"] == 0
        and gate["verdict"] != "ERROR"
    )
    return gate, reusable


def build_historic_scope_receipt(
    *,
    common_envelope: HistoricCommonEnvelope,
    source_evidence: HistoryScopeSourceEvidence,
    artifact_ref: object,
    raw_day_count: int,
    detached_summary: Mapping[str, object],
    source_timestamps: Iterable[str],
    origin_gate: Mapping[str, object],
    diagnostics: Mapping[str, object] | None = None,
) -> HistoricScopeReceipt:
    common = common_envelope.payload
    if not source_evidence.complete:
        raise HistoricReceiptEvidenceError("source digest evidence is incomplete")
    for field_name in ("provider_id", "family"):
        if source_evidence.as_dict()[field_name] != common.get(field_name):
            raise HistoricReceiptEvidenceError(f"source/common {field_name} mismatch")
    ref = _artifact_ref_mapping(artifact_ref)
    month = ref["coverage_start"][:7]
    if source_evidence.month != month:
        raise HistoricReceiptEvidenceError("source and artifact months differ")
    try:
        dependency_start = date.fromisoformat(source_evidence.scope_start)
        dependency_end = date.fromisoformat(source_evidence.scope_end)
    except ValueError as exc:
        raise HistoricReceiptEvidenceError(
            "source dependency coverage must use ISO dates"
        ) from exc
    if (
        dependency_start > dependency_end
        or dependency_start.strftime("%Y-%m") != month
        or dependency_end.strftime("%Y-%m") != month
    ):
        raise HistoricReceiptEvidenceError(
            "source dependency coverage must stay within the artifact month"
        )
    scope_start = date.fromisoformat(ref["coverage_start"])
    scope_end = date.fromisoformat(ref["coverage_end"])
    if not dependency_start <= scope_start <= scope_end <= dependency_end:
        raise HistoricReceiptEvidenceError(
            "source dependency coverage must contain artifact coverage"
        )
    if not isinstance(raw_day_count, int) or isinstance(raw_day_count, bool):
        raise HistoricReceiptEvidenceError("raw day count must be an integer")
    if raw_day_count < ref["count"]:
        raise HistoricReceiptEvidenceError("raw day count cannot be below artifact day count")
    gate, origin_reusable = _validated_origin_gate(origin_gate)
    source_payload = source_evidence.as_dict()
    identity = {
        "provider_id": source_evidence.provider_id,
        "provider_timezone": common["provider_timezone"],
        "family": source_evidence.family,
        "entity_key": source_evidence.entity_key,
        "month": month,
        "scope_start": ref["coverage_start"],
        "scope_end": ref["coverage_end"],
        "dependency_start": source_evidence.scope_start,
        "dependency_end": source_evidence.scope_end,
    }
    input_sha256 = _json_sha256(
        {
            "protocol": "f7-scope-input-v1",
            "common_envelope_sha256": common_envelope.sha256,
            "identity": identity,
            "source_evidence": source_payload,
        }
    )
    timestamp_values = tuple(source_timestamps)
    if not all(isinstance(value, str) and value for value in timestamp_values):
        raise HistoricReceiptEvidenceError("source timestamps must be nonempty strings")
    try:
        timestamps = sorted(
            {
                history_utc_timestamp(value, field="source_timestamp")
                for value in timestamp_values
            }
        )
    except ValueError as exc:
        raise HistoricReceiptEvidenceError(
            "source timestamps must be timezone-aware ISO timestamps"
        ) from exc
    if tuple(timestamps) != source_evidence.source_timestamps:
        raise HistoricReceiptEvidenceError(
            "scope receipt source timestamps differ from same-pass evidence"
        )
    detached = _validated_detached_contribution(
        detached_summary,
        family=source_evidence.family,
        entity_key=source_evidence.entity_key,
        month=month,
        ref=ref,
        raw_day_count=raw_day_count,
    )
    payload = {
        **identity,
        "source_evidence": source_payload["sources"],
        "combined_source_sha256": source_evidence.combined_source_sha256,
        "inventory_sha256": source_evidence.inventory_sha256,
        "input_sha256": input_sha256,
        "artifact": {
            "path": ref["path"],
            "sha256": ref["sha256"],
            "byte_size": ref["byte_size"],
            "day_count": ref["count"],
        },
        "raw_day_count": raw_day_count,
        "detached_summary": detached,
        "source_timestamps": timestamps,
        "origin_gate": gate,
        "origin_reusable": origin_reusable,
    }
    if diagnostics is not None:
        payload["diagnostics"] = _normalize_json(diagnostics)
    return HistoricScopeReceipt(
        entity_key=source_evidence.entity_key,
        month=month,
        payload=payload,
    ).rehash()


@dataclass(frozen=True)
class HistoricEntityReceipt:
    provider_id: str
    family: str
    entity_key: str
    receipt_schema_version: int
    common_envelope: dict[str, Any]
    common_envelope_sha256: str
    month_receipts: dict[str, dict[str, Any]]
    scope_count: int
    first_scope_start: date
    last_scope_end: date
    entity_receipt_sha256: str
    origin_publish_generation_id: str
    activated_root_generation_id: str

    def as_sql_params(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "family": self.family,
            "entity_key": self.entity_key,
            "receipt_schema_version": self.receipt_schema_version,
            "common_envelope": _canonical_json_bytes(self.common_envelope).decode("utf-8"),
            "common_envelope_sha256": self.common_envelope_sha256,
            "month_receipts": _canonical_json_bytes(self.month_receipts).decode("utf-8"),
            "scope_count": self.scope_count,
            "first_scope_start": self.first_scope_start,
            "last_scope_end": self.last_scope_end,
            "entity_receipt_sha256": self.entity_receipt_sha256,
            "origin_publish_generation_id": self.origin_publish_generation_id,
            "activated_root_generation_id": self.activated_root_generation_id,
        }


def _scope_semantic_payload(payload: Mapping[str, object]) -> dict[str, object]:
    semantic = dict(payload)
    semantic.pop("scope_receipt_sha256", None)
    semantic.pop("diagnostics", None)
    return semantic


def _entity_semantic_months(
    month_receipts: Mapping[str, Mapping[str, object]],
) -> dict[str, dict[str, object]]:
    return {
        month: _scope_semantic_payload(payload)
        | {"scope_receipt_sha256": payload.get("scope_receipt_sha256")}
        for month, payload in sorted(month_receipts.items())
    }


def build_historic_entity_receipt(
    *,
    provider_id: str,
    family: str,
    entity_key: str,
    common_envelope: HistoricCommonEnvelope,
    scope_receipts: Iterable[HistoricScopeReceipt],
    origin_publish_generation_id: str,
    activated_root_generation_id: str,
) -> HistoricEntityReceipt:
    if family not in _FAMILIES:
        raise HistoricReceiptEvidenceError(f"unsupported historic family: {family!r}")
    if not provider_id or not origin_publish_generation_id or not activated_root_generation_id:
        raise HistoricReceiptEvidenceError("receipt provider and generation IDs are required")
    if (family == "network" and entity_key != "") or (
        family in {"lines", "stops"} and not entity_key
    ):
        raise HistoricReceiptEvidenceError("receipt family/entity identity is invalid")
    if common_envelope.payload.get("provider_id") != provider_id:
        raise HistoricReceiptEvidenceError("receipt/common provider mismatch")
    if common_envelope.payload.get("family") != family:
        raise HistoricReceiptEvidenceError("receipt/common family mismatch")
    scopes: dict[str, dict[str, Any]] = {}
    for receipt in scope_receipts:
        if receipt.entity_key != entity_key or receipt.payload.get("entity_key") != entity_key:
            raise HistoricReceiptEvidenceError("scope/entity receipt identity mismatch")
        if receipt.month in scopes:
            raise HistoricReceiptEvidenceError(f"duplicate scope receipt month: {receipt.month}")
        if not _MONTH.fullmatch(receipt.month):
            raise HistoricReceiptEvidenceError(f"invalid scope receipt month: {receipt.month}")
        normalized = _normalize_json(receipt.payload)
        assert isinstance(normalized, dict)
        scopes[receipt.month] = normalized
    if not scopes:
        raise HistoricReceiptEvidenceError("entity receipt requires at least one month")
    ordered_scopes = {month: scopes[month] for month in sorted(scopes)}
    starts = [date.fromisoformat(value["scope_start"]) for value in ordered_scopes.values()]
    ends = [date.fromisoformat(value["scope_end"]) for value in ordered_scopes.values()]
    entity_digest = _json_sha256(
        {
            "receipt_schema_version": RECEIPT_SCHEMA_VERSION,
            "provider_id": provider_id,
            "family": family,
            "entity_key": entity_key,
            "common_envelope_sha256": common_envelope.sha256,
            "month_receipts": _entity_semantic_months(ordered_scopes),
        }
    )
    result = HistoricEntityReceipt(
        provider_id=provider_id,
        family=family,
        entity_key=entity_key,
        receipt_schema_version=RECEIPT_SCHEMA_VERSION,
        common_envelope=common_envelope.payload,
        common_envelope_sha256=common_envelope.sha256,
        month_receipts=ordered_scopes,
        scope_count=len(ordered_scopes),
        first_scope_start=min(starts),
        last_scope_end=max(ends),
        entity_receipt_sha256=entity_digest,
        origin_publish_generation_id=origin_publish_generation_id,
        activated_root_generation_id=activated_root_generation_id,
    )
    validate_historic_entity_receipt(result)
    return result


def validate_historic_entity_receipt(receipt: HistoricEntityReceipt) -> None:
    if not receipt.provider_id:
        raise ValueError("historic receipt provider is required")
    if (
        not receipt.origin_publish_generation_id
        or not receipt.activated_root_generation_id
    ):
        raise ValueError("historic receipt generation IDs are required")
    if receipt.family not in _FAMILIES:
        raise ValueError("historic receipt family is invalid")
    if (receipt.family == "network" and receipt.entity_key != "") or (
        receipt.family in {"lines", "stops"} and not receipt.entity_key
    ):
        raise ValueError("historic receipt family/entity identity is invalid")
    if receipt.scope_count != len(receipt.month_receipts):
        raise ValueError(
            "historic receipt scope_count must equal len(month_receipts)"
        )
    if receipt.scope_count <= 0:
        raise ValueError("historic receipt scope_count must be positive")
    if receipt.receipt_schema_version != RECEIPT_SCHEMA_VERSION:
        raise ValueError("historic receipt schema version is invalid")
    if list(receipt.month_receipts) != sorted(receipt.month_receipts):
        raise ValueError("historic receipt month map must be canonically ordered")
    _validate_common_envelope_payload(
        receipt.common_envelope,
        provider_id=receipt.provider_id,
        family=receipt.family,
        receipt_schema_version=receipt.receipt_schema_version,
    )
    if _json_sha256(receipt.common_envelope) != receipt.common_envelope_sha256:
        raise ValueError("historic receipt common envelope digest mismatch")
    starts: list[date] = []
    ends: list[date] = []
    for month, payload in receipt.month_receipts.items():
        if not _MONTH.fullmatch(month) or payload.get("month") != month:
            raise ValueError("historic receipt month key/payload mismatch")
        if (
            payload.get("provider_id") != receipt.provider_id
            or payload.get("provider_timezone")
            != receipt.common_envelope.get("provider_timezone")
            or payload.get("family") != receipt.family
            or payload.get("entity_key") != receipt.entity_key
        ):
            raise ValueError("historic scope receipt identity mismatch")
        digest = payload.get("scope_receipt_sha256")
        if digest != _json_sha256(_scope_semantic_payload(payload)):
            raise ValueError("historic scope receipt digest mismatch")
        scope_start = date.fromisoformat(payload["scope_start"])
        scope_end = date.fromisoformat(payload["scope_end"])
        dependency_start = date.fromisoformat(payload["dependency_start"])
        dependency_end = date.fromisoformat(payload["dependency_end"])
        if (
            scope_start > scope_end
            or scope_start.strftime("%Y-%m") != month
            or scope_end.strftime("%Y-%m") != month
            or dependency_start > dependency_end
            or dependency_start.strftime("%Y-%m") != month
            or dependency_end.strftime("%Y-%m") != month
        ):
            raise ValueError("historic scope receipt coverage mismatch")
        if not dependency_start <= scope_start <= scope_end <= dependency_end:
            raise ValueError(
                "historic source dependency coverage must contain artifact coverage"
            )
        artifact = payload.get("artifact")
        raw_day_count = payload.get("raw_day_count")
        detached_summary = payload.get("detached_summary")
        if (
            not isinstance(artifact, Mapping)
            or not isinstance(raw_day_count, int)
            or isinstance(raw_day_count, bool)
            or not isinstance(detached_summary, Mapping)
        ):
            raise ValueError("historic scope artifact or detached evidence is invalid")
        artifact_ref = {
            "path": artifact.get("path"),
            "coverage_start": payload["scope_start"],
            "coverage_end": payload["scope_end"],
            "count": artifact.get("day_count"),
            "sha256": artifact.get("sha256"),
            "byte_size": artifact.get("byte_size"),
        }
        _validated_detached_contribution(
            detached_summary,
            family=receipt.family,
            entity_key=receipt.entity_key,
            month=month,
            ref=_artifact_ref_mapping(artifact_ref),
            raw_day_count=raw_day_count,
        )
        origin_gate = payload.get("origin_gate")
        if not isinstance(origin_gate, Mapping):
            raise ValueError("historic scope origin gate evidence is invalid")
        normalized_gate, origin_reusable = _validated_origin_gate(origin_gate)
        if (
            normalized_gate != dict(origin_gate)
            or payload.get("origin_reusable") is not origin_reusable
        ):
            raise ValueError("historic scope origin gate reuse evidence is inconsistent")
        sources = payload.get("source_evidence")
        if not isinstance(sources, list) or not sources:
            raise ValueError("historic scope receipt source evidence is missing")
        source_names: set[str] = set()
        source_bounds: list[date] = []
        source_timestamps: set[str] = set()
        for source in sources:
            if not isinstance(source, Mapping):
                raise ValueError("historic scope receipt source evidence is invalid")
            source_name = source.get("source_name")
            row_count = source.get("row_count")
            empty = source.get("empty")
            if (
                not isinstance(source_name, str)
                or not source_name
                or source_name in source_names
                or source.get("entity_key") != receipt.entity_key
                or source.get("month") != month
                or not isinstance(row_count, int)
                or isinstance(row_count, bool)
                or not isinstance(empty, bool)
                or not isinstance(source.get("sha256"), str)
                or not _SHA256.fullmatch(source["sha256"])
            ):
                raise ValueError("historic scope receipt source evidence is invalid")
            source_names.add(source_name)
            minimum = source.get("min_date")
            maximum = source.get("max_date")
            if empty:
                if row_count != 0 or minimum is not None or maximum is not None:
                    raise ValueError("historic empty-source evidence is invalid")
            else:
                if (
                    row_count <= 0
                    or not isinstance(minimum, str)
                    or not isinstance(maximum, str)
                ):
                    raise ValueError("historic nonempty-source evidence is invalid")
                minimum_date = date.fromisoformat(minimum)
                maximum_date = date.fromisoformat(maximum)
                if (
                    minimum_date > maximum_date
                    or minimum_date.strftime("%Y-%m") != month
                    or maximum_date.strftime("%Y-%m") != month
                ):
                    raise ValueError("historic source coverage is invalid")
                source_bounds.extend((minimum_date, maximum_date))
            timestamps = source.get("source_timestamps")
            if not isinstance(timestamps, list):
                raise ValueError("historic source timestamps are invalid")
            for timestamp in timestamps:
                if (
                    not isinstance(timestamp, str)
                    or history_utc_timestamp(timestamp, field="source_timestamp") != timestamp
                ):
                    raise ValueError("historic source timestamps are invalid")
                source_timestamps.add(timestamp)
        if (
            not source_bounds
            or min(source_bounds) != dependency_start
            or max(source_bounds) != dependency_end
            or payload.get("source_timestamps") != sorted(source_timestamps)
        ):
            raise ValueError("historic scope source summary mismatch")
        inventory_sha256 = payload.get("inventory_sha256")
        if inventory_sha256 is not None and (
            not isinstance(inventory_sha256, str)
            or not _SHA256.fullmatch(inventory_sha256)
        ):
            raise ValueError("historic scope inventory digest is invalid")
        combined_source_payload = {
            "protocol": "f7-combined-source-v1",
            "provider_id": receipt.provider_id,
            "family": receipt.family,
            "entity_key": receipt.entity_key,
            "month": month,
            "inventory_sha256": inventory_sha256,
            "sources": sources,
        }
        combined_source_sha256 = payload.get("combined_source_sha256")
        if combined_source_sha256 != _json_sha256(combined_source_payload):
            raise ValueError("historic scope combined source digest mismatch")
        identity = {
            "provider_id": receipt.provider_id,
            "provider_timezone": receipt.common_envelope["provider_timezone"],
            "family": receipt.family,
            "entity_key": receipt.entity_key,
            "month": month,
            "scope_start": payload["scope_start"],
            "scope_end": payload["scope_end"],
            "dependency_start": payload["dependency_start"],
            "dependency_end": payload["dependency_end"],
        }
        source_evidence_payload = {
            "provider_id": receipt.provider_id,
            "family": receipt.family,
            "entity_key": receipt.entity_key,
            "month": month,
            "scope_start": payload["dependency_start"],
            "scope_end": payload["dependency_end"],
            "sources": sources,
            "combined_source_sha256": combined_source_sha256,
            "inventory_sha256": inventory_sha256,
            "source_timestamps": sorted(source_timestamps),
            "complete": True,
        }
        expected_input_sha256 = _json_sha256(
            {
                "protocol": "f7-scope-input-v1",
                "common_envelope_sha256": receipt.common_envelope_sha256,
                "identity": identity,
                "source_evidence": source_evidence_payload,
            }
        )
        if payload.get("input_sha256") != expected_input_sha256:
            raise ValueError("historic scope input/common envelope digest mismatch")
        starts.append(scope_start)
        ends.append(scope_end)
    if min(starts) != receipt.first_scope_start or max(ends) != receipt.last_scope_end:
        raise ValueError("historic receipt coverage summary mismatch")
    expected_entity_sha256 = _json_sha256(
        {
            "receipt_schema_version": receipt.receipt_schema_version,
            "provider_id": receipt.provider_id,
            "family": receipt.family,
            "entity_key": receipt.entity_key,
            "common_envelope_sha256": receipt.common_envelope_sha256,
            "month_receipts": _entity_semantic_months(receipt.month_receipts),
        }
    )
    if receipt.entity_receipt_sha256 != expected_entity_sha256:
        raise ValueError("historic entity receipt digest mismatch")


@dataclass(frozen=True)
class HistoricReceiptPersistenceStats:
    rows_attempted: int
    rows_changed: int
    json_bytes_attempted: int
    json_bytes_changed: int
    stale_entities_deleted: int
    stale_months_deleted: int


def _mapping_json(value: object) -> dict[str, Any]:
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, Mapping):
        raise HistoricReceiptEvidenceError("stored receipt JSON must be an object")
    normalized = _normalize_json(value)
    assert isinstance(normalized, dict)
    return normalized


def _receipt_json_bytes(receipt: HistoricEntityReceipt) -> int:
    return len(_canonical_json_bytes(receipt.common_envelope)) + len(
        _canonical_json_bytes(receipt.month_receipts)
    )


def persist_historic_receipts(
    conn: Any,
    *,
    provider_id: str,
    receipts: Iterable[HistoricEntityReceipt],
    complete_families: Sequence[str],
) -> HistoricReceiptPersistenceStats:
    """Replace complete entity maps, suppress identical writes, and remove stale entities."""

    families = tuple(sorted(set(complete_families)))
    if not families or any(family not in _FAMILIES for family in families):
        raise ValueError("complete historic receipt families are invalid")
    materialized = tuple(receipts)
    keys: set[tuple[str, str]] = set()
    for receipt in materialized:
        validate_historic_entity_receipt(receipt)
        if receipt.provider_id != provider_id:
            raise ValueError("historic receipt provider mismatch")
        if receipt.family not in families:
            raise ValueError("historic receipt family is not marked complete")
        key = (receipt.family, receipt.entity_key)
        if key in keys:
            raise ValueError(f"duplicate historic entity receipt: {key}")
        keys.add(key)

    existing: dict[tuple[str, str], dict[str, Any]] = {}
    for raw_row in conn.execute(
        _EXISTING_RECEIPTS_SQL,
        {"provider_id": provider_id, "families": list(families)},
    ).mappings():
        row = dict(raw_row)
        key = (row["family"], row["entity_key"])
        month_keys = row["month_keys"]
        if not isinstance(month_keys, Sequence) or isinstance(month_keys, str):
            raise HistoricReceiptEvidenceError("stored receipt month keys must be an array")
        normalized_month_keys = tuple(month_keys)
        if any(
            not isinstance(month, str) or not _MONTH.fullmatch(month)
            for month in normalized_month_keys
        ):
            raise HistoricReceiptEvidenceError("stored receipt month key is invalid")
        existing[key] = {
            "entity_receipt_sha256": row["entity_receipt_sha256"],
            "month_keys": normalized_month_keys,
        }

    attempted_bytes = sum(_receipt_json_bytes(receipt) for receipt in materialized)
    changed_new = {
        (receipt.family, receipt.entity_key)
        for receipt in materialized
        if existing.get((receipt.family, receipt.entity_key), {}).get(
            "entity_receipt_sha256"
        )
        != receipt.entity_receipt_sha256
    }
    stale_keys = set(existing) - keys
    stale_json: dict[tuple[str, str], tuple[dict[str, Any], dict[str, Any]]] = {}
    for family in families:
        entity_keys = sorted(
            entity_key
            for stale_family, entity_key in stale_keys
            if stale_family == family
        )
        if not entity_keys:
            continue
        for raw_row in conn.execute(
            _STALE_RECEIPT_JSON_SQL,
            {
                "provider_id": provider_id,
                "family": family,
                "entity_keys": entity_keys,
            },
        ).mappings():
            row = dict(raw_row)
            key = (family, row["entity_key"])
            if key not in stale_keys or key in stale_json:
                raise HistoricReceiptEvidenceError(
                    "stale receipt JSON lookup returned an unexpected entity"
                )
            stale_json[key] = (
                _mapping_json(row["common_envelope"]),
                _mapping_json(row["month_receipts"]),
            )
    if set(stale_json) != stale_keys:
        raise HistoricReceiptEvidenceError("stale receipt JSON lookup was incomplete")
    changed_bytes = sum(
        _receipt_json_bytes(receipt)
        for receipt in materialized
        if (receipt.family, receipt.entity_key) in changed_new
    )
    changed_bytes += sum(
        len(_canonical_json_bytes(stale_json[key][0]))
        + len(_canonical_json_bytes(stale_json[key][1]))
        for key in stale_keys
    )
    stale_months = sum(
        len(set(existing[key]["month_keys"]) - set(receipt.month_receipts))
        for receipt in materialized
        if (key := (receipt.family, receipt.entity_key)) in existing
    )
    stale_months += sum(len(existing[key]["month_keys"]) for key in stale_keys)

    upserted = 0
    changed_params = [
        receipt.as_sql_params()
        for receipt in materialized
        if (receipt.family, receipt.entity_key) in changed_new
    ]
    for offset in range(0, len(changed_params), HISTORIC_RECEIPT_UPSERT_BATCH_SIZE):
        result = conn.execute(
            _UPSERT_RECEIPT_SQL,
            changed_params[offset : offset + HISTORIC_RECEIPT_UPSERT_BATCH_SIZE],
        )
        upserted += max(0, int(result.rowcount or 0))
    deleted = 0
    current_by_family = {
        family: sorted(
            receipt.entity_key for receipt in materialized if receipt.family == family
        )
        for family in families
    }
    for family, entity_keys in current_by_family.items():
        result = conn.execute(
            _DELETE_STALE_RECEIPTS_SQL,
            {
                "provider_id": provider_id,
                "family": family,
                "entity_keys": entity_keys,
            },
        )
        deleted += max(0, int(result.rowcount or 0))
    expected_changed = len(changed_new) + len(stale_keys)
    actual_changed = upserted + deleted
    if actual_changed != expected_changed:
        raise HistoricReceiptEvidenceError(
            f"receipt persistence row-count mismatch: {actual_changed} != {expected_changed}"
        )
    return HistoricReceiptPersistenceStats(
        rows_attempted=len(materialized),
        rows_changed=actual_changed,
        json_bytes_attempted=attempted_bytes,
        json_bytes_changed=changed_bytes,
        stale_entities_deleted=deleted,
        stale_months_deleted=stale_months,
    )


_HISTORIC_EXCLUSIVE_PHASES = (
    "source_digest",
    "build",
    "gate",
    "upload",
    "compatibility",
    "parent_compose",
    "code_schema_preflight",
    "receipt_persist",
    "hash_state_flush",
    "state_upsert",
    "transaction_commit",
    "other",
)
_HISTORIC_FAMILIES = ("network", "lines", "stops")
_HISTORIC_SCOPE_CLASSES = ("retention_edge", "mutable_edge", "settled_candidate")
_HISTORIC_SCOPE_METRICS = ("partition_materialize", "child_gate")


class _HistoricPhaseLedger:
    """Exclusive nanosecond ledger for one historic publish transaction."""

    def __init__(self, *, clock: Callable[[], int] = perf_counter_ns) -> None:
        self._clock = clock
        self._last_ns = clock()
        self._active_phase: str | None = "other"
        self._active_detail: tuple[str, str, str] | None = None
        self._finished = False
        self.phase_ns = {phase: 0 for phase in _HISTORIC_EXCLUSIVE_PHASES}
        self.scope_detail_ns = {
            family: {
                scope_class: {
                    metric: 0 for metric in _HISTORIC_SCOPE_METRICS
                }
                for scope_class in _HISTORIC_SCOPE_CLASSES
            }
            for family in _HISTORIC_FAMILIES
        }
        self.scope_counts = {
            family: {scope_class: 0 for scope_class in _HISTORIC_SCOPE_CLASSES}
            for family in _HISTORIC_FAMILIES
        }

    def _switch(
        self,
        phase: str | None,
        detail: tuple[str, str, str] | None = None,
    ) -> tuple[str | None, tuple[str, str, str] | None]:
        if self._finished:
            raise RuntimeError("historic phase ledger is already finished")
        if phase is not None and phase not in self.phase_ns:
            raise ValueError(f"unknown historic publish phase {phase!r}")
        now = self._clock()
        elapsed = now - self._last_ns
        if elapsed < 0:
            raise RuntimeError("historic phase clock moved backwards")
        if self._active_phase is not None:
            self.phase_ns[self._active_phase] += elapsed
        if self._active_detail is not None:
            family, scope_class, metric = self._active_detail
            self.scope_detail_ns[family][scope_class][metric] += elapsed
        previous = (self._active_phase, self._active_detail)
        self._active_phase = phase
        self._active_detail = detail
        self._last_ns = now
        return previous

    @contextmanager
    def phase(
        self,
        phase: str,
        *,
        family: str | None = None,
        scope_class: str | None = None,
        scope_metric: str | None = None,
    ) -> Iterator[None]:
        """Switch the one active phase, restoring the caller's phase on exit."""

        detail: tuple[str, str, str] | None = None
        detail_values = (family, scope_class, scope_metric)
        if any(value is not None for value in detail_values):
            if not all(value is not None for value in detail_values):
                raise ValueError("historic scope detail requires family, class, and metric")
            if family not in _HISTORIC_FAMILIES:
                raise ValueError(f"unknown historic family {family!r}")
            if scope_class not in _HISTORIC_SCOPE_CLASSES:
                raise ValueError(f"unknown historic scope class {scope_class!r}")
            if scope_metric not in _HISTORIC_SCOPE_METRICS:
                raise ValueError(f"unknown historic scope metric {scope_metric!r}")
            detail = cast(tuple[str, str, str], detail_values)
        previous_phase, previous_detail = self._switch(phase, detail)
        try:
            yield
        finally:
            self._switch(previous_phase, previous_detail)

    def observe_scope(self, family: str, scope_class: str) -> None:
        if family not in _HISTORIC_FAMILIES:
            raise ValueError(f"unknown historic family {family!r}")
        if scope_class not in _HISTORIC_SCOPE_CLASSES:
            raise ValueError(f"unknown historic scope class {scope_class!r}")
        self.scope_counts[family][scope_class] += 1

    def activate(self, phase: str) -> None:
        self._switch(phase)

    def add_scope_detail_ns(
        self,
        family: str,
        scope_class: str,
        metric: str,
        elapsed_ns: int,
    ) -> None:
        if family not in _HISTORIC_FAMILIES:
            raise ValueError(f"unknown historic family {family!r}")
        if scope_class not in _HISTORIC_SCOPE_CLASSES:
            raise ValueError(f"unknown historic scope class {scope_class!r}")
        if metric not in _HISTORIC_SCOPE_METRICS:
            raise ValueError(f"unknown historic scope metric {metric!r}")
        if elapsed_ns < 0:
            raise ValueError("historic scope detail duration must be nonnegative")
        self.scope_detail_ns[family][scope_class][metric] += elapsed_ns

    def finish(self) -> int:
        if not self._finished:
            self._switch(None)
            self._finished = True
        return sum(self.phase_ns.values())

    def checkpoint(self) -> int:
        if self._finished:
            return sum(self.phase_ns.values())
        self._switch(self._active_phase, self._active_detail)
        return sum(self.phase_ns.values())

    def _render(self, total_ns: int, **extra: object) -> dict[str, object]:
        phase_ms = {
            f"{phase}_ms": duration / 1_000_000
            for phase, duration in self.phase_ns.items()
        }
        family_scope_detail = {
            family: {
                scope_class: {
                    "scopes_rebuilt": self.scope_counts[family][scope_class],
                    **{
                        f"{metric}_ms": duration / 1_000_000
                        for metric, duration in metrics.items()
                    },
                }
                for scope_class, metrics in classes.items()
            }
            for family, classes in self.scope_detail_ns.items()
        }
        return {
            "schema_version": 1,
            "phase_ns": dict(self.phase_ns),
            **phase_ms,
            "publish_total_ns": total_ns,
            "publish_total_ms": total_ns / 1_000_000,
            "family_scope_detail": family_scope_detail,
            **extra,
        }

    def snapshot(self, **extra: object) -> dict[str, object]:
        return self._render(self.checkpoint(), **extra)

    def telemetry(self, **extra: object) -> dict[str, object]:
        return self._render(self.finish(), **extra)


class _TimedHistoricTransaction:
    """Charge transaction exit, including commit or rollback, to one phase."""

    def __init__(
        self,
        transaction: AbstractContextManager[Connection],
        ledger: _HistoricPhaseLedger,
    ) -> None:
        self._transaction = transaction
        self._ledger = ledger

    def __enter__(self) -> Connection:
        return self._transaction.__enter__()

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool | None:
        with self._ledger.phase("transaction_commit"):
            return self._transaction.__exit__(exc_type, exc_value, traceback)


@dataclass(frozen=True)
class _HistoricPartitionObservation:
    family: str
    entity_key: str
    scope_class: str
    ref: object
    raw_day_count: int
    detached_summary: dict[str, object]


@dataclass
class _HistoricPublishRun:
    """Receipt staging and telemetry for one full historic publish."""

    ledger: _HistoricPhaseLedger
    settings: Settings
    stamp: str
    full_historic_rebuild: bool
    partition_upload_batch_size: int
    preflights: dict[str, HistoricReceiptPreflight] = field(default_factory=dict)
    plans: dict[str, object] = field(default_factory=dict)
    observations: dict[str, list[_HistoricPartitionObservation]] = field(
        default_factory=lambda: {family: [] for family in _HISTORIC_FAMILIES}
    )
    receipt_scope_cardinality: dict[str, dict[str, object]] = field(default_factory=dict)
    entity_receipts: list[HistoricEntityReceipt] = field(default_factory=list)
    complete_receipt_families: tuple[str, ...] = ()
    receipt_evidence_available: bool = False
    receipt_evidence_unavailable_reason: str | None = None
    receipt_cardinality_gate_passed: bool | None = None
    receipt_rows_attempted: int = 0
    receipt_rows_changed: int = 0
    receipt_json_bytes_attempted: int = 0
    receipt_json_bytes_changed: int = 0
    stale_receipt_entities_deleted: int = 0
    stale_receipt_months_deleted: int = 0
    receipt_persist_failed: bool = False

    @property
    def historic_scopes_rebuilt(self) -> int:
        return sum(len(values) for values in self.observations.values())

    def telemetry_fields(self, *, timing_complete: bool) -> dict[str, object]:
        return {
            "timing_complete": timing_complete,
            "full_historic_rebuild": self.full_historic_rebuild,
            "historic_files_reused": 0,
            "historic_scopes_reused": 0,
            "historic_scopes_rebuilt": self.historic_scopes_rebuilt,
            "receipt_evidence_available": self.receipt_evidence_available,
            "receipt_evidence_unavailable_reason": (
                self.receipt_evidence_unavailable_reason
            ),
            "receipt_cardinality_gate_passed": self.receipt_cardinality_gate_passed,
            "receipt_scope_cardinality": self.receipt_scope_cardinality,
            "receipt_entity_count": len(self.entity_receipts),
            "receipt_scope_count": sum(
                receipt.scope_count for receipt in self.entity_receipts
            ),
            "receipt_rows_attempted": self.receipt_rows_attempted,
            "receipt_rows_changed": self.receipt_rows_changed,
            "receipt_json_bytes_attempted": self.receipt_json_bytes_attempted,
            "receipt_json_bytes_changed": self.receipt_json_bytes_changed,
            "stale_receipt_entities_deleted": self.stale_receipt_entities_deleted,
            "stale_receipt_months_deleted": self.stale_receipt_months_deleted,
            "receipt_persist_failed": self.receipt_persist_failed,
            "receipt_entity_map_grain": True,
            "partition_upload_batch_size": self.partition_upload_batch_size,
        }


def _activate_historic_phase(
    run: _HistoricPublishRun | None,
    phase: str,
) -> None:
    if run is not None:
        run.ledger.activate(phase)


def _historic_phase_context(
    run: _HistoricPublishRun | None,
    phase: str,
) -> AbstractContextManager[None]:
    if run is None:
        return nullcontext()
    return run.ledger.phase(phase)


def _historic_child_gate_phase(
    run: _HistoricPublishRun | None,
    family: str,
    scope_class: str | None,
) -> AbstractContextManager[None]:
    if run is None:
        return nullcontext()
    if scope_class is None:
        raise RuntimeError("historic child gate phase requires a scope class")
    return run.ledger.phase(
        "gate",
        family=family,
        scope_class=scope_class,
        scope_metric="child_gate",
    )


def _historic_transaction_context(
    transaction: AbstractContextManager[Connection],
    ledger: _HistoricPhaseLedger | None,
) -> AbstractContextManager[Connection]:
    if ledger is None:
        return transaction
    return _TimedHistoricTransaction(transaction, ledger)


def _new_historic_publish_run(
    ledger: _HistoricPhaseLedger | None,
    settings: Settings,
    stamp: str,
    full_historic_rebuild: bool,
    partition_upload_batch_size: int,
) -> _HistoricPublishRun | None:
    if ledger is None:
        return None
    return _HistoricPublishRun(
        ledger=ledger,
        settings=settings,
        stamp=stamp,
        full_historic_rebuild=full_historic_rebuild,
        partition_upload_batch_size=partition_upload_batch_size,
    )


def _build_historic_history_plans[NetworkPlanT, LinePlanT, StopPlanT](
    run: _HistoricPublishRun | None,
    conn: Connection,
    provider_id: str,
    stamp: str,
    build_network: Callable[..., NetworkPlanT],
    build_lines: Callable[..., LinePlanT],
    build_stops: Callable[..., StopPlanT],
) -> tuple[NetworkPlanT, LinePlanT, StopPlanT]:
    phase_context = run.ledger.phase if run is not None else None
    with _historic_phase_context(run, "build"):
        return (
            build_network(
                conn,
                provider_id=provider_id,
                generated_utc=stamp,
                phase_context=phase_context,
            ),
            build_lines(
                conn,
                provider_id=provider_id,
                generated_utc=stamp,
                phase_context=phase_context,
            ),
            build_stops(
                conn,
                provider_id=provider_id,
                generated_utc=stamp,
                phase_context=phase_context,
            ),
        )


def _prepare_historic_receipt_run(
    run: _HistoricPublishRun | None,
    conn: Connection,
    provider_id: str,
    plans: tuple[object, object, object],
    prepare_preflight: Callable[..., HistoricReceiptPreflight],
) -> None:
    """Resolve all common envelopes before the first historic upload."""

    if run is None:
        return
    run.plans = dict(zip(_HISTORIC_FAMILIES, plans, strict=True))
    try:
        with run.ledger.phase("code_schema_preflight"):
            for family in _HISTORIC_FAMILIES:
                collector = getattr(run.plans[family], "receipt_evidence", None)
                named_query_sha256 = getattr(collector, "named_query_sha256", None)
                if not isinstance(named_query_sha256, Mapping):
                    run.receipt_evidence_unavailable_reason = (
                        f"{family} plan has no receipt digest collector"
                    )
                    return
                preflight = prepare_preflight(
                    conn,
                    provider_id=provider_id,
                    settings=run.settings,
                    family=family,
                    named_query_sha256=cast(Mapping[str, str], named_query_sha256),
                    partition_upload_batch_size=run.partition_upload_batch_size,
                )
                if not preflight.available:
                    run.receipt_evidence_unavailable_reason = (
                        preflight.unavailable_reason
                        or f"{family} receipt preflight is unavailable"
                    )
                    return
                run.preflights[family] = preflight
    except HistoricReceiptEvidenceError as exc:
        run.receipt_evidence_unavailable_reason = str(exc)
        logger.exception(
            "historic receipt preflight unavailable; artifact publish continues without "
            "receipt writes"
        )
        return
    run.receipt_evidence_available = True


def _next_historic_partition[HistoricRefT, HistoricPartitionT](
    iterator: Iterator[tuple[HistoricRefT, HistoricPartitionT]],
    run: _HistoricPublishRun | None,
) -> tuple[HistoricRefT, HistoricPartitionT, int]:
    """Advance a lazy plan while keeping nested source SQL out of build time."""

    if run is None:
        ref, partition = next(iterator)
        return ref, partition, 0
    before_build = run.ledger.phase_ns["build"]
    before_source_digest = run.ledger.phase_ns["source_digest"]
    with run.ledger.phase("build"):
        ref, partition = next(iterator)
    build_ns = run.ledger.phase_ns["build"] - before_build
    if run.ledger.phase_ns["source_digest"] > before_source_digest:
        build_ns = 0
    return ref, partition, build_ns


def _iter_historic_partitions[HistoricRefT, HistoricPartitionT](
    iterator: Iterator[tuple[HistoricRefT, HistoricPartitionT]],
    run: _HistoricPublishRun | None,
    family: str,
) -> Iterator[tuple[HistoricRefT, HistoricPartitionT, str | None]]:
    while True:
        try:
            ref, partition, build_ns = _next_historic_partition(iterator, run)
        except StopIteration:
            return
        yield (
            ref,
            partition,
            _observe_historic_partition(
                run,
                family,
                ref,
                partition,
                build_ns,
            ),
        )


def _scope_class_for_observation(
    run: _HistoricPublishRun,
    *,
    family: str,
    scope_start: date,
    scope_end: date,
) -> str:
    preflight = run.preflights.get(family)
    if preflight is not None and preflight.provider is not None:
        return preflight.provider.classify_scope(
            family=family,
            scope_start=scope_start,
            scope_end=scope_end,
        )
    return classify_historic_scope(
        family=family,
        scope_start=scope_start,
        scope_end=scope_end,
        today_local=date.fromisoformat(run.stamp[:10]),
        open_window_days=int(
            getattr(run.settings, "GOLD_REPORTING_OPEN_WINDOW_DAYS", 10)
        ),
        fact_retention_days=int(
            getattr(run.settings, "GOLD_FACT_RETENTION_DAYS", 14)
        ),
        retention_days=int(
            getattr(run.settings, "GOLD_WARM_ROLLUP_RETENTION_DAYS", 730)
        ),
    )


def _observe_historic_partition(
    run: _HistoricPublishRun | None,
    family: str,
    ref: object,
    partition: object,
    build_ns: int,
) -> str | None:
    if run is None:
        return None
    with run.ledger.phase("other"):
        scope_start = date.fromisoformat(cast(str, cast(Any, ref).coverage_start))
        scope_end = date.fromisoformat(cast(str, cast(Any, ref).coverage_end))
        scope_class = _scope_class_for_observation(
            run,
            family=family,
            scope_start=scope_start,
            scope_end=scope_end,
        )
        entity_key = (
            "" if family == "network" else cast(str, cast(Any, partition).entity_id)
        )
        days = cast(Sequence[object], cast(Any, partition).days)
        detached_summary = build_historic_detached_contribution(
            family=family,
            artifact_ref=ref,
            partition=partition,
        )
        run.ledger.observe_scope(family, scope_class)
        run.ledger.add_scope_detail_ns(
            family,
            scope_class,
            "partition_materialize",
            build_ns,
        )
        run.observations[family].append(
            _HistoricPartitionObservation(
                family=family,
                entity_key=entity_key,
                scope_class=scope_class,
                ref=ref,
                raw_day_count=len(days),
                detached_summary=detached_summary,
            )
        )
    return scope_class


def _origin_gate_evidence(
    report: GateReport,
    *,
    enabled: bool,
    force: bool,
) -> dict[str, object]:
    errors = len(report.errors)
    warnings = len(report.warnings)
    if not enabled:
        verdict: str | None = None
    elif errors:
        verdict = "ERROR"
    elif warnings:
        verdict = "WARN"
    else:
        verdict = "PASS"
    return {
        "enabled": enabled,
        "force": force,
        "verdict": verdict,
        "checks": report.checks_run,
        "errors": errors,
        "warnings": warnings,
        "complete": enabled,
    }


def _ref_mapping(ref: object) -> dict[str, object]:
    model_dump = getattr(ref, "model_dump", None)
    if callable(model_dump):
        value = model_dump(mode="json")
        if isinstance(value, dict):
            return cast(dict[str, object], value)
    if isinstance(ref, Mapping):
        return dict(ref)
    raise HistoricReceiptEvidenceError("historic receipt ref is not a mapping")


def _validate_receipt_pair(
    observation: _HistoricPartitionObservation,
    evidence: HistoryScopeSourceEvidence,
) -> None:
    ref = _ref_mapping(observation.ref)
    if evidence.family != observation.family:
        raise HistoricReceiptEvidenceError("receipt source family order mismatch")
    if evidence.entity_key != observation.entity_key:
        raise HistoricReceiptEvidenceError("receipt source entity order mismatch")
    coverage_start = ref.get("coverage_start")
    coverage_end = ref.get("coverage_end")
    if (
        not isinstance(coverage_start, str)
        or not isinstance(coverage_end, str)
        or evidence.month != coverage_start[:7]
        or evidence.month != coverage_end[:7]
        or evidence.scope_start[:7] != evidence.month
        or evidence.scope_end[:7] != evidence.month
    ):
        raise HistoricReceiptEvidenceError("receipt source/artifact month mismatch")
    path = ref.get("path")
    if not isinstance(path, str):
        raise HistoricReceiptEvidenceError("receipt artifact path is missing")
    if observation.family == "network":
        expected_prefix = "historic/history/network/generations/"
    else:
        expected_prefix = (
            f"historic/history/{observation.family}/"
            f"{encode_history_entity_id(observation.entity_key)}/generations/"
        )
    if not path.startswith(expected_prefix):
        raise HistoricReceiptEvidenceError("receipt artifact entity path mismatch")


def _receipt_cardinality_mapping(
    family: str,
    cardinality: HistoryScopeCardinality,
    observations: Sequence[_HistoricPartitionObservation],
) -> tuple[dict[str, object], bool]:
    emitted_entities = len({value.entity_key for value in observations})
    emitted_scopes = len(observations)
    source_covers_emitted = cardinality.observed_scope_count >= emitted_scopes
    entity_capacity = cardinality.entity_count >= emitted_entities
    inventory_consistent = (
        cardinality.entity_count == 1
        if family == "network"
        else (
            cardinality.entity_count == 0
            if cardinality.observed_scope_count == 0
            else cardinality.entity_count > 0
        )
    )
    sized_for_entity_maps = (
        cardinality.observed_scope_count == 0
        or (
            cardinality.entity_count <= cardinality.observed_scope_count
            <= cardinality.dense_scope_count
        )
    )
    passed = (
        source_covers_emitted
        and entity_capacity
        and inventory_consistent
        and sized_for_entity_maps
    )
    return (
        {
            **cardinality.as_dict(),
            "emitted_entity_count": emitted_entities,
            "emitted_scope_count": emitted_scopes,
            "selected_grain": "entity_month_map",
            "cardinality_gate_passed": passed,
        },
        passed,
    )


def _assemble_historic_receipt_envelopes(
    run: _HistoricPublishRun,
    *,
    provider_id: str,
    generation_id: str,
    report: GateReport,
    gate_enabled: bool,
    force: bool,
) -> None:
    """Pair exact emitted refs with source evidence and stage entity maps."""

    if not run.receipt_evidence_available:
        for family, observations in run.observations.items():
            run.receipt_scope_cardinality[family] = {
                "emitted_entity_count": len(
                    {value.entity_key for value in observations}
                ),
                "emitted_scope_count": len(observations),
                "selected_grain": "entity_month_map",
                "cardinality_gate_passed": None,
            }
        return

    origin_gate = _origin_gate_evidence(
        report,
        enabled=gate_enabled,
        force=force,
    )
    entity_receipts: list[HistoricEntityReceipt] = []
    all_cardinality_passed = True
    for family in _HISTORIC_FAMILIES:
        plan = run.plans[family]
        evidence_iter = getattr(plan, "iter_receipt_source_evidence", None)
        cardinality_fn = getattr(plan, "receipt_scope_cardinality", None)
        if not callable(evidence_iter) or not callable(cardinality_fn):
            raise HistoricReceiptEvidenceError(
                f"{family} plan lost receipt evidence after preflight"
            )
        evidence_values = tuple(
            cast(Iterator[HistoryScopeSourceEvidence], evidence_iter())
        )
        observations = run.observations[family]
        cardinality = cast(HistoryScopeCardinality, cardinality_fn())
        if len(evidence_values) != cardinality.observed_scope_count:
            raise HistoricReceiptEvidenceError(
                f"{family} source evidence cardinality differs from its measured scopes"
            )
        mapping, passed = _receipt_cardinality_mapping(
            family,
            cardinality,
            observations,
        )
        evidence_by_scope = {
            (evidence.entity_key, evidence.month): evidence
            for evidence in evidence_values
        }
        observation_scopes = {
            (
                observation.entity_key,
                cast(str, _ref_mapping(observation.ref)["coverage_start"])[:7],
            )
            for observation in observations
        }
        if len(evidence_by_scope) != len(evidence_values):
            raise HistoricReceiptEvidenceError(
                f"{family} source evidence contains duplicate entity-month scopes"
            )
        if len(observation_scopes) != len(observations):
            raise HistoricReceiptEvidenceError(
                f"{family} emitted duplicate entity-month partitions"
            )
        missing_scopes = sorted(observation_scopes - set(evidence_by_scope))
        if missing_scopes:
            raise HistoricReceiptEvidenceError(
                f"{family} emitted scopes lack same-pass source evidence: "
                f"{missing_scopes[:3]}"
            )
        mapping["source_only_scope_count"] = len(
            set(evidence_by_scope) - observation_scopes
        )
        run.receipt_scope_cardinality[family] = mapping
        all_cardinality_passed = all_cardinality_passed and passed
        if not passed:
            raise HistoricReceiptEvidenceError(
                f"{family} receipt cardinality gate rejected entity-map persistence"
            )

        provider, common = run.preflights[family].require()
        scopes_by_entity: dict[str, list[HistoricScopeReceipt]] = {}
        for observation in observations:
            ref = _ref_mapping(observation.ref)
            evidence = evidence_by_scope[
                (
                    observation.entity_key,
                    cast(str, ref["coverage_start"])[:7],
                )
            ]
            _validate_receipt_pair(observation, evidence)
            scope_receipt = build_historic_scope_receipt(
                common_envelope=common,
                source_evidence=evidence,
                artifact_ref=observation.ref,
                raw_day_count=observation.raw_day_count,
                detached_summary=observation.detached_summary,
                source_timestamps=evidence.source_timestamps,
                origin_gate=origin_gate,
                diagnostics={
                    "scope_class": observation.scope_class,
                    "today_local": provider.today_local.isoformat(),
                },
            )
            scopes_by_entity.setdefault(observation.entity_key, []).append(
                scope_receipt
            )
        for entity_key, scope_receipts in sorted(scopes_by_entity.items()):
            entity_receipts.append(
                build_historic_entity_receipt(
                    provider_id=provider_id,
                    family=family,
                    entity_key=entity_key,
                    common_envelope=common,
                    scope_receipts=scope_receipts,
                    origin_publish_generation_id=generation_id,
                    activated_root_generation_id=generation_id,
                )
            )
    run.receipt_cardinality_gate_passed = all_cardinality_passed
    run.entity_receipts = entity_receipts
    run.complete_receipt_families = _HISTORIC_FAMILIES
    run.receipt_rows_attempted = len(entity_receipts)
    run.receipt_json_bytes_attempted = sum(
        len(cast(str, params["common_envelope"]).encode("utf-8"))
        + len(cast(str, params["month_receipts"]).encode("utf-8"))
        for receipt in entity_receipts
        for params in (receipt.as_sql_params(),)
    )


def _finalize_historic_receipt_run(
    run: _HistoricPublishRun | None,
    provider_id: str,
    generation_id: str,
    report: GateReport,
    gate_enabled: bool,
    force: bool,
) -> None:
    if run is None:
        return
    with run.ledger.phase("other"):
        _assemble_historic_receipt_envelopes(
            run,
            provider_id=provider_id,
            generation_id=generation_id,
            report=report,
            gate_enabled=gate_enabled,
            force=force,
        )


@contextmanager
def _historic_receipt_persistence(
    run: _HistoricPublishRun,
) -> Iterator[None]:
    try:
        with run.ledger.phase("receipt_persist"):
            yield
    except Exception:  # noqa: BLE001 - the caller's SAVEPOINT isolates receipt-only failure
        run.receipt_persist_failed = True
        run.receipt_rows_changed = 0
        run.receipt_json_bytes_changed = 0
        logger.exception(
            "historic receipt persistence failed after root activation; "
            "SAVEPOINT rolled back and publish state will still advance"
        )


def _persist_historic_receipt_run(
    conn: Connection,
    provider_id: str,
    run: _HistoricPublishRun,
    persist: Callable[..., HistoricReceiptPersistenceStats],
) -> None:
    stats = persist(
        conn,
        provider_id=provider_id,
        receipts=run.entity_receipts,
        complete_families=run.complete_receipt_families,
    )
    run.receipt_rows_attempted = stats.rows_attempted
    run.receipt_rows_changed = stats.rows_changed
    run.receipt_json_bytes_attempted = stats.json_bytes_attempted
    run.receipt_json_bytes_changed = stats.json_bytes_changed
    run.stale_receipt_entities_deleted = stats.stale_entities_deleted
    run.stale_receipt_months_deleted = stats.stale_months_deleted


def _snapshot_historic_telemetry(
    run: _HistoricPublishRun,
) -> dict[str, object]:
    return run.ledger.snapshot(**run.telemetry_fields(timing_complete=False))


def _finish_historic_telemetry(
    run: _HistoricPublishRun | None,
) -> dict[str, object] | None:
    if run is None:
        return None
    telemetry = run.ledger.telemetry(
        **run.telemetry_fields(timing_complete=True)
    )
    logger.info(
        "historic publish telemetry: %s",
        json.dumps(telemetry, sort_keys=True, separators=(",", ":")),
    )
    return telemetry


def _historic_publish_state_fields(
    *,
    tier: str,
    historic_telemetry: Mapping[str, object] | None,
) -> dict[str, object]:
    state: dict[str, object] = {
        "historic_files_reused": None,
        "historic_scopes_reused": None,
        "historic_scopes_rebuilt": None,
        "historic_source_digest_ms": None,
        "historic_build_ms": None,
        "historic_gate_ms": None,
        "historic_upload_ms": None,
        "historic_parent_compose_ms": None,
        "historic_compatibility_ms": None,
        "historic_receipt_persist_ms": None,
        "historic_receipt_rows_attempted": None,
        "historic_receipt_rows_changed": None,
        "historic_phase_detail": None,
    }
    if historic_telemetry is None:
        return state
    if tier != "historic":
        raise ValueError("historic telemetry can only be recorded for the historic tier")
    state.update(
        {
            "historic_files_reused": int(
                cast(Any, historic_telemetry["historic_files_reused"])
            ),
            "historic_scopes_reused": int(
                cast(Any, historic_telemetry["historic_scopes_reused"])
            ),
            "historic_scopes_rebuilt": int(
                cast(Any, historic_telemetry["historic_scopes_rebuilt"])
            ),
            "historic_source_digest_ms": historic_telemetry["source_digest_ms"],
            "historic_build_ms": historic_telemetry["build_ms"],
            "historic_gate_ms": historic_telemetry["gate_ms"],
            "historic_upload_ms": historic_telemetry["upload_ms"],
            "historic_parent_compose_ms": historic_telemetry["parent_compose_ms"],
            "historic_compatibility_ms": historic_telemetry["compatibility_ms"],
            "historic_receipt_persist_ms": historic_telemetry["receipt_persist_ms"],
            "historic_receipt_rows_attempted": int(
                cast(Any, historic_telemetry["receipt_rows_attempted"])
            ),
            "historic_receipt_rows_changed": int(
                cast(Any, historic_telemetry["receipt_rows_changed"])
            ),
            "historic_phase_detail": dict(historic_telemetry),
        }
    )
    return state


_HISTORIC_STATE_COLUMNS_SQL = (
    "historic_files_reused, historic_scopes_reused, historic_scopes_rebuilt, "
    "historic_source_digest_ms, historic_build_ms, historic_gate_ms, "
    "historic_upload_ms, historic_parent_compose_ms, historic_compatibility_ms, "
    "historic_receipt_persist_ms, historic_receipt_rows_attempted, "
    "historic_receipt_rows_changed, historic_phase_detail, "
)
_HISTORIC_STATE_VALUES_SQL = (
    ":historic_files_reused, :historic_scopes_reused, :historic_scopes_rebuilt, "
    ":historic_source_digest_ms, :historic_build_ms, :historic_gate_ms, "
    ":historic_upload_ms, :historic_parent_compose_ms, :historic_compatibility_ms, "
    ":historic_receipt_persist_ms, :historic_receipt_rows_attempted, "
    ":historic_receipt_rows_changed, CAST(:historic_phase_detail AS jsonb), "
)
_HISTORIC_STATE_UPDATES_SQL = (
    "historic_files_reused = EXCLUDED.historic_files_reused, "
    "historic_scopes_reused = EXCLUDED.historic_scopes_reused, "
    "historic_scopes_rebuilt = EXCLUDED.historic_scopes_rebuilt, "
    "historic_source_digest_ms = EXCLUDED.historic_source_digest_ms, "
    "historic_build_ms = EXCLUDED.historic_build_ms, "
    "historic_gate_ms = EXCLUDED.historic_gate_ms, "
    "historic_upload_ms = EXCLUDED.historic_upload_ms, "
    "historic_parent_compose_ms = EXCLUDED.historic_parent_compose_ms, "
    "historic_compatibility_ms = EXCLUDED.historic_compatibility_ms, "
    "historic_receipt_persist_ms = EXCLUDED.historic_receipt_persist_ms, "
    "historic_receipt_rows_attempted = EXCLUDED.historic_receipt_rows_attempted, "
    "historic_receipt_rows_changed = EXCLUDED.historic_receipt_rows_changed, "
    "historic_phase_detail = EXCLUDED.historic_phase_detail, "
)


__all__ = [
    "HistoricCommonEnvelope",
    "HistoricEntityReceipt",
    "HistoricProviderContext",
    "HistoricReceiptEvidenceError",
    "HistoricReceiptPersistenceStats",
    "HistoricReceiptPreflight",
    "HistoricScopeReceipt",
    "HistoryScopeCardinality",
    "build_historic_common_envelope",
    "build_historic_detached_contribution",
    "build_historic_entity_receipt",
    "build_historic_scope_receipt",
    "digest_file_manifest",
    "historic_receipts_supported",
    "persist_historic_receipts",
    "prepare_historic_receipt_preflight",
    "validate_historic_entity_receipt",
]
