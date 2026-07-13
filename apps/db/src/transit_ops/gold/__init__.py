"""Gold-layer marts and KPI builders.

Design gate — adding a NEW gold relation (table / view / append-only daily):
  * Prefer DERIVING breakdowns at READ time from the finest-grain append-only
    SPINE (route_delay_spine / stop_delay_spine / *_shift_daily) over
    materializing one-table-per-window. The S7-close program collapsed the
    one-table-per-breakdown sprawl into the dimensional rollup spine + the
    gold/reader kernel; a new stored mart must justify why a read-time
    projection off an existing spine cannot serve it.
  * The provider-local calendar day is named `provider_local_date` on EVERY
    daily gold table (not `service_local_date`, not a GTFS service_date) — it is
    the provider-timezone-derived calendar day. Match that name for symmetry;
    cross-table additive parity depends on the shared grain vocabulary.
  * Append-only daily tables register in maintenance.gold
    (GOLD_APPEND_ONLY_DAILY_TABLES + a GOLD_AGGREGATE_RETENTION_COLUMNS tuple
    keyed on provider_local_date); DELETE+UPSERT reporting marts register in
    REPORTING_AGGREGATE_TABLES. A retention tuple mismatch raises at prune time.
  * Every SQL body flows through the named-query registry (sql_registry) with a
    stable `-- q:<name>` marker; reads C2 touches are byte-locked in
    tests/test_gold_reader.py.
"""

from transit_ops.gold.alert_archive import AlertArchiveSyncResult, sync_alert_archive
from transit_ops.gold.dim_history import DimHistoryBackfillResult, backfill_dim_name_history
from transit_ops.gold.marts import (
    GoldBuildResult,
    GoldRealtimeRefreshResult,
    GoldStaticRefreshResult,
    build_gold_marts,
    refresh_gold_realtime,
    refresh_gold_static,
)
from transit_ops.gold.rollups import (
    REBUILDABLE_KINDS,
    WarmRollupBuildResult,
    WarmRollupRebuildResult,
    build_warm_rollups,
    provider_is_seeded,
    rebuild_warm_rollups,
)

__all__ = [
    "REBUILDABLE_KINDS",
    "AlertArchiveSyncResult",
    "DimHistoryBackfillResult",
    "GoldBuildResult",
    "GoldRealtimeRefreshResult",
    "GoldStaticRefreshResult",
    "WarmRollupBuildResult",
    "WarmRollupRebuildResult",
    "backfill_dim_name_history",
    "build_gold_marts",
    "build_warm_rollups",
    "provider_is_seeded",
    "rebuild_warm_rollups",
    "refresh_gold_realtime",
    "refresh_gold_static",
    "sync_alert_archive",
]
