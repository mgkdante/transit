"""stop_delay_shift_daily — additive STOP-DELAY shift grain (rollup_kind="stop_delay_shift_daily").

Append-only, closed-day rollup of gold.fact_trip_delay_snapshot at the shift grain
(provider_id, stop_id, route_id, service_local_date, shift) — 5 shift buckets (am_peak/midday/
pm_peak/evening/night), NOT an hour column (the hour+histogram variant is the ~9-18x cardinality
multiplier 0066 rejected on the system's highest-cardinality table; 5 buckets is only ~5x and never
approaches HARD GATE 1). Mirrors the 0065 route-headway shift-daily cardinality precedent.

The shift bucket is derived ONCE at build time from EXTRACT(HOUR FROM timezone(dp.timezone,
captured_at_utc)) via the ONE gold.reader.buckets shift CASE — byte-identical to the read-time
_SPINE_SHIFT_CASE the route projector uses — so /stop and /lines attribute the same observation to
the same shift. service_local_date = :local_date (the closed-day watermark day), matching the stop
spine's feed-based date basis while the shift derives from captured_at_utc (like the route spine
hour); mixing feed-based date with captured-based hour is the EXISTING documented spine
characteristic, replicated deliberately so parity with /lines holds.

Predicates = the same GHOST clamp (|delay| <= 3600) + delay/stop non-null + severe = delay > 300 as
UPSERT_STOP_DELAY_SPINE, so observation_count / severe_delay_count / sum_delay_seconds stay directly
comparable and SUM-over-shifts == the stop_delay_spine per-(stop,route,date) counts (a finer
partition of the same in-clamp row set). route_id is COALESCE'd to '__unrouted__' (NULL-route
per-stop totals depend on it; a real route read never matches the sentinel).

DAY-ATTRIBUTION REBASELINE: re-pointing the stop shift/day_type/dow reads off gold.stop_delay_hourly
(which timezone()-re-buckets UTC period_start_utc at read time -> wrong day/shift near local
midnight and every DST transition) onto this pre-localized service day changes count/share values at
day boundaries. This is the deliberate CORRECTION (aligning /stop with /lines), documented + allowed
per the S7-B cutover law (same class as the 0065 route-headway + 0063 spine rebaselines) — NOT the
"exact counts byte-identical" invariant.

NOT in REPORTING_AGGREGATE_TABLES — accrued history is never DELETE+UPSERT wiped; pruned at
GOLD_WARM_ROLLUP_RETENTION_DAYS (730d) via the append-only retention lists in maintenance/gold.py.
The lean guard keeps the grain to shift only: no per-hour column, no per-bin delay distribution,
and no direction split (the contract publishes only shift/day_type/dow at stop grain). Clones the
append-only lifecycle of 0063/0065/0066.

Revision ID: 0071_stop_delay_shift_daily
Revises: 0070_route_delay_spine_delayed_trip_count
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0071_stop_delay_shift_daily"
down_revision = "0070_route_delay_spine_delayed_trip_count"
branch_labels = None
depends_on = None


def _built_at_column() -> sa.Column:
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
        name="fk_gold_stop_delay_shift_daily_provider_id",
    )


def upgrade() -> None:
    op.create_table(
        "stop_delay_shift_daily",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("stop_id", sa.Text(), nullable=False),
        # route_id is COALESCE'd to the '__unrouted__' sentinel by the builder (NOT NULL PK column).
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("service_local_date", sa.Date(), nullable=False),
        # shift in {am_peak, midday, pm_peak, evening, night} — the ONE gold.reader.buckets CASE.
        sa.Column("shift", sa.Text(), nullable=False),
        # observation_count = in-clamp delay count (the WHERE clamps delay non-null + |delay|<=3600):
        # the severe-rate denominator AND the pooled-avg n, over ONE row set.
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default="0"),
        # bigint: a windowed SUM of (in-clamp magnitude 3600 x obs) overflows int4.
        sa.Column("sum_delay_seconds", sa.BigInteger(), nullable=False, server_default="0"),
        _built_at_column(),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "stop_id",
            "route_id",
            "service_local_date",
            "shift",
            name="pk_gold_stop_delay_shift_daily",
        ),
        _provider_fk(),
        schema="gold",
    )
    # The grain reads aggregate the whole-stop view (no route filter): they lead with
    # (provider, stop, date). route_id stays in the PK for spine symmetry + additive
    # cross-table parity, but the index omits it to match the read shape.
    op.create_index(
        "ix_gold_stop_delay_shift_daily_provider_stop_date",
        "stop_delay_shift_daily",
        ["provider_id", "stop_id", "service_local_date"],
        schema="gold",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gold_stop_delay_shift_daily_provider_stop_date",
        table_name="stop_delay_shift_daily",
        schema="gold",
    )
    op.drop_table("stop_delay_shift_daily", schema="gold")
