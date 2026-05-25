from __future__ import annotations

import re
from urllib.parse import unquote, urlsplit

from sqlalchemy import text

from transit_ops.settings import Settings

NON_ORACLE_HOST_MARKERS = (
    "neon.tech",
    "railway.app",
    "proxy.rlwy.net",
    "localhost",
    "127.0.0.1",
)
SENSITIVE_NOTE_PATTERN = re.compile(
    r"://\S+:\S+@|"
    r"\b(database_url|password|token|secret|secret[-_\s]*key|access[-_\s]*key|api[-_\s]*key)\b",
    re.IGNORECASE,
)
REDACTED_NOTE = "[redacted: sensitive operator note omitted]"


def assert_oracle_database_target(
    database_url: str | None,
    *,
    confirm_oracle_target: bool,
) -> dict[str, str]:
    if database_url is None or not database_url.strip():
        raise ValueError("DATABASE_URL is required before Oracle source-factory execution.")

    parts = urlsplit(database_url.strip())
    host = parts.hostname
    if not host:
        raise ValueError("DATABASE_URL must include a host.")

    host_lower = host.lower()
    for marker in NON_ORACLE_HOST_MARKERS:
        if marker in host_lower:
            raise ValueError(f"DATABASE_URL host is not an Oracle target: {host_lower}")

    if not confirm_oracle_target:
        raise ValueError("confirm_oracle_target=True is required for accepted database targets.")

    proof = {
        "status": "ok",
        "scheme": parts.scheme,
        "host": host,
    }
    port = _safe_database_port(parts)
    if port is not None:
        proof["port"] = str(port)

    database = unquote(parts.path.lstrip("/"))
    if database:
        proof["database"] = database

    return proof


def validate_migration_revision(
    connection,
    *,
    expected_revision: str = "0013_gold_ops_brain_contract",
) -> dict[str, str]:
    result = connection.execute(text("SELECT version_num FROM alembic_version"))
    revision = result.scalar_one_or_none()

    if revision != expected_revision:
        raise ValueError(
            f"Expected Alembic revision {expected_revision}; found {revision or '<missing>'}."
        )

    return {"status": "ok", "revision": revision}


def validate_destructive_confirmations(
    *,
    execute: bool,
    destructive_r2_cleanup: bool,
    active_prefix_wipe: bool,
    confirm_worker_stopped: bool,
    confirm_oracle_target: bool,
    confirm_r2_cleanup: bool,
    confirm_active_prefix_wipe: bool,
) -> dict[str, bool]:
    proof = {
        "execute": execute,
        "destructive_r2_cleanup": destructive_r2_cleanup,
        "active_prefix_wipe": active_prefix_wipe,
        "confirm_worker_stopped": confirm_worker_stopped,
        "confirm_oracle_target": confirm_oracle_target,
        "confirm_r2_cleanup": confirm_r2_cleanup,
        "confirm_active_prefix_wipe": confirm_active_prefix_wipe,
    }

    if not execute:
        return proof

    if not confirm_worker_stopped:
        raise ValueError("confirm_worker_stopped=True is required for execute=True.")
    if not confirm_oracle_target:
        raise ValueError("confirm_oracle_target=True is required for execute=True.")
    if destructive_r2_cleanup and not confirm_r2_cleanup:
        raise ValueError("confirm_r2_cleanup=True is required for destructive R2 cleanup.")
    if active_prefix_wipe and not confirm_active_prefix_wipe:
        raise ValueError(
            "confirm_active_prefix_wipe=True is required for active prefix wipe."
        )

    return proof


def build_worker_stopped_proof(
    *,
    confirm_worker_stopped: bool,
    note: str | None = None,
) -> dict[str, object]:
    if not confirm_worker_stopped:
        raise ValueError("confirm_worker_stopped=True is required.")

    proof: dict[str, object] = {"status": "ok", "confirmed": True}
    if note:
        proof["note"] = _safe_operator_note(note)
    return proof


def _safe_database_port(parts: object) -> int | None:
    try:
        return parts.port
    except ValueError as exc:
        raise ValueError("DATABASE_URL has an invalid port.") from exc


def _safe_operator_note(note: str) -> str:
    if SENSITIVE_NOTE_PATTERN.search(note):
        return REDACTED_NOTE
    return note


def build_r2_namespace_proof(settings: Settings, provider_id: str) -> dict[str, object]:
    storage_backend = settings.BRONZE_STORAGE_BACKEND
    proof: dict[str, object] = {
        "provider_id": provider_id,
        "storage_backend": storage_backend,
    }

    backend_lower = storage_backend.lower()
    if backend_lower == "local":
        proof["local_root"] = settings.BRONZE_LOCAL_ROOT
        return proof

    if backend_lower in {"s3", "r2"} and settings.BRONZE_S3_BUCKET:
        proof["bucket"] = settings.BRONZE_S3_BUCKET

    for attr_name in (
        "BRONZE_S3_PREFIX",
        "BRONZE_R2_PREFIX",
        "BRONZE_STORAGE_PREFIX",
        "BRONZE_S3_ROOT",
        "BRONZE_R2_ROOT",
    ):
        value = getattr(settings, attr_name, None)
        if value:
            proof[attr_name.lower()] = value

    return proof
