"""Retention interface and legacy command compatibility.

SQL, tier implementations and their low-level helpers are package internals.
New callers use prune; legacy wrappers retain single-tier behavior and receipts.
"""

from .bronze import BronzeStoragePruneResult
from .gold import GoldStoragePruneResult, WarmRollupStoragePruneResult
from .i3 import I3StoragePruneResult
from .retention import (
    PruneBudget,
    PruneReceipt,
    RetentionPolicy,
    RetentionTier,
    prune,
    prune_bronze_storage,
    prune_gold_storage,
    prune_i3_storage,
    prune_silver_storage,
    prune_warm_rollup_storage,
)
from .silver import SilverStoragePruneResult
from .vacuum import VacuumResult, vacuum_storage

__all__ = [
    "PruneBudget",
    "PruneReceipt",
    "RetentionPolicy",
    "RetentionTier",
    "prune",
    "BronzeStoragePruneResult",
    "GoldStoragePruneResult",
    "I3StoragePruneResult",
    "SilverStoragePruneResult",
    "WarmRollupStoragePruneResult",
    "prune_bronze_storage",
    "prune_gold_storage",
    "prune_i3_storage",
    "prune_silver_storage",
    "prune_warm_rollup_storage",
    "VacuumResult",
    "vacuum_storage",
]
