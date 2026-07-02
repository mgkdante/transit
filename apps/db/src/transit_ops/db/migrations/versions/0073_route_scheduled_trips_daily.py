"""route_scheduled_trips_daily — the scheduled universe (GC2 / DB-A+ Step H1).

Adds the FIRST honest scheduled denominator to the historic cancellation surface.
Every existing cancellation number is derived from RT-observed trip-days only, so a
trip STM scheduled but never reported in ANY realtime poll is invisible: the
denominator is "trips STM reported on", never "trips STM was supposed to run". This
table materializes the scheduled universe so downstream reads can split trip-days
into delivered / explicitly-cancelled / silent (scheduled-but-never-observed).

Grain: (provider_id, provider_local_date, route_id). scheduled_trip_count = distinct
scheduled trip_id active on that CLOSED provider-local date after resolving the
canonical GTFS service-on-date rule against the CURRENT (is_current) static edition:

    service active on date D  <=>
        ( calendar row covers D  AND  weekday-boolean(isodow(D)) true
          AND NOT EXISTS calendar_dates(exception_type=2) for (service_id, D) )
        OR EXISTS calendar_dates(exception_type=1) for (service_id, D)

This inherently handles calendar_dates-only feeds (the OR branch fires with zero
silver.calendar rows) — the same gap 0069:20-21 deferred to GC2. dataset_version_id
records the edition that resolved the row (provenance): a closed date can be
re-resolved by a later edition (schedule corrections are real), so ON CONFLICT is
last-writer-wins on scheduled_trip_count + dataset_version_id.

Why per-date (not per-edition-per-dow like 0069): cancellation must join to a
SPECIFIC closed provider-local date to line up with route_cancellation_daily's
(provider_local_date) grain, and calendar_dates exceptions are inherently per-date —
a per-edition-per-dow count cannot express "service X does not run on holiday date D".
Materializing only closed dates within the retention window bounds cost; the daily
warm-rollup path builds exactly the ONE just-closed day per run (same shape as the
other _build_percentile_days consumers), and the sargable
silver.calendar_dates(dataset_version_id, service_date) index (0002:259) keeps the
exception lookup cheap.

Lifecycle: append-only daily rollup. Registered in GOLD_APPEND_ONLY_DAILY_TABLES
(never DELETE+UPSERT wiped) AND in GOLD_AGGREGATE_RETENTION_COLUMNS
(provider_local_date, date_only) so it is pruned at GOLD_WARM_ROLLUP_RETENTION_DAYS
(730d) exactly like route_cancellation_daily — UNLIKE 0069's permanent edition
history, because this is a per-date operational join partner, not edition provenance.

--- Cancellation split (same migration, additive ALTER) ---

Also ADDs three nullable columns to gold.route_cancellation_daily so the LEFT JOIN in
UPSERT_ROUTE_CANCELLATION_DAILY can carry the scheduled-aware view WITHOUT touching a
published number:
    scheduled_trip_days   = scheduled_trip_count (NULL when no scheduled rollup for
                            the date — pre-0073 history rows + editions with no silver
                            schedule; NULL means UNKNOWN, never 0).
    delivered_trip_days   = total_trip_days - canceled_trip_days (RT-observed,
                            non-cancelled).
    silent_trip_days      = GREATEST(scheduled - total_observed, 0) (scheduled but
                            never RT-observed; clamped at 0 because RT can legitimately
                            show added/unscheduled trips and a negative would be
                            dishonest — the clamp hides over-delivery, a documented
                            small honesty loss).

CUTOVER LAW (honest, no silent redefinition — DECISIONS #13): total_trip_days,
canceled_trip_days AND cancellation_rate_pct KEEP their exact old RT-observed
semantics byte-for-byte (the LEFT JOIN adds columns, it never filters the trip_day
CTE). The scheduled-aware readout is a NEW sibling field, service_completeness_pct
(= 100*delivered/scheduled, read-time), NOT a mutation of the old rate — so no
published rate rebaselines and no allowlist entry is needed. Nullable ADD COLUMN =
no history rewrite; pre-0073 rows stay NULL (unknown).

The trailing fact-retention window of route_cancellation_daily watermarks is
invalidated (mirrors 0070) so the next warm-rollup build recomputes those days and
back-fills the new scheduled/delivered/silent columns from retained facts + the
freshly-built scheduled rollup; days beyond fact retention keep NULL honestly.

Revision ID: 0073_route_scheduled_trips_daily
Revises: 0072_spine_naming_hygiene
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0073_route_scheduled_trips_daily"
down_revision = "0072_spine_naming_hygiene"
branch_labels = None
depends_on = None


def _built_at_column() -> sa.Column:
    # Mirrors 0071_stop_delay_shift_daily.py.
    return sa.Column(
        "built_at_utc",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


def _provider_fk() -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["provider_id"],
        ["core.providers.provider_id"],
        name="fk_gold_route_scheduled_trips_daily_provider_id",
    )


def upgrade() -> None:
    op.create_table(
        "route_scheduled_trips_daily",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("provider_local_date", sa.Date(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        # distinct scheduled trip_id active on the date after calendar ∩ calendar_dates.
        sa.Column(
            "scheduled_trip_count", sa.Integer(), nullable=False, server_default="0"
        ),
        # the CURRENT (is_current) edition that resolved this row (provenance;
        # last-writer-wins across edition flips).
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        _built_at_column(),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "provider_local_date",
            "route_id",
            name="pk_gold_route_scheduled_trips_daily",
        ),
        _provider_fk(),
        schema="gold",
    )

    # Cancellation split — additive nullable columns (no history rewrite; NULL =
    # unknown scheduled universe on pre-0073 rows). See module docstring CUTOVER LAW.
    op.add_column(
        "route_cancellation_daily",
        sa.Column("scheduled_trip_days", sa.Integer(), nullable=True),
        schema="gold",
    )
    op.add_column(
        "route_cancellation_daily",
        sa.Column("delivered_trip_days", sa.Integer(), nullable=True),
        schema="gold",
    )
    op.add_column(
        "route_cancellation_daily",
        sa.Column("silent_trip_days", sa.Integer(), nullable=True),
        schema="gold",
    )

    # Invalidate the trailing fact-retention window of cancellation watermarks so the
    # next warm-rollup build recomputes those days WITH the scheduled join (the daily
    # builder only builds watermark-absent days). 14 = GOLD_FACT_RETENTION_DAYS
    # default; days beyond it are unrecomputable (facts pruned) and keep NULL.
    op.execute(
        "DELETE FROM gold.warm_rollup_periods "
        "WHERE rollup_kind = 'route_cancellation_daily' "
        "AND period_start_utc >= now() - interval '14 days'"
    )


def downgrade() -> None:
    op.drop_column("route_cancellation_daily", "silent_trip_days", schema="gold")
    op.drop_column("route_cancellation_daily", "delivered_trip_days", schema="gold")
    op.drop_column("route_cancellation_daily", "scheduled_trip_days", schema="gold")
    op.drop_table("route_scheduled_trips_daily", schema="gold")
