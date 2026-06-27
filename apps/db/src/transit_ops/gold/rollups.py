from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.engine import Engine

from transit_ops.db.connection import make_engine
from transit_ops.ingestion.common import utc_now
from transit_ops.settings import Settings, get_settings

logger = logging.getLogger(__name__)


def provider_is_seeded(conn, provider_id: str) -> bool:  # noqa: ANN001
    """Return True if the provider has a ``gold.dim_provider`` row.

    Multi-provider: a provider can be *enrolled* (registered in the provider
    registry / has a YAML manifest, so ``list-providers`` returns it) yet never
    *seeded* (its static pipeline has never run, so there is no
    ``gold.dim_provider`` row). Per-provider gold steps that look up the provider
    calendar (e.g. ``build_warm_rollups`` via ``dp.timezone``) crash with
    ``NoResultFound`` on such a provider. This cheap EXISTS probe lets each
    entry point skip an unseeded provider gracefully instead of aborting the
    whole all-providers run.

    Accepts either a live Connection or an Engine; a bare Engine is opened in a
    short-lived ``connect()`` block.
    """
    sql = text("SELECT 1 FROM gold.dim_provider WHERE provider_id = :provider_id LIMIT 1")
    params = {"provider_id": provider_id}
    if isinstance(conn, Engine):
        with conn.connect() as connection:
            return connection.execute(sql, params).scalar_one_or_none() is not None
    return conn.execute(sql, params).scalar_one_or_none() is not None


SEVERE_DELAY_SECONDS = 300
GHOST_DELAY_ABS_SECONDS = 3600
OPEN_WINDOW_HOURLY_CUTOFF_SQL = (
    "date_trunc('hour', CAST(:built_at_utc AS timestamptz)) "
    "- make_interval(days => :open_window_days)"
)

# ---------------------------------------------------------------------------
# SQL — missing period detection
# ---------------------------------------------------------------------------

SELECT_MISSING_TRIP_DELAY_PERIODS = text(
    """
    SELECT DISTINCT
        DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01') AS period_start_utc
    FROM gold.fact_trip_delay_snapshot
    WHERE provider_id = :provider_id
      AND (
          CAST(:since_utc AS timestamptz) IS NULL
          OR captured_at_utc >= CAST(:since_utc AS timestamptz)
      )
      AND DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01') NOT IN (
          SELECT period_start_utc
          FROM gold.warm_rollup_periods
          WHERE provider_id = :provider_id
            AND rollup_kind = 'trip_delay_summary_5m'
      )
    ORDER BY 1
    """
)

# ---------------------------------------------------------------------------
# SQL — upserts
# ---------------------------------------------------------------------------

UPSERT_TRIP_DELAY_SUMMARY_5M = text(
    f"""
    INSERT INTO gold.trip_delay_summary_5m (
        provider_id,
        period_start_utc,
        route_id,
        trip_count,
        observation_count,
        delay_observation_count,
        on_time_observation_count,
        avg_delay_seconds,
        avg_delay_seconds_capped,
        max_delay_seconds,
        max_delay_seconds_capped,
        min_delay_seconds,
        delayed_trip_count,
        outlier_count,
        severe_delay_observation_count,
        built_at_utc
    )
    SELECT
        provider_id,
        DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01'),
        COALESCE(route_id, '__unrouted__'),
        COUNT(DISTINCT trip_id)::integer,
        COUNT(*)::integer,
        COUNT(delay_seconds)::integer,
        COUNT(*) FILTER (WHERE delay_seconds >= -60 AND delay_seconds < 300)::integer,
        AVG(delay_seconds::numeric),
        AVG(delay_seconds::numeric) FILTER (WHERE ABS(delay_seconds) <= 3600),
        MAX(delay_seconds),
        MAX(delay_seconds) FILTER (WHERE ABS(delay_seconds) <= 3600),
        MIN(delay_seconds),
        COUNT(DISTINCT trip_id) FILTER (WHERE delay_seconds > 0)::integer,
        COUNT(*) FILTER (WHERE ABS(delay_seconds) > 3600)::integer,
        COUNT(*) FILTER (
            WHERE delay_seconds > {SEVERE_DELAY_SECONDS}
              AND ABS(delay_seconds) <= {GHOST_DELAY_ABS_SECONDS}
        )::integer,
        :built_at_utc
    FROM gold.fact_trip_delay_snapshot
    WHERE provider_id = :provider_id
      -- Sargable range bound (logically identical to the DATE_BIN bin, but
      -- index-usable on (provider_id, captured_at_utc)) so a per-period upsert is
      -- an index range scan of one 5-min slice, NOT a full seq scan of the fact.
      AND captured_at_utc >= :period_start_utc
      AND captured_at_utc < :period_start_utc + INTERVAL '5 minutes'
      AND DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01') = :period_start_utc
    GROUP BY 1, 2, 3
    ON CONFLICT (provider_id, period_start_utc, route_id) DO UPDATE SET
        trip_count              = EXCLUDED.trip_count,
        observation_count       = EXCLUDED.observation_count,
        delay_observation_count = EXCLUDED.delay_observation_count,
        on_time_observation_count = EXCLUDED.on_time_observation_count,
        avg_delay_seconds       = EXCLUDED.avg_delay_seconds,
        avg_delay_seconds_capped = EXCLUDED.avg_delay_seconds_capped,
        max_delay_seconds       = EXCLUDED.max_delay_seconds,
        max_delay_seconds_capped = EXCLUDED.max_delay_seconds_capped,
        min_delay_seconds       = EXCLUDED.min_delay_seconds,
        delayed_trip_count      = EXCLUDED.delayed_trip_count,
        outlier_count           = EXCLUDED.outlier_count,
        severe_delay_observation_count = EXCLUDED.severe_delay_observation_count,
        built_at_utc            = EXCLUDED.built_at_utc
    """
)

UPSERT_WARM_ROLLUP_PERIOD = text(
    """
    INSERT INTO gold.warm_rollup_periods (
        provider_id, rollup_kind, period_start_utc, built_at_utc
    )
    VALUES (
        :provider_id, :rollup_kind, :period_start_utc, :built_at_utc
    )
    ON CONFLICT (provider_id, rollup_kind, period_start_utc) DO UPDATE SET
        built_at_utc = EXCLUDED.built_at_utc
    """
)

# Append-only daily percentile rollup (route + stop). One row per CLOSED,
# fully-retained provider-local day, computed from that day's facts. Percentiles
# are NOT additively composable, so they can't be derived from the 5m rollups —
# this is the only source of per-route/per-stop p50/p90 with history beyond the
# 14d fact window. The missing-day calendar is enumerated by the indexed,
# provider-local snapshot_date_key (YYYYMMDD) over a sargable [:floor_key,
# :today_key) window — an index range scan, NOT a full-table timezone() scan of
# every fact row. :floor_key (= today_local - (fact_retention_days - 1)) keeps
# the oldest candidate day from being computed over partially-pruned facts on a
# cold start; :today_key (= today_local) excludes the still-open current day. In
# steady state each day is built the day after it closes, intact.
SELECT_MISSING_PERCENTILE_DAYS = text(
    """
    SELECT DISTINCT
        f.snapshot_local_date AS local_date,
        f.snapshot_date_key AS date_key
    FROM gold.fact_trip_delay_snapshot AS f
    WHERE f.provider_id = :provider_id
      AND f.snapshot_date_key >= :floor_key
      AND f.snapshot_date_key < :today_key
      AND timezone('UTC', f.snapshot_local_date::timestamp) NOT IN (
          SELECT period_start_utc
          FROM gold.warm_rollup_periods
          WHERE provider_id = :provider_id
            AND rollup_kind = :rollup_kind
      )
    ORDER BY f.snapshot_local_date
    """
)

# Sibling of SELECT_MISSING_PERCENTILE_DAYS that scans gold.fact_vehicle_snapshot
# instead of fact_trip_delay_snapshot. Occupancy lives ONLY on the vehicle fact,
# and the two fact tables prune independently — enumerating the missing-day
# calendar against the vehicle fact keeps the watermark + cold-start lookback
# bound aligned with the actual occupancy data source, so a day with trip-delay
# facts but no vehicle facts is never watermarked-built with an empty reduction.
SELECT_MISSING_OCCUPANCY_DAYS = text(
    """
    SELECT DISTINCT
        f.snapshot_local_date AS local_date,
        f.snapshot_date_key AS date_key
    FROM gold.fact_vehicle_snapshot AS f
    WHERE f.provider_id = :provider_id
      AND f.snapshot_date_key >= :floor_key
      AND f.snapshot_date_key < :today_key
      AND timezone('UTC', f.snapshot_local_date::timestamp) NOT IN (
          SELECT period_start_utc
          FROM gold.warm_rollup_periods
          WHERE provider_id = :provider_id
            AND rollup_kind = :rollup_kind
      )
    ORDER BY f.snapshot_local_date
    """
)

UPSERT_ROUTE_DELAY_PERCENTILE_DAILY = text(
    f"""
    INSERT INTO gold.route_delay_percentile_daily (
        provider_id, provider_local_date, route_id,
        delay_observation_count, p50_delay_seconds, p90_delay_seconds, built_at_utc
    )
    SELECT
        f.provider_id,
        :local_date,
        f.route_id,
        COUNT(*)::integer,
        ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY f.delay_seconds)::numeric, 2),
        ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY f.delay_seconds)::numeric, 2),
        :built_at_utc
    FROM gold.fact_trip_delay_snapshot AS f
    WHERE f.provider_id = :provider_id
      AND f.route_id IS NOT NULL
      AND f.delay_seconds IS NOT NULL
      AND ABS(f.delay_seconds) <= {GHOST_DELAY_ABS_SECONDS}
      AND f.snapshot_date_key = :date_key
    GROUP BY f.provider_id, f.route_id
    ON CONFLICT (provider_id, provider_local_date, route_id) DO UPDATE SET
        delay_observation_count = EXCLUDED.delay_observation_count,
        p50_delay_seconds = EXCLUDED.p50_delay_seconds,
        p90_delay_seconds = EXCLUDED.p90_delay_seconds,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

UPSERT_STOP_DELAY_PERCENTILE_DAILY = text(
    f"""
    INSERT INTO gold.stop_delay_percentile_daily (
        provider_id, provider_local_date, stop_id,
        delay_observation_count, p50_delay_seconds, p90_delay_seconds, built_at_utc
    )
    SELECT
        f.provider_id,
        :local_date,
        f.delay_stop_id,
        COUNT(*)::integer,
        ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY f.delay_seconds)::numeric, 2),
        ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY f.delay_seconds)::numeric, 2),
        :built_at_utc
    FROM gold.fact_trip_delay_snapshot AS f
    WHERE f.provider_id = :provider_id
      AND f.delay_stop_id IS NOT NULL
      AND f.delay_seconds IS NOT NULL
      AND ABS(f.delay_seconds) <= {GHOST_DELAY_ABS_SECONDS}
      AND f.snapshot_date_key = :date_key
    GROUP BY f.provider_id, f.delay_stop_id
    ON CONFLICT (provider_id, provider_local_date, stop_id) DO UPDATE SET
        delay_observation_count = EXCLUDED.delay_observation_count,
        p50_delay_seconds = EXCLUDED.p50_delay_seconds,
        p90_delay_seconds = EXCLUDED.p90_delay_seconds,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

# Per-route daily cancellation rate over one CLOSED provider-local day. A trip-day
# is a DISTINCT (trip_id, start_date); the inner GROUP BY + MAX collapses per-poll
# over-count, so a trip seen in many polls counts once and counts canceled if it
# was EVER observed with trip_schedule_relationship=3. GTFS-RT omits the field for
# scheduled trips (silver stores NULL); COALESCE(...,0) treats NULL as a normal
# (non-canceled) trip-day so the denominator is NOT filtered down to only
# explicitly-tagged trips — otherwise the rate would be systematically inflated.
# Binds exactly {provider_id, local_date, built_at_utc} so it drops into
# _build_percentile_days unchanged.
UPSERT_ROUTE_CANCELLATION_DAILY = text(
    """
    WITH trip_day AS (
        SELECT
            f.provider_id,
            f.route_id,
            f.trip_id,
            f.start_date AS service_date,
            MAX((COALESCE(f.trip_schedule_relationship, 0) = 3)::int) AS was_canceled
        FROM gold.fact_trip_delay_snapshot AS f
        WHERE f.provider_id = :provider_id
          AND f.route_id IS NOT NULL
          AND f.trip_id IS NOT NULL
          AND f.start_date IS NOT NULL
          AND f.snapshot_date_key = :date_key
        GROUP BY f.provider_id, f.route_id, f.trip_id, f.start_date
    )
    INSERT INTO gold.route_cancellation_daily (
        provider_id, provider_local_date, route_id,
        total_trip_days, canceled_trip_days, cancellation_rate_pct, built_at_utc
    )
    SELECT
        provider_id,
        :local_date,
        route_id,
        COUNT(*)::integer,
        COUNT(*) FILTER (WHERE was_canceled = 1)::integer,
        ROUND(100.0 * COUNT(*) FILTER (WHERE was_canceled = 1) / NULLIF(COUNT(*), 0), 2),
        :built_at_utc
    FROM trip_day
    GROUP BY provider_id, route_id
    ON CONFLICT (provider_id, provider_local_date, route_id) DO UPDATE SET
        total_trip_days = EXCLUDED.total_trip_days,
        canceled_trip_days = EXCLUDED.canceled_trip_days,
        cancellation_rate_pct = EXCLUDED.cancellation_rate_pct,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

# Append-only daily reduction of occupancy band counts for one CLOSED local day,
# summed straight from fact_vehicle_snapshot (single read, same shape as the
# percentile daily upserts). Counts are additively composable, so shift/hour/
# weekly band-SHARES are derived at read time without re-reading pruned facts.
# observation_count = band-bearing pings (codes 0-5); the five band counts sum to
# it. Binds {provider_id, local_date, built_at_utc} for _build_percentile_days.
UPSERT_ROUTE_OCCUPANCY_BAND_DAILY = text(
    """
    INSERT INTO gold.route_occupancy_band_daily (
        provider_id, provider_local_date, route_id,
        observation_count, empty_count, many_seats_count,
        few_seats_count, standing_count, full_count, built_at_utc
    )
    SELECT
        f.provider_id,
        :local_date,
        COALESCE(f.route_id, '__unrouted__'),
        COUNT(*) FILTER (WHERE f.occupancy_status IN (0, 1, 2, 3, 4, 5))::integer,
        COUNT(*) FILTER (WHERE f.occupancy_status = 0)::integer,
        COUNT(*) FILTER (WHERE f.occupancy_status = 1)::integer,
        COUNT(*) FILTER (WHERE f.occupancy_status = 2)::integer,
        COUNT(*) FILTER (WHERE f.occupancy_status IN (3, 4))::integer,
        COUNT(*) FILTER (WHERE f.occupancy_status = 5)::integer,
        :built_at_utc
    FROM gold.fact_vehicle_snapshot AS f
    WHERE f.provider_id = :provider_id
      AND f.snapshot_date_key = :date_key
    GROUP BY f.provider_id, COALESCE(f.route_id, '__unrouted__')
    ON CONFLICT (provider_id, provider_local_date, route_id) DO UPDATE SET
        observation_count = EXCLUDED.observation_count,
        empty_count = EXCLUDED.empty_count,
        many_seats_count = EXCLUDED.many_seats_count,
        few_seats_count = EXCLUDED.few_seats_count,
        standing_count = EXCLUDED.standing_count,
        full_count = EXCLUDED.full_count,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

# Per-STOP twin of UPSERT_ROUTE_OCCUPANCY_BAND_DAILY: append-only daily reduction
# of occupancy band counts for one CLOSED local day, summed straight from
# fact_vehicle_snapshot but GROUPED BY the GTFS-RT VehiclePosition current/next
# stop_id. CRITICAL stop-vs-route difference: a ping with NULL stop_id cannot be
# attributed to a stop, so this filters `f.stop_id IS NOT NULL` and groups on the
# raw stop_id — there is NO sentinel bucket (the route mirror COALESCEs NULL
# route_id to '__unrouted__'; a NULL stop has no honest stop to attribute to).
# observation_count = band-bearing pings (codes 0-5, code 4 folded into standing);
# the five band counts sum to it. Binds {provider_id, local_date, built_at_utc} for
# _build_percentile_days, sourced from fact_vehicle_snapshot (same closed-day
# missing-day calendar as the route occupancy rollup).
UPSERT_STOP_OCCUPANCY_BAND_DAILY = text(
    """
    INSERT INTO gold.stop_occupancy_band_daily (
        provider_id, provider_local_date, stop_id,
        observation_count, empty_count, many_seats_count,
        few_seats_count, standing_count, full_count, built_at_utc
    )
    SELECT
        f.provider_id,
        :local_date,
        f.stop_id,
        COUNT(*) FILTER (WHERE f.occupancy_status IN (0, 1, 2, 3, 4, 5))::integer,
        COUNT(*) FILTER (WHERE f.occupancy_status = 0)::integer,
        COUNT(*) FILTER (WHERE f.occupancy_status = 1)::integer,
        COUNT(*) FILTER (WHERE f.occupancy_status = 2)::integer,
        COUNT(*) FILTER (WHERE f.occupancy_status IN (3, 4))::integer,
        COUNT(*) FILTER (WHERE f.occupancy_status = 5)::integer,
        :built_at_utc
    FROM gold.fact_vehicle_snapshot AS f
    WHERE f.provider_id = :provider_id
      AND f.snapshot_date_key = :date_key
      AND f.stop_id IS NOT NULL
    GROUP BY f.provider_id, f.stop_id
    ON CONFLICT (provider_id, provider_local_date, stop_id) DO UPDATE SET
        observation_count = EXCLUDED.observation_count,
        empty_count = EXCLUDED.empty_count,
        many_seats_count = EXCLUDED.many_seats_count,
        few_seats_count = EXCLUDED.few_seats_count,
        standing_count = EXCLUDED.standing_count,
        full_count = EXCLUDED.full_count,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

# Per-route service span over one CLOSED provider-local day (append-only). Grain
# is route x provider_local_date; weekday/weekend is derived at READ time from the
# date, so the closed-day calendar (captured-date) is the single source of truth
# for the grain (no captured-date-vs-start_date ambiguity). "Trip start" = the
# first realtime observation of a trip (MIN captured_at_utc) — labeled honestly as
# first-observed activity, not the scheduled departure. first/last delay = that
# trip's earliest-observation schedule deviation. Binds {provider_id, local_date,
# built_at_utc} so it drops into _build_percentile_days unchanged.
UPSERT_ROUTE_SERVICE_SPAN_DAILY = text(
    """
    WITH trip_starts AS (
        SELECT
            f.provider_id,
            f.route_id,
            f.trip_id,
            MIN(f.captured_at_utc) AS trip_start_utc,
            (ARRAY_AGG(f.delay_seconds ORDER BY f.captured_at_utc, f.entity_index))[1]
                AS first_obs_delay
        FROM gold.fact_trip_delay_snapshot AS f
        WHERE f.provider_id = :provider_id
          AND f.route_id IS NOT NULL
          AND f.trip_id IS NOT NULL
          AND f.snapshot_date_key = :date_key
        GROUP BY f.provider_id, f.route_id, f.trip_id
    ),
    ranked AS (
        SELECT
            provider_id,
            route_id,
            trip_start_utc,
            first_obs_delay,
            ROW_NUMBER() OVER (
                PARTITION BY provider_id, route_id ORDER BY trip_start_utc, first_obs_delay
            ) AS rn_first,
            ROW_NUMBER() OVER (
                PARTITION BY provider_id, route_id ORDER BY trip_start_utc DESC, first_obs_delay
            ) AS rn_last
        FROM trip_starts
    )
    INSERT INTO gold.route_service_span_daily (
        provider_id, provider_local_date, route_id,
        first_trip_start_utc, last_trip_start_utc, service_span_min,
        first_trip_delay_seconds, last_trip_delay_seconds, trip_count, built_at_utc
    )
    SELECT
        provider_id,
        :local_date,
        route_id,
        MIN(trip_start_utc),
        MAX(trip_start_utc),
        ROUND(EXTRACT(EPOCH FROM (MAX(trip_start_utc) - MIN(trip_start_utc))) / 60.0)::integer,
        MAX(first_obs_delay) FILTER (WHERE rn_first = 1),
        MAX(first_obs_delay) FILTER (WHERE rn_last = 1),
        COUNT(*)::integer,
        :built_at_utc
    FROM ranked
    GROUP BY provider_id, route_id
    ON CONFLICT (provider_id, provider_local_date, route_id) DO UPDATE SET
        first_trip_start_utc = EXCLUDED.first_trip_start_utc,
        last_trip_start_utc = EXCLUDED.last_trip_start_utc,
        service_span_min = EXCLUDED.service_span_min,
        first_trip_delay_seconds = EXCLUDED.first_trip_delay_seconds,
        last_trip_delay_seconds = EXCLUDED.last_trip_delay_seconds,
        trip_count = EXCLUDED.trip_count,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

# Per-route skipped-stop rate over one CLOSED provider-local day (append-only).
# Sums the per-trip skipped_stop_count + stop_time_update_count (both carried on
# the fact by the ETL) for one local day. rate = 100 * skipped / total stop-time
# updates; None when no stop-time updates were observed. The denominator is ALL
# stop-time updates (matching the carried stop_time_update_count), NOT filtered on
# schedule_relationship — a NULL stop-level relationship is SCHEDULED and stays in
# the denominator. Binds {provider_id, local_date, built_at_utc} for
# _build_percentile_days. RAMP-IN: no history before this metric shipped.
UPSERT_ROUTE_SKIPPED_STOP_DAILY = text(
    """
    INSERT INTO gold.route_skipped_stop_daily (
        provider_id, provider_local_date, route_id,
        stop_time_update_count, skipped_stop_count, skipped_stop_rate_pct, built_at_utc
    )
    SELECT
        f.provider_id,
        :local_date,
        f.route_id,
        SUM(f.stop_time_update_count)::bigint,
        SUM(f.skipped_stop_count)::bigint,
        ROUND(
            100.0 * SUM(f.skipped_stop_count) / NULLIF(SUM(f.stop_time_update_count), 0),
            2
        ),
        :built_at_utc
    FROM gold.fact_trip_delay_snapshot AS f
    WHERE f.provider_id = :provider_id
      AND f.route_id IS NOT NULL
      AND f.snapshot_date_key = :date_key
    GROUP BY f.provider_id, f.route_id
    ON CONFLICT (provider_id, provider_local_date, route_id) DO UPDATE SET
        stop_time_update_count = EXCLUDED.stop_time_update_count,
        skipped_stop_count = EXCLUDED.skipped_stop_count,
        skipped_stop_rate_pct = EXCLUDED.skipped_stop_rate_pct,
        built_at_utc = EXCLUDED.built_at_utc
    """
)


# --- S7-B route_delay_spine: finest-grain additive DELAY metric family ---
# Single source for the 21 histogram edges (sec, left-closed/right-open). The
# headline SHARES come from the EXACT delay_seconds-predicate count columns below
# (NOT bins) — a left-closed edge at 300 cannot represent the strict >300 severe
# band — so the histogram is used only for p50/p90 (CDF interpolation) + the chart.
DELAY_HISTOGRAM_EDGES = (
    -3600, -300, -180, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180,
    240, 300, 420, 600, 900, 1800, 3600,
)

_SPINE_HIST_EDGES_SQL = (
    "ARRAY[-3600,-300,-180,-120,-90,-60,-30,0,30,60,90,120,150,180,"
    "240,300,420,600,900,1800,3600]"
)

# --- S7-B route_headway_shift_daily: finest-grain additive HEADWAY family ---
# Fixed gap-histogram edges (MINUTES, left-closed/right-open). 21 edges -> 20 finite bins,
# mirroring the 21-bin spine so the read helper is a 21-entry walk. Edges START AT 0 (D6)
# so sub-1-min gaps bin honestly (an edges[0]=1 would fold (0,1) into bin 0 and poison the
# 0.5*median bunched threshold for high-frequency routes). The clamp is 0 < gap_min < 240,
# so 240 is the finite domain ceiling — NO +inf overflow bin (the read helper's terminal
# branch is dead code here, unlike the delay spine's Finding B). Fine at the low end so the
# median CDF-interp + the 0.5*median bunched threshold reconstruct accurately.
HEADWAY_GAP_HISTOGRAM_EDGES = (
    0.0, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 60, 90, 120, 180, 240,
)  # 21 edges -> 20 bins; width_bucket -> [1,20], LEAST(.,20)-1 -> bin_idx [0,19]

_HEADWAY_GAP_HIST_EDGES_SQL = (
    "ARRAY[0.0,0.5,1,2,3,4,5,6,8,10,12,15,20,25,30,40,60,90,120,180,240]"
)

# Append-only / closed-day builder for gold.route_delay_spine (rollup_kind=
# "route_delay_spine"). Reads one CLOSED provider-local day of the trip-delay fact,
# groups to (route, hour-of-day-local, direction), and stores EXACT additive counts
# computed with the SAME predicates as UPSERT_TRIP_DELAY_SUMMARY_5M (so otp_pct /
# severe_pct are byte-identical ratios), plus a SEPARATE 21-bin histogram + the
# pooled sum_delay_seconds. Binds {provider_id, local_date, date_key, built_at_utc}
# so it drops straight into _build_percentile_days. Unknown direction COALESCEs to 0
# (matching the directional headway builder); delayed_trip_count is intentionally
# absent (non-additive distinct-trip count -> read from route_delay_hourly).
UPSERT_ROUTE_DELAY_SPINE = text(
    f"""
    WITH binned AS (
        SELECT
            f.provider_id,
            f.route_id,
            EXTRACT(HOUR FROM timezone(dp.timezone, f.captured_at_utc))::smallint
                AS hour_of_day_local,
            COALESCE(f.direction_id, 0) AS direction_id,
            f.delay_seconds AS delay_seconds,
            CASE
                WHEN f.delay_seconds IS NULL
                     OR ABS(f.delay_seconds) > {GHOST_DELAY_ABS_SECONDS}
                THEN NULL
                ELSE LEAST(
                    GREATEST(width_bucket(f.delay_seconds, {_SPINE_HIST_EDGES_SQL}), 1),
                    21
                ) - 1
            END AS bin_idx
        FROM gold.fact_trip_delay_snapshot AS f
        INNER JOIN gold.dim_provider AS dp ON dp.provider_id = f.provider_id
        WHERE f.provider_id = :provider_id
          AND f.route_id IS NOT NULL
          AND f.snapshot_date_key = :date_key
    )
    INSERT INTO gold.route_delay_spine (
        provider_id, route_id, service_local_date, hour_of_day_local, direction_id,
        observation_count, delay_observation_count, on_time_observation_count,
        severe_delay_count, sum_delay_seconds, delay_histogram, built_at_utc
    )
    SELECT
        provider_id,
        route_id,
        :local_date,
        hour_of_day_local,
        direction_id,
        -- observation_count: every fact row in the grain (delay may be NULL).
        COUNT(*)::integer,
        -- delay_observation_count: every non-null delay (ghost-INCLUSIVE), matching the 5m.
        COUNT(delay_seconds)::integer,
        -- on-time = delay in [-60, 300) via the EXACT live predicate (NOT bins).
        -- NULL-guarded: no usable delay -> on-time unknowable -> NULL (honest absence).
        CASE
            WHEN COUNT(delay_seconds) = 0 THEN NULL
            ELSE COUNT(*) FILTER (
                WHERE delay_seconds >= -60 AND delay_seconds < 300
            )::integer
        END,
        -- severe = delay > 300s via the EXACT live predicate (byte-identical to the 5m).
        COUNT(*) FILTER (
            WHERE delay_seconds > {SEVERE_DELAY_SECONDS}
              AND ABS(delay_seconds) <= {GHOST_DELAY_ABS_SECONDS}
        )::integer,
        -- pooled numerator for the rebaselined avg (ghost-excluded = in-clamp delays).
        COALESCE(SUM(delay_seconds) FILTER (WHERE bin_idx IS NOT NULL), 0)::bigint,
        ARRAY[
            COUNT(*) FILTER (WHERE bin_idx = 0),  COUNT(*) FILTER (WHERE bin_idx = 1),
            COUNT(*) FILTER (WHERE bin_idx = 2),  COUNT(*) FILTER (WHERE bin_idx = 3),
            COUNT(*) FILTER (WHERE bin_idx = 4),  COUNT(*) FILTER (WHERE bin_idx = 5),
            COUNT(*) FILTER (WHERE bin_idx = 6),  COUNT(*) FILTER (WHERE bin_idx = 7),
            COUNT(*) FILTER (WHERE bin_idx = 8),  COUNT(*) FILTER (WHERE bin_idx = 9),
            COUNT(*) FILTER (WHERE bin_idx = 10), COUNT(*) FILTER (WHERE bin_idx = 11),
            COUNT(*) FILTER (WHERE bin_idx = 12), COUNT(*) FILTER (WHERE bin_idx = 13),
            COUNT(*) FILTER (WHERE bin_idx = 14), COUNT(*) FILTER (WHERE bin_idx = 15),
            COUNT(*) FILTER (WHERE bin_idx = 16), COUNT(*) FILTER (WHERE bin_idx = 17),
            COUNT(*) FILTER (WHERE bin_idx = 18), COUNT(*) FILTER (WHERE bin_idx = 19),
            COUNT(*) FILTER (WHERE bin_idx = 20)
        ]::smallint[],
        :built_at_utc
    FROM binned
    GROUP BY provider_id, route_id, hour_of_day_local, direction_id
    ON CONFLICT (provider_id, route_id, service_local_date, hour_of_day_local, direction_id)
    DO UPDATE SET
        observation_count        = EXCLUDED.observation_count,
        delay_observation_count  = EXCLUDED.delay_observation_count,
        on_time_observation_count = EXCLUDED.on_time_observation_count,
        severe_delay_count       = EXCLUDED.severe_delay_count,
        sum_delay_seconds        = EXCLUDED.sum_delay_seconds,
        delay_histogram          = EXCLUDED.delay_histogram,
        built_at_utc             = EXCLUDED.built_at_utc
    """
)


REPORTING_AGGREGATE_TABLES = (
    "route_delay_hourly",
    "stop_delay_hourly",
    "stop_delay_weekly",
    "stop_delay_monthly",
    "route_habit_score",
    # repeated_problem_route_stop derives route-grain recurrence from the route
    # delay spine (built earlier, in the append-only section) + stop_delay_weekly.
    "repeated_problem_route_stop",
    "citizen_accountability_daily",
    "route_headway_by_shift",
    "repeat_offender",
    "route_headway_by_direction_shift",
)

WINDOWED_HISTORY_TABLES = (
    "route_delay_hourly",
    "stop_delay_hourly",
    "citizen_accountability_daily",
)

DERIVED_REBUILD_TABLES = (
    "stop_delay_weekly",
    "stop_delay_monthly",
    "route_habit_score",
    "repeated_problem_route_stop",
)

ROLLING_WINDOW_TABLES = (
    "route_headway_by_shift",
    "repeat_offender",
    "route_headway_by_direction_shift",
)

DELETE_REPORTING_AGGREGATES = {
    "route_delay_hourly": text(
        f"""
        DELETE FROM gold.route_delay_hourly
        WHERE provider_id = :provider_id
          AND period_start_utc >= {OPEN_WINDOW_HOURLY_CUTOFF_SQL}
        """
    ),
    "stop_delay_hourly": text(
        f"""
        DELETE FROM gold.stop_delay_hourly
        WHERE provider_id = :provider_id
          AND period_start_utc >= {OPEN_WINDOW_HOURLY_CUTOFF_SQL}
        """
    ),
    "citizen_accountability_daily": text(
        """
        DELETE FROM gold.citizen_accountability_daily
        WHERE provider_id = :provider_id
          AND provider_local_date >= (
              SELECT (timezone(dp.timezone, CAST(:built_at_utc AS timestamptz)))::date
                     - :open_window_days
              FROM gold.dim_provider AS dp
              WHERE dp.provider_id = :provider_id
          )
        """
    ),
    **{
        table_name: text(f"DELETE FROM gold.{table_name} WHERE provider_id = :provider_id")
        for table_name in (*DERIVED_REBUILD_TABLES, *ROLLING_WINDOW_TABLES)
    },
}

UPSERT_ROUTE_DELAY_HOURLY = text(
    f"""
    WITH summary AS (
        SELECT
            provider_id,
            date_trunc('hour', period_start_utc) AS period_start_utc,
            COALESCE(route_id, '__unrouted__') AS route_id,
            SUM(trip_count)::integer AS trip_count,
            SUM(observation_count)::integer AS observation_count,
            SUM(delay_observation_count)::integer AS delay_observation_count,
            SUM(severe_delay_observation_count)::integer AS severe_delay_count,
            -- A NULL in any contributing 5m bucket means pre-fix history is unknowable.
            CASE WHEN COUNT(*) = COUNT(on_time_observation_count)
                THEN SUM(on_time_observation_count)::integer
            END AS on_time_observation_count,
            ROUND(
                SUM(avg_delay_seconds_capped * NULLIF(delay_observation_count - outlier_count, 0))
                / NULLIF(SUM(delay_observation_count - outlier_count), 0),
                2
            ) AS avg_delay_seconds,
            MAX(max_delay_seconds_capped) AS max_delay_seconds,
            SUM(delayed_trip_count)::integer AS delayed_trip_count
        FROM gold.trip_delay_summary_5m
        WHERE provider_id = :provider_id
          AND period_start_utc >= {OPEN_WINDOW_HOURLY_CUTOFF_SQL}
        GROUP BY 1, 2, 3
    )
    INSERT INTO gold.route_delay_hourly (
        provider_id,
        period_start_utc,
        route_id,
        trip_count,
        observation_count,
        delay_observation_count,
        on_time_observation_count,
        avg_delay_seconds,
        max_delay_seconds,
        delayed_trip_count,
        severe_delay_count,
        built_at_utc
    )
    SELECT
        s.provider_id,
        s.period_start_utc,
        s.route_id,
        s.trip_count,
        s.observation_count,
        s.delay_observation_count,
        s.on_time_observation_count,
        s.avg_delay_seconds,
        s.max_delay_seconds,
        s.delayed_trip_count,
        s.severe_delay_count,
        :built_at_utc
    FROM summary AS s
    """
)

UPSERT_STOP_DELAY_HOURLY = text(
    f"""
    INSERT INTO gold.stop_delay_hourly (
        provider_id,
        period_start_utc,
        stop_id,
        route_id,
        observation_count,
        avg_arrival_delay_seconds,
        avg_departure_delay_seconds,
        severe_delay_count,
        built_at_utc
    )
    SELECT
        f.provider_id,
        date_trunc('hour', f.captured_at_utc) AS period_start_utc,
        f.delay_stop_id AS stop_id,
        COALESCE(f.route_id, '__unrouted__') AS route_id,
        COUNT(*)::integer AS observation_count,
        -- delay_seconds is a single trip-update delay; stop consumers coalesce
        -- arrival/departure, so both average columns carry the same value.
        ROUND(AVG(f.delay_seconds::numeric), 2) AS avg_arrival_delay_seconds,
        ROUND(AVG(f.delay_seconds::numeric), 2) AS avg_departure_delay_seconds,
        COUNT(*) FILTER (
            WHERE f.delay_seconds > {SEVERE_DELAY_SECONDS}
              AND ABS(f.delay_seconds) <= {GHOST_DELAY_ABS_SECONDS}
        )::integer AS severe_delay_count,
        :built_at_utc
    FROM gold.fact_trip_delay_snapshot AS f
    WHERE f.provider_id = :provider_id
      AND f.delay_stop_id IS NOT NULL
      AND f.delay_seconds IS NOT NULL
      AND ABS(f.delay_seconds) <= {GHOST_DELAY_ABS_SECONDS}
      AND f.captured_at_utc >= {OPEN_WINDOW_HOURLY_CUTOFF_SQL}
    GROUP BY 1, 2, 3, 4
    """
)

UPSERT_STOP_DELAY_WEEKLY = text(
    """
    INSERT INTO gold.stop_delay_weekly (
        provider_id,
        week_start_local,
        stop_id,
        route_id,
        observation_count,
        avg_delay_seconds,
        severe_delay_count,
        built_at_utc
    )
    SELECT
        sd.provider_id,
        date_trunc('week', timezone(dp.timezone, sd.period_start_utc))::date,
        sd.stop_id,
        sd.route_id,
        SUM(sd.observation_count)::integer,
        ROUND(
            SUM(COALESCE(sd.avg_arrival_delay_seconds, sd.avg_departure_delay_seconds)
                * NULLIF(sd.observation_count, 0))
            / NULLIF(SUM(sd.observation_count), 0),
            2
        ),
        SUM(sd.severe_delay_count)::integer,
        :built_at_utc
    FROM gold.stop_delay_hourly AS sd
    INNER JOIN gold.dim_provider AS dp
        ON dp.provider_id = sd.provider_id
    WHERE sd.provider_id = :provider_id
    GROUP BY 1, 2, 3, 4
    ON CONFLICT (provider_id, week_start_local, stop_id, route_id) DO UPDATE SET
        observation_count = EXCLUDED.observation_count,
        avg_delay_seconds = EXCLUDED.avg_delay_seconds,
        severe_delay_count = EXCLUDED.severe_delay_count,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

UPSERT_STOP_DELAY_MONTHLY = text(
    """
    INSERT INTO gold.stop_delay_monthly (
        provider_id,
        month_start_local,
        stop_id,
        route_id,
        observation_count,
        avg_delay_seconds,
        severe_delay_count,
        built_at_utc
    )
    SELECT
        sd.provider_id,
        date_trunc('month', timezone(dp.timezone, sd.period_start_utc))::date,
        sd.stop_id,
        sd.route_id,
        SUM(sd.observation_count)::integer,
        ROUND(
            SUM(COALESCE(sd.avg_arrival_delay_seconds, sd.avg_departure_delay_seconds)
                * NULLIF(sd.observation_count, 0))
            / NULLIF(SUM(sd.observation_count), 0),
            2
        ),
        SUM(sd.severe_delay_count)::integer,
        :built_at_utc
    FROM gold.stop_delay_hourly AS sd
    INNER JOIN gold.dim_provider AS dp
        ON dp.provider_id = sd.provider_id
    WHERE sd.provider_id = :provider_id
    GROUP BY 1, 2, 3, 4
    ON CONFLICT (provider_id, month_start_local, stop_id, route_id) DO UPDATE SET
        observation_count = EXCLUDED.observation_count,
        avg_delay_seconds = EXCLUDED.avg_delay_seconds,
        severe_delay_count = EXCLUDED.severe_delay_count,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

UPSERT_ROUTE_HABIT_SCORE = text(
    """
    WITH habit AS (
        SELECT
            rd.provider_id,
            rd.route_id,
            EXTRACT(ISODOW FROM timezone(dp.timezone, rd.period_start_utc))::integer
                AS day_of_week_iso,
            EXTRACT(HOUR FROM timezone(dp.timezone, rd.period_start_utc))::integer
                AS hour_of_day_local,
            SUM(rd.observation_count)::integer AS observation_count,
            ROUND(
                SUM(rd.avg_delay_seconds * NULLIF(rd.observation_count, 0))
                / NULLIF(SUM(rd.observation_count), 0),
                2
            ) AS avg_delay_seconds,
            SUM(rd.severe_delay_count)::integer AS severe_delay_count
        FROM gold.route_delay_hourly AS rd
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = rd.provider_id
        WHERE rd.provider_id = :provider_id
        GROUP BY 1, 2, 3, 4
    )
    INSERT INTO gold.route_habit_score (
        provider_id,
        route_id,
        day_of_week_iso,
        hour_of_day_local,
        observation_count,
        avg_delay_seconds,
        severe_delay_count,
        repeat_problem_score,
        built_at_utc
    )
    SELECT
        provider_id,
        route_id,
        day_of_week_iso,
        hour_of_day_local,
        observation_count,
        avg_delay_seconds,
        severe_delay_count,
        LEAST(
            ROUND(
                (
                    severe_delay_count::numeric * 10
                    + GREATEST(COALESCE(avg_delay_seconds, 0), 0) / 60
                ),
                4
            ),
            9999.9999
        ),
        :built_at_utc
    FROM habit
    ON CONFLICT (provider_id, route_id, day_of_week_iso, hour_of_day_local) DO UPDATE SET
        observation_count = EXCLUDED.observation_count,
        avg_delay_seconds = EXCLUDED.avg_delay_seconds,
        severe_delay_count = EXCLUDED.severe_delay_count,
        repeat_problem_score = EXCLUDED.repeat_problem_score,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

UPSERT_REPEATED_PROBLEM_ROUTE_STOP = text(
    """
    -- Route-grain weekly recurrence derived from the route delay spine (S7-B): the
    -- ISO-week SUM of severe_delay_count is byte-identical to the (dropped)
    -- route_reliability_weekly.severe_delay_count, so issue_count and the
    -- issue_count-driven severity are unchanged. avg_delay_seconds rebaselines to the
    -- ghost-excluded pooled mean (sum_delay_seconds / Σ histogram bins) — it only
    -- influences severity at the 300/600s thresholds for low-severe rows. The spine
    -- filters route_id IS NOT NULL, so the '__unrouted__' sentinel never appears.
    WITH route_week AS (
        SELECT
            sp.provider_id,
            'route'::text AS entity_kind,
            sp.route_id AS entity_id,
            sp.route_id AS route_id,
            'week'::text AS period_grain,
            date_trunc('week', sp.service_local_date)::date AS period_start_local,
            SUM(sp.severe_delay_count)::integer AS issue_count,
            ROUND(
                SUM(sp.sum_delay_seconds)::numeric
                / NULLIF(SUM((SELECT COALESCE(SUM(x), 0) FROM unnest(sp.delay_histogram) AS x)), 0),
                2
            ) AS avg_delay_seconds
        FROM gold.route_delay_spine AS sp
        WHERE sp.provider_id = :provider_id
        GROUP BY 1, 2, 3, 4, 5, 6
    ),
    stop_week AS (
        SELECT
            s.provider_id,
            'stop'::text AS entity_kind,
            COALESCE(s.stop_id, '__unknown_stop__') AS entity_id,
            COALESCE(s.route_id, '__unrouted__') AS route_id,
            'week'::text AS period_grain,
            s.week_start_local AS period_start_local,
            SUM(s.severe_delay_count)::integer AS issue_count,
            ROUND(AVG(s.avg_delay_seconds)::numeric, 2) AS avg_delay_seconds
        FROM gold.stop_delay_weekly AS s
        WHERE s.provider_id = :provider_id
        GROUP BY 1, 2, 3, 4, 5, 6
    ),
    problems AS (
        SELECT * FROM route_week
        UNION ALL
        SELECT * FROM stop_week
    )
    INSERT INTO gold.repeated_problem_route_stop (
        provider_id,
        entity_kind,
        entity_id,
        route_id,
        period_grain,
        period_start_local,
        issue_count,
        avg_delay_seconds,
        severity_label,
        built_at_utc
    )
    SELECT
        provider_id,
        entity_kind,
        entity_id,
        route_id,
        period_grain,
        period_start_local,
        issue_count,
        avg_delay_seconds,
        CASE
            WHEN issue_count >= 10 OR avg_delay_seconds > 600 THEN 'critical'
            WHEN issue_count > 0 OR avg_delay_seconds > 300 THEN 'high'
            ELSE 'watch'
        END,
        :built_at_utc
    FROM problems
    WHERE issue_count > 0 OR avg_delay_seconds > 300
    ON CONFLICT (
        provider_id,
        entity_kind,
        entity_id,
        route_id,
        period_grain,
        period_start_local
    ) DO UPDATE SET
        issue_count = EXCLUDED.issue_count,
        avg_delay_seconds = EXCLUDED.avg_delay_seconds,
        severity_label = EXCLUDED.severity_label,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

UPSERT_CITIZEN_ACCOUNTABILITY_DAILY = text(
    """
    WITH cutoff AS (
        SELECT
            (timezone(dp.timezone, CAST(:built_at_utc AS timestamptz)))::date
                - :open_window_days AS min_local_date
        FROM gold.dim_provider AS dp
        WHERE dp.provider_id = :provider_id
    ),
    route_daily AS (
        SELECT
            rd.provider_id,
            timezone(dp.timezone, rd.period_start_utc)::date AS provider_local_date,
            COUNT(DISTINCT route_id) FILTER (
                WHERE rd.avg_delay_seconds > 300 OR rd.severe_delay_count > 0
            )::integer AS affected_route_count,
            SUM(rd.delayed_trip_count)::integer AS delayed_trip_count,
            SUM(rd.severe_delay_count)::integer AS severe_delay_count
        FROM gold.route_delay_hourly AS rd
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = rd.provider_id
        WHERE rd.provider_id = :provider_id
          AND rd.period_start_utc >= (
              CAST(:built_at_utc AS timestamptz)
              - make_interval(days => :open_window_days + 2)
          )
        GROUP BY 1, 2
    ),
    stop_daily AS (
        SELECT
            sd.provider_id,
            timezone(dp.timezone, sd.period_start_utc)::date AS provider_local_date,
            COUNT(DISTINCT stop_id) FILTER (
                WHERE COALESCE(sd.avg_arrival_delay_seconds, sd.avg_departure_delay_seconds) > 300
                   OR sd.severe_delay_count > 0
            )::integer AS affected_stop_count
        FROM gold.stop_delay_hourly AS sd
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = sd.provider_id
        WHERE sd.provider_id = :provider_id
          AND sd.period_start_utc >= (
              CAST(:built_at_utc AS timestamptz)
              - make_interval(days => :open_window_days + 2)
          )
        GROUP BY 1, 2
    ),
    i3_alert_daily AS (
        SELECT
            provider_id,
            provider_local_date,
            COUNT(DISTINCT effective_content_hash)::integer AS alert_count
        FROM gold.i3_alert_history_reporting
        WHERE provider_id = :provider_id
          AND provider_local_date >= (SELECT min_local_date FROM cutoff)
        GROUP BY 1, 2
    ),
    calendar AS (
        SELECT provider_id, provider_local_date FROM route_daily
        UNION
        SELECT provider_id, provider_local_date FROM stop_daily
        UNION
        SELECT provider_id, provider_local_date FROM i3_alert_daily
    )
    INSERT INTO gold.citizen_accountability_daily (
        provider_id,
        provider_local_date,
        affected_route_count,
        affected_stop_count,
        delayed_trip_count,
        severe_delay_count,
        alert_count,
        rider_impact_score,
        built_at_utc
    )
    SELECT
        c.provider_id,
        c.provider_local_date,
        -- Honesty (truth-audit): a LEFT-JOIN miss means "no delay telemetry for
        -- this date", NOT "zero entities affected". Do NOT COALESCE the miss to 0
        -- (that fabricates an honest-looking zero). A present source row already
        -- carries its real integer, including a genuine 0 when telemetry existed
        -- and no entity crossed the threshold; that real 0 is preserved untouched.
        -- affected_route_count / affected_stop_count are int|None in the Receipt
        -- contract, so emitting NULL on a miss is contract-valid honest "no data".
        r.affected_route_count,
        s.affected_stop_count,
        COALESCE(r.delayed_trip_count, 0),
        COALESCE(r.severe_delay_count, 0),
        COALESCE(ia.alert_count, 0),
        -- Honesty (truth-audit): rider_impact_score is a composite of the
        -- delay/severe/route/stop terms. When the delay telemetry feeding it is
        -- absent for the date (neither the route_daily nor the stop_daily source
        -- row exists — the calendar date is present only because alerts arrived),
        -- every reliability term is a join-miss and the score would collapse to
        -- pure alerts*2 while otp/avg/severe publish honest-NULL. That is
        -- internally inconsistent, so we emit NULL (float|None in the contract)
        -- to match the honest-NULL reliability inputs on the same receipt. The
        -- 9999.9999 clamp is unchanged for real days.
        CASE
            WHEN r.provider_local_date IS NULL
                 AND s.provider_local_date IS NULL
            THEN NULL
            ELSE LEAST(
                ROUND(
                    (
                        COALESCE(r.affected_route_count, 0)::numeric * 2
                        + COALESCE(s.affected_stop_count, 0)::numeric
                        + COALESCE(r.delayed_trip_count, 0)::numeric
                        + COALESCE(r.severe_delay_count, 0)::numeric * 3
                        + COALESCE(ia.alert_count, 0)::numeric * 2
                    ),
                    4
                ),
                9999.9999
            )
        END,
        :built_at_utc
    FROM calendar AS c
    LEFT JOIN route_daily AS r
        ON r.provider_id = c.provider_id
       AND r.provider_local_date = c.provider_local_date
    LEFT JOIN stop_daily AS s
        ON s.provider_id = c.provider_id
       AND s.provider_local_date = c.provider_local_date
    LEFT JOIN i3_alert_daily AS ia
        ON ia.provider_id = c.provider_id
       AND ia.provider_local_date = c.provider_local_date
    WHERE c.provider_local_date >= (SELECT min_local_date FROM cutoff)
    """
)

UPSERT_ROUTE_HEADWAY_DAILY = text(
    """
    WITH trip_starts AS (
        -- Observed headway uses trip instances, not pooled vehicle pings:
        -- first in-service realtime observation per trip/service day, weekday
        -- service only, then the busiest direction to match scheduled parity.
        SELECT
            f.provider_id,
            f.route_id,
            COALESCE(f.direction_id, 0) AS direction_id,
            COALESCE(f.start_date, f.snapshot_local_date) AS service_date,
            f.trip_id,
            MIN(f.captured_at_utc) AS trip_start_utc
        FROM gold.fact_trip_delay_snapshot AS f
        WHERE f.provider_id = :provider_id
          AND f.captured_at_utc >= now() - make_interval(days => :fact_retention_days)
          AND f.route_id IS NOT NULL
          AND f.trip_id IS NOT NULL
          AND f.delay_seconds IS NOT NULL
          AND ABS(f.delay_seconds) <= 3600
          AND EXTRACT(ISODOW FROM COALESCE(f.start_date, f.snapshot_local_date)) BETWEEN 1 AND 5
        GROUP BY
            f.provider_id,
            f.route_id,
            COALESCE(f.direction_id, 0),
            COALESCE(f.start_date, f.snapshot_local_date),
            f.trip_id
    ),
    busiest_direction AS (
        SELECT
            provider_id,
            route_id,
            direction_id
        FROM (
            SELECT
                provider_id,
                route_id,
                direction_id,
                ROW_NUMBER() OVER (
                    PARTITION BY provider_id, route_id
                    ORDER BY COUNT(*) DESC, direction_id
                ) AS direction_rank
            FROM trip_starts
            GROUP BY provider_id, route_id, direction_id
        ) AS ranked
        WHERE direction_rank = 1
    ),
    shifted AS (
        SELECT
            ts.provider_id,
            ts.route_id,
            ts.direction_id,
            ts.service_date,
            ts.trip_start_utc,
            CASE
                WHEN EXTRACT(HOUR FROM timezone(dp.timezone, ts.trip_start_utc))
                    BETWEEN 6 AND 8 THEN 'am_peak'
                WHEN EXTRACT(HOUR FROM timezone(dp.timezone, ts.trip_start_utc))
                    BETWEEN 9 AND 14 THEN 'midday'
                WHEN EXTRACT(HOUR FROM timezone(dp.timezone, ts.trip_start_utc))
                    BETWEEN 15 AND 18 THEN 'pm_peak'
                WHEN EXTRACT(HOUR FROM timezone(dp.timezone, ts.trip_start_utc))
                    BETWEEN 19 AND 22 THEN 'evening'
                ELSE 'night'
            END AS shift
        FROM trip_starts AS ts
        INNER JOIN busiest_direction AS bd
            ON bd.provider_id = ts.provider_id
           AND bd.route_id = ts.route_id
           AND bd.direction_id = ts.direction_id
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = ts.provider_id
    ),
    gaps AS (
        SELECT
            provider_id,
            route_id,
            direction_id,
            service_date,
            shift,
            EXTRACT(
                EPOCH FROM (
                    trip_start_utc - LAG(trip_start_utc) OVER (
                        PARTITION BY provider_id, route_id, direction_id, service_date, shift
                        ORDER BY trip_start_utc
                    )
                )
            ) / 60.0 AS gap_min
        FROM shifted
    ),
    -- Single shared sanity filter so the median, CoV, and bunching are all
    -- computed over the IDENTICAL gap sample (no numerator/denominator drift).
    filtered AS (
        SELECT provider_id, route_id, shift, gap_min
        FROM gaps
        WHERE gap_min IS NOT NULL
          AND gap_min > 0
          AND gap_min < 240
    ),
    agg AS (
        SELECT
            provider_id,
            route_id,
            shift,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_min) AS med_gap,
            avg(gap_min) AS mean_gap,
            stddev_samp(gap_min) AS sd_gap,
            COUNT(*) AS n
        FROM filtered
        GROUP BY provider_id, route_id, shift
    ),
    -- Bunching = gaps under half the shift median; joins the per-group median
    -- back onto the same filtered gaps (an aggregate can't be referenced inside
    -- another aggregate's FILTER at the same level).
    bunch AS (
        SELECT
            f.provider_id,
            f.route_id,
            f.shift,
            COUNT(*) FILTER (WHERE f.gap_min < 0.5 * a.med_gap) AS bunched_count
        FROM filtered AS f
        JOIN agg AS a USING (provider_id, route_id, shift)
        GROUP BY f.provider_id, f.route_id, f.shift
    )
    INSERT INTO gold.route_headway_by_shift (
        provider_id,
        route_id,
        shift,
        observed_headway_min,
        sample_count,
        headway_cov,
        bunched_count,
        built_at_utc
    )
    SELECT
        a.provider_id,
        a.route_id,
        a.shift,
        ROUND(a.med_gap::numeric, 1),
        a.n::integer,
        -- CoV undefined for a single gap; mean=0 guard avoids div-by-zero.
        CASE WHEN a.n >= 2 AND a.mean_gap > 0
            THEN ROUND((a.sd_gap / a.mean_gap)::numeric, 4)
        END,
        COALESCE(b.bunched_count, 0)::integer,
        :built_at_utc
    FROM agg AS a
    LEFT JOIN bunch AS b USING (provider_id, route_id, shift)
    ON CONFLICT (provider_id, route_id, shift) DO UPDATE SET
        observed_headway_min = EXCLUDED.observed_headway_min,
        sample_count = EXCLUDED.sample_count,
        headway_cov = EXCLUDED.headway_cov,
        bunched_count = EXCLUDED.bunched_count,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

# Per-direction + weekday/weekend headway. Sibling of route_headway_by_shift (which
# is left untouched): the busiest_direction collapse is dropped so EVERY
# direction survives, and weekend service days are kept (tagged) instead of
# filtered out. Same 14d rolling reconstruction + median-gap method.
UPSERT_ROUTE_HEADWAY_DIRECTION_DAILY = text(
    """
    WITH trip_starts AS (
        SELECT
            f.provider_id,
            f.route_id,
            COALESCE(f.direction_id, 0) AS direction_id,
            COALESCE(f.start_date, f.snapshot_local_date) AS service_date,
            f.trip_id,
            MIN(f.captured_at_utc) AS trip_start_utc
        FROM gold.fact_trip_delay_snapshot AS f
        WHERE f.provider_id = :provider_id
          AND f.captured_at_utc >= now() - make_interval(days => :fact_retention_days)
          AND f.route_id IS NOT NULL
          AND f.trip_id IS NOT NULL
          AND f.delay_seconds IS NOT NULL
          AND ABS(f.delay_seconds) <= 3600
        GROUP BY
            f.provider_id,
            f.route_id,
            COALESCE(f.direction_id, 0),
            COALESCE(f.start_date, f.snapshot_local_date),
            f.trip_id
    ),
    shifted AS (
        SELECT
            ts.provider_id,
            ts.route_id,
            ts.direction_id,
            ts.service_date,
            ts.trip_start_utc,
            CASE
                WHEN EXTRACT(ISODOW FROM ts.service_date) BETWEEN 1 AND 5 THEN 'weekday'
                ELSE 'weekend'
            END AS service_day_kind,
            CASE
                WHEN EXTRACT(HOUR FROM timezone(dp.timezone, ts.trip_start_utc))
                    BETWEEN 6 AND 8 THEN 'am_peak'
                WHEN EXTRACT(HOUR FROM timezone(dp.timezone, ts.trip_start_utc))
                    BETWEEN 9 AND 14 THEN 'midday'
                WHEN EXTRACT(HOUR FROM timezone(dp.timezone, ts.trip_start_utc))
                    BETWEEN 15 AND 18 THEN 'pm_peak'
                WHEN EXTRACT(HOUR FROM timezone(dp.timezone, ts.trip_start_utc))
                    BETWEEN 19 AND 22 THEN 'evening'
                ELSE 'night'
            END AS shift
        FROM trip_starts AS ts
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = ts.provider_id
    ),
    gaps AS (
        SELECT
            provider_id,
            route_id,
            direction_id,
            service_day_kind,
            service_date,
            shift,
            EXTRACT(
                EPOCH FROM (
                    trip_start_utc - LAG(trip_start_utc) OVER (
                        PARTITION BY
                            provider_id, route_id, direction_id, service_day_kind,
                            service_date, shift
                        ORDER BY trip_start_utc
                    )
                )
            ) / 60.0 AS gap_min
        FROM shifted
    )
    INSERT INTO gold.route_headway_by_direction_shift (
        provider_id, route_id, direction_id, shift, service_day_kind,
        observed_headway_min, sample_count, built_at_utc
    )
    SELECT
        provider_id,
        route_id,
        direction_id,
        shift,
        service_day_kind,
        ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_min)::numeric, 1),
        COUNT(*)::integer,
        :built_at_utc
    FROM gaps
    WHERE gap_min IS NOT NULL
      AND gap_min > 0
      AND gap_min < 240
    GROUP BY provider_id, route_id, direction_id, shift, service_day_kind
    ON CONFLICT (provider_id, route_id, direction_id, shift, service_day_kind) DO UPDATE SET
        observed_headway_min = EXCLUDED.observed_headway_min,
        sample_count = EXCLUDED.sample_count,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

# S7-B finest-grain additive HEADWAY family. Distinct from UPSERT_ROUTE_HEADWAY_DAILY (above,
# writes the 14-day-rolling route_headway_by_shift) — this is an APPEND-ONLY closed-day rollup
# keyed by (provider, route, service_local_date, shift, direction) storing a gap histogram +
# moment sums so a windowed read recomposes the median (CDF-interp), CoV (Bessel n-1 pooled SD)
# + %bunched. EVERY direction stored (busiest-direction argmax is read-time, per window). The
# clamp (0 < gap_min < 240) + n>=2 guard are byte-identical to route_headway_by_shift. Binds
# {provider_id, local_date, date_key, built_at_utc} -> drops into _build_percentile_days.
UPSERT_ROUTE_HEADWAY_SHIFT_DAILY = text(
    f"""
    WITH trip_starts AS (
        -- trip start = first in-service realtime observation per trip/service day.
        SELECT
            f.provider_id,
            f.route_id,
            COALESCE(f.direction_id, 0) AS direction_id,
            COALESCE(f.start_date, f.snapshot_local_date) AS service_date,
            f.trip_id,
            MIN(f.captured_at_utc) AS trip_start_utc
        FROM gold.fact_trip_delay_snapshot AS f
        WHERE f.provider_id = :provider_id
          AND f.snapshot_date_key = :date_key          -- sargable closed day (NOT now()-interval)
          AND f.route_id IS NOT NULL
          AND f.trip_id IS NOT NULL
          AND f.delay_seconds IS NOT NULL
          AND ABS(f.delay_seconds) <= 3600
        GROUP BY
            f.provider_id, f.route_id, COALESCE(f.direction_id, 0),
            COALESCE(f.start_date, f.snapshot_local_date), f.trip_id
    ),
    shifted AS (
        SELECT
            ts.provider_id, ts.route_id, ts.direction_id, ts.service_date, ts.trip_start_utc,
            CASE
                WHEN EXTRACT(HOUR FROM timezone(dp.timezone, ts.trip_start_utc)) BETWEEN 6 AND 8 THEN 'am_peak'
                WHEN EXTRACT(HOUR FROM timezone(dp.timezone, ts.trip_start_utc)) BETWEEN 9 AND 14 THEN 'midday'
                WHEN EXTRACT(HOUR FROM timezone(dp.timezone, ts.trip_start_utc)) BETWEEN 15 AND 18 THEN 'pm_peak'
                WHEN EXTRACT(HOUR FROM timezone(dp.timezone, ts.trip_start_utc)) BETWEEN 19 AND 22 THEN 'evening'
                ELSE 'night'
            END AS shift
        FROM trip_starts AS ts
        INNER JOIN gold.dim_provider AS dp ON dp.provider_id = ts.provider_id
    ),
    gaps AS (
        SELECT
            provider_id, route_id, direction_id, shift,
            EXTRACT(EPOCH FROM (
                trip_start_utc - LAG(trip_start_utc) OVER (
                    PARTITION BY provider_id, route_id, direction_id, service_date, shift
                    ORDER BY trip_start_utc)
            )) / 60.0 AS gap_min
        FROM shifted
    ),
    -- ONE shared clamp feeds histogram + moments + bunching (no num/denom drift),
    -- byte-identical to the legacy filtered CTE.
    filtered AS (
        SELECT
            provider_id, route_id, direction_id, shift, gap_min,
            LEAST(GREATEST(width_bucket(gap_min, {_HEADWAY_GAP_HIST_EDGES_SQL}), 1), 20) - 1 AS bin_idx
        FROM gaps
        WHERE gap_min IS NOT NULL AND gap_min > 0 AND gap_min < 240
    ),
    agg AS (
        SELECT
            provider_id, route_id, direction_id, shift,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_min) AS med_gap
        FROM filtered
        GROUP BY provider_id, route_id, direction_id, shift
    ),
    -- per-DAY bunched, against the per-day-per-group median (NOT summed across a window).
    bunch AS (
        SELECT
            f.provider_id, f.route_id, f.direction_id, f.shift,
            COUNT(*) FILTER (WHERE f.gap_min < 0.5 * a.med_gap) AS bunched_count
        FROM filtered AS f
        JOIN agg AS a USING (provider_id, route_id, direction_id, shift)
        GROUP BY f.provider_id, f.route_id, f.direction_id, f.shift
    ),
    -- raw trip-instance count per grain (pre-gap): the read-time argmax basis (D5).
    trips AS (
        SELECT provider_id, route_id, direction_id, shift, COUNT(*) AS trip_n
        FROM shifted
        GROUP BY provider_id, route_id, direction_id, shift
    )
    INSERT INTO gold.route_headway_shift_daily (
        provider_id, route_id, service_local_date, shift, direction_id,
        gap_count, sum_gap_min, sum_gap_sq_min, bunched_gap_count, trip_count,
        gap_histogram, built_at_utc
    )
    SELECT
        f.provider_id, f.route_id, :local_date, f.shift, f.direction_id,
        COUNT(*)::integer                                AS gap_count,
        COALESCE(SUM(f.gap_min), 0)::numeric             AS sum_gap_min,
        COALESCE(SUM(f.gap_min * f.gap_min), 0)::numeric AS sum_gap_sq_min,
        COALESCE(MAX(b.bunched_count), 0)::integer       AS bunched_gap_count,
        COALESCE(MAX(t.trip_n), 0)::integer              AS trip_count,
        ARRAY[
            COUNT(*) FILTER (WHERE f.bin_idx = 0),  COUNT(*) FILTER (WHERE f.bin_idx = 1),
            COUNT(*) FILTER (WHERE f.bin_idx = 2),  COUNT(*) FILTER (WHERE f.bin_idx = 3),
            COUNT(*) FILTER (WHERE f.bin_idx = 4),  COUNT(*) FILTER (WHERE f.bin_idx = 5),
            COUNT(*) FILTER (WHERE f.bin_idx = 6),  COUNT(*) FILTER (WHERE f.bin_idx = 7),
            COUNT(*) FILTER (WHERE f.bin_idx = 8),  COUNT(*) FILTER (WHERE f.bin_idx = 9),
            COUNT(*) FILTER (WHERE f.bin_idx = 10), COUNT(*) FILTER (WHERE f.bin_idx = 11),
            COUNT(*) FILTER (WHERE f.bin_idx = 12), COUNT(*) FILTER (WHERE f.bin_idx = 13),
            COUNT(*) FILTER (WHERE f.bin_idx = 14), COUNT(*) FILTER (WHERE f.bin_idx = 15),
            COUNT(*) FILTER (WHERE f.bin_idx = 16), COUNT(*) FILTER (WHERE f.bin_idx = 17),
            COUNT(*) FILTER (WHERE f.bin_idx = 18), COUNT(*) FILTER (WHERE f.bin_idx = 19)
        ]::smallint[]                                    AS gap_histogram,
        :built_at_utc
    FROM filtered AS f
    LEFT JOIN bunch  AS b USING (provider_id, route_id, direction_id, shift)
    LEFT JOIN trips  AS t USING (provider_id, route_id, direction_id, shift)
    -- D7 weekend-leak guard: only attribute to a WEEKDAY :local_date.
    WHERE EXTRACT(ISODOW FROM CAST(:local_date AS date)) BETWEEN 1 AND 5
    GROUP BY f.provider_id, f.route_id, f.shift, f.direction_id
    ON CONFLICT (provider_id, route_id, service_local_date, shift, direction_id) DO UPDATE SET
        gap_count         = EXCLUDED.gap_count,
        sum_gap_min       = EXCLUDED.sum_gap_min,
        sum_gap_sq_min    = EXCLUDED.sum_gap_sq_min,
        bunched_gap_count = EXCLUDED.bunched_gap_count,
        trip_count        = EXCLUDED.trip_count,
        gap_histogram     = EXCLUDED.gap_histogram,
        built_at_utc      = EXCLUDED.built_at_utc
    """
)

UPSERT_REPEAT_OFFENDER_DAILY = text(
    """
    WITH obs AS (
        SELECT
            f.provider_id,
            f.route_id,
            f.trip_id,
            f.vehicle_id,
            f.delay_seconds,
            timezone(dp.timezone, f.captured_at_utc)::date AS local_day
        FROM gold.fact_trip_delay_snapshot AS f
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = f.provider_id
        WHERE f.provider_id = :provider_id
          AND f.captured_at_utc >= now() - make_interval(days => :fact_retention_days)
          AND f.delay_seconds IS NOT NULL
          AND ABS(f.delay_seconds) <= 3600
          AND f.route_id IS NOT NULL
    ),
    agg AS (
        SELECT
            'trip'::text AS entity_kind,
            trip_id AS entity_id,
            route_id,
            provider_id,
            COUNT(DISTINCT local_day) FILTER (WHERE delay_seconds > 300)
                AS recurrence_days,
            ROUND(AVG(delay_seconds)::numeric, 1) AS avg_delay_seconds
        FROM obs
        WHERE trip_id IS NOT NULL
        GROUP BY provider_id, route_id, trip_id
        UNION ALL
        SELECT
            'vehicle'::text,
            vehicle_id,
            route_id,
            provider_id,
            COUNT(DISTINCT local_day) FILTER (WHERE delay_seconds > 300),
            ROUND(AVG(delay_seconds)::numeric, 1)
        FROM obs
        WHERE vehicle_id IS NOT NULL
        GROUP BY provider_id, route_id, vehicle_id
    )
    INSERT INTO gold.repeat_offender (
        provider_id,
        entity_kind,
        entity_id,
        route_id,
        recurrence_days,
        window_days,
        avg_delay_seconds,
        severity_label,
        built_at_utc
    )
    SELECT
        provider_id,
        entity_kind,
        entity_id,
        route_id,
        recurrence_days,
        14,
        avg_delay_seconds,
        CASE
            WHEN recurrence_days >= 10 OR avg_delay_seconds > 600 THEN 'critical'
            WHEN recurrence_days >= 5 THEN 'high'
            ELSE 'watch'
        END,
        :built_at_utc
    FROM agg
    WHERE recurrence_days >= 3
    ON CONFLICT (provider_id, entity_kind, entity_id, route_id) DO UPDATE SET
        recurrence_days = EXCLUDED.recurrence_days,
        window_days = EXCLUDED.window_days,
        avg_delay_seconds = EXCLUDED.avg_delay_seconds,
        severity_label = EXCLUDED.severity_label,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

REPORTING_AGGREGATE_UPSERTS = {
    "route_delay_hourly": UPSERT_ROUTE_DELAY_HOURLY,
    "stop_delay_hourly": UPSERT_STOP_DELAY_HOURLY,
    "stop_delay_weekly": UPSERT_STOP_DELAY_WEEKLY,
    "stop_delay_monthly": UPSERT_STOP_DELAY_MONTHLY,
    "route_habit_score": UPSERT_ROUTE_HABIT_SCORE,
    "repeated_problem_route_stop": UPSERT_REPEATED_PROBLEM_ROUTE_STOP,
    "citizen_accountability_daily": UPSERT_CITIZEN_ACCOUNTABILITY_DAILY,
    "route_headway_by_shift": UPSERT_ROUTE_HEADWAY_DAILY,
    "repeat_offender": UPSERT_REPEAT_OFFENDER_DAILY,
    "route_headway_by_direction_shift": UPSERT_ROUTE_HEADWAY_DIRECTION_DAILY,
}

# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WarmRollupBuildResult:
    provider_id: str
    since_utc: datetime | None
    built_trip_delay_periods: int
    completed_at_utc: datetime
    reporting_aggregate_row_counts: dict[str, int] = field(default_factory=dict)
    built_route_percentile_days: int = 0
    built_stop_percentile_days: int = 0
    built_route_cancellation_days: int = 0
    built_route_occupancy_days: int = 0
    built_stop_occupancy_days: int = 0
    built_route_service_span_days: int = 0
    built_route_skipped_stop_days: int = 0
    built_route_delay_spine_days: int = 0
    built_route_headway_shift_daily_days: int = 0
    # True when the provider is enrolled but not yet seeded (no gold.dim_provider
    # row): the build is a logged no-op rather than a crash.
    skipped_not_seeded: bool = False

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "skipped_not_seeded": self.skipped_not_seeded,
            "since_utc": self.since_utc.isoformat() if self.since_utc else None,
            "built_trip_delay_periods": self.built_trip_delay_periods,
            "built_route_percentile_days": self.built_route_percentile_days,
            "built_stop_percentile_days": self.built_stop_percentile_days,
            "built_route_cancellation_days": self.built_route_cancellation_days,
            "built_route_occupancy_days": self.built_route_occupancy_days,
            "built_stop_occupancy_days": self.built_stop_occupancy_days,
            "built_route_service_span_days": self.built_route_service_span_days,
            "built_route_skipped_stop_days": self.built_route_skipped_stop_days,
            "built_route_delay_spine_days": self.built_route_delay_spine_days,
            "built_route_headway_shift_daily_days": self.built_route_headway_shift_daily_days,
            "reporting_aggregate_row_counts": self.reporting_aggregate_row_counts,
            "completed_at_utc": self.completed_at_utc.isoformat(),
        }


# ---------------------------------------------------------------------------
# Public function
# ---------------------------------------------------------------------------


def _safe_rowcount(result) -> int:  # noqa: ANN001
    rowcount = getattr(result, "rowcount", 0)
    return max(int(rowcount or 0), 0)


def _build_percentile_days(
    engine,  # noqa: ANN001
    *,
    provider_id: str,
    rollup_kind: str,
    upsert,  # noqa: ANN001
    today_key: int,
    floor_key: int,
    now: datetime,
    select_missing=SELECT_MISSING_PERCENTILE_DAYS,  # noqa: ANN001
) -> int:
    """Build + watermark each missing closed local day for one append-only kind.

    Append-only + resumable: a day already in warm_rollup_periods (matched on
    midnight-UTC of the local date) is skipped, so accrued history is never
    recomputed, and each day is built + watermarked in its OWN transaction — so a
    cold-start build that is interrupted (e.g. a CI timeout) resumes from the last
    committed day instead of restarting from scratch.

    The missing-day calendar is enumerated by the indexed, provider-local
    snapshot_date_key over the sargable [floor_key, today_key) closed-day window
    (an index range scan, not a full-table timezone() scan). select_missing
    defaults to the trip-delay-fact calendar; pass SELECT_MISSING_OCCUPANCY_DAYS
    for rollups sourced from fact_vehicle_snapshot so the missing-day calendar
    matches the data table.
    """
    with engine.begin() as conn:
        rows = conn.execute(
            select_missing,
            {
                "provider_id": provider_id,
                "rollup_kind": rollup_kind,
                "today_key": today_key,
                "floor_key": floor_key,
            },
        ).fetchall()
    built = 0
    for row in rows:
        local_date = row.local_date
        # Watermark key = midnight UTC of the closed local date (documented
        # overload of warm_rollup_periods.period_start_utc, which otherwise holds
        # 5-minute UTC bins).
        period_start_utc = datetime(local_date.year, local_date.month, local_date.day, tzinfo=UTC)
        with engine.begin() as conn:
            conn.execute(
                upsert,
                {
                    "provider_id": provider_id,
                    "local_date": local_date,
                    "date_key": row.date_key,
                    "built_at_utc": now,
                },
            )
            conn.execute(
                UPSERT_WARM_ROLLUP_PERIOD,
                {
                    "provider_id": provider_id,
                    "rollup_kind": rollup_kind,
                    "period_start_utc": period_start_utc,
                    "built_at_utc": now,
                },
            )
        built += 1
    return built


def build_warm_rollups(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
    since_utc: datetime | None = None,
) -> WarmRollupBuildResult:
    """Build 5-minute warm rollups for missing periods.

    Idempotent: skips any period already recorded in warm_rollup_periods.
    Optionally restricted to periods with captured_at_utc >= since_utc.
    """
    if settings is None:
        settings = get_settings()
    open_window_days = getattr(settings, "GOLD_REPORTING_OPEN_WINDOW_DAYS", 10)
    fact_retention_days = getattr(settings, "GOLD_FACT_RETENTION_DAYS", 14)
    if not (0 < open_window_days < fact_retention_days):
        raise ValueError(
            "GOLD_REPORTING_OPEN_WINDOW_DAYS must be greater than 0 and less than "
            "GOLD_FACT_RETENTION_DAYS"
        )
    if engine is None:
        engine = make_engine(settings)

    # Enrolled-but-unseeded providers have no gold.dim_provider row, so the
    # dp.timezone calendar lookup below would raise NoResultFound and abort the
    # all-providers Daily Warm Rollups run. Skip cleanly instead (exit 0).
    with engine.begin() as conn:
        seeded = provider_is_seeded(conn, provider_id)
    if not seeded:
        logger.info(
            "provider %r not seeded (no gold.dim_provider row) — skipping build-warm-rollups",
            provider_id,
        )
        return WarmRollupBuildResult(
            provider_id=provider_id,
            since_utc=since_utc,
            built_trip_delay_periods=0,
            completed_at_utc=utc_now(),
            skipped_not_seeded=True,
        )
    built_trip_delay = 0
    reporting_aggregate_row_counts: dict[str, int] = {}
    now = utc_now()

    # Provider-local "today" anchors the closed-day calendar for the append-only
    # daily builders. percentile_lookback_days (= fact_retention_days - 1) keeps the
    # oldest candidate day off partially-pruned facts; today excludes the still-open
    # current day. Both become sargable snapshot_date_key (YYYYMMDD) bounds so each
    # daily build is an index range scan rather than a full-table timezone() scan.
    percentile_lookback_days = fact_retention_days - 1
    with engine.begin() as conn:
        today_local = conn.execute(
            text(
                "SELECT (now() AT TIME ZONE dp.timezone)::date "
                "FROM gold.dim_provider AS dp WHERE dp.provider_id = :provider_id"
            ),
            {"provider_id": provider_id},
        ).scalar_one()
    today_key = int(today_local.strftime("%Y%m%d"))
    floor_key = int((today_local - timedelta(days=percentile_lookback_days)).strftime("%Y%m%d"))

    with engine.begin() as conn:
        # Trip delay summary
        rows = conn.execute(
            SELECT_MISSING_TRIP_DELAY_PERIODS,
            {"provider_id": provider_id, "since_utc": since_utc},
        ).fetchall()
        for row in rows:
            period = row.period_start_utc
            conn.execute(
                UPSERT_TRIP_DELAY_SUMMARY_5M,
                {
                    "provider_id": provider_id,
                    "period_start_utc": period,
                    "built_at_utc": now,
                },
            )
            conn.execute(
                UPSERT_WARM_ROLLUP_PERIOD,
                {
                    "provider_id": provider_id,
                    "rollup_kind": "trip_delay_summary_5m",
                    "period_start_utc": period,
                    "built_at_utc": now,
                },
            )
            built_trip_delay += 1

    # Append-only daily rollups (route/stop percentiles + cancellation + occupancy
    # band + service span + skipped stop). Built AFTER the 5m section commits and
    # BEFORE the DELETE+UPSERT reporting tables, and deliberately NOT registered in
    # REPORTING_AGGREGATE_TABLES, so accrued history is never wiped. Each call
    # commits per-day in its own transaction (see _build_percentile_days), so a
    # cold-start build is resumable across runs.
    built_route_percentile = _build_percentile_days(
        engine,
        provider_id=provider_id,
        rollup_kind="route_percentile_daily",
        upsert=UPSERT_ROUTE_DELAY_PERCENTILE_DAILY,
        today_key=today_key,
        floor_key=floor_key,
        now=now,
    )
    built_stop_percentile = _build_percentile_days(
        engine,
        provider_id=provider_id,
        rollup_kind="stop_percentile_daily",
        upsert=UPSERT_STOP_DELAY_PERCENTILE_DAILY,
        today_key=today_key,
        floor_key=floor_key,
        now=now,
    )
    # Cancellation reads fact_trip_delay_snapshot, so it reuses the default
    # trip-delay missing-day calendar. Occupancy reads fact_vehicle_snapshot,
    # so it MUST use SELECT_MISSING_OCCUPANCY_DAYS over its own source table.
    built_route_cancellation = _build_percentile_days(
        engine,
        provider_id=provider_id,
        rollup_kind="route_cancellation_daily",
        upsert=UPSERT_ROUTE_CANCELLATION_DAILY,
        today_key=today_key,
        floor_key=floor_key,
        now=now,
    )
    built_route_occupancy = _build_percentile_days(
        engine,
        provider_id=provider_id,
        rollup_kind="route_occupancy_band_daily",
        upsert=UPSERT_ROUTE_OCCUPANCY_BAND_DAILY,
        today_key=today_key,
        floor_key=floor_key,
        now=now,
        select_missing=SELECT_MISSING_OCCUPANCY_DAYS,
    )
    # Per-stop occupancy band reduction — twin of route occupancy, same
    # fact_vehicle_snapshot source, so it MUST use SELECT_MISSING_OCCUPANCY_DAYS too.
    built_stop_occupancy = _build_percentile_days(
        engine,
        provider_id=provider_id,
        rollup_kind="stop_occupancy_band_daily",
        upsert=UPSERT_STOP_OCCUPANCY_BAND_DAILY,
        today_key=today_key,
        floor_key=floor_key,
        now=now,
        select_missing=SELECT_MISSING_OCCUPANCY_DAYS,
    )
    # Service span reads fact_trip_delay_snapshot → default trip-delay calendar.
    built_route_service_span = _build_percentile_days(
        engine,
        provider_id=provider_id,
        rollup_kind="route_service_span_daily",
        upsert=UPSERT_ROUTE_SERVICE_SPAN_DAILY,
        today_key=today_key,
        floor_key=floor_key,
        now=now,
    )
    # Skipped-stop reads fact_trip_delay_snapshot (carried skip count) → default.
    built_route_skipped_stop = _build_percentile_days(
        engine,
        provider_id=provider_id,
        rollup_kind="route_skipped_stop_daily",
        upsert=UPSERT_ROUTE_SKIPPED_STOP_DAILY,
        today_key=today_key,
        floor_key=floor_key,
        now=now,
    )
    # Route delay spine — finest-grain additive delay metric family (hour x direction).
    # Reads fact_trip_delay_snapshot -> default trip-delay missing-day calendar.
    # APPEND-ONLY (NOT in REPORTING_AGGREGATE_TABLES); accrued history is never wiped.
    built_route_delay_spine = _build_percentile_days(
        engine,
        provider_id=provider_id,
        rollup_kind="route_delay_spine",
        upsert=UPSERT_ROUTE_DELAY_SPINE,
        today_key=today_key,
        floor_key=floor_key,
        now=now,
    )

    # Headway shift-daily spine — finest-grain additive HEADWAY family (shift x direction).
    # Reads fact_trip_delay_snapshot -> default trip-delay missing-day calendar.
    # APPEND-ONLY (NOT in REPORTING_AGGREGATE_TABLES); accrued history is never wiped.
    built_route_headway_shift_daily = _build_percentile_days(
        engine,
        provider_id=provider_id,
        rollup_kind="route_headway_shift_daily",
        upsert=UPSERT_ROUTE_HEADWAY_SHIFT_DAILY,
        today_key=today_key,
        floor_key=floor_key,
        now=now,
    )

    # Reporting aggregates (full DELETE+UPSERT refresh) in their own transaction,
    # so a failure here never rolls back the committed 5m + daily-builder work.
    with engine.begin() as conn:
        for table_name in REPORTING_AGGREGATE_TABLES:
            delete_params = {"provider_id": provider_id}
            upsert_params = {
                "provider_id": provider_id,
                "built_at_utc": now,
                # Binds the ~14d fact window into the three fact-coupled headway/
                # repeat-offender upserts so they track GOLD_FACT_RETENTION_DAYS
                # instead of a drift-prone literal. Harmless on rollup-fed upserts
                # that never reference it.
                "fact_retention_days": fact_retention_days,
            }
            if table_name in WINDOWED_HISTORY_TABLES:
                delete_params = {
                    **delete_params,
                    "built_at_utc": now,
                    "open_window_days": open_window_days,
                }
                upsert_params = {
                    **upsert_params,
                    "open_window_days": open_window_days,
                }
            conn.execute(
                DELETE_REPORTING_AGGREGATES[table_name],
                delete_params,
            )
            result = conn.execute(
                REPORTING_AGGREGATE_UPSERTS[table_name],
                upsert_params,
            )
            reporting_aggregate_row_counts[table_name] = _safe_rowcount(result)

    return WarmRollupBuildResult(
        provider_id=provider_id,
        since_utc=since_utc,
        built_trip_delay_periods=built_trip_delay,
        reporting_aggregate_row_counts=reporting_aggregate_row_counts,
        completed_at_utc=now,
        built_route_percentile_days=built_route_percentile,
        built_stop_percentile_days=built_stop_percentile,
        built_route_cancellation_days=built_route_cancellation,
        built_route_occupancy_days=built_route_occupancy,
        built_stop_occupancy_days=built_stop_occupancy,
        built_route_service_span_days=built_route_service_span,
        built_route_skipped_stop_days=built_route_skipped_stop,
        built_route_delay_spine_days=built_route_delay_spine,
        built_route_headway_shift_daily_days=built_route_headway_shift_daily,
    )
