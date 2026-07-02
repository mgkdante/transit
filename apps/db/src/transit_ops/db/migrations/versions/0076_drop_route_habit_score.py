"""drop gold.route_habit_score — one reconciled repeat_problem_score, recomposed at read time (S14).

The whole-history route_habit_score mart stored ONE copy of the composite repeat_problem_score
(severe*10 + pooled-in-clamp-mean/60, clamped) per (route, ISO-dow, hour). Its ONLY reader was the
scalar RouteReliability.habits matrix (the 'route.habit.score' read). S14 reconciled the score to a
SINGLE reader-owned formula (gold/reader/score.py) and re-pointed that scalar read onto the SAME
gold/reader ROUTE_HABIT_SPINE_SQL used by the windowed habits_by_grain ladders, bound to an
ALL-TIME window (epoch floor → the route's spine anchor). The re-pointed read is byte/value-parity
with the mart for identical spine content — proven by tests/test_habit_score_reconciliation_realdb
(embeds a FROZEN copy of the old mart SQL, asserts cell-for-cell numeric equality, with a
/60-divisor mutation-killer). So the stored mart is now dead.

LOSS-FREE: route_habit_score was a DERIVED_REBUILD table — fully rebuilt each warm-rollup run from
gold.route_delay_spine, holding no history the spine does not. Its UPSERT_ROUTE_HABIT_SCORE producer
+ every registry wiring (REPORTING_AGGREGATE_TABLES / REPORTING_AGGREGATE_UPSERTS /
DERIVED_REBUILD_TABLES, the maintenance retention row + append-only registry, the source-factory
catalog gold_outputs + reset list) were removed in the same change, so a warm-rollup build no longer
repopulates it and the spine remains the durable source. This mirrors the route/stop fold-table
drops (migrations 0064 / 0067): the finest-grain append-only spine is the single source of truth and
the derived mart is collapsed away.

The downgrade recreates gold.route_habit_score as an EMPTY shell from the original 0014 shape
(structure only — its producer + wiring are gone, so it stays empty until a manual rebuild; the
spine remains the durable source).

Revision ID: 0076_drop_route_habit_score
Revises: 0075_repeat_offender_daily_spine
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0076_drop_route_habit_score"
down_revision = "0075_repeat_offender_daily_spine"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("route_habit_score", schema="gold")


def downgrade() -> None:
    # Recreate the empty shell from the original 0014 shape (no index — 0014 created none).
    op.create_table(
        "route_habit_score",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("day_of_week_iso", sa.Integer(), nullable=False),
        sa.Column("hour_of_day_local", sa.Integer(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("avg_delay_seconds", sa.Numeric(12, 2), nullable=True),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("repeat_problem_score", sa.Numeric(8, 4), nullable=True),
        sa.Column(
            "built_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_route_habit_score_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "route_id",
            "day_of_week_iso",
            "hour_of_day_local",
            name="pk_gold_route_habit_score",
        ),
        schema="gold",
    )
