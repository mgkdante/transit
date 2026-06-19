from __future__ import annotations

import os
import platform
import shutil
import time
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, text

from transit_ops.db.connection import make_engine
from transit_ops.health.models import ComponentHealthResult, HealthStatus
from transit_ops.ingestion.storage import (
    LocalBronzeStorage,
    S3BronzeStorage,
    get_bronze_storage,
)
from transit_ops.providers.registry import ProviderRegistry
from transit_ops.settings import Settings, get_settings

# A feed is stale once it misses this many of its own declared refresh cycles
# (floored at HEALTH_MAX_PIPELINE_AGE_SECONDS). Deriving the budget from each
# feed's refresh_interval_seconds lets a daily static feed and a 30s realtime
# feed share one check without a per-feed-kind threshold table.
FRESHNESS_GRACE_CYCLES = 3

# Latest successful capture per enabled feed of every ACTIVE provider. Driven by
# core.feed_endpoints (seeded from the manifests) + raw.ingestion_runs, so health
# is holistic per provider with no hardcoded provider id. run_kind = feed_kind
# excludes derived runs (e.g. silver_load) from the feed's capture recency.
_PROVIDER_FEED_FRESHNESS_SQL = """
    SELECT
        fe.provider_id,
        fe.endpoint_key,
        fe.feed_kind,
        fe.refresh_interval_seconds,
        max(ir.completed_at_utc) AS latest_captured_at_utc
    FROM core.feed_endpoints AS fe
    JOIN core.providers AS p
        ON p.provider_id = fe.provider_id
       AND p.is_active IS TRUE
    LEFT JOIN raw.ingestion_runs AS ir
        ON ir.feed_endpoint_id = fe.feed_endpoint_id
       AND ir.run_kind = fe.feed_kind
       AND ir.status = 'succeeded'
    WHERE fe.is_enabled IS TRUE
    GROUP BY fe.provider_id, fe.endpoint_key, fe.feed_kind, fe.refresh_interval_seconds
    ORDER BY fe.provider_id, fe.endpoint_key
"""

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


def check_provider_feed_freshness(
    settings: Settings | None = None,
    *,
    engine_factory: EngineFactory | None = None,
    now: datetime | None = None,
) -> list[ComponentHealthResult]:
    """Per-provider, per-feed capture freshness — one component per enabled feed
    of every active provider, named ``{provider_id}_{endpoint_key}``.

    Registry/DB-driven (no hardcoded provider): reads ``core.feed_endpoints``
    (seeded from the manifests) joined to the latest successful
    ``raw.ingestion_runs`` capture, so onboarding a provider automatically adds
    its feed components and health becomes holistic per provider. Each feed's
    staleness threshold is derived from its own ``refresh_interval_seconds`` so a
    daily static feed is not judged by a realtime cadence, floored at
    ``HEALTH_MAX_PIPELINE_AGE_SECONDS``. Detail blocks (provider ids, timestamps)
    stay off the anonymous ``public_dict`` via the model's redaction.
    """
    resolved_settings = settings or get_settings()
    checked_at = _checked_at(now)
    started = time.perf_counter()
    floor_seconds = int(resolved_settings.HEALTH_MAX_PIPELINE_AGE_SECONDS)

    if not resolved_settings.DATABASE_URL:
        return [
            _provider_feeds_unavailable(
                "DATABASE_URL is not configured.", checked_at, started
            )
        ]

    try:
        engine = (engine_factory or _make_health_engine)(resolved_settings)
        with engine.connect() as connection:
            rows = list(connection.execute(text(_PROVIDER_FEED_FRESHNESS_SQL)))
    except Exception as exc:  # noqa: BLE001
        return [
            _provider_feeds_unavailable(
                f"Provider feed freshness query failed: {_safe_error(exc)}",
                checked_at,
                started,
            )
        ]

    mappings = [_row_mapping(row) for row in rows]
    if not mappings:
        return [
            ComponentHealthResult(
                name="provider_feeds",
                status="degraded",
                message="No active provider feeds are configured.",
                latency_ms=_latency_ms(started),
                checked_at_utc=checked_at,
            )
        ]

    components: list[ComponentHealthResult] = []
    for mapping in mappings:
        provider_id = str(mapping["provider_id"])
        endpoint_key = str(mapping["endpoint_key"])
        feed_kind = str(mapping["feed_kind"])
        refresh_seconds = int(mapping.get("refresh_interval_seconds") or 0)
        threshold_seconds = max(floor_seconds, refresh_seconds * FRESHNESS_GRACE_CYCLES)
        latest = mapping.get("latest_captured_at_utc")
        age_seconds = _age_seconds(checked_at, latest)
        details = {
            "provider_id": provider_id,
            "endpoint_key": endpoint_key,
            "feed_kind": feed_kind,
            "age_seconds": age_seconds,
            "threshold_seconds": threshold_seconds,
            "latest_captured_at_utc": latest,
        }

        if latest is None:
            status: HealthStatus = "degraded"
            message = f"{provider_id}/{endpoint_key}: no successful capture recorded."
        elif age_seconds is not None and age_seconds > threshold_seconds:
            status = "degraded"
            message = (
                f"{provider_id}/{endpoint_key}: last capture {age_seconds}s ago "
                f"exceeds the {threshold_seconds}s freshness budget."
            )
        else:
            status = "ok"
            message = f"{provider_id}/{endpoint_key}: capture is fresh."

        components.append(
            ComponentHealthResult(
                name=f"{provider_id}_{endpoint_key}",
                status=status,
                message=message,
                latency_ms=_latency_ms(started),
                checked_at_utc=checked_at,
                details=details,
            )
        )
    return components


def _provider_feeds_unavailable(
    message: str, checked_at: datetime, started: float
) -> ComponentHealthResult:
    return ComponentHealthResult(
        name="provider_feeds",
        status="down",
        message=message,
        latency_ms=_latency_ms(started),
        checked_at_utc=checked_at,
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


def check_feed_conformance(
    settings: Settings | None = None,
    *,
    engine_factory: EngineFactory | None = None,
    now: datetime | None = None,
) -> ComponentHealthResult:
    """Surface "out-of-norm payload" providers whose latest static feed shipped
    members this pipeline does not natively model.

    Pure surfacing over data the loader already captures: unknown / extra GTFS
    members are preserved verbatim in ``silver.gtfs_extra_rows`` (never dropped),
    and a feed that omits a required member or spine column never produced a
    current dataset_version in the first place (the load fails loud). So the
    observable states here are conformant (ok) or out_of_norm (degraded). The
    detailed per-provider breakdown stays off ``public_dict`` via the model's
    redaction.
    """
    resolved_settings = settings or get_settings()
    checked_at = _checked_at(now)
    started = time.perf_counter()

    if not resolved_settings.DATABASE_URL:
        return ComponentHealthResult(
            name="feed_conformance",
            status="down",
            message="DATABASE_URL is not configured.",
            latency_ms=_latency_ms(started),
            checked_at_utc=checked_at,
        )

    try:
        engine = (engine_factory or _make_health_engine)(resolved_settings)
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    """
                    SELECT
                        dv.provider_id,
                        dv.dataset_version_id,
                        (
                            SELECT count(*)
                            FROM silver.gtfs_extra_rows AS ger
                            WHERE ger.dataset_version_id = dv.dataset_version_id
                        )::bigint AS extra_row_count,
                        (
                            SELECT array_agg(DISTINCT ger.source_file_name)
                            FROM silver.gtfs_extra_rows AS ger
                            WHERE ger.dataset_version_id = dv.dataset_version_id
                        ) AS unknown_members
                    FROM core.dataset_versions AS dv
                    WHERE dv.is_current IS TRUE
                      AND dv.dataset_kind = 'static_schedule'
                    ORDER BY dv.provider_id
                    """
                )
            )
    except Exception as exc:  # noqa: BLE001
        return ComponentHealthResult(
            name="feed_conformance",
            status="down",
            message=f"Feed conformance query failed: {_safe_error(exc)}",
            latency_ms=_latency_ms(started),
            checked_at_utc=checked_at,
        )

    per_provider: dict[str, object] = {}
    out_of_norm: list[str] = []
    for row in rows:
        mapping = _row_mapping(row)
        provider_id = str(mapping["provider_id"])
        unknown_members = sorted(mapping.get("unknown_members") or [])
        extra_row_count = int(mapping.get("extra_row_count") or 0)
        per_provider[provider_id] = {
            "dataset_version_id": int(mapping["dataset_version_id"]),
            "unknown_members": unknown_members,
            "extra_row_count": extra_row_count,
        }
        if unknown_members or extra_row_count:
            out_of_norm.append(provider_id)

    details: dict[str, object] = {"label": "conformant", "providers": per_provider}

    if out_of_norm:
        details["label"] = "out_of_norm"
        summary = ", ".join(
            f"{pid} ({len(per_provider[pid]['unknown_members'])} member(s), "
            f"{per_provider[pid]['extra_row_count']} row(s))"
            for pid in out_of_norm
        )
        return ComponentHealthResult(
            name="feed_conformance",
            status="degraded",
            message=(
                f"Out-of-norm feed payload for {len(out_of_norm)} provider(s): "
                f"{summary} — captured verbatim in silver.gtfs_extra_rows."
            ),
            latency_ms=_latency_ms(started),
            checked_at_utc=checked_at,
            details=details,
        )

    return ComponentHealthResult(
        name="feed_conformance",
        status="ok",
        message="Latest static load matched the expected GTFS shape.",
        latency_ms=_latency_ms(started),
        checked_at_utc=checked_at,
        details=details,
    )


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
        *check_provider_feed_freshness(
            resolved_settings,
            engine_factory=engine_factory,
            now=checked_at,
        ),
        check_feed_conformance(
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


def _normalize_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _age_seconds(now: datetime, timestamp: datetime | None) -> int | None:
    if timestamp is None:
        return None
    return max(0, int((now - _normalize_datetime(timestamp)).total_seconds()))


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
