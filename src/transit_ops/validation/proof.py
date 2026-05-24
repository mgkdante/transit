from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.engine import Engine

from transit_ops.db.connection import make_engine
from transit_ops.maintenance import (
    prune_bronze_storage,
    prune_gold_storage,
    prune_silver_storage,
    prune_warm_rollup_storage,
)
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings, get_settings
from transit_ops.validation.static_feeds import validate_static_feeds

RETENTION_CONTRACT_KEYS = (
    "STATIC_DATASET_RETENTION_COUNT",
    "SILVER_REALTIME_RETENTION_DAYS",
    "GOLD_FACT_RETENTION_DAYS",
    "BRONZE_REALTIME_RETENTION_DAYS",
    "BRONZE_STATIC_RETENTION_DAYS",
    "GOLD_WARM_ROLLUP_RETENTION_DAYS",
)

DryRunCallable = Callable[..., Any]
StaticFeedValidator = Callable[..., Any]


@dataclass(frozen=True)
class ProofDryRunSection:
    status: str
    dry_run: bool
    result: dict[str, object] | None
    message: str
    error_type: str | None

    def display_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class RetentionProofReport:
    provider_id: str
    generated_at_utc: datetime
    retention_contract: dict[str, int]
    storage: dict[str, object]
    dry_runs: dict[str, ProofDryRunSection]
    static_feed_validation: dict[str, object]

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "generated_at_utc": self.generated_at_utc.isoformat(),
            "retention_contract": self.retention_contract,
            "storage": self.storage,
            "dry_runs": {
                name: section.display_dict() for name, section in self.dry_runs.items()
            },
            "static_feed_validation": self.static_feed_validation,
        }


def _retention_contract(settings: Settings) -> dict[str, int]:
    return {key: int(getattr(settings, key)) for key in RETENTION_CONTRACT_KEYS}


def _storage_settings(settings: Settings) -> dict[str, object]:
    return {
        "BRONZE_STORAGE_BACKEND": settings.BRONZE_STORAGE_BACKEND,
        "BRONZE_LOCAL_ROOT": settings.BRONZE_LOCAL_ROOT,
        "BRONZE_S3_ENDPOINT": settings.BRONZE_S3_ENDPOINT,
        "BRONZE_S3_BUCKET": settings.BRONZE_S3_BUCKET,
        "BRONZE_S3_REGION": settings.BRONZE_S3_REGION,
        "BRONZE_S3_ACCESS_KEY_CONFIGURED": bool(settings.BRONZE_S3_ACCESS_KEY),
        "BRONZE_S3_SECRET_KEY_CONFIGURED": bool(settings.BRONZE_S3_SECRET_KEY),
    }


def _unavailable_section(message: str, error_type: str) -> ProofDryRunSection:
    return ProofDryRunSection(
        status="unavailable",
        dry_run=True,
        result=None,
        message=message,
        error_type=error_type,
    )


def _ok_section(result: Any) -> ProofDryRunSection:
    return ProofDryRunSection(
        status="ok",
        dry_run=True,
        result=result.display_dict(),
        message="Dry-run completed successfully.",
        error_type=None,
    )


def _exception_section(exc: Exception) -> ProofDryRunSection:
    return _unavailable_section(str(exc), type(exc).__name__)


def _run_prune_surface(
    *,
    provider_id: str,
    settings: Settings,
    engine: Engine,
    prune: DryRunCallable,
) -> ProofDryRunSection:
    try:
        result = prune(provider_id, settings=settings, engine=engine, dry_run=True)
    except Exception as exc:
        return _exception_section(exc)
    return _ok_section(result)


def _unavailable_static_validation(exc: Exception) -> dict[str, object]:
    return {
        "status": "unavailable",
        "message": str(exc),
        "error_type": type(exc).__name__,
    }


def _build_static_validation(
    *,
    provider_id: str,
    settings: Settings,
    registry: ProviderRegistry | None,
    static_feed_validator: StaticFeedValidator,
) -> dict[str, object]:
    try:
        result = static_feed_validator(provider_id, settings=settings, registry=registry)
    except Exception as exc:
        return _unavailable_static_validation(exc)
    return result.display_dict()


def build_retention_proof_report(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
    registry: ProviderRegistry | None = None,
    static_feed_validator: StaticFeedValidator | None = None,
    prune_silver: DryRunCallable | None = None,
    prune_gold: DryRunCallable | None = None,
    prune_bronze: DryRunCallable | None = None,
    prune_warm_rollup: DryRunCallable | None = None,
) -> RetentionProofReport:
    resolved_settings = settings or get_settings()
    resolved_static_feed_validator = static_feed_validator or validate_static_feeds

    dry_run_callables = {
        "silver": prune_silver or prune_silver_storage,
        "gold": prune_gold or prune_gold_storage,
        "bronze": prune_bronze or prune_bronze_storage,
        "warm_rollup": prune_warm_rollup or prune_warm_rollup_storage,
    }
    if not resolved_settings.sqlalchemy_database_url:
        dry_runs = {
            name: _unavailable_section(
                "DATABASE_URL is required for this dry-run proof surface.",
                "missing_database_url",
            )
            for name in dry_run_callables
        }
    else:
        try:
            resolved_engine = engine or make_engine(resolved_settings)
        except Exception as exc:
            dry_runs = {name: _exception_section(exc) for name in dry_run_callables}
        else:
            dry_runs = {
                name: _run_prune_surface(
                    provider_id=provider_id,
                    settings=resolved_settings,
                    engine=resolved_engine,
                    prune=prune,
                )
                for name, prune in dry_run_callables.items()
            }

    return RetentionProofReport(
        provider_id=provider_id,
        generated_at_utc=datetime.now(UTC),
        retention_contract=_retention_contract(resolved_settings),
        storage=_storage_settings(resolved_settings),
        dry_runs=dry_runs,
        static_feed_validation=_build_static_validation(
            provider_id=provider_id,
            settings=resolved_settings,
            registry=registry,
            static_feed_validator=resolved_static_feed_validator,
        ),
    )
