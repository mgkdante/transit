"""drop the stop delay fold tables — superseded by gold.stop_delay_spine (DB-0067 Phase 2).

Every reader of these two per-(stop, route) fold tables now derives the same breakdown at READ
time from gold.stop_delay_spine (DB-0067 Phase 1, shipped + verified in prod first):

  build_stop_reliability   weekly/monthly/by_route periods   (trailing-7d / trailing-30d SUMs)
  build_hotspots           net_stop / stop_otp CTEs          (the stop_spine_weekly ISO-week CTE)
  UPSERT_REPEATED_PROBLEM_ROUTE_STOP  stop_week CTE          (ISO-week SUM(severe_delay_count))

so the stored marts are dead. This mirrors the route fold-table drop (migration 0064): the
finest-grain append-only spine is the single source, and the one-table-per-window sprawl is
collapsed. stop_delay_hourly (the open-window source the marts were built from, still read by the
on-the-fly shift/day-type stop grains) and every other gold family are KEPT.

The downgrade recreates the two tables as EMPTY shells from the original 0014 shape (structure
only — their UPSERT_STOP_DELAY_WEEKLY/MONTHLY producers + registry wiring were removed in the same
change, so a warm-rollup build no longer repopulates them; the spine remains the durable source).

Revision ID: 0067_drop_stop_delay_folds
Revises: 0066_stop_delay_spine
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0067_drop_stop_delay_folds"
down_revision = "0066_stop_delay_spine"
branch_labels = None
depends_on = None

# Both marts carry only their primary-key index (pk_gold_stop_delay_<grain>), which drops with
# the table — no secondary index to drop first (verified against prod pg_indexes).
_DROPPED = ("stop_delay_weekly", "stop_delay_monthly")


def upgrade() -> None:
    for table in _DROPPED:
        op.drop_table(table, schema="gold")


def _built_at() -> sa.Column:
    return sa.Column(
        "built_at_utc", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )


def _provider_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["provider_id"], ["core.providers.provider_id"], name=f"fk_gold_{table}_provider_id"
    )


def _stop_delay_fold_table(table: str, period_col: sa.Column, *pk_cols: str) -> None:
    """Recreate a stop_delay weekly/monthly shell from the 0014 column shape (empty)."""
    op.create_table(
        table,
        sa.Column("provider_id", sa.Text(), nullable=False),
        period_col,
        sa.Column("stop_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("avg_delay_seconds", sa.Numeric(12, 2), nullable=True),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        _built_at(),
        _provider_fk(table),
        sa.PrimaryKeyConstraint(*pk_cols, name=f"pk_gold_{table}"),
        schema="gold",
    )


def downgrade() -> None:
    _stop_delay_fold_table(
        "stop_delay_weekly",
        sa.Column("week_start_local", sa.Date(), nullable=False),
        "provider_id", "week_start_local", "stop_id", "route_id",
    )
    _stop_delay_fold_table(
        "stop_delay_monthly",
        sa.Column("month_start_local", sa.Date(), nullable=False),
        "provider_id", "month_start_local", "stop_id", "route_id",
    )
