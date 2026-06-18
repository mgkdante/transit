"""Tune autovacuum for hot realtime retention tables.

The live VM keeps a 30-second ingest cadence while Silver/Gold realtime
retention prunes high-churn Silver and Gold rows. Postgres defaults wait for a
20 percent dead-row threshold, which is too high for the large realtime tables.
These reloptions make ordinary VACUUM reclaim deleted pages for reuse much
earlier without requiring VACUUM FULL or disk-expanding rewrites.
"""
from __future__ import annotations

from alembic import op

revision = "0045_hot_realtime_autovacuum"
down_revision = "0044_drop_unused_rt_feed_snapshots_index"
branch_labels = None
depends_on = None


_RELATION_OPTIONS = {
    "silver.rt_trip_update_stop_times": (
        "autovacuum_vacuum_scale_factor = 0.005",
        "autovacuum_vacuum_threshold = 50000",
        "autovacuum_analyze_scale_factor = 0.01",
        "autovacuum_analyze_threshold = 50000",
    ),
    "silver.rt_trip_updates": (
        "autovacuum_vacuum_scale_factor = 0.01",
        "autovacuum_vacuum_threshold = 50000",
        "autovacuum_analyze_scale_factor = 0.02",
        "autovacuum_analyze_threshold = 50000",
    ),
    "silver.rt_entities": (
        "autovacuum_vacuum_scale_factor = 0.01",
        "autovacuum_vacuum_threshold = 50000",
        "autovacuum_analyze_scale_factor = 0.02",
        "autovacuum_analyze_threshold = 50000",
    ),
    "silver.rt_vehicle_positions": (
        "autovacuum_vacuum_scale_factor = 0.01",
        "autovacuum_vacuum_threshold = 50000",
        "autovacuum_analyze_scale_factor = 0.02",
        "autovacuum_analyze_threshold = 50000",
    ),
    "silver.rt_feed_snapshots": (
        "autovacuum_vacuum_scale_factor = 0.02",
        "autovacuum_vacuum_threshold = 1000",
        "autovacuum_analyze_scale_factor = 0.05",
        "autovacuum_analyze_threshold = 1000",
    ),
    "gold.fact_trip_delay_snapshot": (
        "autovacuum_vacuum_scale_factor = 0.01",
        "autovacuum_vacuum_threshold = 50000",
        "autovacuum_analyze_scale_factor = 0.02",
        "autovacuum_analyze_threshold = 50000",
    ),
    "gold.fact_vehicle_snapshot": (
        "autovacuum_vacuum_scale_factor = 0.01",
        "autovacuum_vacuum_threshold = 50000",
        "autovacuum_analyze_scale_factor = 0.02",
        "autovacuum_analyze_threshold = 50000",
    ),
}


def upgrade() -> None:
    for table_name, options in _RELATION_OPTIONS.items():
        op.execute(f"ALTER TABLE {table_name} SET ({', '.join(options)})")


def downgrade() -> None:
    option_names = (
        "autovacuum_vacuum_scale_factor",
        "autovacuum_vacuum_threshold",
        "autovacuum_analyze_scale_factor",
        "autovacuum_analyze_threshold",
    )
    for table_name in _RELATION_OPTIONS:
        op.execute(f"ALTER TABLE {table_name} RESET ({', '.join(option_names)})")
