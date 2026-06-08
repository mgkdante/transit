from __future__ import annotations

import os
import platform
import shutil
import time
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import create_engine, text

from transit_ops.core.models import AuthType
from transit_ops.db.connection import make_engine
from transit_ops.health.models import ComponentHealthResult
from transit_ops.ingestion.storage import (
    LocalBronzeStorage,
    S3BronzeStorage,
    get_bronze_storage,
)
from transit_ops.providers.registry import ProviderRegistry
from transit_ops.settings import Settings, get_settings

REQUIRED_REALTIME_ENDPOINTS = ("trip_updates", "vehicle_positions", "i3_alerts")
FEED_RESULT_NAMES = {
    "static_schedule": "stm_static_feed",
    "trip_updates": "stm_trip_updates_feed",
    "vehicle_positions": "stm_vehicle_positions_feed",
}

EngineFactory = Callable[[Settings], Any]
Requester = Callable[..., Any]
StorageFactory = Callable[..., Any]
RuntimeStatsProvider = Callable[[], Mapping[str, object]]
_RUNTIME_HEALTH_CACHE: tuple[datetime, ComponentHealthResult] | None = None


def check_database_connectivity(
    settings: Settings | None = None,
    *,
    engine_factory: EngineFactory | None = None,
    now: datetime | None = None,
) -> ComponentHealthResult:
    resolved_settings = settings or get_settings()
    checked_at = _checked_at(now)
    started = time.perf_counter()

    if not resolved_settings.DATABASE_URL:
        return ComponentHealthResult(
            name="database",
            status="down",
            message="DATABASE_URL is not configured.",
            latency_ms=_latency_ms(started),
            checked_at_utc=checked_at,
        )

    try:
        engine = (engine_factory or _make_health_engine)(resolved_settings)
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        return ComponentHealthResult(
            name="database",
            status="down",
            message=f"Database connectivity check failed: {_safe_error(exc)}",
            latency_ms=_latency_ms(started),
            checked_at_utc=checked_at,
        )

    return ComponentHealthResult(
        name="database",
        status="ok",
        message="Database connectivity check passed.",
        latency_ms=_latency_ms(started),
        checked_at_utc=checked_at,
    )


def check_pipeline_freshness(
    settings: Settings | None = None,
    *,
    engine_factory: EngineFactory | None = None,
    now: datetime | None = None,
) -> ComponentHealthResult:
    resolved_settings = settings or get_settings()
    checked_at = _checked_at(now)
    started = time.perf_counter()
    threshold_seconds = int(resolved_settings.HEALTH_MAX_PIPELINE_AGE_SECONDS)

    if not resolved_settings.DATABASE_URL:
        return ComponentHealthResult(
            name="pipeline_freshness",
            status="down",
            message="DATABASE_URL is not configured.",
            latency_ms=_latency_ms(started),
            checked_at_utc=checked_at,
            details=_freshness_details({}, checked_at, threshold_seconds),
        )

    try:
        engine = (engine_factory or _make_health_engine)(resolved_settings)
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    """
                    WITH gtfs_rt AS (
                        SELECT
                            fe.endpoint_key,
                            max(rsi.captured_at_utc) AS latest_captured_at_utc
                        FROM core.feed_endpoints AS fe
                        LEFT JOIN raw.realtime_snapshot_index AS rsi
                            ON rsi.provider_id = fe.provider_id
                            AND rsi.feed_endpoint_id = fe.feed_endpoint_id
                        WHERE fe.provider_id = :provider_id
                            AND fe.endpoint_key IN ('trip_updates', 'vehicle_positions')
                        GROUP BY fe.endpoint_key
                    ),
                    i3 AS (
                        SELECT
                            fe.endpoint_key,
                            max(snapshots.captured_at_utc) AS latest_captured_at_utc
                        FROM core.feed_endpoints AS fe
                        LEFT JOIN raw.i3_alert_snapshots AS snapshots
                            ON snapshots.provider_id = fe.provider_id
                            AND snapshots.feed_endpoint_id = fe.feed_endpoint_id
                        WHERE fe.provider_id = :provider_id
                            AND fe.endpoint_key = 'i3_alerts'
                        GROUP BY fe.endpoint_key
                    )
                    SELECT endpoint_key, latest_captured_at_utc
                    FROM gtfs_rt
                    UNION ALL
                    SELECT endpoint_key, latest_captured_at_utc
                    FROM i3
                    """
                ),
                {"provider_id": resolved_settings.STM_PROVIDER_ID},
            )
    except Exception as exc:  # noqa: BLE001
        return ComponentHealthResult(
            name="pipeline_freshness",
            status="down",
            message=f"Pipeline freshness query failed: {_safe_error(exc)}",
            latency_ms=_latency_ms(started),
            checked_at_utc=checked_at,
            details=_freshness_details({}, checked_at, threshold_seconds),
        )

    latest_by_endpoint = _latest_timestamps_by_endpoint(rows)
    details = _freshness_details(latest_by_endpoint, checked_at, threshold_seconds)
    missing = [
        endpoint
        for endpoint in REQUIRED_REALTIME_ENDPOINTS
        if latest_by_endpoint.get(endpoint) is None
    ]
    stale = [
        endpoint
        for endpoint in REQUIRED_REALTIME_ENDPOINTS
        if (
            latest_by_endpoint.get(endpoint) is not None
            and _age_seconds(checked_at, latest_by_endpoint[endpoint]) > threshold_seconds
        )
    ]

    if missing:
        return ComponentHealthResult(
            name="pipeline_freshness",
            status="degraded",
            message=f"Missing realtime freshness data for: {', '.join(missing)}.",
            latency_ms=_latency_ms(started),
            checked_at_utc=checked_at,
            details=details,
        )
    if stale:
        return ComponentHealthResult(
            name="pipeline_freshness",
            status="degraded",
            message=f"Realtime pipeline data is stale for: {', '.join(stale)}.",
            latency_ms=_latency_ms(started),
            checked_at_utc=checked_at,
            details=details,
        )

    return ComponentHealthResult(
        name="pipeline_freshness",
        status="ok",
        message="Realtime pipeline data is fresh.",
        latency_ms=_latency_ms(started),
        checked_at_utc=checked_at,
        details=details,
    )


def check_bronze_storage(
    settings: Settings | None = None,
    *,
    project_root: Path | None = None,
    storage_factory: StorageFactory = get_bronze_storage,
    now: datetime | None = None,
) -> ComponentHealthResult:
    resolved_settings = settings or get_settings()
    checked_at = _checked_at(now)
    started = time.perf_counter()
    root = project_root or Path(__file__).resolve().parents[3]

    try:
        storage = storage_factory(resolved_settings, project_root=root)
        backend = getattr(storage, "storage_backend", resolved_settings.BRONZE_STORAGE_BACKEND)
        details = {
            "backend": backend,
            "location": _bronze_location(storage),
        }

        if isinstance(storage, LocalBronzeStorage) or backend == "local":
            local_root = Path(storage.root)
            if not local_root.exists():
                raise RuntimeError(f"Bronze local root does not exist: {local_root}")
            if not local_root.is_dir():
                raise RuntimeError(f"Bronze local root is not a directory: {local_root}")
            next(local_root.iterdir(), None)
            details["location"] = str(local_root)
        elif isinstance(storage, S3BronzeStorage) or backend == "s3":
            client = getattr(storage, "client", None)
            bucket = getattr(storage, "bucket", None)
            if client is None or bucket is None:
                raise RuntimeError("S3 Bronze storage client or bucket is not available.")
            client.list_objects_v2(Bucket=bucket, MaxKeys=1)
            storage.exists("healthcheck/sentinel")
        else:
            raise RuntimeError(f"Unsupported Bronze storage backend: {backend}")
    except Exception as exc:  # noqa: BLE001
        return ComponentHealthResult(
            name="bronze_storage",
            status="down",
            message=f"Bronze storage check failed: {_safe_error(exc)}",
            latency_ms=_latency_ms(started),
            checked_at_utc=checked_at,
            details=locals().get(
                "details",
                {
                    "backend": resolved_settings.BRONZE_STORAGE_BACKEND,
                    "location": _configured_bronze_location(resolved_settings, root),
                },
            ),
        )

    return ComponentHealthResult(
        name="bronze_storage",
        status="ok",
        message="Bronze storage check passed.",
        latency_ms=_latency_ms(started),
        checked_at_utc=checked_at,
        details=details,
    )


def check_stm_feed(
    endpoint_key: str,
    settings: Settings | None = None,
    *,
    registry: ProviderRegistry | None = None,
    requester: Requester | None = None,
    now: datetime | None = None,
    project_root: Path | None = None,
) -> ComponentHealthResult:
    resolved_settings = settings or get_settings()
    checked_at = _checked_at(now)
    started = time.perf_counter()
    result_name = FEED_RESULT_NAMES[endpoint_key]
    resolved_registry = registry or ProviderRegistry.from_project_root(
        project_root=project_root,
        settings=resolved_settings,
    )

    try:
        manifest = resolved_registry.get_provider(resolved_settings.STM_PROVIDER_ID)
        feed = (
            manifest.static_feed()
            if endpoint_key == "static_schedule"
            else manifest.realtime_feed(endpoint_key)
        )
        url = feed.resolved_source_url(resolved_settings)
        if not url:
            raise RuntimeError(f"No URL configured for STM feed '{endpoint_key}'.")

        headers, params = _feed_auth_parts(feed.auth, resolved_settings)
        method = "HEAD"
        if endpoint_key in REQUIRED_REALTIME_ENDPOINTS:
            method = "GET"
            headers.setdefault("Accept", "application/x-protobuf")
            headers.setdefault("User-Agent", "transit-ops/0.1.0")
        details = {"url": url, "status_code": None}
        response = (requester or httpx.request)(
            method,
            url,
            headers=headers,
            params=params,
            timeout=resolved_settings.HEALTH_FEED_TIMEOUT_SECONDS,
            follow_redirects=True,
        )
        status_code = int(response.status_code)
        details["status_code"] = status_code
    except Exception as exc:  # noqa: BLE001
        return ComponentHealthResult(
            name=result_name,
            status="down",
            message=f"STM feed check failed: {_safe_error(exc)}",
            latency_ms=_latency_ms(started),
            checked_at_utc=checked_at,
            details=locals().get("details", None),
        )

    if 200 <= status_code < 400:
        return ComponentHealthResult(
            name=result_name,
            status="ok",
            message="STM feed is reachable.",
            latency_ms=_latency_ms(started),
            checked_at_utc=checked_at,
            details=details,
        )
    return ComponentHealthResult(
        name=result_name,
        status="down",
        message=f"STM feed returned HTTP {status_code}.",
        latency_ms=_latency_ms(started),
        checked_at_utc=checked_at,
        details=details,
    )


def check_runtime_vm_health(
    settings: Settings | None = None,
    *,
    now: datetime | None = None,
    stats_provider: RuntimeStatsProvider | None = None,
    use_cache: bool = True,
) -> ComponentHealthResult:
    global _RUNTIME_HEALTH_CACHE

    resolved_settings = settings or get_settings()
    checked_at = _checked_at(now)
    started = time.perf_counter()
    cache_seconds = max(0, int(resolved_settings.HEALTH_RUNTIME_CACHE_SECONDS))
    if use_cache and stats_provider is None and _RUNTIME_HEALTH_CACHE is not None:
        cached_at, cached_result = _RUNTIME_HEALTH_CACHE
        if (checked_at - cached_at).total_seconds() <= cache_seconds:
            return cached_result

    try:
        raw_stats = dict((stats_provider or collect_runtime_vm_stats)())
        details = _runtime_details(raw_stats, resolved_settings)
    except Exception as exc:  # noqa: BLE001
        return ComponentHealthResult(
            name="runtime_vm",
            status="down",
            message=f"Runtime VM health check failed: {_safe_error(exc)}",
            latency_ms=_latency_ms(started),
            checked_at_utc=checked_at,
        )

    status = _runtime_status(details)
    result = ComponentHealthResult(
        name="runtime_vm",
        status=status,
        message=(
            "Runtime VM metrics are within thresholds."
            if status == "ok"
            else "Runtime VM resource pressure is elevated."
        ),
        latency_ms=_latency_ms(started),
        checked_at_utc=checked_at,
        details=details,
    )
    if use_cache and stats_provider is None:
        _RUNTIME_HEALTH_CACHE = (checked_at, result)
    return result


def run_health_checks(
    settings: Settings | None = None,
    *,
    registry: ProviderRegistry | None = None,
    now: datetime | None = None,
    project_root: Path | None = None,
    engine_factory: EngineFactory | None = None,
    storage_factory: StorageFactory = get_bronze_storage,
    requester: Requester | None = None,
) -> list[ComponentHealthResult]:
    resolved_settings = settings or get_settings()
    checked_at = _checked_at(now)
    resolved_root = project_root or Path(__file__).resolve().parents[3]

    return [
        check_database_connectivity(
            resolved_settings,
            engine_factory=engine_factory,
            now=checked_at,
        ),
        check_pipeline_freshness(
            resolved_settings,
            engine_factory=engine_factory,
            now=checked_at,
        ),
        check_bronze_storage(
            resolved_settings,
            project_root=resolved_root,
            storage_factory=storage_factory,
            now=checked_at,
        ),
        check_runtime_vm_health(
            resolved_settings,
            now=checked_at,
        ),
    ]


def _make_health_engine(settings: Settings) -> Any:
    if not settings.sqlalchemy_database_url:
        return make_engine(settings)
    if not settings.sqlalchemy_database_url.startswith("postgresql"):
        return make_engine(settings)
    return create_engine(
        settings.sqlalchemy_database_url,
        pool_pre_ping=True,
        connect_args={
            "connect_timeout": max(1, int(settings.HEALTH_DATABASE_TIMEOUT_SECONDS))
        },
    )


def _checked_at(now: datetime | None) -> datetime:
    value = now or datetime.now(UTC)
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _latency_ms(started: float) -> float:
    return round((time.perf_counter() - started) * 1000, 3)


def _safe_error(exc: Exception) -> str:
    return str(exc).replace("\n", " ")


def _row_mapping(row: Any) -> Mapping[str, Any]:
    if isinstance(row, Mapping):
        return row
    mapping = getattr(row, "_mapping", None)
    if isinstance(mapping, Mapping):
        return mapping
    return {"endpoint_key": row[0], "latest_captured_at_utc": row[1]}


def _latest_timestamps_by_endpoint(rows: Any) -> dict[str, datetime | None]:
    latest: dict[str, datetime | None] = {}
    for row in rows:
        mapping = _row_mapping(row)
        endpoint_key = str(mapping["endpoint_key"])
        timestamp = mapping.get("latest_captured_at_utc")
        latest[endpoint_key] = _normalize_datetime(timestamp) if timestamp else None
    return latest


def _normalize_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _age_seconds(now: datetime, timestamp: datetime | None) -> int | None:
    if timestamp is None:
        return None
    return max(0, int((now - _normalize_datetime(timestamp)).total_seconds()))


def _freshness_details(
    latest_by_endpoint: Mapping[str, datetime | None],
    now: datetime,
    threshold_seconds: int,
) -> dict[str, object]:
    return {
        "threshold_seconds": threshold_seconds,
        "endpoints": {
            endpoint: {
                "latest_captured_at_utc": latest_by_endpoint.get(endpoint),
                "age_seconds": _age_seconds(now, latest_by_endpoint.get(endpoint)),
            }
            for endpoint in REQUIRED_REALTIME_ENDPOINTS
        },
    }


def _bronze_location(storage: Any) -> str:
    backend = getattr(storage, "storage_backend", "")
    if backend == "local" and hasattr(storage, "root"):
        return str(storage.root)
    if hasattr(storage, "describe_location"):
        return storage.describe_location("")
    return ""


def _configured_bronze_location(settings: Settings, project_root: Path) -> str:
    if settings.BRONZE_STORAGE_BACKEND == "local":
        root = Path(settings.BRONZE_LOCAL_ROOT)
        return str(root if root.is_absolute() else project_root / root)
    if settings.BRONZE_S3_BUCKET:
        return f"s3://{settings.BRONZE_S3_BUCKET}/"
    return ""


def collect_runtime_vm_stats() -> Mapping[str, object]:
    disk_usage = shutil.disk_usage("/")
    memory = _memory_stats()
    load_average = _load_average()
    return {
        "disk_used_percent": round((disk_usage.used / disk_usage.total) * 100, 2),
        "disk_total_gb": round(disk_usage.total / (1024**3), 2),
        "disk_free_gb": round(disk_usage.free / (1024**3), 2),
        "memory_used_percent": memory["memory_used_percent"],
        "memory_total_mb": memory["memory_total_mb"],
        "memory_available_mb": memory["memory_available_mb"],
        "load_1m": load_average[0],
        "load_5m": load_average[1],
        "load_15m": load_average[2],
        "cpu_count": os.cpu_count() or 1,
        "uptime_seconds": _uptime_seconds(),
        "python_version": platform.python_version(),
        "platform_system": platform.system(),
        "platform_machine": platform.machine(),
        "kernel_release": platform.release(),
    }


def _memory_stats() -> dict[str, float]:
    meminfo: dict[str, int] = {}
    meminfo_path = Path("/proc/meminfo")
    if meminfo_path.exists():
        for line in meminfo_path.read_text(encoding="utf-8").splitlines():
            key, _, value = line.partition(":")
            parts = value.strip().split()
            if parts:
                meminfo[key] = int(parts[0])
    total_kb = meminfo.get("MemTotal", 0)
    available_kb = meminfo.get("MemAvailable", 0)
    if total_kb <= 0:
        return {
            "memory_used_percent": 0.0,
            "memory_total_mb": 0.0,
            "memory_available_mb": 0.0,
        }
    used_percent = ((total_kb - available_kb) / total_kb) * 100
    return {
        "memory_used_percent": round(used_percent, 2),
        "memory_total_mb": round(total_kb / 1024, 2),
        "memory_available_mb": round(available_kb / 1024, 2),
    }


def _load_average() -> tuple[float, float, float]:
    try:
        return tuple(round(value, 2) for value in os.getloadavg())
    except OSError:
        return (0.0, 0.0, 0.0)


def _uptime_seconds() -> int | None:
    uptime_path = Path("/proc/uptime")
    if not uptime_path.exists():
        return None
    try:
        return int(float(uptime_path.read_text(encoding="utf-8").split()[0]))
    except (IndexError, ValueError):
        return None


def _runtime_details(
    raw_stats: Mapping[str, object],
    settings: Settings,
) -> dict[str, object]:
    allowed_keys = (
        "disk_used_percent",
        "disk_total_gb",
        "disk_free_gb",
        "memory_used_percent",
        "memory_total_mb",
        "memory_available_mb",
        "load_1m",
        "load_5m",
        "load_15m",
        "cpu_count",
        "uptime_seconds",
        "python_version",
        "platform_system",
        "platform_machine",
        "kernel_release",
    )
    details = {key: raw_stats.get(key) for key in allowed_keys if key in raw_stats}
    details["retention_days"] = {
        "bronze_realtime": settings.BRONZE_REALTIME_RETENTION_DAYS,
        "bronze_static": settings.BRONZE_STATIC_RETENTION_DAYS,
        "silver_realtime": settings.SILVER_REALTIME_RETENTION_DAYS,
        "gold_fact": settings.GOLD_FACT_RETENTION_DAYS,
        "gold_warm_rollup": settings.GOLD_WARM_ROLLUP_RETENTION_DAYS,
    }
    return details


def _runtime_status(details: Mapping[str, object]) -> str:
    disk_used = _float_detail(details, "disk_used_percent")
    memory_used = _float_detail(details, "memory_used_percent")
    load_1m = _float_detail(details, "load_1m")
    cpu_count = max(1.0, _float_detail(details, "cpu_count"))
    if disk_used >= 90 or memory_used >= 95 or (load_1m / cpu_count) >= 2:
        return "degraded"
    return "ok"


def _float_detail(details: Mapping[str, object], key: str) -> float:
    value = details.get(key)
    return float(value) if isinstance(value, int | float) else 0.0


def _feed_auth_parts(auth: Any, settings: Settings) -> tuple[dict[str, str], dict[str, str]]:
    headers: dict[str, str] = {}
    params: dict[str, str] = {}
    if auth.auth_type == AuthType.NONE:
        return headers, params

    credential_name = auth.credential_env_var
    credential = getattr(settings, credential_name, None) if credential_name else None
    if not credential:
        raise RuntimeError(f"{credential_name or 'API key'} is not configured.")
    if auth.auth_header_name:
        headers[auth.auth_header_name] = credential
    if auth.auth_query_param:
        params[auth.auth_query_param] = credential
    return headers, params
