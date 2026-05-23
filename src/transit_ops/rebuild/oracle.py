from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from transit_ops.db.connection import make_engine
from transit_ops.gold.marts import (
    GoldBuildResult,
    _refresh_gold_tables,
    _resolve_gold_build_context,
)
from transit_ops.gold.rollups import (
    SELECT_MISSING_TRIP_DELAY_PERIODS,
    SELECT_MISSING_VEHICLE_PERIODS,
    UPSERT_TRIP_DELAY_SUMMARY_5M,
    UPSERT_VEHICLE_SUMMARY_5M,
    UPSERT_WARM_ROLLUP_PERIOD,
    WarmRollupBuildResult,
)
from transit_ops.ingestion.common import project_root, utc_now
from transit_ops.ingestion.storage import get_bronze_storage
from transit_ops.providers import ProviderRegistry
from transit_ops.rebuild.bronze_cleanup import (
    BronzeCleanupPlan,
    build_bronze_cleanup_plan,
    execute_bronze_cleanup_plan,
)
from transit_ops.rebuild.catalog import (
    BronzeRebuildSelection,
    month_bounds,
    rebuild_raw_catalog,
    reset_rebuild_tables,
    select_rebuild_bronze_objects,
)
from transit_ops.rebuild.parity import collect_parity_evidence
from transit_ops.settings import Settings, get_settings
from transit_ops.silver.realtime_gtfs import (
    find_realtime_bronze_snapshots,
    load_realtime_snapshots_to_silver,
)
from transit_ops.silver.static_gtfs import (
    find_latest_static_bronze_archive,
    load_static_zip_to_silver,
)

ORACLE_REBUILD_MONTH = "2026-05"
R2_DELETE_CONFIRMATION_DATE = date(2026, 5, 1)
PROTECTED_DATABASE_HOST_FRAGMENTS = ("neon", "railway", "rlwy")
PROTECTED_DATABASE_HOST_SUFFIXES = (
    ".neon.tech",
    ".railway.app",
    ".proxy.rlwy.net",
)


@dataclass(frozen=True)
class OracleRebuildResult:
    provider_id: str
    month: str
    dry_run: bool
    delete_r2: bool
    database_target: Mapping[str, object]
    cleanup_plan: Mapping[str, object]
    cleanup_result: object | None
    selection: Mapping[str, object]
    before_parity: object
    after_parity: object | None
    raw_catalog_rebuild: object | None
    static_silver_load: object | None
    realtime_silver_load: object | None
    gold_build: object | None
    warm_rollups: object | None
    reset_executed: bool
    execute_confirmations: Mapping[str, object]
    completed_at_utc: datetime

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "month": self.month,
            "dry_run": self.dry_run,
            "delete_r2": self.delete_r2,
            "database_target": _display_value(self.database_target),
            "cleanup_plan": _display_value(self.cleanup_plan),
            "cleanup_result": _display_value(self.cleanup_result),
            "selection": _display_value(self.selection),
            "before_parity": _display_value(self.before_parity),
            "after_parity": _display_value(self.after_parity),
            "raw_catalog_rebuild": _display_value(self.raw_catalog_rebuild),
            "static_silver_load": _display_value(self.static_silver_load),
            "realtime_silver_load": _display_value(self.realtime_silver_load),
            "gold_build": _display_value(self.gold_build),
            "warm_rollups": _display_value(self.warm_rollups),
            "reset_executed": self.reset_executed,
            "execute_confirmations": _display_value(self.execute_confirmations),
            "completed_at_utc": self.completed_at_utc.isoformat(),
        }


def rebuild_oracle_data(
    provider_id: str,
    *,
    month: str = ORACLE_REBUILD_MONTH,
    execute: bool = False,
    delete_r2: bool = False,
    confirm_reset: bool = False,
    confirm_worker_stopped: bool = False,
    confirm_r2_delete_before: date | str | None = None,
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    engine: Any | None = None,
    bronze_storage: Any | None = None,
) -> OracleRebuildResult:
    settings = settings or get_settings()
    database_target = _validate_database_target(settings)
    _validate_rebuild_month(month)
    confirmation_date = _parse_confirmation_date(confirm_r2_delete_before)
    _validate_execution_guards(
        execute=execute,
        delete_r2=delete_r2,
        confirm_reset=confirm_reset,
        confirm_worker_stopped=confirm_worker_stopped,
        confirm_r2_delete_before=confirmation_date,
    )

    month_start, month_end = month_bounds(month)
    root = project_root()
    registry = registry or ProviderRegistry.from_project_root(
        project_root=root,
        settings=settings,
    )
    engine = engine or make_engine(settings)
    bronze_storage = bronze_storage or get_bronze_storage(settings, project_root=root)
    dry_run = not execute
    execute_confirmations = _execute_confirmations(
        execute=execute,
        delete_r2=delete_r2,
        confirm_reset=confirm_reset,
        confirm_worker_stopped=confirm_worker_stopped,
        confirm_r2_delete_before=confirmation_date,
    )

    with engine.connect() as connection:
        before_parity = collect_parity_evidence(connection, provider_id=provider_id)

    cleanup_plan = build_bronze_cleanup_plan(
        bronze_storage,
        provider_id=provider_id,
        keep_from_date=R2_DELETE_CONFIRMATION_DATE,
    )
    selection = select_rebuild_bronze_objects(
        bronze_storage,
        provider_id=provider_id,
        month=month,
    )

    cleanup_result = None
    after_parity = None
    raw_catalog_rebuild = None
    static_silver_load = None
    realtime_silver_load = None
    gold_build = None
    warm_rollups = None
    reset_executed = False

    if execute:
        cleanup_result = execute_bronze_cleanup_plan(
            bronze_storage,
            cleanup_plan,
            delete=delete_r2,
        )

        with engine.begin() as connection:
            reset_rebuild_tables(connection)
            reset_executed = True
            raw_catalog_rebuild = rebuild_raw_catalog(
                connection,
                provider_id=provider_id,
                selection=selection,
                settings=settings,
                registry=registry,
                storage=bronze_storage,
            )
            static_archive = find_latest_static_bronze_archive(
                connection,
                provider_id=provider_id,
                endpoint_key="static_schedule",
                settings=settings,
                project_root=root,
            )
            static_silver_load = load_static_zip_to_silver(
                connection,
                archive=static_archive,
                bronze_storage=bronze_storage,
            )
            realtime_snapshots = find_realtime_bronze_snapshots(
                connection,
                provider_id=provider_id,
                start_utc=month_start,
                end_utc=month_end,
                settings=settings,
                project_root=root,
            )
            realtime_silver_load = load_realtime_snapshots_to_silver(
                connection,
                provider_id=provider_id,
                snapshots=realtime_snapshots,
                bronze_storage=bronze_storage,
                skip_existing=True,
            )
            gold_build = _build_gold_marts_in_transaction(
                connection,
                provider_id=provider_id,
                settings=settings,
                registry=registry,
            )
            warm_rollups = _build_warm_rollups_in_transaction(
                connection,
                provider_id=provider_id,
                since_utc=month_start,
            )
            after_parity = collect_parity_evidence(connection, provider_id=provider_id)

    return OracleRebuildResult(
        provider_id=provider_id,
        month=month,
        dry_run=dry_run,
        delete_r2=delete_r2,
        database_target=database_target,
        cleanup_plan=_cleanup_plan_summary(cleanup_plan),
        cleanup_result=cleanup_result,
        selection=_selection_summary(selection),
        before_parity=before_parity,
        after_parity=after_parity,
        raw_catalog_rebuild=raw_catalog_rebuild,
        static_silver_load=static_silver_load,
        realtime_silver_load=realtime_silver_load,
        gold_build=gold_build,
        warm_rollups=warm_rollups,
        reset_executed=reset_executed,
        execute_confirmations=execute_confirmations,
        completed_at_utc=utc_now(),
    )


def _validate_rebuild_month(month: str) -> None:
    if month != ORACLE_REBUILD_MONTH:
        raise ValueError(
            f"Oracle rebuild only supports month {ORACLE_REBUILD_MONTH}, got {month}."
        )


def _validate_database_target(settings: Settings) -> dict[str, object]:
    database_url = getattr(settings, "DATABASE_URL", None)
    if not database_url:
        raise ValueError("DATABASE_URL is required for Oracle rebuild.")

    parsed = urlsplit(database_url)
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("DATABASE_URL must include a database hostname for Oracle rebuild.")

    normalized_host = hostname.lower()
    if any(fragment in normalized_host for fragment in PROTECTED_DATABASE_HOST_FRAGMENTS) or any(
        normalized_host.endswith(suffix) for suffix in PROTECTED_DATABASE_HOST_SUFFIXES
    ):
        raise ValueError(
            "Refusing Oracle rebuild against protected hosted database host "
            f"'{hostname}'. Configure an Oracle DATABASE_URL before running."
        )

    return {
        "hostname": hostname,
        "url": getattr(settings, "redacted_database_url", None)
        or _redact_database_url(database_url),
    }


def _parse_confirmation_date(value: date | str | None) -> date | None:
    if value is None or isinstance(value, date):
        return value
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(
            "--confirm-r2-delete-before must use YYYY-MM-DD format."
        ) from exc


def _validate_execution_guards(
    *,
    execute: bool,
    delete_r2: bool,
    confirm_reset: bool,
    confirm_worker_stopped: bool,
    confirm_r2_delete_before: date | None,
) -> None:
    if execute and (not confirm_reset or not confirm_worker_stopped):
        raise ValueError(
            "Oracle rebuild with --execute requires --confirm-reset and "
            "--confirm-worker-stopped."
        )
    if delete_r2 and not execute:
        raise ValueError("Oracle rebuild with --delete-r2 requires --execute.")
    if delete_r2 and confirm_r2_delete_before != R2_DELETE_CONFIRMATION_DATE:
        raise ValueError(
            "Oracle rebuild with --delete-r2 requires "
            "--confirm-r2-delete-before 2026-05-01."
        )


def _execute_confirmations(
    *,
    execute: bool,
    delete_r2: bool,
    confirm_reset: bool,
    confirm_worker_stopped: bool,
    confirm_r2_delete_before: date | None,
) -> dict[str, object]:
    return {
        "execute": execute,
        "confirm_reset": confirm_reset,
        "confirm_worker_stopped": confirm_worker_stopped,
        "delete_r2": delete_r2,
        "confirm_r2_delete_before": (
            confirm_r2_delete_before.isoformat() if confirm_r2_delete_before else None
        ),
        "r2_delete_confirmation_required": R2_DELETE_CONFIRMATION_DATE.isoformat(),
    }


def _cleanup_plan_summary(plan: BronzeCleanupPlan) -> dict[str, object]:
    return {
        "provider_id": plan.provider_id,
        "keep_from_date": plan.keep_from_date.isoformat(),
        "eligible_count": len(plan.eligible_objects),
        "retained_count": len(plan.retained_objects),
        "skipped_unknown_key_count": len(plan.skipped_unknown_keys),
        "eligible_objects": [item.display_dict() for item in plan.eligible_objects],
        "retained_objects": [item.display_dict() for item in plan.retained_objects],
        "skipped_unknown_keys": list(plan.skipped_unknown_keys),
    }


def _selection_summary(selection: BronzeRebuildSelection) -> dict[str, object]:
    return {
        "provider_id": selection.provider_id,
        "month": selection.month,
        "static_count": 1,
        "realtime_count": len(selection.realtime_snapshots),
        "static_archive": selection.static_archive.display_dict(),
        "realtime_snapshots": [
            snapshot.display_dict()
            for snapshot in selection.realtime_snapshots
        ],
        "skipped_unknown_keys": list(selection.skipped_unknown_keys),
    }


def _build_gold_marts_in_transaction(
    connection,
    *,
    provider_id: str,
    settings: Settings,
    registry: ProviderRegistry,
) -> GoldBuildResult:
    manifest = registry.get_provider(provider_id)
    context = _resolve_gold_build_context(
        connection,
        provider_id=manifest.provider.provider_id,
        provider_timezone=manifest.provider.timezone,
    )
    row_counts = _refresh_gold_tables(connection, context=context)
    built_at_utc = utc_now()

    return GoldBuildResult(
        provider_id=context.provider_id,
        provider_timezone=context.provider_timezone,
        dataset_version_id=context.dataset_version_id,
        latest_trip_updates_snapshot_id=context.latest_trip_updates_snapshot_id,
        latest_vehicle_snapshot_id=context.latest_vehicle_snapshot_id,
        built_at_utc=built_at_utc,
        row_counts=row_counts,
    )


def _build_warm_rollups_in_transaction(
    connection,
    *,
    provider_id: str,
    since_utc: datetime,
) -> WarmRollupBuildResult:
    built_vehicle = 0
    built_trip_delay = 0
    now = utc_now()

    rows = connection.execute(
        SELECT_MISSING_VEHICLE_PERIODS,
        {"provider_id": provider_id, "since_utc": since_utc},
    ).fetchall()
    for row in rows:
        period = row.period_start_utc
        connection.execute(
            UPSERT_VEHICLE_SUMMARY_5M,
            {
                "provider_id": provider_id,
                "period_start_utc": period,
                "built_at_utc": now,
            },
        )
        connection.execute(
            UPSERT_WARM_ROLLUP_PERIOD,
            {
                "provider_id": provider_id,
                "rollup_kind": "vehicle_summary_5m",
                "period_start_utc": period,
                "built_at_utc": now,
            },
        )
        built_vehicle += 1

    rows = connection.execute(
        SELECT_MISSING_TRIP_DELAY_PERIODS,
        {"provider_id": provider_id, "since_utc": since_utc},
    ).fetchall()
    for row in rows:
        period = row.period_start_utc
        connection.execute(
            UPSERT_TRIP_DELAY_SUMMARY_5M,
            {
                "provider_id": provider_id,
                "period_start_utc": period,
                "built_at_utc": now,
            },
        )
        connection.execute(
            UPSERT_WARM_ROLLUP_PERIOD,
            {
                "provider_id": provider_id,
                "rollup_kind": "trip_delay_summary_5m",
                "period_start_utc": period,
                "built_at_utc": now,
            },
        )
        built_trip_delay += 1

    return WarmRollupBuildResult(
        provider_id=provider_id,
        since_utc=since_utc,
        built_vehicle_periods=built_vehicle,
        built_trip_delay_periods=built_trip_delay,
        completed_at_utc=now,
    )


def _redact_database_url(database_url: str) -> str:
    parsed = urlsplit(database_url)
    hostname = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    return urlunsplit((parsed.scheme, hostname + port, parsed.path, parsed.query, parsed.fragment))


def _display_value(value: object) -> object:
    if value is None:
        return None
    display_dict = getattr(value, "display_dict", None)
    if callable(display_dict):
        return _display_value(display_dict())
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, Mapping):
        return {
            str(key): _display_value(value[key])
            for key in sorted(value, key=str)
        }
    if isinstance(value, list):
        return [_display_value(item) for item in value]
    if isinstance(value, tuple):
        return [_display_value(item) for item in value]
    return value


__all__ = ["OracleRebuildResult", "rebuild_oracle_data"]
