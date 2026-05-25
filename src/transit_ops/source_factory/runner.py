from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from transit_ops.db.connection import make_engine
from transit_ops.gold.marts import build_gold_marts
from transit_ops.gold.rollups import build_warm_rollups
from transit_ops.ingestion.gis import ingest_gis_feed
from transit_ops.ingestion.i3 import capture_i3_alerts
from transit_ops.ingestion.realtime_gtfs import capture_realtime_feed
from transit_ops.ingestion.static_gtfs import ingest_static_feed
from transit_ops.ingestion.storage import get_bronze_storage
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings, get_settings
from transit_ops.silver.gis import load_latest_gis_to_silver
from transit_ops.silver.i3 import load_latest_i3_to_silver
from transit_ops.silver.realtime_gtfs import load_latest_realtime_to_silver
from transit_ops.silver.static_gtfs import load_latest_static_to_silver
from transit_ops.source_factory.artifacts import write_json_artifact
from transit_ops.source_factory.catalog import (
    SourceFactorySource,
    build_source_factory_catalog,
    reset_source_factory_tables,
)
from transit_ops.source_factory.guards import (
    assert_oracle_database_target,
    build_r2_namespace_proof,
    build_worker_stopped_proof,
    validate_destructive_confirmations,
)
from transit_ops.source_factory.models import (
    ArtifactRef,
    FactoryPhase,
    PhaseStatus,
    SourceFactoryResult,
)
from transit_ops.source_factory.r2 import run_r2_prune_cycle


class OptionalSourceUnavailable(RuntimeError):
    """Raised by optional source operations when no source is available."""


@dataclass(frozen=True)
class SourceFactoryOperationImpls:
    r2_prune_cycle: Callable[..., Any] = run_r2_prune_cycle
    reset_tables: Callable[..., Any] = reset_source_factory_tables
    ingest_static_feed: Callable[..., Any] = ingest_static_feed
    capture_realtime_feed: Callable[..., Any] = capture_realtime_feed
    ingest_gis_feed: Callable[..., Any] = ingest_gis_feed
    capture_i3_alerts: Callable[..., Any] = capture_i3_alerts
    load_latest_static_to_silver: Callable[..., Any] = load_latest_static_to_silver
    load_latest_realtime_to_silver: Callable[..., Any] = load_latest_realtime_to_silver
    load_latest_gis_to_silver: Callable[..., Any] = load_latest_gis_to_silver
    load_latest_i3_to_silver: Callable[..., Any] = load_latest_i3_to_silver
    build_gold_marts: Callable[..., Any] = build_gold_marts
    build_warm_rollups: Callable[..., Any] = build_warm_rollups


def run_source_factory_rebuild(
    provider_id: str,
    *,
    artifact_dir: Path,
    keep_from_date: date,
    execute: bool = False,
    active_prefix_wipe: bool = False,
    confirm_worker_stopped: bool = False,
    confirm_oracle_target: bool = False,
    confirm_r2_cleanup: bool = False,
    confirm_active_prefix_wipe: bool = False,
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    engine: Any | None = None,
    bronze_storage: Any | None = None,
    clock: Callable[[], datetime] | None = None,
    operation_impls: SourceFactoryOperationImpls | None = None,
) -> SourceFactoryResult:
    now = clock or (lambda: datetime.now(UTC))
    started_at_utc = now()
    settings = settings or get_settings()
    operation_impls = operation_impls or SourceFactoryOperationImpls()

    guard_proofs: dict[str, object] = {
        "destructive_confirmations": validate_destructive_confirmations(
            execute=execute,
            destructive_r2_cleanup=execute,
            active_prefix_wipe=active_prefix_wipe,
            confirm_worker_stopped=confirm_worker_stopped,
            confirm_oracle_target=confirm_oracle_target,
            confirm_r2_cleanup=confirm_r2_cleanup,
            confirm_active_prefix_wipe=confirm_active_prefix_wipe,
        ),
        "r2_namespace": build_r2_namespace_proof(settings, provider_id),
    }
    if execute:
        guard_proofs["worker_stopped"] = build_worker_stopped_proof(
            confirm_worker_stopped=confirm_worker_stopped,
        )
        guard_proofs["oracle_database_target"] = assert_oracle_database_target(
            settings.DATABASE_URL,
            confirm_oracle_target=confirm_oracle_target,
        )

    registry = registry or ProviderRegistry.from_project_root(settings=settings)
    registry.get_provider(provider_id)
    catalog = build_source_factory_catalog(provider_id)
    bronze_storage = bronze_storage or get_bronze_storage(
        settings,
        project_root=Path(__file__).resolve().parents[3],
    )

    phase_status: dict[FactoryPhase, PhaseStatus] = {
        FactoryPhase.PREFLIGHT: PhaseStatus.OK,
    }
    artifacts: dict[str, object] = {}
    summaries: dict[str, object] = {
        "catalog": catalog.display_dict(),
        "guard_proofs": guard_proofs,
        "planned_backfill_order": [
            _planned_source_step(source) for source in catalog.sources
        ],
    }

    r2_result = operation_impls.r2_prune_cycle(
        bronze_storage,
        provider_id=provider_id,
        keep_from_date=keep_from_date,
        artifact_dir=artifact_dir,
        endpoint_keys=tuple(source.endpoint_key for source in catalog.sources),
        execute=execute,
        confirm_r2_cleanup=confirm_r2_cleanup,
        active_prefix_wipe=active_prefix_wipe,
        confirm_active_prefix_wipe=confirm_active_prefix_wipe,
        clock=now,
    )
    r2_failed_keys = _failed_r2_cleanup_keys(r2_result)
    if r2_failed_keys:
        raise RuntimeError(
            "R2 cleanup failed for "
            f"{len(r2_failed_keys)} object(s); aborting before database reset: "
            + ", ".join(r2_failed_keys)
        )
    phase_status.update(
        {
            FactoryPhase.R2_PRE_INVENTORY: PhaseStatus.OK,
            FactoryPhase.R2_CLEANUP_PLAN: PhaseStatus.OK,
            FactoryPhase.R2_CLEANUP_EXECUTE: PhaseStatus.OK,
            FactoryPhase.R2_POST_INVENTORY: PhaseStatus.OK,
        }
    )
    for artifact_name, artifact in getattr(r2_result, "artifacts", {}).items():
        artifacts[f"r2_{artifact_name}"] = _display_value(artifact)
    summaries["r2_prune_cycle"] = _display_value(r2_result)

    if not execute:
        phase_status[FactoryPhase.DB_RESET] = PhaseStatus.SKIPPED
        phase_status[FactoryPhase.SOURCE_BACKFILL] = PhaseStatus.SKIPPED
        phase_status[FactoryPhase.SILVER_VALIDATION] = PhaseStatus.SKIPPED
        phase_status[FactoryPhase.GOLD_VALIDATION] = PhaseStatus.SKIPPED
        summaries["reset"] = {"status": PhaseStatus.SKIPPED, "reason": "dry_run"}
        summaries["source_backfill"] = [
            {
                **_planned_source_step(source),
                "status": PhaseStatus.SKIPPED,
                "reason": "dry_run",
            }
            for source in catalog.sources
        ]
        summaries["gold"] = {"status": PhaseStatus.SKIPPED, "reason": "dry_run"}
    else:
        engine = engine or make_engine(settings)
        with engine.begin() as connection:
            operation_impls.reset_tables(connection)
        phase_status[FactoryPhase.DB_RESET] = PhaseStatus.OK
        summaries["reset"] = {
            "status": PhaseStatus.OK,
            "tables": list(catalog.reset_tables),
        }

        source_backfill = _execute_source_backfill(
            provider_id,
            catalog.sources,
            settings=settings,
            registry=registry,
            engine=engine,
            operation_impls=operation_impls,
        )
        summaries["source_backfill"] = source_backfill
        phase_status[FactoryPhase.SOURCE_BACKFILL] = PhaseStatus.OK
        phase_status[FactoryPhase.SILVER_VALIDATION] = PhaseStatus.OK

        gold_marts_result = operation_impls.build_gold_marts(
            provider_id,
            settings=settings,
            registry=registry,
            engine=engine,
        )
        warm_rollups_result = operation_impls.build_warm_rollups(
            provider_id,
            settings=settings,
            engine=engine,
        )
        summaries["gold"] = {
            "status": PhaseStatus.OK,
            "build_gold_marts": _display_value(gold_marts_result),
            "build_warm_rollups": _display_value(warm_rollups_result),
        }
        phase_status[FactoryPhase.GOLD_VALIDATION] = PhaseStatus.OK

    completed_at_utc = now()
    phase_status[FactoryPhase.FINAL_REPORT] = PhaseStatus.OK
    result = SourceFactoryResult(
        provider_id=provider_id,
        execute=execute,
        started_at_utc=started_at_utc,
        completed_at_utc=completed_at_utc,
        phase_status=phase_status,
        artifacts=artifacts,
        summaries=summaries,
    )
    report_artifact = write_json_artifact(
        artifact_dir / f"{provider_id}-source-factory-result.json",
        result.display_dict(),
    )

    return SourceFactoryResult(
        provider_id=result.provider_id,
        execute=result.execute,
        started_at_utc=result.started_at_utc,
        completed_at_utc=result.completed_at_utc,
        phase_status=result.phase_status,
        artifacts={**result.artifacts, "source_factory_result": report_artifact},
        summaries=result.summaries,
    )


def _execute_source_backfill(
    provider_id: str,
    sources: tuple[SourceFactorySource, ...],
    *,
    settings: Settings,
    registry: ProviderRegistry,
    engine: Any,
    operation_impls: SourceFactoryOperationImpls,
) -> list[dict[str, object]]:
    results: list[dict[str, object]] = []
    for source in sources:
        result = _execute_source_step(
            provider_id,
            source,
            settings=settings,
            registry=registry,
            engine=engine,
            operation_impls=operation_impls,
        )
        results.append(result)
    return results


def _execute_source_step(
    provider_id: str,
    source: SourceFactorySource,
    *,
    settings: Settings,
    registry: ProviderRegistry,
    engine: Any,
    operation_impls: SourceFactoryOperationImpls,
) -> dict[str, object]:
    if source.family == "static_schedule":
        capture_result = operation_impls.ingest_static_feed(
            provider_id,
            settings=settings,
            registry=registry,
            engine=engine,
        )
        silver_result = operation_impls.load_latest_static_to_silver(
            provider_id,
            settings=settings,
            registry=registry,
            engine=engine,
        )
    elif source.family in {"trip_updates", "vehicle_positions"}:
        capture_result = operation_impls.capture_realtime_feed(
            provider_id,
            settings=settings,
            registry=registry,
            engine=engine,
            endpoint_key=source.endpoint_key,
        )
        silver_result = operation_impls.load_latest_realtime_to_silver(
            provider_id,
            settings=settings,
            registry=registry,
            engine=engine,
            endpoint_key=source.endpoint_key,
        )
    elif source.family == "gis_static":
        try:
            capture_result = operation_impls.ingest_gis_feed(
                provider_id,
                settings=settings,
                registry=registry,
                engine=engine,
            )
        except Exception as exc:
            if not _is_optional_capture_source_unavailable(source, exc):
                raise
            return _optional_source_skip_result(source, exc)
        silver_result = operation_impls.load_latest_gis_to_silver(
            provider_id,
            settings=settings,
            registry=registry,
            engine=engine,
        )
    elif source.family == "i3_alerts":
        try:
            capture_result = operation_impls.capture_i3_alerts(
                provider_id,
                settings=settings,
                registry=registry,
                engine=engine,
            )
        except Exception as exc:
            if not _is_optional_capture_source_unavailable(source, exc):
                raise
            return _optional_source_skip_result(source, exc)
        silver_result = operation_impls.load_latest_i3_to_silver(
            provider_id,
            settings=settings,
            engine=engine,
        )
    else:
        raise ValueError(f"Unsupported source factory family: {source.family}")

    return {
        **_planned_source_step(source),
        "status": PhaseStatus.OK,
        "capture": _display_value(capture_result),
        "silver": _display_value(silver_result),
    }


def _failed_r2_cleanup_keys(r2_result: object) -> list[str]:
    cleanup_result = getattr(r2_result, "cleanup_result", None)
    failed_keys = getattr(cleanup_result, "failed_keys", [])
    return [str(key) for key in failed_keys]


def _optional_source_skip_result(
    source: SourceFactorySource,
    exc: Exception,
) -> dict[str, object]:
    return {
        **_planned_source_step(source),
        "status": PhaseStatus.SKIPPED,
        "reason": str(exc),
    }


def _planned_source_step(source: SourceFactorySource) -> dict[str, object]:
    return {
        "family": source.family,
        "endpoint_key": source.endpoint_key,
        "required": source.required,
        "sibling_group": source.sibling_group,
        "backfill_strategy": source.backfill_strategy,
    }


def _display_value(value: object) -> object:
    if hasattr(value, "display_dict"):
        return value.display_dict()
    if isinstance(value, ArtifactRef):
        return value.display_dict()
    if isinstance(value, Mapping):
        return {str(key): _display_value(nested) for key, nested in value.items()}
    if isinstance(value, list | tuple):
        return [_display_value(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if value is None or isinstance(value, str | int | float | bool):
        return value
    return repr(value)


def _is_optional_capture_source_unavailable(
    source: SourceFactorySource,
    exc: Exception,
) -> bool:
    if source.required:
        return False
    if isinstance(exc, OptionalSourceUnavailable):
        return True
    if not isinstance(exc, ValueError):
        return False
    message = str(exc).lower()
    if source.family == "gis_static":
        return (
            "gis feed for provider" in message
            and "does not have a resolved url" in message
        )
    if source.family == "i3_alerts":
        return (
            "i3 alert feed for provider" in message
            and "does not have a resolved url" in message
        )
    return False
