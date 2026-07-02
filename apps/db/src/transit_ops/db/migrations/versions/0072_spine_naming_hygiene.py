"""naming hygiene on the S7-close gold spine — service_local_date → provider_local_date + drop one dead view (GC1 / Step G5).

Two pure-hygiene DDL actions, one reviewable unit:

(a) RENAME the provider-local calendar-day column service_local_date →
    provider_local_date on the four S7-era spine tables:
      gold.route_delay_spine         [0063]
      gold.route_headway_shift_daily [0065]
      gold.stop_delay_spine          [0066]
      gold.stop_delay_shift_daily    [0071]
    Every OTHER daily gold table already names this column provider_local_date
    (15 migrations; the most-recent daily table 0068 chose it). It is the
    provider-local calendar day derived from the provider timezone — NOT a GTFS
    service_date — so provider_local_date is the honest majority name. This is a
    PURE identifier rename: PG column rename is metadata-only (instant, no table
    rewrite, safe under active append-only writes). Indexes and PKs reference
    columns positionally in the PG catalog, so pk_gold_*_spine and
    ix_gold_*_provider_route_date survive unchanged (no index rebuild). Zero data
    movement, zero count/share/avg/percentile change → the S7-B cutover law is not
    triggered (published VALUES are byte-identical; only column identifiers move).
    The code sweep + this DDL ship together (single atomic deploy): between the
    rename and the code deploy any spine upsert/read on the old identifier errors.

(d) DROP the dead view gold.trip_delay_summary_5m_live (0019, last redefined at
    0033). Post-S7-close it has ZERO src readers (grep src/ excluding migrations =
    none). Its downstream view current_vehicle_map_with_status (0020) reads
    current_vehicle_map + current_trip_delay_computed, NOT this view. Only test
    files exercised it (removed/re-pointed in the same change). The downgrade
    recreates it verbatim from the 0033 head definition for full reversibility.

DEFERRED (documented, NOT done here):
  - per-grain watermark column: the daily percentile watermark is shared infra
    keyed by rollup_kind in gold.warm_rollup_periods.period_start_utc (an
    explicitly-documented overload, rollups.py), not a spine column — adding a
    per-table column would touch all ~11 daily kinds for a documentation nicety.
  - direction −1 sentinel: the spine builders write COALESCE(direction_id, 0) to
    keep sum-across-direction folds byte-identical with the legacy builder
    (0063 concession). No reader branches on the value; re-keying to admit -1
    would break that byte-parity for zero read-side benefit.
  - the SECOND audit-flagged view gold.fact_stop_time_delay_observation is NOT
    dead: source_factory/validation.py has a LIVE reconciliation read and
    catalog.py declares it a gold_outputs member for two source families. KEPT.
  - snapshot_local_date on the FACT tables is out of scope (note only).

Revision ID: 0072_spine_naming_hygiene
Revises: 0071_stop_delay_shift_daily
"""

from __future__ import annotations

from alembic import op

revision = "0072_spine_naming_hygiene"
down_revision = "0071_stop_delay_shift_daily"
branch_labels = None
depends_on = None

# The four S7-era spine tables that named the provider-local calendar day
# service_local_date. Renamed to provider_local_date to match every other daily
# gold table. Metadata-only alter — PKs/indexes reference columns positionally so
# they survive without a rebuild.
_RENAMED_SPINE_TABLES = (
    "route_delay_spine",
    "route_headway_shift_daily",
    "stop_delay_spine",
    "stop_delay_shift_daily",
)


# Dead view — recreated on downgrade verbatim from the 0033 head definition.
_CREATE_TRIP_DELAY_SUMMARY_5M_LIVE = """
CREATE OR REPLACE VIEW gold.trip_delay_summary_5m_live AS
SELECT
    provider_id,
    DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01') AS period_start_utc,
    COALESCE(route_id, '__unrouted__') AS route_id,
    COUNT(DISTINCT trip_id)::integer AS trip_count,
    COUNT(*)::integer AS observation_count,
    COUNT(delay_seconds)::integer AS delay_observation_count,
    AVG(delay_seconds::numeric) AS avg_delay_seconds,
    AVG(delay_seconds::numeric) FILTER (WHERE ABS(delay_seconds) <= 3600)
        AS avg_delay_seconds_capped,
    MAX(delay_seconds) AS max_delay_seconds,
    MIN(delay_seconds) AS min_delay_seconds,
    COUNT(DISTINCT trip_id) FILTER (WHERE delay_seconds > 0)::integer
        AS delayed_trip_count,
    COUNT(*) FILTER (WHERE ABS(delay_seconds) > 3600)::integer AS outlier_count,
    now() AS built_at_utc,
    COUNT(*) FILTER (WHERE delay_seconds >= -60 AND delay_seconds < 300)::integer
        AS on_time_observation_count,
    MAX(delay_seconds) FILTER (WHERE ABS(delay_seconds) <= 3600)
        AS max_delay_seconds_capped,
    COUNT(*) FILTER (WHERE delay_seconds > 300 AND ABS(delay_seconds) <= 3600)::integer
        AS severe_delay_observation_count
FROM gold.fact_trip_delay_snapshot
WHERE captured_at_utc >= now() - INTERVAL '24 hours'
GROUP BY provider_id,
         DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01'),
         COALESCE(route_id, '__unrouted__')
"""


def upgrade() -> None:
    for table in _RENAMED_SPINE_TABLES:
        op.alter_column(
            table,
            "service_local_date",
            new_column_name="provider_local_date",
            schema="gold",
        )
    op.execute("DROP VIEW IF EXISTS gold.trip_delay_summary_5m_live")


def downgrade() -> None:
    op.execute(_CREATE_TRIP_DELAY_SUMMARY_5M_LIVE)
    for table in _RENAMED_SPINE_TABLES:
        op.alter_column(
            table,
            "provider_local_date",
            new_column_name="service_local_date",
            schema="gold",
        )
