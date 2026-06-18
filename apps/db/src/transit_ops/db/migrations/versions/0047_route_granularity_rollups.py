"""Granularity-tier route rollups: by-shift + by-day-type reliability + per-direction headway.

Revision ID: 0047_route_granularity_rollups
Revises: 0046_daily_percentile_rollup
Create Date: 2026-06-18

Built in build_warm_rollups and surfaced as ADDITIVE free-string grain/shift rows
on route_reliability (no /v1 contract change):
  - route_delay_by_shift / route_delay_by_daytype: DELETE+UPSERT derived tables,
    regrouping gold.route_delay_hourly by time-of-day band / weekday-vs-weekend.
  - route_headway_direction_daily: a per-direction + weekday/weekend SIBLING of
    route_headway_daily (which is left 100% untouched), keeping every direction
    instead of collapsing to the busiest weekday direction.

Alembic migration modules are independent — the _built_at_column / _provider_fk
helpers are re-declared here rather than imported from 0014.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0047_route_granularity_rollups"
down_revision = "0046_daily_percentile_rollup"
branch_labels = None
depends_on = None


def _built_at_column() -> sa.Column:
    return sa.Column(
        "built_at_utc",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


def _provider_fk(table_name: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["provider_id"],
        ["core.providers.provider_id"],
        name=f"fk_gold_{table_name}_provider_id",
    )


def _reliability_grain_table(name: str, grain_col: str) -> None:
    op.create_table(
        name,
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column(grain_col, sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("delay_observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("on_time_observation_count", sa.Integer(), nullable=True),
        sa.Column("avg_delay_seconds", sa.Numeric(12, 2), nullable=True),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default="0"),
        _built_at_column(),
        _provider_fk(name),
        sa.PrimaryKeyConstraint("provider_id", grain_col, "route_id", name=f"pk_gold_{name}"),
        schema="gold",
    )
    op.create_index(
        f"ix_gold_{name}_provider_route",
        name,
        ["provider_id", "route_id"],
        schema="gold",
    )


def upgrade() -> None:
    _reliability_grain_table("route_delay_by_shift", "shift")
    _reliability_grain_table("route_delay_by_daytype", "day_type")

    op.create_table(
        "route_headway_direction_daily",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("direction_id", sa.Integer(), nullable=False),
        sa.Column("shift", sa.Text(), nullable=False),
        sa.Column("service_day_kind", sa.Text(), nullable=False),
        sa.Column("observed_headway_min", sa.Numeric(), nullable=True),
        sa.Column("sample_count", sa.Integer(), nullable=False, server_default="0"),
        _built_at_column(),
        _provider_fk("route_headway_direction_daily"),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "route_id",
            "direction_id",
            "shift",
            "service_day_kind",
            name="pk_gold_route_headway_direction_daily",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_route_headway_direction_daily_provider_route",
        "route_headway_direction_daily",
        ["provider_id", "route_id"],
        schema="gold",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gold_route_headway_direction_daily_provider_route",
        table_name="route_headway_direction_daily",
        schema="gold",
    )
    op.drop_table("route_headway_direction_daily", schema="gold")
    op.drop_index(
        "ix_gold_route_delay_by_daytype_provider_route",
        table_name="route_delay_by_daytype",
        schema="gold",
    )
    op.drop_table("route_delay_by_daytype", schema="gold")
    op.drop_index(
        "ix_gold_route_delay_by_shift_provider_route",
        table_name="route_delay_by_shift",
        schema="gold",
    )
    op.drop_table("route_delay_by_shift", schema="gold")
