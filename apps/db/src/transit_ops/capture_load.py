from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from sqlalchemy.engine import Engine

from transit_ops.ingestion.common import redact_error_message, utc_now
from transit_ops.ingestion.realtime_gtfs import RealtimeIngestionResult, _capture_realtime_feed
from transit_ops.ingestion.storage import BronzeStorageResolver
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings
from transit_ops.silver.realtime_gtfs import RealtimeSilverLoadResult, _load_realtime_to_silver

logger = logging.getLogger(__name__)


class _DisplayResult(Protocol):
    def display_dict(self) -> dict[str, object]: ...


@dataclass(frozen=True)
class CaptureLoadFailure:
    stage: Literal["capture", "silver"]
    kind: Literal["operation", "capture_identity", "silver_identity"]
    error: Exception
    started_at_utc: datetime


@dataclass(frozen=True)
class CaptureLoadResult[Captured: _DisplayResult, Loaded: _DisplayResult]:
    capture: Captured | None
    silver: Loaded | None
    capture_duration_seconds: float | None
    silver_load_duration_seconds: float | None
    total_endpoint_duration_seconds: float
    failure: CaptureLoadFailure | None


type RealtimeCaptureLoadResult = CaptureLoadResult[
    RealtimeIngestionResult, RealtimeSilverLoadResult
]


class _ReceiptIdentityError(ValueError):
    def __init__(self, message: str, kind: Literal["capture_identity", "silver_identity"]) -> None:
        super().__init__(message)
        self.kind = kind


def _log_step_success(step_name: str, payload: dict[str, object]) -> None:
    logger.info(
        "%s succeeded: %s", step_name, redact_error_message(json.dumps(payload, sort_keys=True))
    )


def _run_timed_realtime_step[Result: _DisplayResult](
    step_name: str, step_fn: Callable[[], Result]
) -> tuple[Result, float]:
    step_started_at_utc = utc_now()
    step_started_at = time.perf_counter()
    logger.info("Starting realtime cycle step '%s'.", step_name)
    try:
        result = step_fn()
    except Exception as exc:
        duration_seconds = round(time.perf_counter() - step_started_at, 3)
        logger.error(
            "Realtime cycle step '%s' failed after %.3f seconds: %s",
            step_name,
            duration_seconds,
            redact_error_message(str(exc)),
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


def _run_capture_load_steps[Captured: _DisplayResult, Loaded: _DisplayResult](
    provider_id: str,
    endpoint_key: str,
    *,
    capture_step: Callable[[], Captured],
    silver_load_step: Callable[[Captured], Loaded],
    capture_label_prefix: str,
    silver_label_prefix: str,
) -> CaptureLoadResult[Captured, Loaded]:
    endpoint_started_at = time.perf_counter()
    capture_duration_seconds: float | None = None
    silver_load_duration_seconds: float | None = None
    capture_result: Captured | None = None
    silver_result: Loaded | None = None
    failure: CaptureLoadFailure | None = None

    logger.info(
        "Running capture step for provider '%s', endpoint '%s'.",
        provider_id,
        endpoint_key,
    )
    capture_started_at = time.perf_counter()
    capture_started_at_utc = utc_now()
    try:
        capture_result, capture_duration_seconds = _run_timed_realtime_step(
            f"{capture_label_prefix}[{endpoint_key}]",
            capture_step,
        )
    except Exception as exc:
        capture_duration_seconds = round(time.perf_counter() - capture_started_at, 3)
        logger.error(
            "Realtime cycle capture failed for provider '%s', endpoint '%s': %s",
            provider_id,
            endpoint_key,
            redact_error_message(str(exc)),
        )
        failure = CaptureLoadFailure("capture", "operation", exc, capture_started_at_utc)

    if capture_result is not None:
        logger.info(
            "Running Silver load step for provider '%s', endpoint '%s'.",
            provider_id,
            endpoint_key,
        )
        silver_load_started_at = time.perf_counter()
        silver_load_started_at_utc = utc_now()
        try:
            silver_result, silver_load_duration_seconds = _run_timed_realtime_step(
                f"{silver_label_prefix}[{endpoint_key}]",
                lambda: silver_load_step(capture_result),
            )
        except Exception as exc:
            silver_load_duration_seconds = round(time.perf_counter() - silver_load_started_at, 3)
            logger.error(
                "Realtime cycle Silver load failed for provider '%s', endpoint '%s': %s",
                provider_id,
                endpoint_key,
                redact_error_message(str(exc)),
            )
            failure = CaptureLoadFailure(
                "silver",
                exc.kind if isinstance(exc, _ReceiptIdentityError) else "operation",
                exc,
                silver_load_started_at_utc,
            )

    return CaptureLoadResult(
        capture=capture_result,
        silver=silver_result,
        capture_duration_seconds=capture_duration_seconds,
        silver_load_duration_seconds=silver_load_duration_seconds,
        total_endpoint_duration_seconds=round(time.perf_counter() - endpoint_started_at, 3),
        failure=failure,
    )


@dataclass(frozen=True)
class _CapturedRealtime:
    receipt: RealtimeIngestionResult
    payload: bytes

    def display_dict(self) -> dict[str, object]:
        return self.receipt.display_dict()


def capture_and_load_realtime(
    provider_id: str,
    endpoint_key: str,
    *,
    settings: Settings,
    registry: ProviderRegistry,
    engine: Engine,
    bronze_storage_resolver: BronzeStorageResolver,
) -> RealtimeCaptureLoadResult:
    def capture() -> _CapturedRealtime:
        receipt, payload = _capture_realtime_feed(
            provider_id,
            endpoint_key,
            settings=settings,
            registry=registry,
            engine=engine,
            bronze_storage_resolver=bronze_storage_resolver,
        )
        return _CapturedRealtime(receipt, payload)

    def load(captured: _CapturedRealtime) -> RealtimeSilverLoadResult:
        receipt = captured.receipt
        if (receipt.provider_id, receipt.endpoint_key) != (provider_id, endpoint_key):
            raise _ReceiptIdentityError(
                "Realtime capture receipt does not match the requested source",
                "capture_identity",
            )
        silver = _load_realtime_to_silver(
            provider_id,
            endpoint_key,
            snapshot_id=receipt.realtime_snapshot_id,
            captured_payload=captured.payload,
            settings=settings,
            registry=registry,
            engine=engine,
            bronze_storage_resolver=bronze_storage_resolver,
        )
        if not isinstance(silver, RealtimeSilverLoadResult) or (
            silver.provider_id,
            silver.endpoint_key,
            silver.realtime_snapshot_id,
        ) != (provider_id, endpoint_key, receipt.realtime_snapshot_id):
            raise _ReceiptIdentityError(
                "Realtime Silver receipt does not match the captured snapshot",
                "silver_identity",
            )
        return silver

    result = _run_capture_load_steps(
        provider_id,
        endpoint_key,
        capture_step=capture,
        silver_load_step=load,
        capture_label_prefix="capture-realtime",
        silver_label_prefix="load-realtime-silver",
    )
    return CaptureLoadResult(
        capture=result.capture.receipt if result.capture is not None else None,
        silver=result.silver,
        capture_duration_seconds=result.capture_duration_seconds,
        silver_load_duration_seconds=result.silver_load_duration_seconds,
        total_endpoint_duration_seconds=result.total_endpoint_duration_seconds,
        failure=result.failure,
    )
