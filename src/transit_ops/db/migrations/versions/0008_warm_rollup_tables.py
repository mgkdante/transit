from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0008_warm_rollup_tables"
down_revision = "0007_gold_fact_retention_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vehicle_summary_5m",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("period_start_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("vehicle_count", sa.Integer(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False),
        sa.Column("snapshot_count", sa.Integer(), nullable=False),
        sa.Column("built_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_vehicle_summary_5m_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "period_start_utc",
            "route_id",
            name="pk_gold_vehicle_summary_5m",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_vehicle_summary_5m_provider_period",
        "vehicle_summary_5m",
        ["provider_id", "period_start_utc"],
        schema="gold",
    )
    op.create_index(
        "ix_gold_vehicle_summary_5m_provider_route_period",
        "vehicle_summary_5m",
        ["provider_id", "route_id", "period_start_utc"],
        schema="gold",
    )

    op.create_table(
        "trip_delay_summary_5m",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("period_start_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("trip_count", sa.Integer(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False),
        sa.Column("delay_observation_count", sa.Integer(), nullable=False),
        sa.Column("avg_delay_seconds", sa.Numeric(10, 2), nullable=True),
        sa.Column("avg_delay_seconds_capped", sa.Numeric(10, 2), nullable=True),
        sa.Column("max_delay_seconds", sa.Integer(), nullable=True),
        sa.Column("min_delay_seconds", sa.Integer(), nullable=True),
        sa.Column("delayed_trip_count", sa.Integer(), nullable=False),
        sa.Column("outlier_count", sa.Integer(), nullable=False),
        sa.Column("built_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_trip_delay_summary_5m_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "period_start_utc",
            "route_id",
            name="pk_gold_trip_delay_summary_5m",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_trip_delay_summary_5m_provider_period",
        "trip_delay_summary_5m",
        ["provider_id", "period_start_utc"],
        schema="gold",
    )
    op.create_index(
        "ix_gold_trip_delay_summary_5m_provider_route_period",
        "trip_delay_summary_5m",
        ["provider_id", "route_id", "period_start_utc"],
        schema="gold",
    )

    op.create_table(
        "warm_rollup_periods",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("rollup_kind", sa.Text(), nullable=False),
        sa.Column("period_start_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("built_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_warm_rollup_periods_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "rollup_kind",
            "period_start_utc",
            name="pk_gold_warm_rollup_periods",
        ),
        schema="gold",
    )


def downgrade() -> None:
    op.drop_table("warm_rollup_periods", schema="gold")

    op.drop_index(
        "ix_gold_trip_delay_summary_5m_provider_route_period",
        table_name="trip_delay_summary_5m",
        schema="gold",
    )
    op.drop_index(
        "ix_gold_trip_delay_summary_5m_provider_period",
        table_name="trip_delay_summary_5m",
        schema="gold",
    )
    op.drop_table("trip_delay_summary_5m", schema="gold")

    op.drop_index(
        "ix_gold_vehicle_summary_5m_provider_route_period",
        table_name="vehicle_summary_5m",
        schema="gold",
    )
    op.drop_index(
        "ix_gold_vehicle_summary_5m_provider_period",
        table_name="vehicle_summary_5m",
        schema="gold",
    )
    op.drop_table("vehicle_summary_5m", schema="gold")
