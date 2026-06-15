"""Drop the unused rt_feed_snapshots hot-path index (slice-9.1.1-alpha revert).

slice-9.1.1-alpha added ix_silver_rt_feed_snapshots_provider_endpoint_srsid
(migration 0043) on the audit's #1 recommendation. PROD EXPLAIN ANALYZE
(2026-06-15) proved the planner never adopts it: the real selective hot-path
(source_realtime_snapshot_id = latest / max()) is already served optimally by the
existing single-column source_realtime_snapshot_id index (17,402 scans), while the
only queries the composite would serve are non-selective (endpoint_key ~50% of
rows) where a Seq Scan is correctly cheaper. The new index logged 0 scans and cost
1.9 MB + per-INSERT (~30s) write overhead. Carrying an index the planner never
chooses is the anti-pattern this campaign removes -> drop it. downgrade recreates
it (restores 0043).

CONCURRENTLY (the table is INSERT'd every ~30s by the live worker) inside
autocommit_block, mirroring 0021/0038/0043.
"""
from __future__ import annotations

from alembic import op

revision = "0044_drop_unused_rt_feed_snapshots_index"
down_revision = "0043_rt_feed_snapshots_hot_path_index"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS silver.ix_silver_rt_feed_snapshots_provider_endpoint_srsid"  # noqa: E501
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_silver_rt_feed_snapshots_provider_endpoint_srsid "  # noqa: E501
            "ON silver.rt_feed_snapshots (provider_id, endpoint_key, source_realtime_snapshot_id DESC) "  # noqa: E501
            "WHERE source_realtime_snapshot_id IS NOT NULL"
        )
