"""Provider retention, including tier order, bounded work and post-prune proof.

Settings remains the owner of retention windows and per-table row batch limits.
The budget bounds Bronze objects/batches exactly as the legacy Bronze command did.
Tier functions retain their existing transactions, clocks, SQL and archive handling.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy.engine import Engine

from transit_ops.db.connection import make_engine
from transit_ops.ingestion.common import utc_now
from transit_ops.settings import Settings, get_settings

from . import bronze, gold, i3, silver

if TYPE_CHECKING:
    from transit_ops.validation.proof import RetentionProofReport


class RetentionTier(StrEnum):
    SILVER = "silver"
    GOLD = "gold"
    I3 = "i3"
    WARM_ROLLUP = "warm_rollup"
    BRONZE = "bronze"


@dataclass(frozen=True)
class RetentionPolicy:
    settings: Settings
    tiers: frozenset[RetentionTier] = frozenset(RetentionTier)
    dry_run: bool = False
    prove: bool = True
    require_exhausted: bool = False

    def __post_init__(self) -> None:
        # Validate the entire selection before any tier can delete data.
        object.__setattr__(self, "tiers", frozenset(RetentionTier(tier) for tier in self.tiers))
        if not self.tiers:
            raise ValueError("Retention policy must select at least one tier")


@dataclass(frozen=True)
class PruneBudget:
    """Bronze limits per phase; None preserves the configured limit, including floors."""

    max_objects: int | None = None
    max_batches: int | None = None


type TierResult = (
    silver.SilverStoragePruneResult
    | gold.GoldStoragePruneResult
    | i3.I3StoragePruneResult
    | gold.WarmRollupStoragePruneResult
    | bronze.BronzeStoragePruneResult
)


@dataclass(frozen=True)
class PruneReceipt:
    provider_id: str
    dry_run: bool
    requested_tiers: frozenset[RetentionTier]
    results: dict[RetentionTier, TierResult]
    proof: RetentionProofReport | None
    require_exhausted: bool
    completed_at_utc: datetime

    @property
    def is_complete(self) -> bool:
        if self.results.keys() != self.requested_tiers:
            return False
        for result in self.results.values():
            if isinstance(result, (bronze.BronzeStoragePruneResult, i3.I3StoragePruneResult)):
                if any(result.failed_object_counts.values()):
                    return False
            if (
                isinstance(result, bronze.BronzeStoragePruneResult)
                and self.require_exhausted
                and not self.dry_run
                and not result.exhausted
            ):
                return False
        return self.proof is None or self.proof.is_complete

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "dry_run": self.dry_run,
            "is_complete": self.is_complete,
            "requested_tiers": sorted(self.requested_tiers),
            "results": {tier.value: result.display_dict() for tier, result in self.results.items()},
            "proof": self.proof.display_dict() if self.proof is not None else None,
            "require_exhausted": self.require_exhausted,
            "completed_at_utc": self.completed_at_utc.isoformat(),
        }


def prune(
    provider_id: str,
    policy: RetentionPolicy,
    budget: PruneBudget | None = None,
    *,
    engine: Engine | None = None,
) -> PruneReceipt:
    """Run selected tiers in dependency order and return their receipts plus proof.

    Each tier commits exactly as before. A later failure cannot roll back already
    committed tiers or deleted archives. Archive failures stop subsequent tiers;
    proof still runs and cannot turn those failures into a successful receipt.
    Operational exceptions propagate, as with the legacy commands.
    """
    settings = policy.settings
    engine = engine or make_engine(settings)
    budget = budget or PruneBudget()
    results: dict[RetentionTier, TierResult] = {}
    # Silver references must disappear before Bronze eligibility is evaluated.
    # i3 synchronizes its archive before deleting Silver and Raw; warm retention
    # follows that sync, matching the daily retention commands.
    for tier in RetentionTier:
        if tier not in policy.tiers:
            continue
        result: TierResult
        match tier:
            case RetentionTier.SILVER:
                result = silver.prune_silver_storage(
                    provider_id,
                    settings=settings,
                    engine=engine,
                    dry_run=policy.dry_run,
                )
            case RetentionTier.GOLD:
                result = gold.prune_gold_storage(
                    provider_id,
                    settings=settings,
                    engine=engine,
                    dry_run=policy.dry_run,
                )
            case RetentionTier.I3:
                result = i3.prune_i3_storage(
                    provider_id,
                    settings=settings,
                    engine=engine,
                    dry_run=policy.dry_run,
                )
            case RetentionTier.WARM_ROLLUP:
                result = gold.prune_warm_rollup_storage(
                    provider_id,
                    settings=settings,
                    engine=engine,
                    dry_run=policy.dry_run,
                )
            case RetentionTier.BRONZE:
                result = bronze.prune_bronze_storage(
                    provider_id,
                    settings=settings,
                    engine=engine,
                    dry_run=policy.dry_run,
                    max_objects=budget.max_objects,
                    max_batches=budget.max_batches,
                )
        results[tier] = result
        if isinstance(result, (bronze.BronzeStoragePruneResult, i3.I3StoragePruneResult)):
            if any(result.failed_object_counts.values()):
                break

    proof = None
    if policy.prove:
        # Local import avoids the compatibility proof command's dependency on
        # legacy wrappers. Its dry runs select a single tier without more proof.
        from transit_ops.validation.proof import build_retention_proof_report

        proof = build_retention_proof_report(provider_id, settings=settings, engine=engine)

    return PruneReceipt(
        provider_id=provider_id,
        dry_run=policy.dry_run,
        requested_tiers=policy.tiers,
        results=results,
        proof=proof,
        require_exhausted=policy.require_exhausted,
        completed_at_utc=utc_now(),
    )


def prune_silver_storage(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
    dry_run: bool = False,
) -> silver.SilverStoragePruneResult:
    result = prune(
        provider_id,
        RetentionPolicy(
            settings or get_settings(),
            tiers=frozenset({RetentionTier.SILVER}),
            dry_run=dry_run,
            prove=False,
        ),
        engine=engine,
    ).results[RetentionTier.SILVER]
    assert isinstance(result, silver.SilverStoragePruneResult)
    return result


def prune_gold_storage(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
    dry_run: bool = False,
) -> gold.GoldStoragePruneResult:
    result = prune(
        provider_id,
        RetentionPolicy(
            settings or get_settings(),
            tiers=frozenset({RetentionTier.GOLD}),
            dry_run=dry_run,
            prove=False,
        ),
        engine=engine,
    ).results[RetentionTier.GOLD]
    assert isinstance(result, gold.GoldStoragePruneResult)
    return result


def prune_i3_storage(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
    dry_run: bool = False,
) -> i3.I3StoragePruneResult:
    result = prune(
        provider_id,
        RetentionPolicy(
            settings or get_settings(),
            tiers=frozenset({RetentionTier.I3}),
            dry_run=dry_run,
            prove=False,
        ),
        engine=engine,
    ).results[RetentionTier.I3]
    assert isinstance(result, i3.I3StoragePruneResult)
    return result


def prune_warm_rollup_storage(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
    dry_run: bool = False,
) -> gold.WarmRollupStoragePruneResult:
    result = prune(
        provider_id,
        RetentionPolicy(
            settings or get_settings(),
            tiers=frozenset({RetentionTier.WARM_ROLLUP}),
            dry_run=dry_run,
            prove=False,
        ),
        engine=engine,
    ).results[RetentionTier.WARM_ROLLUP]
    assert isinstance(result, gold.WarmRollupStoragePruneResult)
    return result


def prune_bronze_storage(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
    dry_run: bool = False,
    max_objects: int | None = None,
    max_batches: int | None = None,
) -> bronze.BronzeStoragePruneResult:
    result = prune(
        provider_id,
        RetentionPolicy(
            settings or get_settings(),
            tiers=frozenset({RetentionTier.BRONZE}),
            dry_run=dry_run,
            prove=False,
        ),
        PruneBudget(max_objects, max_batches),
        engine=engine,
    ).results[RetentionTier.BRONZE]
    assert isinstance(result, bronze.BronzeStoragePruneResult)
    return result
