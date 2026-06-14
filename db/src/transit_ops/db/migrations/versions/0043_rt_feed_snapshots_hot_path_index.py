"""Add the rt_feed_snapshots hot-path partial index (slice-9.1.1-alpha).

The per-cycle gold refresh + prune DELETEs filter silver.rt_feed_snapshots on
(provider_id, endpoint_key) and take max(source_realtime_snapshot_id) (gold/marts.py).
The existing indexes cover (provider_id, the per-feed endpoint id, captured_at_utc)
and (source_realtime_snapshot_id) alone -- NEITHER covers the (provider_id,
endpoint_key) text predicate. This partial index lets the planner index-seek
(provider_id, endpoint_key) and read max(source_realtime_snapshot_id) as the first
row (DESC), and serves the endpoint_key=... AND source_realtime_snapshot_id IS NOT
NULL joins.

CONCURRENTLY: the table is INSERT'd every ~30s by the live worker, so a plain
CREATE INDEX's SHARE lock would block captures. CONCURRENTLY cannot run in a
transaction (env.py transaction_per_migration=True) -> autocommit_block, mirroring
migrations 0021/0038.
"""
from __future__ import annotations

from alembic import op

revision = "0043_rt_feed_snapshots_hot_path_index"
down_revision = "0042_snapshot_publish_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_silver_rt_feed_snapshots_provider_endpoint_srsid "  # noqa: E501
            "ON silver.rt_feed_snapshots (provider_id, endpoint_key, source_realtime_snapshot_id DESC) "  # noqa: E501
            "WHERE source_realtime_snapshot_id IS NOT NULL"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS silver.ix_silver_rt_feed_snapshots_provider_endpoint_srsid"  # noqa: E501
        )
