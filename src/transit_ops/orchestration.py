from __future__ import annotations

import json
import logging
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
    build_gold_marts,
    refresh_gold_realtime,
)
from transit_ops.ingestion import (
    build_realtime_ingestion_config,
    capture_realtime_feed,
    ingest_static_feed,
)
from transit_ops.ingestion.common import utc_now
from transit_ops.maintenance import (
    GoldStoragePruneResult,
    SilverStoragePruneResult,
    prune_gold_storage,
    prune_silver_storage,
)
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings, get_settings
from transit_ops.silver import (
    load_latest_realtime_to_silver,
    load_latest_static_to_silver,
)

REALTIME_ENDPOINTS = ("trip_updates", "vehicle_positions")

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class StaticPipelineResult:
    provider_id: str
    status: str
    started_at_utc: datetime
    completed_at_utc: datetime
    total_duration_seconds: float
    static_ingestion_duration_seconds: float
    silver_load_duration_seconds: float
    gold_build_duration_seconds: float
    static_ingestion: dict[str, object]
    silver_load: dict[str, object]
    gold_build: dict[str, object]

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
    static_ingestion, static_ingestion_duration_seconds = _run_timed_static_step(
        "ingest-static",
        lambda: ingest_static_feed(
            provider_id,
            settings=settings,
            registry=registry,
            engine=engine,
        ),
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
        "build-gold-marts",
        lambda: build_gold_marts(
            provider_id,
            settings=settings,
            registry=registry,
            engine=engine,
        ),
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
            error_message=f"load-realtime-silver failed: {exc}",
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


def run_realtime_cycle(
    provider_id: str,
    *,
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    engine: Engine | None = None,
) -> RealtimeCycleResult:
    settings = settings or get_settings()
    registry = registry or _provider_registry(settings)
    engine = _engine(settings, engine)
    started_at_utc = utc_now()
    started_at = time.perf_counter()

    logger.info("Starting realtime cycle for provider '%s'.", provider_id)
    endpoint_results = [
        _capture_and_load_endpoint(
            provider_id,
            endpoint_key,
            settings=settings,
            registry=registry,
            engine=engine,
        )
        for endpoint_key in REALTIME_ENDPOINTS
    ]
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
        1 for endpoint_result in endpoint_results if endpoint_result.status != "succeeded"
    )
    successful_endpoint_count = len(endpoint_results) - failed_endpoint_count

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
        else:
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
    for endpoint_key in REALTIME_ENDPOINTS:
        build_realtime_ingestion_config(manifest, settings, endpoint_key)
    return manifest


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
) -> None:
    settings = settings or get_settings()
    registry = registry or _provider_registry(settings)
    engine = _engine(settings, engine)
    if max_cycles is not None and max_cycles <= 0:
        raise ValueError("max_cycles must be greater than 0 when provided.")

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
    while max_cycles is None or cycle_number < max_cycles:
        cycle_number += 1
        cycle_start_utc = utc_now_fn()
        cycle_started_at = perf_counter_fn()
        logger.info(
            "Starting realtime worker cycle %s for provider '%s'.",
            cycle_number,
            provider_id,
        )
        cycle_result = run_realtime_cycle(
            provider_id,
            settings=settings,
            registry=registry,
            engine=engine,
        )
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
