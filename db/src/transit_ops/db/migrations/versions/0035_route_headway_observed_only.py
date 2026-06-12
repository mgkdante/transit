"""Drop never-written route-headway scheduled/excess columns.

Revision ID: 0035_route_headway_observed_only
Revises: 0034_trip_delay_stop_attribution
Create Date: 2026-06-12

``gold.route_headway_daily`` is a rolling-window rebuilt mart. Its runtime
upsert has only ever written observed headway and sample count; scheduled
headway and excess wait are computed at publish time by the route-reliability
snapshot builder. Dropping these dead columns keeps the schema honest without a
history backfill.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0035_route_headway_observed_only"
down_revision = "0034_trip_delay_stop_attribution"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("route_headway_daily", "scheduled_headway_min", schema="gold")
    op.drop_column("route_headway_daily", "excess_wait_min", schema="gold")


def downgrade() -> None:
    op.add_column(
        "route_headway_daily",
        sa.Column("scheduled_headway_min", sa.Numeric(), nullable=True),
        schema="gold",
    )
    op.add_column(
        "route_headway_daily",
        sa.Column("excess_wait_min", sa.Numeric(), nullable=True),
        schema="gold",
    )
