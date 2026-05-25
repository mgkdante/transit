from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from transit_ops.db.connection import make_engine
from transit_ops.gold.marts import refresh_gold_static
from transit_ops.ingestion.common import project_root, utc_now
from transit_ops.ingestion.static_gtfs import ingest_static_feed
from transit_ops.ingestion.storage import get_bronze_storage
from transit_ops.providers import ProviderRegistry
from transit_ops.rebuild.bronze_cleanup import (
    REBUILD_ENDPOINTS,
    BronzeActivePrefixCleanupPlan,
    build_bronze_active_prefix_cleanup_plan,
    execute_bronze_active_prefix_cleanup_plan,
)
from transit_ops.rebuild.catalog import reset_rebuild_tables
from transit_ops.settings import Settings, get_settings
from transit_ops.silver.static_gtfs import load_latest_static_to_silver

PROTECTED_DATABASE_HOST_FRAGMENTS = ("neon", "railway", "rlwy")
PROTECTED_DATABASE_HOST_SUFFIXES = (
    ".neon.tech",
    ".railway.app",
    ".proxy.rlwy.net",
)

@dataclass(frozen=True)
class BetaStaticRebuildResult:
    provider_id: str
    dry_run: bool
    delete_r2: bool
    database_target: Mapping[str, object]
    r2_cleanup_plan: Mapping[str, object]
    r2_cleanup_result: object | None
    static_ingestion: object | None
    static_silver_load: object | None
    gold_static_refresh: object | None
    reset_executed: bool
    execute_confirmations: Mapping[str, object]
    completed_at_utc: datetime

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "dry_run": self.dry_run,
            "delete_r2": self.delete_r2,
            "database_target": _display_value(self.database_target),
            "r2_cleanup_plan": _display_value(self.r2_cleanup_plan),
            "r2_cleanup_result": _display_value(self.r2_cleanup_result),
            "static_ingestion": _display_value(self.static_ingestion),
            "static_silver_load": _display_value(self.static_silver_load),
            "gold_static_refresh": _display_value(self.gold_static_refresh),
            "reset_executed": self.reset_executed,
            "execute_confirmations": _display_value(self.execute_confirmations),
            "completed_at_utc": self.completed_at_utc.isoformat(),
        }


def rebuild_beta_static_contract(
    provider_id: str,
    *,
    execute: bool = False,
    delete_r2: bool = False,
    confirm_reset: bool = False,
    confirm_worker_stopped: bool = False,
    confirm_r2_active_prefix_wipe: bool = False,
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    engine: Any | None = None,
    bronze_storage: Any | None = None,
    pre_cleanup_report_path: Path | None = None,
) -> BetaStaticRebuildResult:
    settings = settings or get_settings()
    database_target = _validate_database_target(settings)
    _validate_execution_guards(
        execute=execute,
        delete_r2=delete_r2,
        confirm_reset=confirm_reset,
        confirm_worker_stopped=confirm_worker_stopped,
        confirm_r2_active_prefix_wipe=confirm_r2_active_prefix_wipe,
    )

    root = project_root()
    registry = registry or ProviderRegistry.from_project_root(
        project_root=root,
        settings=settings,
    )
    registry.get_provider(provider_id)
    engine = engine or make_engine(settings)
    bronze_storage = bronze_storage or get_bronze_storage(settings, project_root=root)
    dry_run = not execute
    confirmations = _execute_confirmations(
        execute=execute,
        delete_r2=delete_r2,
        confirm_reset=confirm_reset,
        confirm_worker_stopped=confirm_worker_stopped,
        confirm_r2_active_prefix_wipe=confirm_r2_active_prefix_wipe,
    )

    cleanup_plan = build_bronze_active_prefix_cleanup_plan(
        bronze_storage,
        provider_id=provider_id,
        endpoint_keys=REBUILD_ENDPOINTS,
    )

    cleanup_result = None
    static_ingestion = None
    static_silver_load = None
    gold_static_refresh = None
    reset_executed = False

    if execute:
        if delete_r2 and pre_cleanup_report_path is not None:
            _write_pre_cleanup_report(
                pre_cleanup_report_path,
                provider_id=provider_id,
                database_target=database_target,
                cleanup_plan=cleanup_plan,
                execute_confirmations=confirmations,
            )
        cleanup_result = execute_bronze_active_prefix_cleanup_plan(
            bronze_storage,
            cleanup_plan,
            delete=delete_r2,
        )
        failed_keys = getattr(cleanup_result, "failed_keys", [])
        if failed_keys:
            raise RuntimeError(
                "Active R2 prefix cleanup failed for "
                f"{len(failed_keys)} object(s); refusing to reset Oracle tables."
            )
        with engine.begin() as connection:
            reset_static_rebuild_tables(connection)
            reset_executed = True

        static_ingestion = ingest_static_feed(
            provider_id,
            settings=settings,
            registry=registry,
            engine=engine,
        )
        static_silver_load = load_latest_static_to_silver(
            provider_id,
            settings=settings,
            registry=registry,
            engine=engine,
        )
        gold_static_refresh = refresh_gold_static(
            provider_id,
            settings=settings,
            registry=registry,
            engine=engine,
        )

    return BetaStaticRebuildResult(
        provider_id=provider_id,
        dry_run=dry_run,
        delete_r2=delete_r2,
        database_target=database_target,
        r2_cleanup_plan=_cleanup_plan_summary(cleanup_plan),
        r2_cleanup_result=cleanup_result,
        static_ingestion=static_ingestion,
        static_silver_load=static_silver_load,
        gold_static_refresh=gold_static_refresh,
        reset_executed=reset_executed,
        execute_confirmations=confirmations,
        completed_at_utc=utc_now(),
    )


def reset_static_rebuild_tables(connection) -> None:  # noqa: ANN001
    reset_rebuild_tables(connection)


def _validate_database_target(settings: Settings) -> dict[str, object]:
    database_url = getattr(settings, "DATABASE_URL", None)
    if not database_url:
        raise ValueError("DATABASE_URL is required for beta static rebuild.")

    parsed = urlsplit(database_url)
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("DATABASE_URL must include a database hostname for beta static rebuild.")

    normalized_host = hostname.lower()
    if any(fragment in normalized_host for fragment in PROTECTED_DATABASE_HOST_FRAGMENTS) or any(
        normalized_host.endswith(suffix) for suffix in PROTECTED_DATABASE_HOST_SUFFIXES
    ):
        raise ValueError(
            "Refusing beta static rebuild against protected hosted database host "
            f"'{hostname}'. Configure an Oracle DATABASE_URL before running."
        )

    return {
        "hostname": hostname,
        "url": _redact_database_url(database_url),
    }


def _validate_execution_guards(
    *,
    execute: bool,
    delete_r2: bool,
    confirm_reset: bool,
    confirm_worker_stopped: bool,
    confirm_r2_active_prefix_wipe: bool,
) -> None:
    if execute and (not confirm_reset or not confirm_worker_stopped):
        raise ValueError(
            "Beta static rebuild with --execute requires --confirm-reset and "
            "--confirm-worker-stopped."
        )
    if delete_r2 and not execute:
        raise ValueError("Beta static rebuild with --delete-r2 requires --execute.")
    if delete_r2 and not confirm_r2_active_prefix_wipe:
        raise ValueError(
            "Beta static rebuild with --delete-r2 requires "
            "--confirm-r2-active-prefix-wipe."
        )


def _execute_confirmations(
    *,
    execute: bool,
    delete_r2: bool,
    confirm_reset: bool,
    confirm_worker_stopped: bool,
    confirm_r2_active_prefix_wipe: bool,
) -> dict[str, object]:
    return {
        "execute": execute,
        "confirm_reset": confirm_reset,
        "confirm_worker_stopped": confirm_worker_stopped,
        "delete_r2": delete_r2,
        "confirm_r2_active_prefix_wipe": confirm_r2_active_prefix_wipe,
        "r2_cleanup_mode": "active_prefix_wipe",
    }


def _cleanup_plan_summary(plan: BronzeActivePrefixCleanupPlan) -> dict[str, object]:
    return {
        "provider_id": plan.provider_id,
        "endpoint_keys": list(plan.endpoint_keys),
        "prefixes": list(plan.prefixes),
        "planned_count": len(plan.objects_to_delete),
        "objects_to_delete": [item.display_dict() for item in plan.objects_to_delete],
        "proof_note": plan.proof_note,
    }


def _write_pre_cleanup_report(
    report_path: Path,
    *,
    provider_id: str,
    database_target: Mapping[str, object],
    cleanup_plan: BronzeActivePrefixCleanupPlan,
    execute_confirmations: Mapping[str, object],
) -> None:
    payload = {
        "stage": "before_r2_active_prefix_wipe",
        "provider_id": provider_id,
        "database_target": _display_value(database_target),
        "r2_cleanup_plan": _cleanup_plan_summary(cleanup_plan),
        "execute_confirmations": _display_value(execute_confirmations),
        "generated_at_utc": utc_now().isoformat(),
    }
    report_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _redact_database_url(database_url: str) -> str:
    parsed = urlsplit(database_url)
    netloc = parsed.hostname or ""
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"
    return urlunsplit((parsed.scheme, netloc, parsed.path, "", ""))


def _display_value(value: object) -> object:
    if hasattr(value, "display_dict"):
        return value.display_dict()
    if isinstance(value, Mapping):
        return {key: _display_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_display_value(item) for item in value]
    if isinstance(value, tuple):
        return [_display_value(item) for item in value]
    if isinstance(value, datetime):
        return value.isoformat()
    return value


__all__ = [
    "BetaStaticRebuildResult",
    "rebuild_beta_static_contract",
    "reset_static_rebuild_tables",
]
