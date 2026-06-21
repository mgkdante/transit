"""Tier-3 route delay crosstab: gold.route_delay_by_shift_daytype.

Revision ID: 0058_route_delay_by_shift_daytype_crosstab
Revises: 0057_citizen_accountability_null_affected
Create Date: 2026-06-21

A 2D sibling of the 1D route_delay_by_shift / route_delay_by_daytype granularity
tables (migration 0047): the SAME metric column set, but keyed on BOTH the
time-of-day shift AND the weekday/weekend day_type. Built in build_warm_rollups
as a DELETE+UPSERT derived table that regroups gold.route_delay_hourly by route +
shift + day_type (reusing the exact shift/day_type derivations the 1D upserts use,
so the 2D cells are consistent with the 1D ones). Surfaced as ADDITIVE
RouteReliability.by_shift_daytype crosstab cells (no breaking /v1 contract change).

Alembic migration modules are independent — the _built_at_column / _provider_fk
helpers are re-declared here rather than imported from 0014/0047.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0058_route_delay_by_shift_daytype_crosstab"
down_revision = "0057_citizen_accountability_null_affected"
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


def upgrade() -> None:
    op.create_table(
        "route_delay_by_shift_daytype",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("shift", sa.Text(), nullable=False),
        sa.Column("day_type", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("delay_observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("on_time_observation_count", sa.Integer(), nullable=True),
        sa.Column("avg_delay_seconds", sa.Numeric(12, 2), nullable=True),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default="0"),
        _built_at_column(),
        _provider_fk("route_delay_by_shift_daytype"),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "shift",
            "day_type",
            "route_id",
            name="pk_gold_route_delay_by_shift_daytype",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_route_delay_by_shift_daytype_provider_route",
        "route_delay_by_shift_daytype",
        ["provider_id", "route_id"],
        schema="gold",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gold_route_delay_by_shift_daytype_provider_route",
        table_name="route_delay_by_shift_daytype",
        schema="gold",
    )
    op.drop_table("route_delay_by_shift_daytype", schema="gold")
