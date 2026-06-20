from __future__ import annotations

import json
import logging
import signal
import threading
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from sqlalchemy.engine import Engine

from transit_ops.core.models import ProviderManifest
from transit_ops.db.connection import make_engine, require_database_url
from transit_ops.gold import (
    GoldBuildResult,
    GoldRealtimeRefreshResult,
    refresh_gold_realtime,
    refresh_gold_static,
)
from transit_ops.ingestion import (
    build_i3_ingestion_config,
    build_realtime_ingestion_config,
    build_service_alerts_ingestion_config,
    capture_i3_alerts,
    capture_realtime_feed,
    capture_service_alerts,
    ingest_gis_feed,
    ingest_static_feed,
)
from transit_ops.ingestion.common import (
    get_feed_endpoint_id,
    insert_failed_ingestion_run,
    utc_now,
)
from transit_ops.maintenance import (
    GoldStoragePruneResult,
    SilverStoragePruneResult,
    prune_gold_storage,
    prune_silver_storage,
)
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings, get_settings
from transit_ops.snapshots.publish import publish_snapshot
from transit_ops.silver import (
    load_latest_gis_to_silver,
    load_latest_i3_to_silver,
    load_latest_realtime_to_silver,
    load_latest_static_to_silver,
)

GTFS_REALTIME_ENDPOINTS = ("trip_updates", "vehicle_positions")
I3_ALERT_ENDPOINT = "i3_alerts"
SERVICE_ALERTS_ENDPOINT = "service_alerts"
REALTIME_ENDPOINTS = (*GTFS_REALTIME_ENDPOINTS, I3_ALERT_ENDPOINT)
# The manifest-driven worker path also polls the generic GTFS-RT service-alerts
# feed when a provider publishes one (STM uses its proprietary i3 feed instead).
# REALTIME_ENDPOINTS stays the legacy fixed set for single-shot CLI/test calls.
ALL_REALTIME_ENDPOINTS = (*REALTIME_ENDPOINTS, SERVICE_ALERTS_ENDPOINT)

logger = logging.getLogger(__name__)


def realtime_endpoints_for_manifest(manifest: ProviderManifest) -> tuple[str, ...]:
    """Realtime endpoint keys this provider actually publishes, in canonical order.

    Drives the realtime cycle from the manifest rather than a fixed tuple, so a
    provider that omits a feed (no i3 alerts; a static-plus-alerts agency with no
    live vehicle feed) is simply not polled for it — instead of failing that
    endpoint every cycle. Considers the full endpoint set (incl. service_alerts).
    """
    return tuple(
        endpoint_key
        for endpoint_key in ALL_REALTIME_ENDPOINTS
        if (feed := manifest.feeds.get(endpoint_key)) is not None
        and getattr(feed, "is_enabled", True)
    )


@dataclass(frozen=True)
class StaticPipelineResult:
    provider_id: str
    status: str
    started_at_utc: datetime
    completed_at_utc: datetime
    total_duration_seconds: float
    static_ingestion_duration_seconds: float
    silver_load_duration_seconds: float | None
    gold_build_duration_seconds: float | None
    static_ingestion: dict[str, object]
    silver_load: dict[str, object] | None
    gold_build: dict[str, object] | None
    static_changed: bool
    skipped_reason: str | None
    # GIS best-effort tail (slice-9.1.1v). Defaulted so a GIS failure never blocks
    # the static publish and pre-existing constructors stay valid.
    gis_ingestion: dict[str, object] | None = None
    gis_silver_load: dict[str, object] | None = None
    gis_ingestion_duration_seconds: float | None = None
    gis_silver_load_duration_seconds: float | None = None
    gis_status: str = "failed"
    gis_error_message: str | None = None

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["started_at_utc"] = self.started_at_utc.isoformat()
        payload["completed_at_utc"] = self.completed_at_utc.isoformat()
        return payload


@dataclass(frozen=True)
class RealtimeEndpointCycleResult:
    endpoint_key: str
    status: str
    capture_duration_seconds: float | None
    silver_load_duration_seconds: float | None
    total_endpoint_duration_seconds: float
    capture_result: dict[str, object] | None
    silver_load_result: dict[str, object] | None
    error_message: str | None

    def display_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class RealtimeCycleResult:
    provider_id: str
    status: str
    started_at_utc: datetime
    completed_at_utc: datetime
    total_duration_seconds: float
    successful_endpoint_count: int
    failed_endpoint_count: int
    endpoint_results: list[RealtimeEndpointCycleResult]
    step_timings_seconds: dict[str, float | None]
    gold_build: dict[str, object] | None
    gold_build_duration_seconds: float | None
    gold_error_message: str | None
    silver_maintenance: dict[str, object] | None
    silver_maintenance_duration_seconds: float | None
    silver_maintenance_error_message: str | None
    gold_maintenance: dict[str, object] | None
    gold_maintenance_duration_seconds: float | None
    gold_maintenance_error_message: str | None
    live_publish_failures: int = 0

    @property
    def has_failures(self) -> bool:
        return self.status != "succeeded"

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "status": self.status,
            "started_at_utc": self.started_at_utc.isoformat(),
            "completed_at_utc": self.completed_at_utc.isoformat(),
            "total_duration_seconds": self.total_duration_seconds,
            "successful_endpoint_count": self.successful_endpoint_count,
            "failed_endpoint_count": self.failed_endpoint_count,
            "endpoint_results": [
                endpoint_result.display_dict()
                for endpoint_result in self.endpoint_results
            ],
            "step_timings_seconds": self.step_timings_seconds,
            "gold_build": self.gold_build,
            "gold_build_duration_seconds": self.gold_build_duration_seconds,
            "gold_error_message": self.gold_error_message,
            "silver_maintenance": self.silver_maintenance,
            "silver_maintenance_duration_seconds": self.silver_maintenance_duration_seconds,
            "silver_maintenance_error_message": self.silver_maintenance_error_message,
            "gold_maintenance": self.gold_maintenance,
            "gold_maintenance_duration_seconds": self.gold_maintenance_duration_seconds,
            "gold_maintenance_error_message": self.gold_maintenance_error_message,
            "live_publish_failures": self.live_publish_failures,
        }


@dataclass(frozen=True)
class RealtimeWorkerCycleTelemetry:
    cycle_number: int
    cycle_start_utc: datetime
    cycle_end_utc: datetime
    cycle_duration_seconds: float
    requested_poll_seconds: float
    computed_sleep_seconds: float
    effective_start_to_start_seconds: float | None
    status: str

    def display_dict(self) -> dict[str, object]:
        return {
            "cycle_number": self.cycle_number,
            "cycle_start_utc": self.cycle_start_utc.isoformat(),
            "cycle_end_utc": self.cycle_end_utc.isoformat(),
            "cycle_duration_seconds": self.cycle_duration_seconds,
            "requested_poll_seconds": self.requested_poll_seconds,
            "computed_sleep_seconds": self.computed_sleep_seconds,
            "effective_start_to_start_seconds": self.effective_start_to_start_seconds,
            "status": self.status,
        }


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _provider_registry(settings: Settings) -> ProviderRegistry:
    return ProviderRegistry.from_project_root(project_root=_project_root(), settings=settings)


def _engine(settings: Settings, engine: Engine | None) -> Engine:
    return engine or make_engine(settings)


def _log_step_success(step_name: str, payload: dict[str, object]) -> None:
    logger.info("%s succeeded: %s", step_name, json.dumps(payload, sort_keys=True))


def _run_timed_static_step(step_name: str, step_fn):  # noqa: ANN001, ANN202
    step_started_at_utc = utc_now()
    step_started_at = time.perf_counter()
    logger.info("Starting static pipeline step '%s'.", step_name)
    try:
        result = step_fn()
    except Exception:
        duration_seconds = round(time.perf_counter() - step_started_at, 3)
        logger.exception(
            "Static pipeline step '%s' failed after %.3f seconds.",
            step_name,
            duration_seconds,
        )
        raise

    step_completed_at_utc = utc_now()
    duration_seconds = round(time.perf_counter() - step_started_at, 3)
    _log_step_success(
        step_name,
        {
            "step_started_at_utc": step_started_at_utc.isoformat(),
            "step_completed_at_utc": step_completed_at_utc.isoformat(),
            "duration_seconds": duration_seconds,
            "result": result.display_dict(),
        },
    )
    return result, duration_seconds


def _run_timed_realtime_step(step_name: str, step_fn):  # noqa: ANN001, ANN202
    step_started_at_utc = utc_now()
    step_started_at = time.perf_counter()
    logger.info("Starting realtime cycle step '%s'.", step_name)
    try:
        result = step_fn()
    except Exception:
        duration_seconds = round(time.perf_counter() - step_started_at, 3)
        logger.exception(
            "Realtime cycle step '%s' failed after %.3f seconds.",
            step_name,
            duration_seconds,
        )
        raise

    step_completed_at_utc = utc_now()
    duration_seconds = round(time.perf_counter() - step_started_at, 3)
    _log_step_success(
        step_name,
        {
            "step_started_at_utc": step_started_at_utc.isoformat(),
            "step_completed_at_utc": step_completed_at_utc.isoformat(),
            "duration_seconds": duration_seconds,
            "result": result.display_dict(),
        },
    )
    return result, duration_seconds


@dataclass(frozen=True)
class _GisStepsOutcome:
    gis_ingestion: dict[str, object] | None
    gis_silver_load: dict[str, object] | None
    gis_ingestion_duration_seconds: float | None
    gis_silver_load_duration_seconds: float | None
    gis_status: str
    gis_error_message: str | None


def _run_gis_steps_best_effort(
    provider_id: str,
    *,
    settings: Settings,
    registry: ProviderRegistry,
    engine: Engine,
) -> _GisStepsOutcome:
    """Run the GIS chain (ingest + silver load) as a best-effort tail.

    GIS must NEVER fail the static publish: any exception is logged and recorded,
    the static pipeline result stays status='succeeded'. The silver load runs
    unconditionally (even when GIS content is unchanged) so gis_gtfs_matches
    re-key to the current static dataset version on every GTFS drop.
    """
    try:
        gis_ingestion, gis_ingestion_duration_seconds = _run_timed_static_step(
            "ingest-gis",
            lambda: ingest_gis_feed(
                provider_id,
                settings=settings,
                registry=registry,
                engine=engine,
            ),
        )
    except Exception as exc:  # noqa: BLE001 — best-effort: GIS must never fail the static publish
        logger.exception("GIS ingest failed (static pipeline continues).")
        return _GisStepsOutcome(
            gis_ingestion=None,
            gis_silver_load=None,
            gis_ingestion_duration_seconds=None,
            gis_silver_load_duration_seconds=None,
            gis_status="failed",
            gis_error_message=f"ingest-gis failed: {exc}",
        )

    try:
        gis_silver_load, gis_silver_load_duration_seconds = _run_timed_static_step(
            "load-gis-silver",
            lambda: load_latest_gis_to_silver(
                provider_id,
                settings=settings,
                registry=registry,
                engine=engine,
            ),
        )
    except Exception as exc:  # noqa: BLE001 — best-effort: GIS must never fail the static publish
        logger.exception("GIS silver load failed (static pipeline continues).")
        return _GisStepsOutcome(
            gis_ingestion=gis_ingestion.display_dict(),
            gis_silver_load=None,
            gis_ingestion_duration_seconds=gis_ingestion_duration_seconds,
            gis_silver_load_duration_seconds=None,
            gis_status="failed",
            gis_error_message=f"load-gis-silver failed: {exc}",
        )

    return _GisStepsOutcome(
        gis_ingestion=gis_ingestion.display_dict(),
        gis_silver_load=gis_silver_load.display_dict(),
        gis_ingestion_duration_seconds=gis_ingestion_duration_seconds,
        gis_silver_load_duration_seconds=gis_silver_load_duration_seconds,
        gis_status="succeeded",
        gis_error_message=None,
    )


def run_static_pipeline(
    provider_id: str,
    *,
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    engine: Engine | None = None,
) -> StaticPipelineResult:
    settings = settings or get_settings()
    registry = registry or _provider_registry(settings)
    engine = _engine(settings, engine)
    started_at_utc = utc_now()
    started_at = time.perf_counter()

    logger.info("Starting static pipeline for provider '%s'.", provider_id)

    # Step 1: static ingestion owns duplicate detection and Bronze/raw lineage.
    static_ingestion, static_ingestion_duration_seconds = _run_timed_static_step(
        "ingest-static",
        lambda: ingest_static_feed(
            provider_id,
            settings=settings,
            registry=registry,
            engine=engine,
        ),
    )

    static_changed = static_ingestion.content_changed

    if not static_changed:
        logger.info(
            "Static content unchanged for provider '%s' (hash=%s). "
            "Skipping Silver load and Gold refresh.",
            provider_id,
            static_ingestion.checksum_sha256,
        )
        gis = _run_gis_steps_best_effort(
            provider_id, settings=settings, registry=registry, engine=engine
        )
        completed_at_utc = utc_now()
        total_duration_seconds = round(time.perf_counter() - started_at, 3)
        return StaticPipelineResult(
            provider_id=provider_id,
            status="succeeded",
            started_at_utc=started_at_utc,
            completed_at_utc=completed_at_utc,
            total_duration_seconds=total_duration_seconds,
            static_ingestion_duration_seconds=static_ingestion_duration_seconds,
            silver_load_duration_seconds=None,
            gold_build_duration_seconds=None,
            static_ingestion=static_ingestion.display_dict(),
            silver_load=None,
            gold_build=None,
            static_changed=False,
            skipped_reason=(
                getattr(static_ingestion, "skipped_reason", None)
                or "static_content_unchanged"
            ),
            gis_ingestion=gis.gis_ingestion,
            gis_silver_load=gis.gis_silver_load,
            gis_ingestion_duration_seconds=gis.gis_ingestion_duration_seconds,
            gis_silver_load_duration_seconds=gis.gis_silver_load_duration_seconds,
            gis_status=gis.gis_status,
            gis_error_message=gis.gis_error_message,
        )

    # Content changed (or no existing version): run steps 2 and 3.
    logger.info(
        "Static content changed for provider '%s' (hash=%s). "
        "Running Silver load and Gold refresh.",
        provider_id,
        static_ingestion.checksum_sha256,
    )
    silver_load, silver_load_duration_seconds = _run_timed_static_step(
        "load-static-silver",
        lambda: load_latest_static_to_silver(
            provider_id,
            settings=settings,
            registry=registry,
            engine=engine,
        ),
    )

    gold_build, gold_build_duration_seconds = _run_timed_static_step(
        "refresh-gold-static",
        lambda: refresh_gold_static(
            provider_id,
            settings=settings,
            registry=registry,
            engine=engine,
        ),
    )

    gis = _run_gis_steps_best_effort(
        provider_id, settings=settings, registry=registry, engine=engine
    )
    completed_at_utc = utc_now()
    total_duration_seconds = round(time.perf_counter() - started_at, 3)
    return StaticPipelineResult(
        provider_id=provider_id,
        status="succeeded",
        started_at_utc=started_at_utc,
        completed_at_utc=completed_at_utc,
        total_duration_seconds=total_duration_seconds,
        static_ingestion_duration_seconds=static_ingestion_duration_seconds,
        silver_load_duration_seconds=silver_load_duration_seconds,
        gold_build_duration_seconds=gold_build_duration_seconds,
        static_ingestion=static_ingestion.display_dict(),
        silver_load=silver_load.display_dict(),
        gold_build=gold_build.display_dict(),
        static_changed=True,
        skipped_reason=None,
        gis_ingestion=gis.gis_ingestion,
        gis_silver_load=gis.gis_silver_load,
        gis_ingestion_duration_seconds=gis.gis_ingestion_duration_seconds,
        gis_silver_load_duration_seconds=gis.gis_silver_load_duration_seconds,
        gis_status=gis.gis_status,
        gis_error_message=gis.gis_error_message,
    )


def _persist_silver_load_failure(
    engine: Engine,
    *,
    provider_id: str,
    endpoint_key: str,
    error_message: str,
    started_at_utc: datetime,
) -> None:
    """Best-effort: record a run_kind='silver_load' failed run for DB telemetry.

    The realtime silver-load failure left zero DB trace before slice-9.1.1o
    (a multi-hour alerts.json freeze was invisible to every DB query). This
    writes a completed status='failed' row so the freshness probe can detect
    the failure-burst incident class.

    A FRESH engine.begin() transaction is used because the load transaction
    just rolled back. The whole body is swallowed: this MUST never raise or
    change the cycle's status semantics — failure telemetry is strictly
    additive. If the run_kind CHECK constraint has not yet been migrated
    (deploy-ordering mistake), the insert raises here and is logged, leaving
    behavior identical to before.
    """
    try:
        with engine.begin() as connection:
            feed_endpoint_id = get_feed_endpoint_id(
                connection,
                provider_id=provider_id,
                endpoint_key=endpoint_key,
                missing_message=(
                    f"No feed endpoint '{endpoint_key}' for provider '{provider_id}'."
                ),
            )
            insert_failed_ingestion_run(
                connection,
                provider_id=provider_id,
                feed_endpoint_id=feed_endpoint_id,
                run_kind="silver_load",
                started_at_utc=started_at_utc,
                completed_at_utc=utc_now(),
                error_message=error_message,
            )
    except Exception:  # noqa: BLE001 — telemetry must never break the cycle
        logger.exception(
            "Failed to persist silver_load failure row for provider '%s', endpoint '%s'.",
            provider_id,
            endpoint_key,
        )


def _capture_and_load_endpoint(
    provider_id: str,
    endpoint_key: str,
    *,
    settings: Settings,
    registry: ProviderRegistry,
    engine: Engine,
) -> RealtimeEndpointCycleResult:
    endpoint_started_at = time.perf_counter()
    capture_duration_seconds: float | None = None
    silver_load_duration_seconds: float | None = None

    logger.info(
        "Running realtime capture step for provider '%s', endpoint '%s'.",
        provider_id,
        endpoint_key,
    )
    capture_started_at = time.perf_counter()
    try:
        capture_result, capture_duration_seconds = _run_timed_realtime_step(
            f"capture-realtime[{endpoint_key}]",
            lambda: capture_realtime_feed(
                provider_id,
                endpoint_key,
                settings=settings,
                registry=registry,
                engine=engine,
            ),
        )
    except Exception as exc:
        if capture_duration_seconds is None:
            capture_duration_seconds = round(
                time.perf_counter() - capture_started_at,
                3,
            )
        logger.error(
            "Realtime cycle capture failed for provider '%s', endpoint '%s': %s",
            provider_id,
            endpoint_key,
            exc,
        )
        return RealtimeEndpointCycleResult(
            endpoint_key=endpoint_key,
            status="failed",
            capture_duration_seconds=capture_duration_seconds,
            silver_load_duration_seconds=silver_load_duration_seconds,
            total_endpoint_duration_seconds=round(
                time.perf_counter() - endpoint_started_at,
                3,
            ),
            capture_result=None,
            silver_load_result=None,
            error_message=f"capture-realtime failed: {exc}",
        )

    logger.info(
        "Running realtime Silver load step for provider '%s', endpoint '%s'.",
        provider_id,
        endpoint_key,
    )
    silver_load_started_at = time.perf_counter()
    silver_load_started_at_utc = utc_now()
    try:
        silver_load_result, silver_load_duration_seconds = _run_timed_realtime_step(
            f"load-realtime-silver[{endpoint_key}]",
            lambda: load_latest_realtime_to_silver(
                provider_id,
                endpoint_key,
                settings=settings,
                registry=registry,
                engine=engine,
            ),
        )
    except Exception as exc:
        if silver_load_duration_seconds is None:
            silver_load_duration_seconds = round(
                time.perf_counter() - silver_load_started_at,
                3,
            )
        logger.error(
            "Realtime cycle Silver load failed for provider '%s', endpoint '%s': %s",
            provider_id,
            endpoint_key,
            exc,
        )
        error_message = f"load-realtime-silver failed: {exc}"
        _persist_silver_load_failure(
            engine,
            provider_id=provider_id,
            endpoint_key=endpoint_key,
            error_message=error_message,
            started_at_utc=silver_load_started_at_utc,
        )
        return RealtimeEndpointCycleResult(
            endpoint_key=endpoint_key,
            status="failed",
            capture_duration_seconds=capture_duration_seconds,
            silver_load_duration_seconds=silver_load_duration_seconds,
            total_endpoint_duration_seconds=round(
                time.perf_counter() - endpoint_started_at,
                3,
            ),
            capture_result=capture_result.display_dict(),
            silver_load_result=None,
            error_message=error_message,
        )

    return RealtimeEndpointCycleResult(
        endpoint_key=endpoint_key,
        status="succeeded",
        capture_duration_seconds=capture_duration_seconds,
        silver_load_duration_seconds=silver_load_duration_seconds,
        total_endpoint_duration_seconds=round(
            time.perf_counter() - endpoint_started_at,
            3,
        ),
        capture_result=capture_result.display_dict(),
        silver_load_result=silver_load_result.display_dict(),
        error_message=None,
    )


def _capture_and_load_alert_endpoint(
    provider_id: str,
    *,
    endpoint_key: str,
    capture_fn: Callable[..., object],
    capture_label_prefix: str,
    silver_label_prefix: str,
    settings: Settings,
    registry: ProviderRegistry,
    engine: Engine,
) -> RealtimeEndpointCycleResult:
    """Capture an alert feed and merge it into silver.i3_alerts.

    Shared by STM's proprietary i3 JSON (capture_i3_alerts) and the generic
    GTFS-RT service-alerts capture; both land in raw.i3_alert_snapshots and use
    the same load_latest_i3_to_silver SCD-2 merge. Label/error prefixes are
    passed in so each endpoint keeps its own operator-facing strings.
    """
    endpoint_started_at = time.perf_counter()
    capture_duration_seconds: float | None = None
    silver_load_duration_seconds: float | None = None

    logger.info(
        "Running alert capture step for provider '%s' (%s).", provider_id, endpoint_key
    )
    capture_started_at = time.perf_counter()
    try:
        capture_result, capture_duration_seconds = _run_timed_realtime_step(
            f"{capture_label_prefix}[{endpoint_key}]",
            lambda: capture_fn(
                provider_id,
                settings=settings,
                registry=registry,
                engine=engine,
            ),
        )
    except Exception as exc:
        if capture_duration_seconds is None:
            capture_duration_seconds = round(
                time.perf_counter() - capture_started_at,
                3,
            )
        logger.error(
            "Realtime cycle %s capture failed for provider '%s': %s",
            endpoint_key,
            provider_id,
            exc,
        )
        return RealtimeEndpointCycleResult(
            endpoint_key=endpoint_key,
            status="failed",
            capture_duration_seconds=capture_duration_seconds,
            silver_load_duration_seconds=silver_load_duration_seconds,
            total_endpoint_duration_seconds=round(
                time.perf_counter() - endpoint_started_at,
                3,
            ),
            capture_result=None,
            silver_load_result=None,
            error_message=f"{capture_label_prefix} failed: {exc}",
        )

    logger.info(
        "Running alert Silver load step for provider '%s' (%s).",
        provider_id,
        endpoint_key,
    )
    silver_load_started_at = time.perf_counter()
    silver_load_started_at_utc = utc_now()
    try:
        silver_load_result, silver_load_duration_seconds = _run_timed_realtime_step(
            f"{silver_label_prefix}[{endpoint_key}]",
            lambda: load_latest_i3_to_silver(
                provider_id,
                settings=settings,
                engine=engine,
            ),
        )
    except Exception as exc:
        if silver_load_duration_seconds is None:
            silver_load_duration_seconds = round(
                time.perf_counter() - silver_load_started_at,
                3,
            )
        logger.error(
            "Realtime cycle %s Silver load failed for provider '%s': %s",
            endpoint_key,
            provider_id,
            exc,
        )
        error_message = f"{silver_label_prefix} failed: {exc}"
        _persist_silver_load_failure(
            engine,
            provider_id=provider_id,
            endpoint_key=endpoint_key,
            error_message=error_message,
            started_at_utc=silver_load_started_at_utc,
        )
        return RealtimeEndpointCycleResult(
            endpoint_key=endpoint_key,
            status="failed",
            capture_duration_seconds=capture_duration_seconds,
            silver_load_duration_seconds=silver_load_duration_seconds,
            total_endpoint_duration_seconds=round(
                time.perf_counter() - endpoint_started_at,
                3,
            ),
            capture_result=capture_result.display_dict(),
            silver_load_result=None,
            error_message=error_message,
        )

    return RealtimeEndpointCycleResult(
        endpoint_key=endpoint_key,
        status="succeeded",
        capture_duration_seconds=capture_duration_seconds,
        silver_load_duration_seconds=silver_load_duration_seconds,
        total_endpoint_duration_seconds=round(
            time.perf_counter() - endpoint_started_at,
            3,
        ),
        capture_result=capture_result.display_dict(),
        silver_load_result=silver_load_result.display_dict(),
        error_message=None,
    )


def _capture_and_load_i3_alerts(
    provider_id: str,
    *,
    settings: Settings,
    registry: ProviderRegistry,
    engine: Engine,
) -> RealtimeEndpointCycleResult:
    return _capture_and_load_alert_endpoint(
        provider_id,
        endpoint_key=I3_ALERT_ENDPOINT,
        capture_fn=capture_i3_alerts,
        capture_label_prefix="capture-i3",
        silver_label_prefix="load-i3-silver",
        settings=settings,
        registry=registry,
        engine=engine,
    )


def _capture_and_load_service_alerts(
    provider_id: str,
    *,
    settings: Settings,
    registry: ProviderRegistry,
    engine: Engine,
) -> RealtimeEndpointCycleResult:
    return _capture_and_load_alert_endpoint(
        provider_id,
        endpoint_key=SERVICE_ALERTS_ENDPOINT,
        capture_fn=capture_service_alerts,
        capture_label_prefix="capture-service-alerts",
        silver_label_prefix="load-service-alerts-silver",
        settings=settings,
        registry=registry,
        engine=engine,
    )


def _capture_and_load_realtime_source(
    provider_id: str,
    endpoint_key: str,
    *,
    settings: Settings,
    registry: ProviderRegistry,
    engine: Engine,
) -> RealtimeEndpointCycleResult:
    if endpoint_key == I3_ALERT_ENDPOINT:
        return _capture_and_load_i3_alerts(
            provider_id,
            settings=settings,
            registry=registry,
            engine=engine,
        )
    if endpoint_key == SERVICE_ALERTS_ENDPOINT:
        return _capture_and_load_service_alerts(
            provider_id,
            settings=settings,
            registry=registry,
            engine=engine,
        )
    return _capture_and_load_endpoint(
        provider_id,
        endpoint_key,
        settings=settings,
        registry=registry,
        engine=engine,
    )


def _best_effort_publish_live(
    provider_id: str,
    *,
    settings: Settings,
    engine: Engine,
    registry: ProviderRegistry | None = None,
) -> int:
    """Publish the live /v1 snapshot as a best-effort side effect of the cycle.

    Returns the number of publish failures (0 or 1). Never raises: an R2/publish
    error is logged and counted so the realtime cycle stays green even when the
    public snapshot bucket is unavailable.
    """
    # Skip when no snapshot target is configured.
    if not (
        getattr(settings, "SNAPSHOT_R2_BUCKET", None)
        or getattr(settings, "SNAPSHOT_STORAGE_BACKEND", None) == "local"
    ):
        return 0
    try:
        publish_snapshot(
            provider_id,
            tier="live",
            settings=settings,
            registry=registry,
            engine=engine,
        )
        return 0
    except Exception:  # noqa: BLE001 — best-effort: never fail the cycle on publish
        logger.exception("live snapshot publish failed (cycle continues)")
        return 1


def run_realtime_cycle(
    provider_id: str,
    *,
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    engine: Engine | None = None,
    last_captures: dict[str, datetime] | None = None,
) -> RealtimeCycleResult:
    """Run one realtime cycle for a provider.

    When ``last_captures`` is provided, each endpoint is gated by the manifest's
    ``refresh_interval_seconds`` — endpoints whose last successful capture was
    within ``refresh_interval_seconds`` are skipped (returning a ``"skipped"``
    status). The dict is mutated in place so the caller (typically
    :func:`run_realtime_worker_loop`) can preserve state across cycles.

    When ``last_captures`` is ``None`` (CLI single-cycle calls, tests), no
    gating happens — every endpoint the provider's manifest publishes runs
    unconditionally.
    """
    settings = settings or get_settings()
    registry = registry or _provider_registry(settings)
    engine = _engine(settings, engine)
    started_at_utc = utc_now()
    started_at = time.perf_counter()

    # Drive the endpoint set from the provider's manifest for BOTH single-shot
    # and worker-loop calls, so a provider's actual feeds are polled: its generic
    # GTFS-RT service-alerts feed is captured, and an absent feed (no i3 alerts,
    # no live vehicle feed) is never polled. Refresh-interval gating only applies
    # when last_captures is supplied (the worker loop); single-shot (last_captures
    # is None) runs every present endpoint unconditionally.
    manifest = registry.get_provider(provider_id)
    cycle_endpoints = realtime_endpoints_for_manifest(manifest)
    refresh_intervals: dict[str, int] = {
        endpoint_key: int(manifest.feeds[endpoint_key].refresh_interval_seconds)
        for endpoint_key in cycle_endpoints
        if manifest.feeds.get(endpoint_key) is not None
    }

    logger.info("Starting realtime cycle for provider '%s'.", provider_id)
    endpoint_results: list[RealtimeEndpointCycleResult] = []
    for endpoint_key in cycle_endpoints:
        interval_seconds = refresh_intervals.get(endpoint_key)
        last_capture_at = (
            last_captures.get(endpoint_key) if last_captures is not None else None
        )
        if (
            interval_seconds is not None
            and last_capture_at is not None
        ):
            elapsed_seconds = (started_at_utc - last_capture_at).total_seconds()
            if elapsed_seconds < interval_seconds:
                logger.info(
                    (
                        "Skipping realtime cycle endpoint '%s' for provider '%s' "
                        "(refresh_interval=%ds, last capture %.1fs ago)."
                    ),
                    endpoint_key,
                    provider_id,
                    interval_seconds,
                    elapsed_seconds,
                )
                endpoint_results.append(
                    RealtimeEndpointCycleResult(
                        endpoint_key=endpoint_key,
                        status="skipped",
                        capture_duration_seconds=0.0,
                        silver_load_duration_seconds=None,
                        total_endpoint_duration_seconds=0.0,
                        capture_result={
                            "reason": "interval_not_elapsed",
                            "refresh_interval_seconds": interval_seconds,
                            "elapsed_seconds": round(elapsed_seconds, 1),
                        },
                        silver_load_result=None,
                        error_message=None,
                    )
                )
                continue

        endpoint_result = _capture_and_load_realtime_source(
            provider_id,
            endpoint_key,
            settings=settings,
            registry=registry,
            engine=engine,
        )
        endpoint_results.append(endpoint_result)
        if (
            last_captures is not None
            and endpoint_result.status == "succeeded"
        ):
            last_captures[endpoint_key] = started_at_utc
    step_timings_seconds = {
        f"capture_{endpoint_result.endpoint_key}": endpoint_result.capture_duration_seconds
        for endpoint_result in endpoint_results
    } | {
        f"load_{endpoint_result.endpoint_key}_to_silver": (
            endpoint_result.silver_load_duration_seconds
        )
        for endpoint_result in endpoint_results
    }

    failed_endpoint_count = sum(
        1
        for endpoint_result in endpoint_results
        if endpoint_result.status not in {"succeeded", "skipped"}
    )
    successful_endpoint_count = sum(
        1 for endpoint_result in endpoint_results if endpoint_result.status == "succeeded"
    )

    gold_build_result: GoldBuildResult | GoldRealtimeRefreshResult | None = None
    gold_build_duration_seconds: float | None = None
    gold_error_message: str | None = None
    silver_maintenance_result: SilverStoragePruneResult | None = None
    silver_maintenance_duration_seconds: float | None = None
    silver_maintenance_error_message: str | None = None
    gold_maintenance_result: GoldStoragePruneResult | None = None
    gold_maintenance_duration_seconds: float | None = None
    gold_maintenance_error_message: str | None = None
    if successful_endpoint_count:
        logger.info("Running refresh-gold-realtime after realtime cycle for '%s'.", provider_id)
        try:
            gold_build_result, gold_build_duration_seconds = _run_timed_realtime_step(
                "refresh-gold-realtime",
                lambda: refresh_gold_realtime(
                    provider_id,
                    settings=settings,
                    registry=registry,
                    engine=engine,
                ),
            )
        except Exception as exc:
            logger.error(
                "Realtime cycle Gold refresh failed for provider '%s': %s",
                provider_id,
                exc,
            )
            gold_error_message = str(exc)

    # Retention pruning is BEST-EFFORT and runs on EVERY cycle, independent of
    # endpoint success and of the gold-refresh outcome above. It previously ran
    # only inside the gold-refresh success branch (gated on
    # successful_endpoint_count AND a clean refresh), so a persistent gold-build
    # outage (the 0034-backfill stall class) or a busy/failing cycle skipped
    # retention every cycle — the silver/gold backlog never drained from the
    # worker, compounding the very stall. Each prune is bounded per cycle (ctid
    # LIMIT batching) so draining a backlog never hangs a cycle.
    logger.info("Running prune-silver-storage after realtime cycle for '%s'.", provider_id)
    try:
        silver_maintenance_result, silver_maintenance_duration_seconds = (
            _run_timed_realtime_step(
                "prune-silver-storage",
                lambda: prune_silver_storage(
                    provider_id,
                    settings=settings,
                    engine=engine,
                ),
            )
        )
    except Exception as exc:
        logger.error(
            "Realtime cycle Silver maintenance failed for provider '%s': %s",
            provider_id,
            exc,
        )
        silver_maintenance_error_message = str(exc)

    logger.info("Running prune-gold-storage after realtime cycle for '%s'.", provider_id)
    try:
        gold_maintenance_result, gold_maintenance_duration_seconds = (
            _run_timed_realtime_step(
                "prune-gold-storage",
                lambda: prune_gold_storage(
                    provider_id,
                    settings=settings,
                    engine=engine,
                ),
            )
        )
    except Exception as exc:
        logger.error(
            "Realtime cycle Gold maintenance failed for provider '%s': %s",
            provider_id,
            exc,
        )
        gold_maintenance_error_message = str(exc)
    step_timings_seconds["refresh_gold_realtime"] = gold_build_duration_seconds
    step_timings_seconds["prune_silver_storage"] = silver_maintenance_duration_seconds
    step_timings_seconds["prune_gold_storage"] = gold_maintenance_duration_seconds

    # Best-effort: publish the live /v1 snapshot after Gold refresh succeeds.
    # Never fails the cycle — an R2/publish error is logged and counted only.
    live_publish_failures = 0
    if successful_endpoint_count and gold_error_message is None:
        live_publish_failures = _best_effort_publish_live(
            provider_id,
            settings=settings,
            engine=engine,
            registry=registry,
        )

    completed_at_utc = utc_now()
    total_duration_seconds = round(time.perf_counter() - started_at, 3)
    if (
        gold_error_message
        or silver_maintenance_error_message
        or gold_maintenance_error_message
    ):
        status = "failed"
    elif failed_endpoint_count == 0:
        status = "succeeded"
    elif successful_endpoint_count > 0:
        status = "partial_failure"
    else:
        status = "failed"

    return RealtimeCycleResult(
        provider_id=provider_id,
        status=status,
        started_at_utc=started_at_utc,
        completed_at_utc=completed_at_utc,
        total_duration_seconds=total_duration_seconds,
        successful_endpoint_count=successful_endpoint_count,
        failed_endpoint_count=failed_endpoint_count,
        endpoint_results=endpoint_results,
        step_timings_seconds=step_timings_seconds,
        gold_build=gold_build_result.display_dict() if gold_build_result else None,
        gold_build_duration_seconds=gold_build_duration_seconds,
        gold_error_message=gold_error_message,
        silver_maintenance=(
            silver_maintenance_result.display_dict() if silver_maintenance_result else None
        ),
        silver_maintenance_duration_seconds=silver_maintenance_duration_seconds,
        silver_maintenance_error_message=silver_maintenance_error_message,
        gold_maintenance=(
            gold_maintenance_result.display_dict() if gold_maintenance_result else None
        ),
        gold_maintenance_duration_seconds=gold_maintenance_duration_seconds,
        gold_maintenance_error_message=gold_maintenance_error_message,
        live_publish_failures=live_publish_failures,
    )


def _validate_realtime_worker_startup(
    provider_id: str,
    *,
    settings: Settings,
    registry: ProviderRegistry,
) -> ProviderManifest:
    require_database_url(settings)
    if settings.REALTIME_POLL_SECONDS <= 0:
        raise ValueError("REALTIME_POLL_SECONDS must be greater than 0.")
    if settings.REALTIME_STARTUP_DELAY_SECONDS < 0:
        raise ValueError("REALTIME_STARTUP_DELAY_SECONDS must be 0 or greater.")

    manifest = registry.get_provider(provider_id)
    for endpoint_key in GTFS_REALTIME_ENDPOINTS:
        build_realtime_ingestion_config(manifest, settings, endpoint_key)
    # Alert feeds are optional and provider-specific: STM uses i3, others use
    # the generic GTFS-RT service-alerts feed. Validate whichever is configured.
    if I3_ALERT_ENDPOINT in manifest.feeds:
        build_i3_ingestion_config(manifest, settings)
    if SERVICE_ALERTS_ENDPOINT in manifest.feeds:
        build_service_alerts_ingestion_config(manifest, settings)
    return manifest


def _install_worker_shutdown_handlers() -> Callable[[], bool]:
    """Install SIGTERM/SIGINT handlers that flip a shutdown flag.

    Returns a predicate the worker loop polls at the top of each iteration so a
    deploy's SIGTERM (or an operator's Ctrl-C) lets the worker drain the current
    cycle and return cleanly instead of being SIGKILLed mid-capture.

    Signal registration only works on the main thread; off the main thread (e.g.
    inside a test runner) ``signal.signal`` raises ``ValueError``. In that case we
    skip registration and return an always-false predicate so the loop is governed
    solely by ``max_cycles`` / an injected ``should_shutdown``.
    """
    shutdown_requested = threading.Event()

    def _request_shutdown(signum: int, _frame: object) -> None:
        logger.info(
            "Received signal %s — requesting clean realtime worker shutdown after "
            "the current cycle drains.",
            signum,
        )
        shutdown_requested.set()

    if threading.current_thread() is not threading.main_thread():
        return shutdown_requested.is_set

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, _request_shutdown)
        except (ValueError, OSError):
            # Not on the main thread, or the platform disallows this signal —
            # fall back to a flag that only an injected predicate can flip.
            logger.debug("Could not register handler for signal %s; skipping.", sig)

    return shutdown_requested.is_set


def run_realtime_worker_loop(
    provider_id: str,
    *,
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    engine: Engine | None = None,
    sleep_fn: Callable[[float], None] = time.sleep,
    max_cycles: int | None = None,
    perf_counter_fn: Callable[[], float] = time.perf_counter,
    utc_now_fn: Callable[[], datetime] = utc_now,
    should_shutdown: Callable[[], bool] | None = None,
) -> None:
    settings = settings or get_settings()
    registry = registry or _provider_registry(settings)
    engine = _engine(settings, engine)
    if max_cycles is not None and max_cycles <= 0:
        raise ValueError("max_cycles must be greater than 0 when provided.")

    # When the caller does not inject a shutdown predicate (production path),
    # install SIGTERM/SIGINT handlers that flip a flag so a deploy's SIGTERM
    # lets the worker drain the current cycle and return cleanly (exit 0)
    # instead of being SIGKILLed mid-capture. Tests inject ``should_shutdown``
    # directly and skip signal registration entirely.
    if should_shutdown is None:
        should_shutdown = _install_worker_shutdown_handlers()

    manifest = _validate_realtime_worker_startup(
        provider_id,
        settings=settings,
        registry=registry,
    )
    poll_seconds = settings.REALTIME_POLL_SECONDS
    startup_delay_seconds = settings.REALTIME_STARTUP_DELAY_SECONDS

    logger.info(
        (
            "Starting realtime worker for provider '%s' (%s) with target start-to-start "
            "poll interval %s seconds."
        ),
        manifest.provider.provider_id,
        manifest.provider.display_name,
        poll_seconds,
    )
    if startup_delay_seconds:
        logger.info(
            "Applying realtime worker startup delay of %s seconds for provider '%s'.",
            startup_delay_seconds,
            provider_id,
        )
        sleep_fn(startup_delay_seconds)

    cycle_number = 0
    previous_cycle_start_utc: datetime | None = None
    last_captures: dict[str, datetime] = {}
    while max_cycles is None or cycle_number < max_cycles:
        if should_shutdown():
            logger.info(
                "Shutdown requested — realtime worker loop is stopping cleanly for "
                "provider '%s' after %s completed cycle(s).",
                provider_id,
                cycle_number,
            )
            break
        if settings.PIPELINE_PAUSED:
            logger.warning(
                "PIPELINE_PAUSED=true — realtime worker is paused for provider '%s'. "
                "Sleeping %s seconds. Set PIPELINE_PAUSED=false to resume.",
                provider_id,
                poll_seconds,
            )
            sleep_fn(poll_seconds)
            continue
        cycle_number += 1
        cycle_start_utc = utc_now_fn()
        cycle_started_at = perf_counter_fn()
        logger.info(
            "Starting realtime worker cycle %s for provider '%s'.",
            cycle_number,
            provider_id,
        )
        try:
            cycle_result = run_realtime_cycle(
                provider_id,
                settings=settings,
                registry=registry,
                engine=engine,
                last_captures=last_captures,
            )
        except Exception as exc:  # noqa: BLE001 — one bad cycle must not kill the loop
            cycle_duration_seconds = round(perf_counter_fn() - cycle_started_at, 3)
            logger.exception(
                "Realtime worker cycle %s for provider '%s' raised an unexpected "
                "exception and will be skipped; the worker loop continues: %s",
                cycle_number,
                provider_id,
                exc,
            )
            previous_cycle_start_utc = cycle_start_utc
            if max_cycles is not None and cycle_number >= max_cycles:
                break
            # Preserve start-to-start cadence: back off by the remaining poll
            # budget after the (partial) failed cycle before retrying.
            computed_sleep_seconds = round(
                max(0.0, poll_seconds - cycle_duration_seconds), 3
            )
            logger.info(
                (
                    "Sleeping %.3f seconds before realtime worker cycle %s for provider "
                    "'%s' after a failed cycle to target a %.3f second start-to-start "
                    "cadence."
                ),
                computed_sleep_seconds,
                cycle_number + 1,
                provider_id,
                float(poll_seconds),
            )
            if computed_sleep_seconds:
                sleep_fn(computed_sleep_seconds)
            continue
        cycle_end_utc = utc_now_fn()
        cycle_duration_seconds = round(perf_counter_fn() - cycle_started_at, 3)
        computed_sleep_seconds = round(max(0.0, poll_seconds - cycle_duration_seconds), 3)
        effective_start_to_start_seconds = None
        if previous_cycle_start_utc is not None:
            effective_start_to_start_seconds = round(
                (cycle_start_utc - previous_cycle_start_utc).total_seconds(),
                3,
            )

        telemetry = RealtimeWorkerCycleTelemetry(
            cycle_number=cycle_number,
            cycle_start_utc=cycle_start_utc,
            cycle_end_utc=cycle_end_utc,
            cycle_duration_seconds=cycle_duration_seconds,
            requested_poll_seconds=float(poll_seconds),
            computed_sleep_seconds=computed_sleep_seconds,
            effective_start_to_start_seconds=effective_start_to_start_seconds,
            status=cycle_result.status,
        )
        log_payload = json.dumps(cycle_result.display_dict(), sort_keys=True)
        if cycle_result.has_failures:
            logger.error(
                "Realtime worker cycle %s completed with status %s: %s",
                cycle_number,
                cycle_result.status,
                log_payload,
            )
        else:
            logger.info(
                "Realtime worker cycle %s completed successfully: %s",
                cycle_number,
                log_payload,
            )
        logger.info(
            "Realtime worker cycle %s timing: %s",
            cycle_number,
            json.dumps(telemetry.display_dict(), sort_keys=True),
        )
        if cycle_duration_seconds > poll_seconds:
            logger.warning(
                (
                    "Realtime worker cycle %s exceeded the requested poll interval: %s"
                ),
                cycle_number,
                json.dumps(
                    {
                        **telemetry.display_dict(),
                        "overrun_seconds": round(cycle_duration_seconds - poll_seconds, 3),
                    },
                    sort_keys=True,
                ),
            )
        previous_cycle_start_utc = cycle_start_utc

        if max_cycles is not None and cycle_number >= max_cycles:
            break

        logger.info(
            (
                "Sleeping %.3f seconds before realtime worker cycle %s for provider '%s' "
                "to target a %.3f second start-to-start cadence."
            ),
            computed_sleep_seconds,
            cycle_number + 1,
            provider_id,
            float(poll_seconds),
        )
        if computed_sleep_seconds:
            sleep_fn(computed_sleep_seconds)
