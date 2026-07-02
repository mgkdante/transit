"""repeat_offender_daily_spine — daily per-entity offender spine (rollup_kind="repeat_offender_daily_spine").

Append-only, closed-day daily spine of gold.fact_trip_delay_snapshot at the finest per-entity
grain the offender surface needs: (provider_id, entity_kind, entity_id, route_id,
provider_local_date). entity_kind is 'trip' | 'vehicle' — the two offender kinds the scalar mart
gold.repeat_offender already ranks (trip_id / vehicle_id). A row is written for every
entity-day that HAS observations; each carries the three additive daily measures the windowed
by_grain ladders SUM over trailing week/month windows:
  * observation_count  = the in-clamp delay COUNT(*) (the severe-rate denominator AND the
    pooled-avg n, over ONE row set),
  * severe_delay_count = COUNT(*) FILTER (delay_seconds > 300) (severe = the same >300s
    threshold the mart uses for recurrence_days),
  * sum_delay_seconds  = SUM(delay_seconds) (BigInteger — a windowed SUM of in-clamp
    magnitude 3600 x obs overflows int4), the pooled numerator for the rebaselined avg.

FACT PREDICATES — BYTE-IDENTICAL to the scalar mart (UPSERT_REPEAT_OFFENDER_DAILY,
gold/rollups.py): delay_seconds IS NOT NULL AND ABS(delay_seconds) <= 3600 (GHOST clamp) AND
route_id IS NOT NULL. The mart's per-kind grain is (route_id, entity_id); the spine keeps the
same grain per day, so the mart's per-entity aggregates are exactly a SUM of the spine's daily
rows over the same window + predicate set.

PARITY INVARIANT (BY CONSTRUCTION): the mart's recurrence_days for an entity ==
COUNT(DISTINCT provider_local_date WHERE severe_delay_count > 0) over the spine's rows in the
SAME trailing 14d window. The mart computes recurrence_days as
COUNT(DISTINCT local_day) FILTER (WHERE delay_seconds > 300); a spine day has
severe_delay_count > 0 iff it had >=1 severe observation, so counting distinct such spine days
reproduces the mart's distinct-severe-day count exactly (same clamp, same route-not-null filter,
same severe threshold). The read-side by_grain builder recomposes recurrence_days this way and a
real-DB test pins the equality (test_windowable_repeat_offenders_realdb). local_day derivation
matches the mart: timezone(dp.timezone, captured_at_utc)::date — but the spine builder binds the
closed-day :local_date/:date_key of _build_percentile_days for a SARGABLE per-day scan, so each
day materializes exactly the closed day the watermark advances over (the mart's now()-14d window
and the spine's per-day accrual cover the same closed days once ~14d have accrued).

14d-BACKFILL HONESTY BOUNDARY: gold.fact_trip_delay_snapshot retains only
GOLD_FACT_RETENTION_DAYS (14d default), so the FIRST build backfills at most the trailing 14
closed days. The by_grain WEEK window (trailing 7d) is fully covered from ~day 7; the MONTH
window (trailing 30d) is PARTIAL until ~30d of spine history has accrued forward past the 14d
fact horizon (the accrued spine outlives the fact it was built from). This is the deliberate,
documented boundary — same class as the 0070 delayed_trip_count backfill note: month-window
values ramp in honestly rather than fabricating pre-accrual history. The read builder OMITS a
grain entirely when the spine has no rows in its window (honest absence, never a zero).

BYTE BUDGET: at prod scale the spine writes ~one row per (offender entity, route, day). STM has
~5-10k distinct (trip|vehicle, route) pairs observed per day, so ~10k rows/day — in line with
gold.stop_delay_spine's per-(stop,route,day) cardinality. At 730d retention that is ~7.3M rows x
~90 bytes/row ≈ ~660 MB + ~30% for the (provider, date) index ≈ ~860 MB, within the append-only
budget (route_delay_spine at route x hour x direction is already larger). Cited from 0074's
byte-budget convention.

LIFECYCLE: NOT in REPORTING_AGGREGATE_TABLES — accrued history is never DELETE+UPSERT wiped;
built forward per closed day by _build_percentile_days (watermarked in gold.warm_rollup_periods,
resumable across runs) and pruned at GOLD_WARM_ROLLUP_RETENTION_DAYS (730d) via the append-only
retention lists in maintenance/gold.py (GOLD_APPEND_ONLY_DAILY_TABLES +
GOLD_AGGREGATE_RETENTION_COLUMNS). Clones the append-only lifecycle of 0063/0071 (spines).
Reversible: downgrade drops the index then the table. The scalar mart gold.repeat_offender is
UNCHANGED — it still feeds the scalar offenders[] list and stays ROLLING_WINDOW.

Revision ID: 0075_repeat_offender_daily_spine
Revises: 0074_route_occupancy_band_hourly
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0075_repeat_offender_daily_spine"
down_revision = "0074_route_occupancy_band_hourly"
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
        name="fk_gold_repeat_offender_daily_spine_provider_id",
    )


def upgrade() -> None:
    op.create_table(
        "repeat_offender_daily_spine",
        sa.Column("provider_id", sa.Text(), nullable=False),
        # entity_kind in {trip, vehicle} — the two offender kinds the mart ranks.
        sa.Column("entity_kind", sa.Text(), nullable=False),
        sa.Column("entity_id", sa.Text(), nullable=False),
        # route_id is NOT NULL by the fact predicate (route_id IS NOT NULL, same as the mart):
        # offenders are always route-attributed, so no '__unrouted__' sentinel is needed here.
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("provider_local_date", sa.Date(), nullable=False),
        # observation_count = in-clamp delay count (the WHERE clamps delay non-null + |delay|<=3600):
        # the severe-rate denominator AND the pooled-avg n, over ONE row set.
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default="0"),
        # bigint: a windowed SUM of (in-clamp magnitude 3600 x obs) overflows int4.
        sa.Column("sum_delay_seconds", sa.BigInteger(), nullable=False, server_default="0"),
        _built_at_column(),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "entity_kind",
            "entity_id",
            "route_id",
            "provider_local_date",
            name="pk_gold_repeat_offender_daily_spine",
        ),
        _provider_fk(),
        schema="gold",
    )
    # The by_grain reads SUM every entity-day across a trailing (provider, date) window
    # (no entity filter): they lead with (provider, date). The full entity grain stays in
    # the PK for daily idempotency; the index matches the windowed read shape.
    op.create_index(
        "ix_gold_repeat_offender_daily_spine_provider_date",
        "repeat_offender_daily_spine",
        ["provider_id", "provider_local_date"],
        schema="gold",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gold_repeat_offender_daily_spine_provider_date",
        table_name="repeat_offender_daily_spine",
        schema="gold",
    )
    op.drop_table("repeat_offender_daily_spine", schema="gold")
