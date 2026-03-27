from __future__ import annotations

from alembic import op

revision = "0007_gold_fact_retention_indexes"
down_revision = "0006_gold_latest_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_gold_fact_vehicle_snapshot_provider_captured_at",
        "fact_vehicle_snapshot",
        ["provider_id", "captured_at_utc"],
        schema="gold",
    )
    op.create_index(
        "ix_gold_fact_trip_delay_snapshot_provider_captured_at",
        "fact_trip_delay_snapshot",
        ["provider_id", "captured_at_utc"],
        schema="gold",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gold_fact_trip_delay_snapshot_provider_captured_at",
        table_name="fact_trip_delay_snapshot",
        schema="gold",
    )
    op.drop_index(
        "ix_gold_fact_vehicle_snapshot_provider_captured_at",
        table_name="fact_vehicle_snapshot",
        schema="gold",
    )
