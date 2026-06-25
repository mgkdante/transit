"""drop the route delay-cube fold tables — superseded by gold.route_delay_spine (S7-B PR1 Task 5).

Every reader of these six per-route fold tables now derives the same breakdown at READ time
from gold.route_delay_spine (the publisher route cube + network by_shift/by_daytype, the
repeated_problem_route_stop builder's route_week CTE, build_hotspots, and route discovery), so
the stored tables are dead. Dropping them collapses the one-table-per-breakdown sprawl:

  route_delay_by_shift / by_daytype / by_shift_daytype / day_of_week  (regroups of the hourly spine)
  route_reliability_weekly / monthly                                   (ISO-week / month SUM/SUM)

route_delay_hourly (the §01 hourly feed + delayed_trip_count source), route_habit_score, the
percentile / headway / service-span / repeat-offender / occupancy / cancellation / skipped
families, and the stop_delay_* tables are KEPT. The downgrade recreates the tables as empty
shells (structure only — the next warm-rollup build would no longer repopulate them, since
their builders were removed in the same change).

Revision ID: 0064_drop_route_delay_cube_folds
Revises: 0063_route_delay_spine
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0064_drop_route_delay_cube_folds"
down_revision = "0063_route_delay_spine"
branch_labels = None
depends_on = None

# (table, drop the same-named ix_gold_<table>_provider_route?)
_DROPPED = (
    ("route_delay_by_shift", True),
    ("route_delay_by_daytype", True),
    ("route_delay_by_shift_daytype", True),
    ("route_delay_day_of_week", False),
    ("route_reliability_weekly", False),
    ("route_reliability_monthly", False),
)


def upgrade() -> None:
    for table, has_index in _DROPPED:
        if has_index:
            op.drop_index(
                f"ix_gold_{table}_provider_route", table_name=table, schema="gold"
            )
        op.drop_table(table, schema="gold")


def _built_at() -> sa.Column:
    return sa.Column(
        "built_at_utc", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )


def _provider_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["provider_id"], ["core.providers.provider_id"], name=f"fk_gold_{table}_provider_id"
    )


def _delay_grain_table(table: str, grain_col: sa.Column, *pk_cols: str) -> None:
    """Recreate a by_shift / by_daytype / by_shift_daytype shell (+ provider/route index)."""
    op.create_table(
        table,
        sa.Column("provider_id", sa.Text(), nullable=False),
        grain_col,
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("delay_observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("on_time_observation_count", sa.Integer(), nullable=True),
        sa.Column("avg_delay_seconds", sa.Numeric(), nullable=True),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default="0"),
        _built_at(),
        sa.PrimaryKeyConstraint(*pk_cols, name=f"pk_gold_{table}"),
        _provider_fk(table),
        schema="gold",
    )
    op.create_index(
        f"ix_gold_{table}_provider_route", table, ["provider_id", "route_id"], schema="gold"
    )


def _reliability_table(table: str, period_col: sa.Column, *pk_cols: str) -> None:
    op.create_table(
        table,
        sa.Column("provider_id", sa.Text(), nullable=False),
        period_col,
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("avg_delay_seconds", sa.Numeric(), nullable=True),
        sa.Column("delayed_trip_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default="0"),
        _built_at(),
        sa.Column("delay_observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("on_time_observation_count", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint(*pk_cols, name=f"pk_gold_{table}"),
        _provider_fk(table),
        schema="gold",
    )


def downgrade() -> None:
    _delay_grain_table(
        "route_delay_by_shift",
        sa.Column("shift", sa.Text(), nullable=False),
        "provider_id", "shift", "route_id",
    )
    _delay_grain_table(
        "route_delay_by_daytype",
        sa.Column("day_type", sa.Text(), nullable=False),
        "provider_id", "day_type", "route_id",
    )
    op.create_table(
        "route_delay_by_shift_daytype",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("shift", sa.Text(), nullable=False),
        sa.Column("day_type", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("delay_observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("on_time_observation_count", sa.Integer(), nullable=True),
        sa.Column("avg_delay_seconds", sa.Numeric(), nullable=True),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default="0"),
        _built_at(),
        sa.PrimaryKeyConstraint(
            "provider_id", "shift", "day_type", "route_id",
            name="pk_gold_route_delay_by_shift_daytype",
        ),
        _provider_fk("route_delay_by_shift_daytype"),
        schema="gold",
    )
    op.create_index(
        "ix_gold_route_delay_by_shift_daytype_provider_route",
        "route_delay_by_shift_daytype", ["provider_id", "route_id"], schema="gold",
    )
    op.create_table(
        "route_delay_day_of_week",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("day_of_week_iso", sa.Integer(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("trip_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("avg_delay_seconds", sa.Numeric(), nullable=True),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default="0"),
        _built_at(),
        sa.Column("delay_observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint(
            "provider_id", "day_of_week_iso", "route_id", name="pk_gold_route_delay_day_of_week"
        ),
        _provider_fk("route_delay_day_of_week"),
        schema="gold",
    )
    _reliability_table(
        "route_reliability_weekly",
        sa.Column("week_start_local", sa.Date(), nullable=False),
        "provider_id", "week_start_local", "route_id",
    )
    _reliability_table(
        "route_reliability_monthly",
        sa.Column("month_start_local", sa.Date(), nullable=False),
        "provider_id", "month_start_local", "route_id",
    )
