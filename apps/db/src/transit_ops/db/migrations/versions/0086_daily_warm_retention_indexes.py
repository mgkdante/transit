"""Index the Daily Warm Bronze retention delete path.

Revision ID: 0086_daily_warm_retention_indexes
Revises: 0085_repair_otp_count_universe
Create Date: 2026-08-30
"""

from __future__ import annotations

from alembic import op

revision = "0086_daily_warm_retention_indexes"
down_revision = "0085_repair_otp_count_universe"
branch_labels = None
depends_on = None


_INDEX_DEFINITIONS = (
    (
        "gold.ix_gold_ftds_realtime_snapshot_id",
        "ix_gold_ftds_realtime_snapshot_id",
        "gold.fact_trip_delay_snapshot",
        "realtime_snapshot_id",
    ),
    (
        "gold.ix_gold_fvs_realtime_snapshot_id",
        "ix_gold_fvs_realtime_snapshot_id",
        "gold.fact_vehicle_snapshot",
        "realtime_snapshot_id",
    ),
    (
        "raw.ix_raw_rsi_ingestion_object_id",
        "ix_raw_rsi_ingestion_object_id",
        "raw.realtime_snapshot_index",
        "ingestion_object_id",
    ),
)


def _rebuild_index_concurrently(
    qualified_index_name: str,
    index_name: str,
    qualified_table_name: str,
    column_name: str,
) -> None:
    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {qualified_index_name}")
        op.execute(
            f"CREATE INDEX CONCURRENTLY {index_name} ON {qualified_table_name} ({column_name})"
        )


def upgrade() -> None:
    for index_definition in _INDEX_DEFINITIONS:
        _rebuild_index_concurrently(*index_definition)


def downgrade() -> None:
    for qualified_index_name, *_ in reversed(_INDEX_DEFINITIONS):
        with op.get_context().autocommit_block():
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {qualified_index_name}")
