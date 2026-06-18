"""Tier-2 (cheap): headway regularity CoV/bunching + per-route service-span/first-last.

Revision ID: 0049_tier2_headway_cov_service_span
Revises: 0048_tier1_cancellation_occupancy_rollups
Create Date: 2026-06-18

Two metrics, no fact-table change:
  - Headway regularity: ride-along columns on the EXISTING route_headway_daily
    (a rolling-window DELETE+UPSERT mart already rebuilt each run from the same
    14d trip-start gap series). headway_cov = stddev/mean of gaps; bunched_count =
    gaps under half the shift median. Computed in the same gaps CTE — zero new
    fact reads, no new pruned table.
  - route_service_span_daily: APPEND-ONLY closed-day table (the 0046 model) giving
    per-route first/last observed trip-start, service span, and first/last trip
    punctuality. Accrues 365d forward; pruned in maintenance/gold.py.

Alert cause/effect/duration breakdown (the third Tier-2-cheap metric) needs no
schema — it is computed at snapshot-build time over the existing alert view.

Alembic migration modules are independent — _built_at_column / _provider_fk are
re-declared here rather than imported from an earlier revision.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0049_tier2_headway_cov_service_span"
down_revision = "0048_tier1_cancellation_occupancy_rollups"
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
    # Headway regularity — ride-along columns on the rolling-window mart.
    op.add_column(
        "route_headway_daily",
        sa.Column("headway_cov", sa.Numeric(6, 4), nullable=True),
        schema="gold",
    )
    op.add_column(
        "route_headway_daily",
        sa.Column("bunched_count", sa.Integer(), nullable=False, server_default="0"),
        schema="gold",
    )

    # Per-route service span — append-only closed-day reduction. Grain is
    # route x provider_local_date (NOT x service_day_kind): the closed-day calendar
    # attributes by captured-date, so weekday/weekend is derived at read time from
    # the date to avoid a captured-date-vs-start_date grain ambiguity.
    op.create_table(
        "route_service_span_daily",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("provider_local_date", sa.Date(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("first_trip_start_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_trip_start_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("service_span_min", sa.Integer(), nullable=True),
        sa.Column("first_trip_delay_seconds", sa.Integer(), nullable=True),
        sa.Column("last_trip_delay_seconds", sa.Integer(), nullable=True),
        sa.Column("trip_count", sa.Integer(), nullable=False, server_default="0"),
        _built_at_column(),
        _provider_fk("route_service_span_daily"),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "provider_local_date",
            "route_id",
            name="pk_gold_route_service_span_daily",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_route_service_span_daily_provider_route_date",
        "route_service_span_daily",
        ["provider_id", "route_id", "provider_local_date"],
        schema="gold",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gold_route_service_span_daily_provider_route_date",
        table_name="route_service_span_daily",
        schema="gold",
    )
    op.drop_table("route_service_span_daily", schema="gold")

    op.drop_column("route_headway_daily", "bunched_count", schema="gold")
    op.drop_column("route_headway_daily", "headway_cov", schema="gold")
