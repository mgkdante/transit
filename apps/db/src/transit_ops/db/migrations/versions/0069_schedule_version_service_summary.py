"""schedule_version_service_summary — per-GTFS-edition scheduled-service preservation.

Grain: (provider_id, dataset_version_id, route_id, day_type). dataset_version_id is the
EDITION discriminator — the whole point of the table: it captures the NEW version's scheduled
silver.calendar/trips/stop_times INSIDE refresh_gold_static, while the OLD version's silver still
exists (the deferred-prune window), so the daily loss of schedule-edition history stops. Every
existing gold rollup is built from realtime facts; NONE preserved scheduled GTFS before this.

day_type = {weekday, saturday, sunday} MEMBERSHIP, NOT a calendar partition. A service_id maps to
a day_type by its silver.calendar weekday booleans:
    weekday  = monday OR tuesday OR wednesday OR thursday OR friday
    saturday = saturday
    sunday   = sunday
A service_id can map to MULTIPLE day_types (a Mon-Sun service serves all three), so a trip on a
7-day service is counted under weekday AND saturday AND sunday. This is honest — those trips DO
run those days — and avoids fabricating a calendar expansion; but scheduled_trip_count is therefore
a per-day_type membership count, NOT a distinct-service-day total. Holidays are NOT resolved into
day_type in v1 — they are surfaced honestly via service_added_exception_count /
service_removed_exception_count (calendar_dates exception_type 1/2). Holiday resolution deferred to
GC2. Editions with a calendar_dates-only agency (empty silver.calendar) yield no day_type rows for
those routes — a known v1 gap tied to the same GC2 calendar_dates work.

Service-time handling: first/last_departure_seconds are GTFS service-seconds-since-service-midnight
computed from silver.stop_times.departure_time (TEXT "HH:MM:SS"); they can exceed 86400 for
overnight service and are stored raw (NEVER modulo 86400) so overnight last-departure stays honest,
matching gtfs/types.py parse_gtfs_service_time total_seconds semantics.

v1 folds both directions into one route x day_type row (silver.trips.direction_id is nullable and
often blank). A later direction split would need a real migration (not covered by the reserved
headway columns) — accepted for v1. scheduled_median/p10/p90_headway_min are RESERVED, always NULL
in v1; GC2 fills them via a data backfill with no migration.

Lifecycle: permanent-intent history — append-only, written by an idempotent DELETE-by-full-
dataset_version then INSERT (safe re-run of the same edition). Registered in
GOLD_APPEND_ONLY_DAILY_TABLES; NOT in GOLD_REPORTING_AGGREGATE_TABLES (never DELETE+UPSERT wiped)
and NOT in GOLD_AGGREGATE_RETENTION_COLUMNS (never pruned — permanent edition history is the point).

Revision ID: 0069_schedule_version_service_summary
Revises: 0068_route_delay_by_crowding_daily
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0069_schedule_version_service_summary"
down_revision = "0068_route_delay_by_crowding_daily"
branch_labels = None
depends_on = None


def _built_at_column() -> sa.Column:
    # Mirrors 0068_route_delay_by_crowding_daily.py.
    return sa.Column(
        "built_at_utc",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


def upgrade() -> None:
    op.create_table(
        "schedule_version_service_summary",
        sa.Column("provider_id", sa.Text(), nullable=False),
        # EDITION discriminator — mirrors silver.* / dim_* BigInteger.
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        # {weekday, saturday, sunday} membership model — a trip counts under EACH
        # day_type its service_id serves (membership, not partition).
        sa.Column("day_type", sa.Text(), nullable=False),
        sa.Column(
            "scheduled_trip_count", sa.Integer(), nullable=False, server_default="0"
        ),
        # distinct stop_id served by this route x day_type's trips.
        sa.Column("stop_count", sa.Integer(), nullable=False, server_default="0"),
        # GTFS service-seconds-since-service-midnight; can exceed 86400 (overnight);
        # NULL when no timed stop_times. Stored raw — never modulo 86400.
        sa.Column("first_departure_seconds", sa.Integer(), nullable=True),
        sa.Column("last_departure_seconds", sa.Integer(), nullable=True),
        # (last - first)/60; NULL when either bound NULL.
        sa.Column("span_minutes", sa.Integer(), nullable=True),
        sa.Column("calendar_start_date", sa.Date(), nullable=True),
        sa.Column("calendar_end_date", sa.Date(), nullable=True),
        # honest holiday/added-service signal — calendar_dates exception counts,
        # NOT resolved into day_type in v1.
        sa.Column(
            "service_added_exception_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "service_removed_exception_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        # RESERVED — always NULL in v1; GC2 fills via data backfill (no migration).
        sa.Column("scheduled_median_headway_min", sa.Integer(), nullable=True),
        sa.Column("scheduled_p10_headway_min", sa.Integer(), nullable=True),
        sa.Column("scheduled_p90_headway_min", sa.Integer(), nullable=True),
        _built_at_column(),
        sa.CheckConstraint(
            "day_type IN ('weekday', 'saturday', 'sunday')",
            name="ck_gold_schedule_version_service_summary_day_type",
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "dataset_version_id",
            "route_id",
            "day_type",
            name="pk_gold_schedule_version_service_summary",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_schedule_version_service_summary_provider_id",
        ),
        schema="gold",
    )
    # Cross-edition per-route reads.
    op.create_index(
        "ix_gold_schedule_version_service_summary_provider_route",
        "schedule_version_service_summary",
        ["provider_id", "route_id", "dataset_version_id"],
        schema="gold",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gold_schedule_version_service_summary_provider_route",
        table_name="schedule_version_service_summary",
        schema="gold",
    )
    op.drop_table("schedule_version_service_summary", schema="gold")
