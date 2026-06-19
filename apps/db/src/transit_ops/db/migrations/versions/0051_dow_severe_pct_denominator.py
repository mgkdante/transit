"""Add delay_observation_count to route_delay_day_of_week (severe_pct denominator fix).

Revision ID: 0051_dow_severe_pct_denominator
Revises: 0050_tier2_skipped_stop
Create Date: 2026-06-19

slice-9-honesty-fixes (3/3). The gold audit found route_reliability.day_of_week
severe_pct was computed as severe / observation_count (COUNT(*) per-poll rows),
while every other grain uses severe / delay_observation_count (COUNT(delay_seconds)).
The day-of-week mart didn't carry delay_observation_count, so it was unrecoverable
downstream. This adds it; UPSERT_ROUTE_DELAY_DAY_OF_WEEK now persists
SUM(delay_observation_count) and the historic builder denominates severe_pct on it,
matching the calendar grains. The table is DELETE+UPSERT-rebuilt each warm-rollup
run, so the column populates on the next run (no backfill); server_default 0 keeps
pre-rebuild rows valid.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0051_dow_severe_pct_denominator"
down_revision = "0050_tier2_skipped_stop"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "route_delay_day_of_week",
        sa.Column(
            "delay_observation_count", sa.Integer(), nullable=False, server_default="0"
        ),
        schema="gold",
    )


def downgrade() -> None:
    op.drop_column("route_delay_day_of_week", "delay_observation_count", schema="gold")
