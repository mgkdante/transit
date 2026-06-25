"""Historic-tier builders (Phase 3) — gold reliability rollups -> /v1/historic.

OTP convention: otp_pct = round(100 * on_time / known), NULL if either side is
unknown or known==0. Stop reliability keeps a documented severe-delay proxy,
now over real per-stop delay observations rather than route-smeared values.
avg_delay_min = round(avg_delay_seconds/60, 1); severe_pct = round(100*sev/known, 1).
p50_min/p90_min for route/stop reliability come from an append-only daily
percentile rollup (route: per local day; stop: most recent closed day); weekly
and monthly grains stay None because percentiles are not additively composable.
"""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING

from sqlalchemy import text

from transit_ops.settings import get_settings
from transit_ops.snapshots.builders._helpers import (
    _ROUTE_NAMES_SQL,
    _ROUTE_SCHEDULE_SQL,  # noqa: F401 - re-exported via package __init__ for parity
    _SHIFT_ORDER,
    _STOP_NAMES_SQL,
    MIN_N_RATE,
    WILSON_Z,
    _avg_delay_min,
    _build_habits_matrix,
    _entity_name_maps,
    _iso,
    _iso_date,
    _opt_int,
    _opt_iso,
    _otp_pct,
    _otp_pct_severe_proxy,
    _public_impact_score,
    _route_sort_key,
    _sane_en,
    _scheduled_headway_by_shift,
    _severe_pct,
    _severity_code,
    _wilson_hi,
    _wilson_lo,
)
from transit_ops.gold.rollups import DELAY_HISTOGRAM_EDGES as _SPINE_EDGES
from transit_ops.snapshots.contract import (
    AlertBreakdown,
    AlertBreakdownBucket,
    AlertHistory,
    AlertHistoryEntry,
    CancellationPeriod,
    CrosstabCell,
    CrowdingDelayCell,
    HeadwayPeriod,
    Hotspot,
    Hotspots,
    NetworkShift,
    NetworkTrend,
    OccupancyByDow,
    OccupancyByGrain,
    OccupancyMix,
    Offender,
    Provenance,
    ProvenanceConformance,
    ProvenanceFreshness,
    ProvenanceSource,
    Receipt,
    ReceiptWorstRoute,
    ReceiptWorstStop,
    ReliabilityPeriod,
    RepeatOffenders,
    RouteDayOfWeek,
    RouteDelayHistogramBin,
    RouteReliability,
    ServiceSpanPeriod,
    SkippedStopPeriod,
    StopByRoute,
    StopReliability,
    StopReliabilityPeriod,
    TrendPoint,
    WeakStop,
)

if TYPE_CHECKING:  # pragma: no cover - typing only
    from sqlalchemy.engine import Connection


_OCCUPANCY_BANDS = ("empty", "many_seats", "few_seats", "standing", "full")


def _pctile_from_hist(hist: list[int] | None, q: float) -> float | None:
    """q-th percentile (minutes) via CDF interpolation over the 21-bin spine histogram.

    ``hist[i]`` is the observation count in bin ``i`` = ``[_SPINE_EDGES[i],
    _SPINE_EDGES[i+1])`` seconds for i in 0..19; bin 20 is the ``[3600, +inf)``
    overflow (no upper edge). Returns None on an empty / all-zero histogram —
    honest absence, never a fabricated 0. The result is rounded to 0.1 min to
    match ``_avg_delay_min``.

    Finding B (terminal floor): when the percentile lands in bin 20 the value is
    pinned at ``_SPINE_EDGES[20] / 60`` = 60.0 min. This *understates* the real
    tail (the spine clamps |delay| <= 3600s anyway, so true outliers are not in
    the histogram), but it is the only finite floor available and is locked by a
    test. Mass in bin 0 is safe — its lower edge ``_SPINE_EDGES[0]`` exists, so a
    very-early percentile interpolates to a negative-minute value without ever
    indexing past the edge array.
    """
    if not hist:
        return None
    total = sum(hist)
    if total <= 0:
        return None
    target = q * total
    cumulative = 0
    for bin_idx, count in enumerate(hist):
        if count <= 0:
            continue
        if cumulative + count >= target:
            lo = _SPINE_EDGES[bin_idx]
            if bin_idx + 1 >= len(_SPINE_EDGES):
                # Terminal overflow bin: no upper edge -> floor at the last edge.
                return round(lo / 60.0, 1)
            hi = _SPINE_EDGES[bin_idx + 1]
            frac = (target - cumulative) / count
            return round((lo + (hi - lo) * frac) / 60.0, 1)
        cumulative += count
    # Unreachable when target <= total, but clamp to the last edge defensively.
    return round(_SPINE_EDGES[-1] / 60.0, 1)


def _occupancy_mix_from_bands(row: object) -> OccupancyMix | None:
    """Build OccupancyMix from summed band counts; honest-None when total is 0.

    Mirrors the live build_network occupancy honesty: an all-zero distribution is
    indistinguishable from a real all-empty fleet, so absence of telemetry must
    surface as None rather than a fabricated all-zero mix.
    """
    if row is None:
        return None
    counts = {band: int(row[band] or 0) for band in _OCCUPANCY_BANDS}
    total = sum(counts.values())
    if not total:
        return None
    return OccupancyMix(**{band: counts[band] / total for band in _OCCUPANCY_BANDS})


def _delay_by_crowding_cells(
    rows, route_pctile: dict[str, tuple[float | None, float | None]]
) -> list[CrowdingDelayCell]:
    """Build per-band delay×crowding cells from per-day band-count + delay rows.

    For each route×day: pick the DOMINANT band (argmax of that day's 5 band
    counts; days with zero band observations are skipped) and bucket that day's
    delay under it. Ties resolve to canonical band order (``_OCCUPANCY_BANDS``,
    i.e. the lower-crowding band wins) — deterministic, rare in practice.
    Aggregate per band over the window: avg_delay_min is
    observation-weighted by the day's delay_observation_count; p50_min is a
    best-effort observation-weighted mean of the contributing daily p50s (an
    approximation — daily percentiles are not exactly additively composable);
    observation_count sums the daily delay observations; day_count counts the
    contributing days. Bands with zero contributing days are omitted; the result
    is empty when the route has no band-bearing telemetry in the window.
    """
    # Per band: weighted delay-seconds sum, p50-seconds weighted sum, obs sum,
    # day count. p50 sums track their own obs total because p50 may be absent on
    # a day the avg-delay is present.
    acc: dict[str, dict[str, float]] = {}
    for r in rows:
        counts = {band: int(r[band] or 0) for band in _OCCUPANCY_BANDS}
        total = sum(counts.values())
        if not total:
            continue  # no occupancy observations this day -> no dominant band
        dominant = max(_OCCUPANCY_BANDS, key=lambda b: counts[b])
        delay_obs = int(r["delay_obs"] or 0)
        avg_sec = r["avg_delay_sec"]
        p50_min, _p90 = route_pctile.get(_iso_date(r["d"]), (None, None))
        cell = acc.setdefault(
            dominant,
            {"w_delay_sec": 0.0, "obs": 0, "w_p50_min": 0.0, "p50_obs": 0, "days": 0},
        )
        cell["days"] += 1
        if avg_sec is not None and delay_obs:
            cell["w_delay_sec"] += float(avg_sec) * delay_obs
            cell["obs"] += delay_obs
        if p50_min is not None and delay_obs:
            cell["w_p50_min"] += float(p50_min) * delay_obs
            cell["p50_obs"] += delay_obs
    cells: list[CrowdingDelayCell] = []
    for band in _OCCUPANCY_BANDS:  # canonical band order
        cell = acc.get(band)
        if not cell:
            continue
        obs = int(cell["obs"])
        p50_obs = int(cell["p50_obs"])
        cells.append(
            CrowdingDelayCell(
                band=band,
                avg_delay_min=(
                    round(cell["w_delay_sec"] / obs / 60.0, 1) if obs else None
                ),
                p50_min=(round(cell["w_p50_min"] / p50_obs, 1) if p50_obs else None),
                observation_count=(obs or None),
                day_count=int(cell["days"]),
            )
        )
    return cells


# --------------------------------------------------------------------------
# build_network_trend
# --------------------------------------------------------------------------

# Daily OTP + weighted-avg delay from the hourly rollup (last ~90 local days).
# Local date = the provider's wall-clock date of the hour bucket.
_TREND_DAILY_SQL = text(
    """
    SELECT timezone(dp.timezone, rdh.period_start_utc)::date AS local_date,
           SUM(rdh.delay_observation_count)                  AS known_obs,
           CASE WHEN COUNT(*) = COUNT(rdh.on_time_observation_count)
                THEN SUM(rdh.on_time_observation_count)
           END AS on_time,
           SUM(rdh.avg_delay_seconds * rdh.delay_observation_count) AS weighted_delay_sec
    FROM gold.route_delay_hourly AS rdh
    JOIN gold.dim_provider AS dp ON dp.provider_id = rdh.provider_id
    WHERE rdh.provider_id = :provider_id
      AND rdh.period_start_utc >= now() - interval '90 days'
    GROUP BY timezone(dp.timezone, rdh.period_start_utc)::date
    """
)

# p90 delay (minutes) + distinct vehicles from capped raw facts (~14d retained).
_TREND_FACT_SQL = text(
    """
    SELECT timezone(dp.timezone, fts.captured_at_utc)::date AS local_date,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY fts.delay_seconds) / 60.0 AS p90_min,
           count(DISTINCT fts.vehicle_id)                                       AS vehicles
    FROM gold.fact_trip_delay_snapshot AS fts
    JOIN gold.dim_provider AS dp ON dp.provider_id = fts.provider_id
    WHERE fts.provider_id = :provider_id
      AND fts.delay_seconds IS NOT NULL
      AND ABS(fts.delay_seconds) <= 3600
      AND fts.captured_at_utc >= now() - make_interval(days => :fact_retention_days)
    GROUP BY timezone(dp.timezone, fts.captured_at_utc)::date
    """
)

# Network-wide daily cancellation rate from the append-only per-route rollup:
# sum numerators/denominators across routes, then derive the day's rate.
_TREND_CANCELLATION_SQL = text(
    """
    SELECT provider_local_date AS local_date,
           SUM(canceled_trip_days) AS canceled,
           SUM(total_trip_days)    AS total
    FROM gold.route_cancellation_daily
    WHERE provider_id = :provider_id
    GROUP BY provider_local_date
    """
)

# Network-wide daily crowding band-shares from the append-only per-route band
# reduction: sum band counts across routes per local date.
_TREND_OCCUPANCY_SQL = text(
    """
    SELECT provider_local_date AS local_date,
           SUM(empty_count)      AS empty,
           SUM(many_seats_count) AS many_seats,
           SUM(few_seats_count)  AS few_seats,
           SUM(standing_count)   AS standing,
           SUM(full_count)       AS full
    FROM gold.route_occupancy_band_daily
    WHERE provider_id = :provider_id
    GROUP BY provider_local_date
    """
)

# --- WEEK / MONTH grain trend series -------------------------------------------
# Additive-optional re-aggregation of the SAME daily sources into ISO-week /
# calendar-month buckets, observation-weighted EXACTLY like the daily queries
# above (mirror their math byte-for-byte; only the GROUP BY key changes from the
# day to date_trunc(<unit>, day)). p90_min/vehicles are intentionally NOT
# re-aggregated here — the raw fact window is ~14d only and percentiles are not
# additively composable, so those stay None on every week/month point.
#
# Postgres date_trunc('week', d) returns the Monday of d's ISO week;
# date_trunc('month', d) returns the 1st of d's month. We cast back to ::date so
# the bucket key is a plain local date (the TrendPoint.date contract).
#
# Each query carries a UNIQUE `-- trend:<grain>:<source>` marker comment so the
# publish-test FakeConn can dispatch a single canned row-set per query without
# the substrings colliding with one another or with the daily variants.

# Hourly-rollup OTP + weighted-avg delay, grouped by the bucket-start local date.
# Mirrors _TREND_DAILY_SQL: same SUM(delay)/CASE-guard on_time/weighted-delay and
# the same sargable upper-history bound on the indexed period_start_utc column,
# only the date expression is wrapped in date_trunc(<unit>, ...). The bound is
# widened to ~371 days (>= 53 ISO weeks / 12 months) so the coarse buckets stay
# useful while the scan over gold.route_delay_hourly stays bounded (the daily
# variant caps at 90 days; an unbounded full-retention scan is a cost/timeout
# risk — see the prior prod rollup-timeout incident).
_TREND_WEEKLY_SQL = text(
    """
    SELECT date_trunc('week', timezone(dp.timezone, rdh.period_start_utc))::date AS local_date,
           SUM(rdh.delay_observation_count)                  AS known_obs,
           CASE WHEN COUNT(*) = COUNT(rdh.on_time_observation_count)
                THEN SUM(rdh.on_time_observation_count)
           END AS on_time,
           SUM(rdh.avg_delay_seconds * rdh.delay_observation_count) AS weighted_delay_sec
    FROM gold.route_delay_hourly AS rdh  -- trend:week:hourly
    JOIN gold.dim_provider AS dp ON dp.provider_id = rdh.provider_id
    WHERE rdh.provider_id = :provider_id
      AND rdh.period_start_utc >= now() - interval '371 days'
    GROUP BY date_trunc('week', timezone(dp.timezone, rdh.period_start_utc))::date
    """
)

_TREND_MONTHLY_SQL = text(
    """
    SELECT date_trunc('month', timezone(dp.timezone, rdh.period_start_utc))::date AS local_date,
           SUM(rdh.delay_observation_count)                  AS known_obs,
           CASE WHEN COUNT(*) = COUNT(rdh.on_time_observation_count)
                THEN SUM(rdh.on_time_observation_count)
           END AS on_time,
           SUM(rdh.avg_delay_seconds * rdh.delay_observation_count) AS weighted_delay_sec
    FROM gold.route_delay_hourly AS rdh  -- trend:month:hourly
    JOIN gold.dim_provider AS dp ON dp.provider_id = rdh.provider_id
    WHERE rdh.provider_id = :provider_id
      AND rdh.period_start_utc >= now() - interval '371 days'
    GROUP BY date_trunc('month', timezone(dp.timezone, rdh.period_start_utc))::date
    """
)

# Cancellation numerators/denominators summed across routes, bucketed by week/month.
# Mirrors _TREND_CANCELLATION_SQL; provider_local_date is already a local date.
# Intentionally unbounded to match the daily variant: gold.route_cancellation_daily
# is a small append-only per-route-day rollup (not a fact table), so a full scan is
# cheap. Do NOT add a horizon bound here without also bounding the daily variant —
# diverging them would make the week/month rate cover a different window than daily.
_TREND_CANCELLATION_WEEKLY_SQL = text(
    """
    SELECT date_trunc('week', provider_local_date)::date AS local_date,
           SUM(canceled_trip_days) AS canceled,
           SUM(total_trip_days)    AS total
    FROM gold.route_cancellation_daily  -- trend:week:cancel
    WHERE provider_id = :provider_id
    GROUP BY date_trunc('week', provider_local_date)::date
    """
)

_TREND_CANCELLATION_MONTHLY_SQL = text(
    """
    SELECT date_trunc('month', provider_local_date)::date AS local_date,
           SUM(canceled_trip_days) AS canceled,
           SUM(total_trip_days)    AS total
    FROM gold.route_cancellation_daily  -- trend:month:cancel
    WHERE provider_id = :provider_id
    GROUP BY date_trunc('month', provider_local_date)::date
    """
)

# Crowding band-counts summed across routes, bucketed by week/month.
# Mirrors _TREND_OCCUPANCY_SQL. Intentionally unbounded for the same reason as the
# cancellation variants above: gold.route_occupancy_band_daily is a small
# append-only per-route-day rollup; the daily variant is unbounded, so stay
# consistent with it rather than diverging the window.
_TREND_OCCUPANCY_WEEKLY_SQL = text(
    """
    SELECT date_trunc('week', provider_local_date)::date AS local_date,
           SUM(empty_count)      AS empty,
           SUM(many_seats_count) AS many_seats,
           SUM(few_seats_count)  AS few_seats,
           SUM(standing_count)   AS standing,
           SUM(full_count)       AS full
    FROM gold.route_occupancy_band_daily  -- trend:week:occupancy
    WHERE provider_id = :provider_id
    GROUP BY date_trunc('week', provider_local_date)::date
    """
)

_TREND_OCCUPANCY_MONTHLY_SQL = text(
    """
    SELECT date_trunc('month', provider_local_date)::date AS local_date,
           SUM(empty_count)      AS empty,
           SUM(many_seats_count) AS many_seats,
           SUM(few_seats_count)  AS few_seats,
           SUM(standing_count)   AS standing,
           SUM(full_count)       AS full
    FROM gold.route_occupancy_band_daily  -- trend:month:occupancy
    WHERE provider_id = :provider_id
    GROUP BY date_trunc('month', provider_local_date)::date
    """
)

# Canonical emit order for the network grains (mirrors the route/stop surface).
# The network by_shift / by_daytype grains derive from the route delay spine across
# all routes (see _NETWORK_SPINE_BY_* + _network_spine_rows below); the old
# per-route fold tables were dropped in migration 0064.
_NETWORK_SHIFT_ORDER = ("am_peak", "midday", "pm_peak", "evening", "night")
_NETWORK_DAYTYPE_ORDER = ("weekday", "weekend")


def _blank_trend_point() -> dict:
    return {
        "otp_pct": None,
        "avg_delay_min": None,
        "p90_min": None,
        "vehicles": None,
        "cancellation_rate": None,
        "occupancy_mix": None,
        "observation_count": None,
        "wilson_lo": None,
        "wilson_hi": None,
    }


def _trend_points(
    conn: Connection,
    params: dict,
    *,
    otp_sql,
    cancellation_sql,
    occupancy_sql,
    fact_sql=None,
) -> list[TrendPoint]:
    """Re-aggregate the daily sources into one TrendPoint list at a single grain.

    Shared by the daily/weekly/monthly builders so the OTP / weighted-avg /
    cancellation / occupancy mapping is identical across grains and only the
    bucket key (local date vs ISO-week-start vs month-start) differs — supplied
    by the caller via the bucketed SQL. `fact_sql` (p90/vehicles from the ~14d
    raw fact window) is only passed for the daily grain; week/month omit it, so
    their p90_min/vehicles stay None (the fact window is not week/month-composable).
    Points are returned sorted ascending by bucket date.
    """
    points: dict[str, dict] = {}

    for r in conn.execute(otp_sql, params).mappings():
        known_obs = r["known_obs"]
        weighted = r["weighted_delay_sec"]
        avg_delay_sec = (
            (float(weighted) / float(known_obs))
            if known_obs and weighted is not None
            else None
        )
        entry = _blank_trend_point()
        entry["otp_pct"] = _otp_pct(r["on_time"], known_obs)
        entry["avg_delay_min"] = _avg_delay_min(avg_delay_sec)
        # observation_count + Wilson are the OTP/avg denominator for THIS bucket
        # only — cancellation/occupancy below keep their own denominators.
        entry["observation_count"] = _opt_int(known_obs)
        entry["wilson_lo"] = _wilson_lo(r["on_time"], known_obs)
        entry["wilson_hi"] = _wilson_hi(r["on_time"], known_obs)
        points[_iso_date(r["local_date"])] = entry

    if fact_sql is not None:
        for r in conn.execute(fact_sql, params).mappings():
            entry = points.setdefault(_iso_date(r["local_date"]), _blank_trend_point())
            entry["p90_min"] = (
                round(float(r["p90_min"]), 1) if r["p90_min"] is not None else None
            )
            entry["vehicles"] = _opt_int(r["vehicles"])

    for r in conn.execute(cancellation_sql, params).mappings():
        entry = points.setdefault(_iso_date(r["local_date"]), _blank_trend_point())
        total = r["total"]
        canceled = r["canceled"]
        entry["cancellation_rate"] = (
            round(100.0 * float(canceled) / float(total), 2)
            if total and canceled is not None
            else None
        )

    for r in conn.execute(occupancy_sql, params).mappings():
        entry = points.setdefault(_iso_date(r["local_date"]), _blank_trend_point())
        entry["occupancy_mix"] = _occupancy_mix_from_bands(r)

    return [
        TrendPoint(
            date=d,
            otp_pct=v["otp_pct"],
            avg_delay_min=v["avg_delay_min"],
            p90_min=v["p90_min"],
            vehicles=v["vehicles"],
            cancellation_rate=v["cancellation_rate"],
            occupancy_mix=v["occupancy_mix"],
            observation_count=v["observation_count"],
            wilson_lo=v["wilson_lo"],
            wilson_hi=v["wilson_hi"],
        )
        for d, v in sorted(points.items())
    ]


def build_network_trend(conn: Connection, *, provider_id: str = "stm", generated_utc: str) -> NetworkTrend:
    """Build historic/network_trend.json — daily + weekly + monthly trend points.

    Daily `series`: OTP + weighted-avg delay from the hourly rollup (~90 days)
    merged with p90 delay + distinct vehicles from the raw fact table (~14 days
    retained), so p90_min/vehicles are present only for the recent days the fact
    table still covers. `weekly`/`monthly` re-aggregate the SAME daily sources
    (hourly OTP/avg, cancellation, occupancy) into ISO-week / calendar-month
    buckets, observation-weighted identically; p90_min/vehicles stay None on
    those grains (the ~14d fact window is not additively composable). The
    by_shift/by_daytype grains derive from gold.route_delay_spine across all routes.
    """
    # fact_retention_days binds the ~14d fact window into _TREND_FACT_SQL so it
    # tracks GOLD_FACT_RETENTION_DAYS instead of a drift-prone literal. The bind
    # is harmless on the otp/cancellation/occupancy SQL (which never reference it).
    params = {
        "provider_id": provider_id,
        "fact_retention_days": get_settings().GOLD_FACT_RETENTION_DAYS,
    }

    series = _trend_points(
        conn,
        params,
        otp_sql=_TREND_DAILY_SQL,
        cancellation_sql=_TREND_CANCELLATION_SQL,
        occupancy_sql=_TREND_OCCUPANCY_SQL,
        fact_sql=_TREND_FACT_SQL,
    )
    weekly = _trend_points(
        conn,
        params,
        otp_sql=_TREND_WEEKLY_SQL,
        cancellation_sql=_TREND_CANCELLATION_WEEKLY_SQL,
        occupancy_sql=_TREND_OCCUPANCY_WEEKLY_SQL,
    )
    monthly = _trend_points(
        conn,
        params,
        otp_sql=_TREND_MONTHLY_SQL,
        cancellation_sql=_TREND_CANCELLATION_MONTHLY_SQL,
        occupancy_sql=_TREND_OCCUPANCY_MONTHLY_SQL,
    )

    # Network-wide reliability by time-of-day shift + weekday/weekend day-type,
    # derived from the route delay spine across all routes (REAL on_time/known OTP,
    # observation-weighted avg delay, honest-NULL on zero-obs grains).
    by_shift = _network_spine_rows(
        conn, _NETWORK_SPINE_BY_SHIFT_SQL, params, _NETWORK_SHIFT_ORDER
    )
    by_daytype = _network_spine_rows(
        conn, _NETWORK_SPINE_BY_DAYTYPE_SQL, params, _NETWORK_DAYTYPE_ORDER
    )

    return NetworkTrend(
        generated_utc=generated_utc,
        series=series,
        weekly=weekly,
        monthly=monthly,
        by_shift=by_shift,
        by_daytype=by_daytype,
    )


# --------------------------------------------------------------------------
# build_route_reliability
# --------------------------------------------------------------------------

_ROUTE_REL_DAILY_SQL = text(
    """
    SELECT provider_local_date              AS d,
           delay_observation_count AS known_obs,
           on_time_observation_count AS on_time,
           avg_delay_seconds                AS avg_delay_sec,
           severe_delay_observation_count   AS severe
    FROM gold.public_route_reliability_daily
    WHERE provider_id = :provider_id AND route_id = :route_id
    ORDER BY provider_local_date DESC
    LIMIT 30
    """
)

# Observed headway per shift (pre-computed in gold) + Tier-2 regularity columns.
_ROUTE_HEADWAY_OBSERVED_SQL = text(
    """
    SELECT shift, observed_headway_min, sample_count, headway_cov, bunched_count
    FROM gold.route_headway_by_shift
    WHERE provider_id = :provider_id AND route_id = :route_id
    """
)

_ROUTE_HABIT_SQL = text(
    """
    SELECT day_of_week_iso, hour_of_day_local, repeat_problem_score
    FROM gold.route_habit_score
    WHERE provider_id = :provider_id AND route_id = :route_id
    """
)

# Per-stop weekly delay for this route — top weak stops by average delay.
_ROUTE_WEAK_STOPS_SQL = text(
    """
    SELECT stop_id,
           SUM(observation_count)                          AS obs,
           SUM(avg_delay_seconds * observation_count)      AS weighted_delay_sec,
           SUM(severe_delay_count)                         AS severe
    FROM gold.stop_delay_weekly
    WHERE provider_id = :provider_id AND route_id = :route_id
    GROUP BY stop_id
    """
)


# Daily p50/p90 delay from the append-only percentile rollup (route grain).
_ROUTE_PERCENTILE_DAILY_SQL = text(
    """
    SELECT provider_local_date, p50_delay_seconds, p90_delay_seconds
    FROM gold.route_delay_percentile_daily
    WHERE provider_id = :provider_id AND route_id = :route_id
    """
)

# The per-route day_of_week / by_shift / by_daytype / by_shift_daytype breakdowns now
# derive at read time from gold.route_delay_spine (see _ROUTE_SPINE_* + the spine
# consumer helpers below); the stored fold tables were dropped in migration 0064.

# Per-direction + weekday/weekend observed headway (sibling table; the busiest-direction
# route_headway_by_shift is left untouched). Direction is encoded into the free shift string.
_ROUTE_HEADWAY_DIRECTION_SQL = text(
    """
    SELECT shift, direction_id, service_day_kind, observed_headway_min
    FROM gold.route_headway_by_direction_shift
    WHERE provider_id = :provider_id AND route_id = :route_id
    ORDER BY direction_id, service_day_kind, shift
    """
)

# Per-route daily cancellation rate from the append-only rollup (last 30 closed
# local days). cancellation_rate_pct is None when total_trip_days=0.
_ROUTE_CANCELLATION_DAILY_SQL = text(
    """
    SELECT provider_local_date, cancellation_rate_pct, canceled_trip_days, total_trip_days
    FROM gold.route_cancellation_daily
    WHERE provider_id = :provider_id AND route_id = :route_id
    ORDER BY provider_local_date DESC
    LIMIT 30
    """
)

# Trailing-30d crowding band-shares for the route from the append-only daily
# band-count reduction. Summed counts are divided into shares at read time;
# honest-None when no band-bearing telemetry exists in the window.
_ROUTE_OCCUPANCY_BAND_WINDOW_SQL = text(
    """
    SELECT SUM(rob.empty_count)       AS empty,
           SUM(rob.many_seats_count)  AS many_seats,
           SUM(rob.few_seats_count)   AS few_seats,
           SUM(rob.standing_count)    AS standing,
           SUM(rob.full_count)        AS full
    FROM gold.route_occupancy_band_daily AS rob
    JOIN gold.dim_provider AS dp ON dp.provider_id = rob.provider_id
    WHERE rob.provider_id = :provider_id AND rob.route_id = :route_id
      AND rob.provider_local_date >= (now() AT TIME ZONE dp.timezone)::date - 30
    """
)

# S7 §04: crowding band-shares grouped by ISO weekday (1=Mon..7=Sun) over the same
# trailing-30d window as occupancy_mix, for the weekday/weekend split. Reuses the
# route_occupancy_band_daily source; honest-None per weekday with no band telemetry
# (handled by _occupancy_mix_from_bands). provider_local_date is ALREADY provider-
# local, so ISODOW needs NO timezone cast (unlike route_delay_day_of_week, which
# extracts from a UTC timestamp). Unique discriminator for test dispatch:
# "-- occupancy_by_dow".
_ROUTE_OCCUPANCY_BY_DOW_SQL = text(
    """
    -- occupancy_by_dow
    SELECT EXTRACT(ISODOW FROM rob.provider_local_date)::int AS day_of_week_iso,
           SUM(rob.empty_count)       AS empty,
           SUM(rob.many_seats_count)  AS many_seats,
           SUM(rob.few_seats_count)   AS few_seats,
           SUM(rob.standing_count)    AS standing,
           SUM(rob.full_count)        AS full
    FROM gold.route_occupancy_band_daily AS rob
    JOIN gold.dim_provider AS dp ON dp.provider_id = rob.provider_id
    WHERE rob.provider_id = :provider_id AND rob.route_id = :route_id
      AND rob.provider_local_date >= (now() AT TIME ZONE dp.timezone)::date - 30
    GROUP BY EXTRACT(ISODOW FROM rob.provider_local_date)
    ORDER BY day_of_week_iso
    """
)

# S7 §04: per-day band counts over the trailing-30d window, bucketed in Python into
# grain-aware crowding mixes (day = most recent closed local day, week = trailing
# 7d, month = full 30d — month reconciles with the scalar occupancy_mix). Unique
# discriminator for test dispatch: "-- occupancy_by_grain".
_ROUTE_OCCUPANCY_BY_GRAIN_SQL = text(
    """
    -- occupancy_by_grain
    SELECT rob.provider_local_date AS d,
           rob.empty_count       AS empty,
           rob.many_seats_count  AS many_seats,
           rob.few_seats_count   AS few_seats,
           rob.standing_count    AS standing,
           rob.full_count        AS full
    FROM gold.route_occupancy_band_daily AS rob
    JOIN gold.dim_provider AS dp ON dp.provider_id = rob.provider_id
    WHERE rob.provider_id = :provider_id AND rob.route_id = :route_id
      AND rob.provider_local_date >= (now() AT TIME ZONE dp.timezone)::date - 30
    ORDER BY rob.provider_local_date DESC
    """
)

# Per-route service-span / first-last punctuality from the append-only daily
# rollup (last 30 closed local days). Unique discriminator for test dispatch:
# "first_trip_start_utc". (Ends with the shared ORDER BY provider_local_date DESC.)
_ROUTE_SERVICE_SPAN_SQL = text(
    """
    SELECT provider_local_date, first_trip_start_utc, last_trip_start_utc,
           service_span_min, first_trip_delay_seconds, last_trip_delay_seconds,
           trip_count
    FROM gold.route_service_span_daily
    WHERE provider_id = :provider_id AND route_id = :route_id
    ORDER BY provider_local_date DESC
    LIMIT 30
    """
)

# Per-route skipped-stop rate from the append-only daily rollup (last 30 closed
# local days). Unique discriminator for test dispatch: "skipped_stop_rate_pct".
_ROUTE_SKIPPED_STOP_SQL = text(
    """
    SELECT provider_local_date, skipped_stop_rate_pct, skipped_stop_count,
           stop_time_update_count
    FROM gold.route_skipped_stop_daily
    WHERE provider_id = :provider_id AND route_id = :route_id
    ORDER BY provider_local_date DESC
    LIMIT 30
    """
)

# Track-B delay×crowding: per route×day join of the append-only band-count
# reduction (dominant band chosen at read time, in Python) with the per-day
# delay rollup, over a trailing 30d window. A literal 30d window is fine here
# because both inputs are gold rollups, not capped raw facts. Unique discriminator
# for the FakeConn substring dispatch: the "-- delay_by_crowding" needle, which
# MUST precede the broader "public_route_reliability_daily" / "route_occupancy_
# band_daily" needles in the test dispatch table.
_ROUTE_CROWDING_DELAY_SQL = text(
    """
    -- delay_by_crowding: dominant-band attribution chosen in Python
    SELECT rocd.provider_local_date              AS d,
           rocd.empty_count                      AS empty,
           rocd.many_seats_count                 AS many_seats,
           rocd.few_seats_count                  AS few_seats,
           rocd.standing_count                   AS standing,
           rocd.full_count                       AS full,
           prr.avg_delay_seconds                 AS avg_delay_sec,
           prr.delay_observation_count           AS delay_obs
    FROM gold.route_occupancy_band_daily AS rocd
    JOIN gold.dim_provider AS dp ON dp.provider_id = rocd.provider_id
    LEFT JOIN gold.public_route_reliability_daily AS prr
      ON prr.provider_id = rocd.provider_id
     AND prr.route_id = rocd.route_id
     AND prr.provider_local_date = rocd.provider_local_date
    WHERE rocd.provider_id = :provider_id AND rocd.route_id = :route_id
      AND rocd.provider_local_date >= (now() AT TIME ZONE dp.timezone)::date - 30
    """
)


# --------------------------------------------------------------------------
# S7-B PR1 Task 3 — route delay-cube reads via ONE spine projector
# --------------------------------------------------------------------------
# build_route_reliability derives every route delay-cube
# breakdown (by_shift / by_daytype / weekly / monthly / day_of_week / crosstab)
# at READ time from gold.route_delay_spine through this one parameterized
# projector, instead of one stored fold table per breakdown. The count/share
# columns are plain SUMs of the spine's additive counts, so otp_pct / severe_pct
# / observation_count are BYTE-IDENTICAL to the fact path; avg_delay_min (pooled
# sum / in-clamp count) and p50/p90 (CDF interpolation over the summed histogram)
# are the allowed rebaseline. The shift / day_type / dow / week / month grain
# expressions read hour_of_day_local and service_local_date DIRECTLY — both are
# already provider-local in the spine, so timezone() is NEVER re-applied — and
# mirror the fold builders' CASE / EXTRACT / date_trunc logic exactly.

# Shift + day_type buckets: byte-identical to UPSERT_ROUTE_DELAY_BY_SHIFT /
# _BY_DAYTYPE, but over the spine's pre-localized columns.
_SPINE_SHIFT_CASE = """CASE
            WHEN hour_of_day_local BETWEEN 6 AND 8 THEN 'am_peak'
            WHEN hour_of_day_local BETWEEN 9 AND 14 THEN 'midday'
            WHEN hour_of_day_local BETWEEN 15 AND 18 THEN 'pm_peak'
            WHEN hour_of_day_local BETWEEN 19 AND 22 THEN 'evening'
            ELSE 'night'
        END"""

_SPINE_DAYTYPE_CASE = """CASE
            WHEN EXTRACT(ISODOW FROM service_local_date) BETWEEN 1 AND 5 THEN 'weekday'
            ELSE 'weekend'
        END"""

# The 21 element-wise histogram bin sums (Postgres arrays are 1-based). Their sum
# is the in-clamp (ghost-excluded) delay count = the pooled-avg denominator; the
# full vector feeds _pctile_from_hist for p50/p90.
_SPINE_HIST_COLS = ",\n        ".join(
    f"SUM(delay_histogram[{k}])::bigint AS h{k}" for k in range(1, 22)
)

# ONE projector template. {dims} selects the grain column(s) (aliased to what each
# consumer reads); {group_by} is the matching positional GROUP BY + ORDER BY (the
# ORDER BY makes the spine's row order deterministic for byte-stable output).
# on_time is a PLAIN SUM, NOT the fold's CASE WHEN COUNT(*)=COUNT(on_time) guard:
# a spine cell's on_time is NULL iff it has zero delays (delay_obs=0), which adds
# nothing to SUM(on_time) AND nothing to SUM(known_obs), so SUM(on_time)/
# SUM(known_obs) reproduces the fold otp_pct exactly — even for an hour where one
# direction has delays and another is silent (route_delay_hourly merges
# directions, so the fold guard never sees that per-direction NULL). NO window
# clause: the spine accrues forward and every breakdown reads the full accrual —
# the deliberate fix for the "monthly can't hold a month" bug; the cutover gate
# seeds closed days inside the shared window so both paths cover identical days.
# {entity_clause} = " AND route_id = :route_id" for the per-route reads; "" for the
# network reads (aggregate the spine across ALL routes by shift / day_type).
_ROUTE_SPINE_PROJECT_TEMPLATE = """
    SELECT
        {dims}
        SUM(observation_count)::bigint          AS obs,
        SUM(delay_observation_count)::bigint    AS known_obs,
        SUM(on_time_observation_count)::bigint  AS on_time,
        SUM(severe_delay_count)::bigint         AS severe,
        SUM(sum_delay_seconds)::bigint          AS sum_delay_sec,
        {hist_cols}
    FROM gold.route_delay_spine
    WHERE provider_id = :provider_id{entity_clause}
    GROUP BY {group_by}
    ORDER BY {group_by}
"""

_ROUTE_ENTITY_CLAUSE = " AND route_id = :route_id"


def _spine_project_sql(dims: str, group_by: str, entity_clause: str = _ROUTE_ENTITY_CLAUSE):  # noqa: ANN202
    """Format the ONE projector template for a fold (dims carry their trailing comma)."""
    return text(
        _ROUTE_SPINE_PROJECT_TEMPLATE.format(
            dims=dims, hist_cols=_SPINE_HIST_COLS, group_by=group_by, entity_clause=entity_clause
        )
    )


def _route_spine_sql(dims: str, group_by: str):  # noqa: ANN202
    return _spine_project_sql(dims, group_by, _ROUTE_ENTITY_CLAUSE)


_ROUTE_SPINE_BY_SHIFT_SQL = _route_spine_sql(f"{_SPINE_SHIFT_CASE} AS grain,", "1")
_ROUTE_SPINE_BY_DAYTYPE_SQL = _route_spine_sql(f"{_SPINE_DAYTYPE_CASE} AS grain,", "1")
_ROUTE_SPINE_WEEKLY_SQL = _route_spine_sql(
    "date_trunc('week', service_local_date)::date AS d,", "1"
)
_ROUTE_SPINE_MONTHLY_SQL = _route_spine_sql(
    "date_trunc('month', service_local_date)::date AS d,", "1"
)
_ROUTE_SPINE_DOW_SQL = _route_spine_sql(
    "EXTRACT(ISODOW FROM service_local_date)::integer AS day_of_week_iso,", "1"
)
_ROUTE_SPINE_CROSSTAB_SQL = _route_spine_sql(
    f"{_SPINE_SHIFT_CASE} AS shift,\n        {_SPINE_DAYTYPE_CASE} AS day_type,", "1, 2"
)

# Network-wide reads: the SAME projector with NO route filter -> aggregate the spine
# across ALL routes by shift / day_type. otp_known == known_obs here because a spine
# cell's on_time is NULL iff delay_obs=0 (so SUM(delay_obs) FILTER(on_time NOT NULL)
# equals SUM(delay_obs)), reproducing the fact network's scoped-OTP denominator.
_NETWORK_SPINE_BY_SHIFT_SQL = _spine_project_sql(f"{_SPINE_SHIFT_CASE} AS grain,", "1", "")
_NETWORK_SPINE_BY_DAYTYPE_SQL = _spine_project_sql(f"{_SPINE_DAYTYPE_CASE} AS grain,", "1", "")


def _spine_hist_and_avg(r):  # noqa: ANN001, ANN202
    """(21-bin summed histogram, ghost-excluded pooled avg seconds-or-None) from a row.

    avg = SUM(sum_delay_seconds) / in-clamp count, where the in-clamp count is the
    sum of the histogram bins (Finding C: ghost-excluded numerator AND denominator).
    None when there are no in-clamp delays -> _avg_delay_min -> honest None.
    """
    hist = [int(r[f"h{k}"] or 0) for k in range(1, 22)]
    in_clamp = sum(hist)
    avg_sec = (float(r["sum_delay_sec"]) / in_clamp) if in_clamp else None
    return hist, avg_sec


def _spine_delay_histogram(hist: list[int]) -> "list[RouteDelayHistogramBin] | None":
    """Signed-delay distribution bins from the 21-bin spine histogram (honest-None).

    bin i = [_SPINE_EDGES[i], _SPINE_EDGES[i + 1]) seconds for i in 0..19; bin 20 is
    the [3600s, +inf) overflow (hi_sec=None). None when there are no in-window
    observations; otherwise ALL 21 bins are emitted (zeros included) so the UI draws
    the full shape. Edges are the same DELAY_HISTOGRAM_EDGES that power p50/p90.
    """
    if not hist or sum(hist) <= 0:
        return None
    bins: list[RouteDelayHistogramBin] = []
    for i, count in enumerate(hist):
        hi = _SPINE_EDGES[i + 1] if i + 1 < len(_SPINE_EDGES) else None
        bins.append(RouteDelayHistogramBin(lo_sec=_SPINE_EDGES[i], hi_sec=hi, count=int(count)))
    return bins


def _spine_reliability_period(r, *, grain: str, date) -> "ReliabilityPeriod":  # noqa: ANN001
    hist, avg_sec = _spine_hist_and_avg(r)
    return ReliabilityPeriod(
        grain=grain,
        date=date,
        otp_pct=_otp_pct(r["on_time"], r["known_obs"]),
        avg_delay_min=_avg_delay_min(avg_sec),
        p50_min=_pctile_from_hist(hist, 0.5),
        p90_min=_pctile_from_hist(hist, 0.9),
        severe_pct=_severe_pct(r["known_obs"], r["severe"]),
        observation_count=_opt_int(r["known_obs"]),
        on_time=_opt_int(r["on_time"]),
        wilson_lo=_wilson_lo(r["on_time"], r["known_obs"]),
        wilson_hi=_wilson_hi(r["on_time"], r["known_obs"]),
        delay_histogram=_spine_delay_histogram(hist),
    )


def _spine_route_periods(conn, params) -> "list[ReliabilityPeriod]":  # noqa: ANN001
    """Weekly + monthly + by-shift + by-daytype ReliabilityPeriod rows from the spine."""
    periods: list[ReliabilityPeriod] = []
    for grain, sql, has_date in (
        ("week", _ROUTE_SPINE_WEEKLY_SQL, True),
        ("month", _ROUTE_SPINE_MONTHLY_SQL, True),
        (None, _ROUTE_SPINE_BY_SHIFT_SQL, False),
        (None, _ROUTE_SPINE_BY_DAYTYPE_SQL, False),
    ):
        for r in conn.execute(sql, params).mappings():
            periods.append(
                _spine_reliability_period(
                    r,
                    grain=grain if grain is not None else str(r["grain"]),
                    date=_iso_date(r["d"]) if has_date else None,
                )
            )
    return periods


def _spine_route_dow(conn, params) -> "list[RouteDayOfWeek]":  # noqa: ANN001
    out: list[RouteDayOfWeek] = []
    for r in conn.execute(_ROUTE_SPINE_DOW_SQL, params).mappings():
        _hist, avg_sec = _spine_hist_and_avg(r)
        out.append(
            RouteDayOfWeek(
                day_of_week_iso=int(r["day_of_week_iso"]),
                avg_delay_min=_avg_delay_min(avg_sec),
                severe_pct=_severe_pct(r["known_obs"], r["severe"]),
                observation_count=_opt_int(r["obs"]),
            )
        )
    return out


def _spine_route_crosstab(conn, params) -> "list[CrosstabCell]":  # noqa: ANN001
    out: list[CrosstabCell] = []
    for r in conn.execute(_ROUTE_SPINE_CROSSTAB_SQL, params).mappings():
        _hist, avg_sec = _spine_hist_and_avg(r)
        out.append(
            CrosstabCell(
                shift=str(r["shift"]),
                day_type=str(r["day_type"]),
                otp_pct=_otp_pct(r["on_time"], r["known_obs"]),
                avg_delay_min=_avg_delay_min(avg_sec),
                severe_pct=_severe_pct(r["known_obs"], r["severe"]),
                observation_count=_opt_int(r["obs"]),
            )
        )
    return out


def _network_spine_rows(conn, sql, params, order) -> "list[NetworkShift]":  # noqa: ANN001
    """Network NetworkShift rows from the spine projector (all routes, no filter).

    otp_pct = on_time/known_obs (== fact's on_time/otp_known: the spine's
    on_time-NULL-iff-delay_obs=0 invariant makes the FILTER a no-op); severe_pct over
    the full known_obs; avg = ghost-excluded pooled mean (rebaseline, allow-move).
    Honest-None when the grain has no known-delay observations.
    """
    by_grain: dict[str, NetworkShift] = {}
    for r in conn.execute(sql, params).mappings():
        known = r["known_obs"]
        _hist, avg_sec = _spine_hist_and_avg(r)
        grain = str(r["grain"])
        by_grain[grain] = NetworkShift(
            grain=grain,
            otp_pct=_otp_pct(r["on_time"], known),
            avg_delay_min=_avg_delay_min(avg_sec),
            severe_pct=_severe_pct(known, r["severe"]),
            observation_count=_opt_int(known),
            wilson_lo=_wilson_lo(r["on_time"], known),
            wilson_hi=_wilson_hi(r["on_time"], known),
        )
    ordered = [by_grain[g] for g in order if g in by_grain]
    ordered.extend(by_grain[g] for g in sorted(set(by_grain) - set(order)))
    return ordered


def build_route_reliability(
    conn: Connection,
    *,
    provider_id: str = "stm",
    route_id: str,
    generated_utc: str,
    weak_stops_limit: int = 100,
) -> RouteReliability:
    """Build historic/route_reliability/{route_id}.json.

    periods: daily (last 30) + weekly + monthly, all using observation-based OTP.
    headway: observed weekday trip-start gaps from the busiest direction (gold
             rollup) vs scheduled representative-weekday first-stop departures
             from the busiest direction, with non-negative excess_wait per shift.
    habits:  7x24 per-route relative-problem matrix (isodow 1..7 x hour 0..23;
             each cell a fraction of the route's worst hour, null = no data).
    weak_stops: the worst N stops on the route by average delay (N =
                weak_stops_limit, default 100; the web exposes a selectable
                worst-N over what is served). Honest: a route with fewer stops
                than the limit returns only what exists, never padded.

    The delay-cube breakdowns (weekly/monthly/by_shift/by_daytype/day_of_week +
    the shift×day_type crosstab) derive at read time from gold.route_delay_spine
    via the parameterized projector above. The daily grain, headway, weak_stops,
    habits, cancellations, occupancy, service spans, skipped stops and crowding
    read kept tables / carve-outs.
    """
    params = {"provider_id": provider_id, "route_id": route_id}

    # --- periods (daily/weekly/monthly observation-based OTP) ---
    # Daily p50/p90 from the append-only percentile rollup, keyed by local date;
    # weekly/monthly stay None (percentiles are not additively composable).
    route_pctile: dict[str, tuple[float | None, float | None]] = {
        _iso_date(r["provider_local_date"]): (
            _avg_delay_min(r["p50_delay_seconds"]),
            _avg_delay_min(r["p90_delay_seconds"]),
        )
        for r in conn.execute(_ROUTE_PERCENTILE_DAILY_SQL, params).mappings()
    }
    periods: list[ReliabilityPeriod] = []
    for r in conn.execute(_ROUTE_REL_DAILY_SQL, params).mappings():
        p50_min, p90_min = route_pctile.get(_iso_date(r["d"]), (None, None))
        periods.append(
            ReliabilityPeriod(
                grain="day",
                date=_iso_date(r["d"]),
                otp_pct=_otp_pct(r["on_time"], r["known_obs"]),
                avg_delay_min=_avg_delay_min(r["avg_delay_sec"]),
                p50_min=p50_min,
                p90_min=p90_min,
                severe_pct=_severe_pct(r["known_obs"], r["severe"]),
                observation_count=_opt_int(r["known_obs"]),
                on_time=_opt_int(r["on_time"]),
                wilson_lo=_wilson_lo(r["on_time"], r["known_obs"]),
                wilson_hi=_wilson_hi(r["on_time"], r["known_obs"]),
            )
        )
    # weekly + monthly + the granularity grains (time-of-day shift, weekday/weekend
    # day-type) — the route delay cube, all derived from gold.route_delay_spine
    # (byte-identical counts/shares, rebaselined avg + p50/p90). The daily grain
    # above is source-independent (public_route_reliability_daily is a carve-out).
    periods.extend(_spine_route_periods(conn, params))

    # --- headway: observed and scheduled both use weekday busiest-direction semantics ---
    observed: dict[str, float] = {}
    # Tier-2 regularity, keyed by shift (busiest-direction rows). Use .get() so an
    # old artifact / fixture lacking the columns yields None rather than KeyError.
    regularity: dict[str, tuple[float | None, float | None]] = {}
    for r in conn.execute(_ROUTE_HEADWAY_OBSERVED_SQL, params).mappings():
        shift = str(r["shift"])
        if r["observed_headway_min"] is not None:
            observed[shift] = float(r["observed_headway_min"])
        cov_raw = r.get("headway_cov")
        bunched = r.get("bunched_count")
        sample = r.get("sample_count")
        cov = float(cov_raw) if cov_raw is not None else None
        # bunched_pct honest-None when no gaps observed.
        bunched_pct = (
            round(100.0 * float(bunched) / float(sample), 1)
            if bunched is not None and sample
            else None
        )
        regularity[shift] = (cov, bunched_pct)

    scheduled = _scheduled_headway_by_shift(conn, provider_id=provider_id, route_id=route_id)

    # Order shift buckets by the canonical time-of-day sequence (mirrors
    # build_route's _SHIFT_ORDER); any unknown shift label sorts last by name.
    def _shift_key(s: str) -> tuple[int, str]:
        return (_SHIFT_ORDER.index(s), "") if s in _SHIFT_ORDER else (len(_SHIFT_ORDER), s)

    headway: list[HeadwayPeriod] = []
    for shift in sorted(set(scheduled) | set(observed), key=_shift_key):
        sched = scheduled.get(shift)
        obs = observed.get(shift)
        both = sched is not None and obs is not None
        # Excess wait is a rider-cost metric: early/frequent observed service
        # stays at zero rather than publishing negative wait.
        excess = round(max(0.0, obs - sched), 1) if both else None
        cov, bunched_pct = regularity.get(shift, (None, None))
        headway.append(
            HeadwayPeriod(
                shift=shift,
                scheduled_min=sched,
                observed_min=round(obs, 1) if obs is not None else None,
                excess_wait_min=excess,
                cov=cov,
                bunched_pct=bunched_pct,
            )
        )

    # --- per-direction + weekday/weekend headway (additive HeadwayPeriod rows).
    #     S7-B Pattern A: the shift is the BARE time-of-day token; direction + day-type
    #     are typed fields (no more {shift}_dir{N}_weekend packed string). The live
    #     strip filters direction_id-bearing rows out; the surface renders them grouped.
    for r in conn.execute(_ROUTE_HEADWAY_DIRECTION_SQL, params).mappings():
        dir_obs = r["observed_headway_min"]
        headway.append(
            HeadwayPeriod(
                shift=str(r["shift"]),
                direction_id=int(r["direction_id"]),
                day_type=str(r["service_day_kind"]),
                scheduled_min=None,
                observed_min=round(float(dir_obs), 1) if dir_obs is not None else None,
                excess_wait_min=None,
            )
        )

    # --- habits: 7x24 per-route relative-problem matrix (isodow 1..7 x hour 0..23) ---
    habits = _build_habits_matrix(conn.execute(_ROUTE_HABIT_SQL, params).mappings())

    # --- weak_stops: worst N (weak_stops_limit) by average delay seconds ---
    names = {
        str(r["stop_id"]): r["stop_name"]
        for r in conn.execute(_STOP_NAMES_SQL, params).mappings()
    }
    weak_rows = []
    for r in conn.execute(_ROUTE_WEAK_STOPS_SQL, params).mappings():
        obs = r["obs"]
        weighted = r["weighted_delay_sec"]
        avg_sec = (float(weighted) / float(obs)) if obs and weighted is not None else None
        if avg_sec is None:
            continue
        weak_rows.append((str(r["stop_id"]), avg_sec))
    weak_rows.sort(key=lambda t: t[1], reverse=True)
    weak_stops = [
        WeakStop(id=sid, name=names.get(sid), avg_delay_min=round(avg_sec / 60.0, 1))
        for sid, avg_sec in weak_rows[:weak_stops_limit]
    ]

    # --- route display name: current dim first, dim_route_history fallback ---
    route_names = {
        str(r["route_id"]): r["route_name"]
        for r in conn.execute(_ROUTE_NAMES_SQL, {"provider_id": provider_id}).mappings()
    }

    # --- day_of_week: per-route weekday seasonality (spine GROUP BY ISO dow) ---
    route_dow = _spine_route_dow(conn, params)

    # --- cancellations: per-day rate history (most recent 30 closed days, ASC) ---
    cancellations = [
        CancellationPeriod(
            grain="day",
            date=_iso_date(r["provider_local_date"]),
            cancellation_rate_pct=(
                float(r["cancellation_rate_pct"])
                if r["cancellation_rate_pct"] is not None
                else None
            ),
            canceled_trip_days=_opt_int(r["canceled_trip_days"]),
            total_trip_days=_opt_int(r["total_trip_days"]),
        )
        for r in sorted(
            conn.execute(_ROUTE_CANCELLATION_DAILY_SQL, params).mappings(),
            key=lambda r: r["provider_local_date"],
        )
    ]

    # --- occupancy_mix: trailing-30d crowding band-shares (honest-None) ---
    occupancy_mix = _occupancy_mix_from_bands(
        conn.execute(_ROUTE_OCCUPANCY_BAND_WINDOW_SQL, params).mappings().fetchone()
    )

    # --- occupancy_by_dow: crowding mix per ISO weekday (S7 §04 weekday/weekend
    #     split; honest-None per weekday with no band telemetry; sparse) ---
    occupancy_by_dow = [
        OccupancyByDow(
            day_of_week_iso=int(r["day_of_week_iso"]),
            mix=_occupancy_mix_from_bands(r),
        )
        for r in conn.execute(_ROUTE_OCCUPANCY_BY_DOW_SQL, params).mappings()
    ]

    # --- occupancy_by_grain: grain-aware crowding mix (S7 §04). day = most recent
    #     closed local day, week = trailing 7d, month = full 30d window (month
    #     reconciles with occupancy_mix). Bucketed in Python; honest-None per grain
    #     with no band telemetry; empty list when there is no occupancy telemetry. ---
    occ_grain_rows = list(conn.execute(_ROUTE_OCCUPANCY_BY_GRAIN_SQL, params).mappings())
    occupancy_by_grain: list[OccupancyByGrain] = []
    if occ_grain_rows:
        most_recent = max(r["d"] for r in occ_grain_rows)
        grain_windows = {
            "day": [r for r in occ_grain_rows if r["d"] == most_recent],
            "week": [r for r in occ_grain_rows if (most_recent - r["d"]).days <= 6],
            "month": occ_grain_rows,
        }
        occupancy_by_grain = [
            OccupancyByGrain(
                grain=grain,
                mix=_occupancy_mix_from_bands(
                    {band: sum(int(r[band] or 0) for r in rows) for band in _OCCUPANCY_BANDS}
                ),
            )
            for grain, rows in grain_windows.items()
        ]

    # --- service spans: per-day first/last + span history (30 closed days, ASC) ---
    service_spans = [
        ServiceSpanPeriod(
            date=_iso_date(r["provider_local_date"]),
            first_trip_utc=_opt_iso(r["first_trip_start_utc"]),
            last_trip_utc=_opt_iso(r["last_trip_start_utc"]),
            service_span_min=_opt_int(r["service_span_min"]),
            first_trip_delay_min=_avg_delay_min(r["first_trip_delay_seconds"]),
            last_trip_delay_min=_avg_delay_min(r["last_trip_delay_seconds"]),
            trip_count=_opt_int(r["trip_count"]),
        )
        for r in sorted(
            conn.execute(_ROUTE_SERVICE_SPAN_SQL, params).mappings(),
            key=lambda r: r["provider_local_date"],
        )
    ]

    # --- skipped stops: per-day rate history (30 closed days, ASC; ramp-in) ---
    skipped_stops = [
        SkippedStopPeriod(
            date=_iso_date(r["provider_local_date"]),
            skipped_stop_rate_pct=(
                float(r["skipped_stop_rate_pct"])
                if r["skipped_stop_rate_pct"] is not None
                else None
            ),
            skipped_stop_count=_opt_int(r["skipped_stop_count"]),
            stop_time_update_count=_opt_int(r["stop_time_update_count"]),
        )
        for r in sorted(
            conn.execute(_ROUTE_SKIPPED_STOP_SQL, params).mappings(),
            key=lambda r: r["provider_local_date"],
        )
    ]

    # --- delay_by_crowding: per-band delay×crowding over trailing 30d (honest
    #     empty when no occupancy telemetry; reuses route_pctile for daily p50) ---
    delay_by_crowding = _delay_by_crowding_cells(
        conn.execute(_ROUTE_CROWDING_DELAY_SQL, params).mappings(), route_pctile
    )

    # --- by_shift_daytype: tier-3 2D shift x day_type delay crosstab (SPARSE —
    #     only grains with observations; honest-None per metric), derived from the
    #     spine GROUP BY (shift, day_type). ---
    by_shift_daytype = _spine_route_crosstab(conn, params)

    return RouteReliability(
        generated_utc=generated_utc,
        id=route_id,
        name=route_names.get(route_id),
        periods=periods,
        headway=headway,
        habits=habits,
        day_of_week=route_dow,
        weak_stops=weak_stops,
        cancellations=cancellations,
        occupancy_mix=occupancy_mix,
        service_spans=service_spans,
        skipped_stops=skipped_stops,
        delay_by_crowding=delay_by_crowding,
        by_shift_daytype=by_shift_daytype,
        occupancy_by_grain=occupancy_by_grain,
        occupancy_by_dow=occupancy_by_dow,
    )


# --------------------------------------------------------------------------
# build_stop_reliability (BATCH — mirrors build_all_stops_data)
# --------------------------------------------------------------------------

# Per-stop weekly/monthly delay, aggregated across the stop's routes.
_STOP_REL_WEEKLY_SQL = text(
    """
    SELECT stop_id,
           SUM(observation_count)                      AS obs,
           SUM(avg_delay_seconds * observation_count)  AS weighted_delay_sec,
           SUM(severe_delay_count)                     AS severe
    FROM gold.stop_delay_weekly
    WHERE provider_id = :provider_id
    GROUP BY stop_id
    """
)

_STOP_REL_MONTHLY_SQL = text(
    """
    SELECT stop_id,
           SUM(observation_count)                      AS obs,
           SUM(avg_delay_seconds * observation_count)  AS weighted_delay_sec,
           SUM(severe_delay_count)                     AS severe
    FROM gold.stop_delay_monthly
    WHERE provider_id = :provider_id
    GROUP BY stop_id
    """
)

# Per-(stop, route) average delay across the retained weekly window.
_STOP_REL_BY_ROUTE_SQL = text(
    """
    SELECT stop_id, route_id,
           SUM(observation_count)                      AS obs,
           SUM(avg_delay_seconds * observation_count)  AS weighted_delay_sec
    FROM gold.stop_delay_weekly
    WHERE provider_id = :provider_id
      -- route_id is COALESCE'd to '__unrouted__' in the stop_delay feeder; drop
      -- it so a stop's per-route breakdown never lists the internal sentinel.
      AND route_id <> '__unrouted__'
    GROUP BY stop_id, route_id
    """
)


# Per-stop 7x24 severe-delay heatmap source (dow x hour from the open-window
# hourly mart). Cell magnitude = summed severe-delay count; fed to
# _build_habits_matrix on the DISTINCT 'severe_relative' scale.
_STOP_HABIT_SQL = text(
    """
    SELECT sd.stop_id,
           EXTRACT(ISODOW FROM timezone(dp.timezone, sd.period_start_utc))::integer
               AS day_of_week_iso,
           EXTRACT(HOUR FROM timezone(dp.timezone, sd.period_start_utc))::integer
               AS hour_of_day_local,
           SUM(sd.severe_delay_count)::numeric AS repeat_problem_score
    FROM gold.stop_delay_hourly AS sd
    INNER JOIN gold.dim_provider AS dp ON dp.provider_id = sd.provider_id
    WHERE sd.provider_id = :provider_id
    GROUP BY sd.stop_id, 2, 3
    ORDER BY sd.stop_id
    """
)

# Most-recent closed local day's p50/p90 per stop (append-only percentile rollup).
_STOP_PERCENTILE_DAILY_SQL = text(
    """
    SELECT DISTINCT ON (stop_id)
        stop_id, p50_delay_seconds, p90_delay_seconds
    FROM gold.stop_delay_percentile_daily
    WHERE provider_id = :provider_id
    ORDER BY stop_id, provider_local_date DESC
    """
)


# Trailing-30d crowding band-shares per stop from the append-only daily band-count
# reduction (twin of _ROUTE_OCCUPANCY_BAND_WINDOW_SQL, but batched over ALL stops:
# one summed row per stop_id rather than a single per-entity bind). Summed counts
# are divided into shares at read time; honest-None when no band-bearing telemetry
# exists in the window. Unique discriminator for test dispatch:
# "stop_occupancy_band_daily AS sob".
_STOP_OCCUPANCY_BAND_WINDOW_SQL = text(
    """
    SELECT sob.stop_id                    AS stop_id,
           SUM(sob.empty_count)           AS empty,
           SUM(sob.many_seats_count)      AS many_seats,
           SUM(sob.few_seats_count)       AS few_seats,
           SUM(sob.standing_count)        AS standing,
           SUM(sob.full_count)            AS full
    FROM gold.stop_occupancy_band_daily AS sob
    JOIN gold.dim_provider AS dp ON dp.provider_id = sob.provider_id
    WHERE sob.provider_id = :provider_id
      AND sob.provider_local_date >= (now() AT TIME ZONE dp.timezone)::date - 30
    GROUP BY sob.stop_id
    """
)


# Granularity grains for stops, computed ON THE FLY from the hourly mart (stops
# have no rollup table). The hour->shift band CASE and the ISODOW weekday/weekend
# split MUST stay byte-identical to the canonical route populate logic in
# gold/rollups.py (UPSERT_ROUTE_DELAY_BY_SHIFT / UPSERT_ROUTE_DELAY_BY_DAYTYPE) so
# stop grains line up with route grains. Avg delay mirrors the stop weekly rollup:
# COALESCE(arrival, departure), observation-weighted (_weighted_avg_sec). Stop OTP
# stays a severe(>300s)-only proxy (no on_time column in the stop hourly mart), so
# only obs + severe are aggregated. One UNION'd pass over both grain families.
_STOP_BY_GRAIN_SQL = text(
    """
    SELECT stop_id, grain,
           SUM(observation_count)::numeric                AS obs,
           SUM(severe_delay_count)::numeric               AS severe,
           SUM(avg_delay_sec * NULLIF(observation_count, 0)) AS weighted_delay_sec
    FROM (
        SELECT sd.stop_id,
               CASE
                   WHEN EXTRACT(HOUR FROM timezone(dp.timezone, sd.period_start_utc))
                       BETWEEN 6 AND 8 THEN 'am_peak'
                   WHEN EXTRACT(HOUR FROM timezone(dp.timezone, sd.period_start_utc))
                       BETWEEN 9 AND 14 THEN 'midday'
                   WHEN EXTRACT(HOUR FROM timezone(dp.timezone, sd.period_start_utc))
                       BETWEEN 15 AND 18 THEN 'pm_peak'
                   WHEN EXTRACT(HOUR FROM timezone(dp.timezone, sd.period_start_utc))
                       BETWEEN 19 AND 22 THEN 'evening'
                   ELSE 'night'
               END AS grain,
               sd.observation_count,
               sd.severe_delay_count,
               COALESCE(sd.avg_arrival_delay_seconds, sd.avg_departure_delay_seconds)
                   AS avg_delay_sec
        FROM gold.stop_delay_hourly AS sd
        INNER JOIN gold.dim_provider AS dp ON dp.provider_id = sd.provider_id
        WHERE sd.provider_id = :provider_id
        UNION ALL
        SELECT sd.stop_id,
               CASE
                   WHEN EXTRACT(ISODOW FROM timezone(dp.timezone, sd.period_start_utc))
                       BETWEEN 1 AND 5 THEN 'weekday'
                   ELSE 'weekend'
               END AS grain,
               sd.observation_count,
               sd.severe_delay_count,
               COALESCE(sd.avg_arrival_delay_seconds, sd.avg_departure_delay_seconds)
                   AS avg_delay_sec
        FROM gold.stop_delay_hourly AS sd
        INNER JOIN gold.dim_provider AS dp ON dp.provider_id = sd.provider_id
        WHERE sd.provider_id = :provider_id
    ) AS banded
    GROUP BY stop_id, grain
    """
)


# Per-stop weekday seasonality (ISO 1=Mon..7=Sun), computed on the fly from the
# hourly mart for route parity (gold.route_delay_day_of_week has no stop sibling).
# The ISODOW resolution + timezone() mirror _STOP_HABIT_SQL / _STOP_BY_GRAIN_SQL.
# Avg delay mirrors the stop weekly rollup: COALESCE(arrival, departure),
# observation-weighted. Stop OTP stays a severe(>300s)-only proxy, so only obs +
# severe are aggregated. Unique discriminator for test dispatch: "AS dow_obs".
_STOP_DOW_SQL = text(
    """
    SELECT sd.stop_id,
           EXTRACT(ISODOW FROM timezone(dp.timezone, sd.period_start_utc))::integer
               AS day_of_week_iso,
           SUM(sd.observation_count)::numeric                AS dow_obs,
           SUM(sd.severe_delay_count)::numeric               AS severe,
           SUM(
               COALESCE(sd.avg_arrival_delay_seconds, sd.avg_departure_delay_seconds)
               * NULLIF(sd.observation_count, 0)
           )                                                 AS weighted_delay_sec
    FROM gold.stop_delay_hourly AS sd
    INNER JOIN gold.dim_provider AS dp ON dp.provider_id = sd.provider_id
    WHERE sd.provider_id = :provider_id
    GROUP BY sd.stop_id, 2
    ORDER BY sd.stop_id, 2
    """
)


def build_stop_reliability(
    conn: Connection, *, provider_id: str = "stm", generated_utc: str
) -> dict[str, StopReliability]:
    """Build all historic/stop_reliability/{stop_id}.json in a batched pass.

    For every stop in gold.stop_delay_weekly/monthly: weekly+monthly periods
    aggregated across the stop's routes. Stop OTP remains a severe(>300s)-only
    proxy, now over per-stop delay observations. Returns stop_id -> model.
    """
    params = {"provider_id": provider_id}

    def _weighted_avg_sec(obs: object, weighted: object) -> float | None:
        return (float(weighted) / float(obs)) if obs and weighted is not None else None

    # period rows keyed stop_id -> {grain: StopReliabilityPeriod}
    periods: dict[str, dict[str, StopReliabilityPeriod]] = {}
    for grain, sql in (("week", _STOP_REL_WEEKLY_SQL), ("month", _STOP_REL_MONTHLY_SQL)):
        for r in conn.execute(sql, params).mappings():
            sid = str(r["stop_id"])
            avg_sec = _weighted_avg_sec(r["obs"], r["weighted_delay_sec"])
            # severe-proxy Wilson success = not-severe count (obs - severe); bounds
            # the NOT-SEVERE proportion, NOT a real OTP (see StopReliabilityPeriod).
            severe_k = (r["obs"] - (r["severe"] or 0)) if r["obs"] else None
            periods.setdefault(sid, {})[grain] = StopReliabilityPeriod(
                grain=grain,
                otp_pct=_otp_pct_severe_proxy(r["obs"], r["severe"]),
                avg_delay_min=(round(avg_sec / 60.0, 1) if avg_sec is not None else None),
                severe_pct=_severe_pct(r["obs"], r["severe"]),
                observation_count=_opt_int(r["obs"]),
                wilson_lo=_wilson_lo(severe_k, r["obs"]),
                wilson_hi=_wilson_hi(severe_k, r["obs"]),
            )

    # Granularity grains (additive, free-string grain): time-of-day shift +
    # weekday/weekend day-type, computed on the fly from the hourly mart with the
    # canonical route hour->shift / ISODOW split. Stop OTP stays the severe proxy;
    # honest-None (never 0) flows from the helpers when obs is 0/missing.
    for r in conn.execute(_STOP_BY_GRAIN_SQL, params).mappings():
        sid = str(r["stop_id"])
        grain = str(r["grain"])
        avg_sec = _weighted_avg_sec(r["obs"], r["weighted_delay_sec"])
        severe_k = (r["obs"] - (r["severe"] or 0)) if r["obs"] else None
        periods.setdefault(sid, {})[grain] = StopReliabilityPeriod(
            grain=grain,
            otp_pct=_otp_pct_severe_proxy(r["obs"], r["severe"]),
            avg_delay_min=(round(avg_sec / 60.0, 1) if avg_sec is not None else None),
            severe_pct=_severe_pct(r["obs"], r["severe"]),
            observation_count=_opt_int(r["obs"]),
            wilson_lo=_wilson_lo(severe_k, r["obs"]),
            wilson_hi=_wilson_hi(severe_k, r["obs"]),
        )

    # by_route breakdown keyed stop_id -> list[StopByRoute]
    by_route: dict[str, list[StopByRoute]] = {}
    for r in conn.execute(_STOP_REL_BY_ROUTE_SQL, params).mappings():
        sid = str(r["stop_id"])
        avg_sec = _weighted_avg_sec(r["obs"], r["weighted_delay_sec"])
        by_route.setdefault(sid, []).append(
            StopByRoute(
                route=str(r["route_id"]),
                avg_delay_min=(round(avg_sec / 60.0, 1) if avg_sec is not None else None),
            )
        )

    # stop display names: current dim first, dim_stop_history fallback
    names = {
        str(r["stop_id"]): r["stop_name"]
        for r in conn.execute(_STOP_NAMES_SQL, params).mappings()
    }

    # Per-stop 7x24 severe-delay heatmap (distinct 'severe_relative' scale, so a
    # shared legend never conflates it with the route repeat-problem matrix).
    habit_rows: dict[str, list] = {}
    for r in conn.execute(_STOP_HABIT_SQL, params).mappings():
        habit_rows.setdefault(str(r["stop_id"]), []).append(r)
    habits = {
        sid: _build_habits_matrix(rows, scale="severe_relative")
        for sid, rows in habit_rows.items()
    }

    # Per-stop weekday seasonality (ISO 1=Mon..7=Sun), computed on the fly from the
    # hourly mart for route parity. Rows arrive ordered by (stop_id, isodow), so the
    # per-stop list is already 1..7-sorted. Honest None (never 0) when obs is 0.
    day_of_week: dict[str, list[RouteDayOfWeek]] = {}
    for r in conn.execute(_STOP_DOW_SQL, params).mappings():
        sid = str(r["stop_id"])
        obs = r["dow_obs"]
        avg_sec = _weighted_avg_sec(obs, r["weighted_delay_sec"])
        day_of_week.setdefault(sid, []).append(
            RouteDayOfWeek(
                day_of_week_iso=int(r["day_of_week_iso"]),
                avg_delay_min=(round(avg_sec / 60.0, 1) if avg_sec is not None else None),
                severe_pct=_severe_pct(obs, r["severe"]),
                # Honest None (never 0): a zero-observation weekday has no count.
                observation_count=(_opt_int(obs) if obs else None),
            )
        )

    # Per-stop most-recent-day p50/p90 from the append-only percentile rollup.
    day_period: dict[str, StopReliabilityPeriod] = {
        str(r["stop_id"]): StopReliabilityPeriod(
            grain="day",
            p50_min=_avg_delay_min(r["p50_delay_seconds"]),
            p90_min=_avg_delay_min(r["p90_delay_seconds"]),
        )
        for r in conn.execute(_STOP_PERCENTILE_DAILY_SQL, params).mappings()
    }

    # Per-stop trailing-30d crowding band-shares from the append-only daily band
    # reduction (honest-None when the stop had no band-bearing telemetry; the
    # helper drops a zero-total row by returning None, so absent stops are absent).
    occupancy_mix: dict[str, OccupancyMix] = {}
    for r in conn.execute(_STOP_OCCUPANCY_BAND_WINDOW_SQL, params).mappings():
        mix = _occupancy_mix_from_bands(r)
        if mix is not None:
            occupancy_mix[str(r["stop_id"])] = mix

    out: dict[str, StopReliability] = {}
    for sid in (
        set(periods)
        | set(by_route)
        | set(habits)
        | set(day_period)
        | set(day_of_week)
        | set(occupancy_mix)
    ):
        grain_map = periods.get(sid, {})
        ordered: list[StopReliabilityPeriod] = []
        if sid in day_period:
            ordered.append(day_period[sid])
        ordered.extend(grain_map[g] for g in ("week", "month") if g in grain_map)
        # Additive granularity grains (canonical shift + day-type tokens), in the
        # same time-of-day / weekday-first order the route surface publishes.
        ordered.extend(
            grain_map[g]
            for g in ("am_peak", "midday", "pm_peak", "evening", "night", "weekday", "weekend")
            if g in grain_map
        )
        routes = sorted(by_route.get(sid, []), key=lambda b: _route_sort_key(b.route))
        out[sid] = StopReliability(
            generated_utc=generated_utc,
            id=sid,
            name=names.get(sid),
            periods=ordered,
            habits=habits.get(sid),
            day_of_week=day_of_week.get(sid, []),
            by_route=routes,
            occupancy_mix=occupancy_mix.get(sid),
        )
    return out


# --------------------------------------------------------------------------
# build_hotspots
# --------------------------------------------------------------------------

# Most-recent week period from gold.repeated_problem_route_stop.
# Fall back to the max period_start_local of any grain if no 'week' rows exist.
# Gold buckets NULL route/stop ids into these sentinels (rollups.py COALESCE).
# They must NEVER surface to a citizen as a named entity. The publish SQL filters
# them out; this set is the defense-in-depth publish-time invariant the builders
# also enforce, so a future un-filtered query path can't leak a phantom entity.
_SENTINEL_ENTITY_IDS = frozenset({"__unrouted__", "__unknown_stop__"})


def _otp_delta_pts(cell_otp: int | None, network_otp: int | None) -> float | None:
    """entity OTP minus the network baseline OTP, in percentage POINTS (1 dp).

    Negative = the entity is worse than the network (that's why it's a hotspot).
    Honest-None: the delta is None (NEVER 0) when EITHER the cell's own OTP or
    the network baseline OTP is unknown for the period — a missing magnitude must
    read as "no data", never as "exactly on par". Both inputs already carry the
    upstream honest-None convention (_otp_pct / _otp_pct_severe_proxy).
    """
    if cell_otp is None or network_otp is None:
        return None
    return round(float(cell_otp) - float(network_otp), 1)


# Selects the top-20 problem cells for the target period AND, per cell, the raw
# OTP counts needed to compute otp_delta_pts honestly at read time:
#   * route cells  -> real OTP counts from the route_spine_weekly CTE (the per-
#                     (route, ISO-week) SUM of on_time/delay observation counts off
#                     gold.route_delay_spine), joined ONLY when entity_kind = 'route'
#                     so a stop never picks up a route's counts.
#   * stop cells   -> per-stop obs + severe from gold.stop_delay_weekly (summed
#                     across the stop's routes for the target week), joined ONLY
#                     when entity_kind = 'stop'. Stops have no on_time column, so
#                     their OTP stays the documented severe(>300s) proxy.
#   * net_on_time / net_known -> the ROUTE network baseline = real on-time OTP
#                     aggregated across ALL routes for the SAME target week
#                     (scalar). Used ONLY for route cells.
#   * net_stop_obs / net_stop_severe -> the STOP network baseline = the SAME
#                     severe(>300s) proxy aggregated across ALL stops for the
#                     target week (scalar). Used ONLY for stop cells, so a stop's
#                     delta is severe-proxy-vs-severe-proxy (same metric, no
#                     lenient-vs-strict offset). Both baselines identical on
#                     every row.
# The per-kind JOIN keys (route_id vs stop_id) keep route and stop OTP from ever
# cross-contaminating, and each kind subtracts its OWN-metric network baseline.
# The OTP math + honest-None live in Python (_otp_pct / _otp_pct_severe_proxy /
# _otp_delta_pts) so the convention matches the rest of the historic surface
# byte-for-byte. Network baselines are week-grain only; on a non-week fallback
# target the route/stop weekly joins miss and the delta is None.
_HOTSPOTS_SQL = text(
    """
    WITH week_max AS (
        SELECT MAX(period_start_local) AS max_week_start
        FROM gold.repeated_problem_route_stop
        WHERE provider_id = :provider_id
          AND period_grain = 'week'
    ),
    any_max AS (
        SELECT MAX(period_start_local) AS max_any_start
        FROM gold.repeated_problem_route_stop
        WHERE provider_id = :provider_id
    ),
    target AS (
        SELECT COALESCE(
            (SELECT max_week_start FROM week_max),
            (SELECT max_any_start FROM any_max)
        ) AS target_start,
        COALESCE(
            (SELECT 'week' WHERE (SELECT max_week_start FROM week_max) IS NOT NULL),
            (SELECT period_grain
             FROM gold.repeated_problem_route_stop
             WHERE provider_id = :provider_id
               AND period_start_local = (SELECT max_any_start FROM any_max)
             LIMIT 1)
        ) AS target_grain
    ),
    -- Per-route weekly OTP counts derived from the route delay spine (S7-B): the
    -- ISO-week SUMs of on_time/delay observation counts are byte-identical to the
    -- (dropped) route_reliability_weekly columns, so the route OTP + the network
    -- baseline below are unchanged. The spine has no '__unrouted__' (route_id NOT
    -- NULL at build); week_start_local is the feed-local ISO-week Monday.
    route_spine_weekly AS (
        SELECT route_id,
               date_trunc('week', service_local_date)::date AS week_start_local,
               SUM(on_time_observation_count) AS on_time_observation_count,
               SUM(delay_observation_count)   AS delay_observation_count
        FROM gold.route_delay_spine
        WHERE provider_id = :provider_id
        GROUP BY route_id, date_trunc('week', service_local_date)::date
    ),
    -- Network baseline OTP for the target week: real on_time/known aggregated
    -- over ALL routes, numerator and denominator scoped together to on-time-known
    -- rows so the gold NULL-guard does not bias OTP low (mirrors network_trend).
    net AS (
        SELECT SUM(rrw.on_time_observation_count) AS net_on_time,
               SUM(rrw.delay_observation_count) FILTER (
                   WHERE rrw.on_time_observation_count IS NOT NULL) AS net_known
        FROM route_spine_weekly AS rrw, target
        WHERE rrw.week_start_local = target.target_start
    ),
    -- Stop-grain network baseline for the target week: the SAME severe(>300s)
    -- proxy a stop cell uses ((obs - severe)/obs), aggregated across ALL stops.
    -- A stop cell's delta must be same-metric-vs-same-metric, so its baseline is
    -- this stop-grain severe-proxy network OTP, NOT the route on-time net above.
    net_stop AS (
        SELECT SUM(sdw.observation_count)  AS net_stop_obs,
               SUM(sdw.severe_delay_count) AS net_stop_severe
        FROM gold.stop_delay_weekly AS sdw, target
        WHERE sdw.provider_id = :provider_id
          AND sdw.week_start_local = target.target_start
    ),
    -- Per-stop obs + severe summed across the stop's routes for the target week.
    stop_otp AS (
        SELECT sdw.stop_id,
               SUM(sdw.observation_count)  AS stop_obs,
               SUM(sdw.severe_delay_count) AS stop_severe
        FROM gold.stop_delay_weekly AS sdw, target
        WHERE sdw.provider_id = :provider_id
          AND sdw.week_start_local = target.target_start
        GROUP BY sdw.stop_id
    )
    SELECT rp.entity_kind, rp.entity_id, rp.issue_count, rp.severity_label,
           rrw.on_time_observation_count AS route_on_time,
           rrw.delay_observation_count   AS route_known,
           so.stop_obs                   AS stop_obs,
           so.stop_severe                AS stop_severe,
           net.net_on_time               AS net_on_time,
           net.net_known                 AS net_known,
           net_stop.net_stop_obs         AS net_stop_obs,
           net_stop.net_stop_severe      AS net_stop_severe
    FROM gold.repeated_problem_route_stop AS rp
    CROSS JOIN target
    CROSS JOIN net
    CROSS JOIN net_stop
    LEFT JOIN route_spine_weekly AS rrw
           ON rp.entity_kind = 'route'
          AND rrw.route_id = rp.entity_id
          AND rrw.week_start_local = target.target_start
    LEFT JOIN stop_otp AS so
           ON rp.entity_kind = 'stop'
          AND so.stop_id = rp.entity_id
    WHERE rp.provider_id = :provider_id
      AND rp.period_start_local = target.target_start
      AND rp.period_grain = target.target_grain
      AND NOT (rp.entity_kind = 'route' AND rp.entity_id = '__unrouted__')
      AND NOT (rp.entity_kind = 'stop' AND rp.entity_id = '__unknown_stop__')
    ORDER BY rp.issue_count DESC
    LIMIT 20
    """
)


def build_hotspots(conn: Connection, provider_id: str = "stm", *, generated_utc: str) -> Hotspots:
    """Build historic/hotspots.json — top 20 problem entities in the most recent week.

    Source: gold.repeated_problem_route_stop. Uses the most-recent week-grain period;
    falls back to the most-recent period of any grain if no week rows are present.

    otp_delta_pts = the cell's own OTP minus a SAME-METRIC network baseline OTP
    for the same target week, in percentage points (negative = worse than the
    network). Route cells use the real OTP from the spine-derived weekly CTE vs
    the route on-time network baseline; stop cells use the documented severe-delay
    proxy (no on_time column at stop grain) vs a stop-grain severe-proxy network
    baseline, so the delta is never lenient-metric-minus-strict-metric. Honest-None
    when either side is unknown (_otp_delta_pts).
    """
    rows = list(conn.execute(_HOTSPOTS_SQL, {"provider_id": provider_id}).mappings())
    route_names, stop_names = _entity_name_maps(conn, provider_id=provider_id)
    # Defense-in-depth: never publish a sentinel-bucket entity even if a query path
    # ever forgets the SQL filter (re-ranks over the surviving rows).
    kept = [r for r in rows if str(r["entity_id"]) not in _SENTINEL_ENTITY_IDS]
    hotspots = []
    for i, r in enumerate(kept):
        kind = str(r["entity_kind"])
        # Per-kind OTP, with a MATCHING-metric baseline so the delta is
        # same-definition-vs-same-definition (never lenient-vs-strict):
        #   route -> real on_time/known   vs route on-time network baseline
        #   stop  -> severe(>300s) proxy  vs stop severe-proxy network baseline
        # The SQL only populates the matching kind's columns, so cross-kind
        # contamination is impossible, but key the Python branch on kind too.
        if kind == "route":
            cell_otp = _otp_pct(r.get("route_on_time"), r.get("route_known"))
            network_otp = _otp_pct(r.get("net_on_time"), r.get("net_known"))
        else:
            cell_otp = _otp_pct_severe_proxy(r.get("stop_obs"), r.get("stop_severe"))
            network_otp = _otp_pct_severe_proxy(r.get("net_stop_obs"), r.get("net_stop_severe"))
        hotspots.append(
            Hotspot(
                rank=i + 1,
                type=kind,
                id=str(r["entity_id"]),
                # kinds verified 'route'/'stop' in the mart — per-kind name lookup
                name=(
                    route_names.get(str(r["entity_id"]))
                    if kind == "route"
                    else stop_names.get(str(r["entity_id"]))
                ),
                severity=r["severity_label"],
                otp_delta_pts=_otp_delta_pts(cell_otp, network_otp),
            )
        )
    return Hotspots(generated_utc=generated_utc, hotspots=hotspots)


# --------------------------------------------------------------------------
# build_repeat_offenders
# --------------------------------------------------------------------------

# P3 mart: gold.repeat_offender — persistent problem entities.
_REPEAT_OFFENDERS_SQL = text(
    """
    SELECT entity_kind, entity_id, route_id,
           recurrence_days, window_days, avg_delay_seconds, severity_label
    FROM gold.repeat_offender
    WHERE provider_id = :provider_id
    ORDER BY recurrence_days DESC, avg_delay_seconds DESC
    LIMIT 50
    """
)


def build_repeat_offenders(
    conn: Connection, provider_id: str = "stm", *, generated_utc: str
) -> RepeatOffenders:
    """Build historic/repeat_offenders.json — top 50 most-persistent problem entities.

    Source: gold.repeat_offender (P3 mart).
    Ordered by recurrence_days desc, avg_delay_seconds desc.
    """
    rows = list(
        conn.execute(_REPEAT_OFFENDERS_SQL, {"provider_id": provider_id}).mappings()
    )
    # Offender entities are 'trip'/'vehicle' kinds with no display name of
    # their own — resolve the ROUTE context name instead (history-backed).
    route_names = {
        str(r["route_id"]): r["route_name"]
        for r in conn.execute(_ROUTE_NAMES_SQL, {"provider_id": provider_id}).mappings()
    }
    offenders = [
        Offender(
            type=str(r["entity_kind"]),
            id=str(r["entity_id"]),
            route=r["route_id"],
            route_name=(
                route_names.get(str(r["route_id"])) if r["route_id"] is not None else None
            ),
            recurrence=f"{r['recurrence_days']}/{r['window_days']}d",
            avg_delay_min=round(float(r["avg_delay_seconds"]) / 60.0, 1),
        )
        for r in rows
    ]
    return RepeatOffenders(generated_utc=generated_utc, offenders=offenders)


# --------------------------------------------------------------------------
# build_receipts
# --------------------------------------------------------------------------

# Accountability daily summary — one row per date, drives the receipt set.
_RECEIPTS_ACCOUNTABILITY_SQL = text(
    """
    SELECT provider_local_date,
           affected_route_count,
           affected_stop_count,
           delayed_trip_count,
           severe_delay_count,
           alert_count,
           rider_impact_score
    FROM gold.citizen_accountability_daily
    WHERE provider_id = :provider_id
      AND provider_local_date >= current_date - 30
    ORDER BY provider_local_date
    """
)

# Network-level daily aggregation from the hourly rollup.
_RECEIPTS_NETWORK_DAILY_SQL = text(
    """
    SELECT timezone(dp.timezone, rdh.period_start_utc)::date AS local_date,
           SUM(rdh.delay_observation_count)                   AS known_obs,
           CASE WHEN COUNT(*) = COUNT(rdh.on_time_observation_count)
                THEN SUM(rdh.on_time_observation_count)
           END AS on_time,
           SUM(rdh.severe_delay_count)                        AS severe,
           SUM(rdh.avg_delay_seconds * rdh.delay_observation_count) AS weighted_delay_sec
    FROM gold.route_delay_hourly AS rdh
    JOIN gold.dim_provider AS dp ON dp.provider_id = rdh.provider_id
    WHERE rdh.provider_id = :provider_id
      AND rdh.period_start_utc >= now() - interval '31 days'
    GROUP BY timezone(dp.timezone, rdh.period_start_utc)::date
    """
)

# Worst route per date: max avg_delay_seconds from the public reliability view.
# on_time / known carry the worst route's own daily OTP so the receipt can show
# its on-time-vs-network gap (otp_delta_pts) against the day's network baseline.
_RECEIPTS_WORST_ROUTE_SQL = text(
    """
    SELECT provider_local_date AS d,
           route_id,
           avg_delay_seconds,
           on_time_observation_count AS on_time,
           delay_observation_count   AS known_obs
    FROM gold.public_route_reliability_daily
    WHERE provider_id = :provider_id
      AND provider_local_date >= current_date - 30
      AND avg_delay_seconds IS NOT NULL
      AND route_id <> '__unrouted__'
    ORDER BY provider_local_date, avg_delay_seconds DESC, route_id
    """
)

# Worst stop per date: max avg_delay_seconds from the public stop delay view.
_RECEIPTS_WORST_STOP_SQL = text(
    """
    SELECT provider_local_date AS d,
           stop_id,
           avg_delay_seconds,
           max_delay_seconds
    FROM gold.public_stop_delay_daily
    WHERE provider_id = :provider_id
      AND provider_local_date >= current_date - 30
      AND avg_delay_seconds IS NOT NULL
      AND stop_id <> '__unknown_stop__'
    ORDER BY provider_local_date, avg_delay_seconds DESC, stop_id
    """
)


def build_receipts(
    conn: Connection, provider_id: str = "stm", *, generated_utc: str
) -> dict[str, Receipt]:
    """Build historic/receipts/{date}.json for each date in the last 30 days.

    The citizen_accountability_daily table is the driver — one Receipt per date
    present there.  Network OTP/delay come from route_delay_hourly (hourly rollup
    aggregated to daily); worst_route and worst_stop come from the public daily
    views (max avg_delay_seconds per date).

    vehicles is None in v1 (not stored in the receipt source mart).
    worst_route.otp_delta_pts = the worst route's daily OTP minus the day's network
    baseline OTP, in percentage points (honest-None when either side is unknown).
    """
    params = {"provider_id": provider_id}
    route_names, stop_names = _entity_name_maps(conn, provider_id=provider_id)

    # 1. accountability rows: one per date (the driver set)
    acct: dict[str, dict] = {}
    for r in conn.execute(_RECEIPTS_ACCOUNTABILITY_SQL, params).mappings():
        ds = _iso_date(r["provider_local_date"])
        acct[ds] = {
            "affected_routes": _opt_int(r["affected_route_count"]),
            "affected_stops": _opt_int(r["affected_stop_count"]),
            "alerts": _opt_int(r["alert_count"]),
            "rider_impact_score": _public_impact_score(r["rider_impact_score"]),
        }

    # 2. network daily OTP/delay from hourly rollup
    net: dict[str, dict] = {}
    for r in conn.execute(_RECEIPTS_NETWORK_DAILY_SQL, params).mappings():
        ds = _iso_date(r["local_date"])
        known_obs, weighted = r["known_obs"], r["weighted_delay_sec"]
        avg_sec = (
            (float(weighted) / float(known_obs))
            if known_obs and weighted is not None
            else None
        )
        net[ds] = {
            "otp_pct": _otp_pct(r["on_time"], known_obs),
            "avg_delay_min": _avg_delay_min(avg_sec),
            "severe_pct": _severe_pct(known_obs, r["severe"]),
        }

    # 3. worst route per date: first row after ORDER BY avg_delay_seconds DESC
    worst_route: dict[str, ReceiptWorstRoute] = {}
    for r in conn.execute(_RECEIPTS_WORST_ROUTE_SQL, params).mappings():
        if str(r["route_id"]) in _SENTINEL_ENTITY_IDS:
            continue  # defense-in-depth: never crown the routeless sentinel as worst
        ds = _iso_date(r["d"])
        if ds not in worst_route:  # first = max avg_delay (ordered DESC)
            # On-time-vs-network gap: the worst route's own daily OTP minus the
            # day's network baseline OTP (already computed in net[ds]). Honest-None
            # when either side is unknown (_otp_delta_pts) — never a fabricated 0.
            route_otp = _otp_pct(r.get("on_time"), r.get("known_obs"))
            network_otp = net.get(ds, {}).get("otp_pct")
            worst_route[ds] = ReceiptWorstRoute(
                id=str(r["route_id"]),
                name=route_names.get(str(r["route_id"])),
                otp_delta_pts=_otp_delta_pts(route_otp, network_otp),
            )

    # 4. worst stop per date: first row after ORDER BY avg_delay_seconds DESC
    worst_stop: dict[str, ReceiptWorstStop] = {}
    for r in conn.execute(_RECEIPTS_WORST_STOP_SQL, params).mappings():
        if str(r["stop_id"]) in _SENTINEL_ENTITY_IDS:
            continue  # defense-in-depth: never crown the unknown-stop sentinel as worst
        ds = _iso_date(r["d"])
        if ds not in worst_stop:  # first = max avg_delay (ordered DESC)
            worst_stop[ds] = ReceiptWorstStop(
                id=str(r["stop_id"]),
                name=stop_names.get(str(r["stop_id"])),
                avg_delay_min=_avg_delay_min(r["avg_delay_seconds"]),
            )

    # merge: only emit dates present in accountability (the driver)
    out: dict[str, Receipt] = {}
    for ds, a in acct.items():
        n = net.get(ds, {})
        out[ds] = Receipt(
            generated_utc=generated_utc,
            date=ds,
            vehicles=None,  # v1: vehicle count not stored in receipt source mart
            otp_pct=n.get("otp_pct"),
            avg_delay_min=n.get("avg_delay_min"),
            severe_pct=n.get("severe_pct"),
            worst_route=worst_route.get(ds),
            worst_stop=worst_stop.get(ds),
            affected_routes=a["affected_routes"],
            affected_stops=a["affected_stops"],
            alerts=a["alerts"],
            rider_impact_score=a["rider_impact_score"],
        )
    return out


# --------------------------------------------------------------------------
# build_alert_history
# --------------------------------------------------------------------------

# 8M-row table — always filter by date BEFORE aggregating.
# v1 bounds: 90-day window, LIMIT 200.  impact_passages is None (not in source).
# array_agg(...) FILTER (WHERE ...) requires PostgreSQL 9.4+.
_ALERT_HISTORY_SQL = text(
    """
    SELECT alert_header_text,
           MAX(alert_header_text_en)                                AS header_text_en,
           MAX(severity)                                            AS severity,
           MAX(cause)                                               AS cause,
           MAX(effect)                                              AS effect,
           ARRAY_AGG(DISTINCT route_id)
               FILTER (WHERE route_id IS NOT NULL)                  AS routes,
           ARRAY_AGG(DISTINCT stop_id)
               FILTER (WHERE stop_id IS NOT NULL)                   AS stops,
           active_period_start_utc                                  AS start_utc,
           active_period_end_utc                                    AS end_utc
    FROM gold.i3_alert_history_reporting
    WHERE provider_id = :provider_id
      AND provider_local_date >= current_date - 30
    GROUP BY alert_header_text, active_period_start_utc, active_period_end_utc
    ORDER BY active_period_start_utc DESC NULLS LAST
    LIMIT 200
    """
)


def _alert_breakdown(
    records: list[tuple[str | None, str | None, str | None, float | None]],
) -> AlertBreakdown | None:
    """Bucket distinct alerts by cause / effect / severity with median duration.

    records = (cause, effect, severity, duration_min) per distinct alert. NULL/blank
    dimensions fold into an 'unknown' bucket (STM frequently omits cause/effect);
    median duration ignores rows with no usable window. Returns None when empty.
    """
    if not records:
        return None
    import statistics

    def _buckets(index: int) -> list[AlertBreakdownBucket]:
        grouped: dict[str, list[float]] = {}
        counts: dict[str, int] = {}
        for rec in records:
            raw = rec[index]
            key = str(raw).strip() if raw not in (None, "") else "unknown"
            counts[key] = counts.get(key, 0) + 1
            if rec[3] is not None:
                grouped.setdefault(key, []).append(rec[3])
        out = [
            AlertBreakdownBucket(
                key=key,
                count=counts[key],
                median_duration_min=(
                    round(statistics.median(grouped[key]), 1) if grouped.get(key) else None
                ),
            )
            for key in counts
        ]
        # Stable, deterministic ordering: most frequent first, then label.
        out.sort(key=lambda b: (-b.count, b.key))
        return out

    return AlertBreakdown(
        by_cause=_buckets(0),
        by_effect=_buckets(1),
        by_severity=_buckets(2),
    )


def build_alert_history(
    conn: Connection, provider_id: str = "stm", *, generated_utc: str
) -> AlertHistory:
    """Build historic/alert_history.json — last 30 days, capped at 200 alerts.

    Source: gold.i3_alert_history_reporting (8M rows — always filter first).
    STM's i3 feed leaves alert_id NULL, so grouping by it would collapse every
    row into one mega-alert; instead we group by the content key
    (header + active period) and synthesize a content-stable id, mirroring the
    live build_alerts approach.  Routes/stops are deduped and natural-sorted.
    duration_min is computed from start/end; impact_passages is None in v1.

    v1 intentional bounds: 30-day look-back, LIMIT 200, impact_passages=None.
    """
    rows = list(
        conn.execute(_ALERT_HISTORY_SQL, {"provider_id": provider_id}).mappings()
    )
    entries: list[AlertHistoryEntry] = []
    # (cause, effect, severity_code, duration_min) per distinct alert for the breakdown.
    breakdown_records: list[tuple[str | None, str | None, str | None, float | None]] = []
    for r in rows:
        start = r["start_utc"]
        end = r["end_utc"]
        # duration_min: only when both timestamps are available
        duration_min: float | None = None
        if start is not None and end is not None:
            try:
                start_s = _iso(start)
                end_s = _iso(end)
                # Parse ISO strings back to timestamps for diff
                import datetime as _dt

                s_dt = _dt.datetime.fromisoformat(start_s.replace("Z", "+00:00"))
                e_dt = _dt.datetime.fromisoformat(end_s.replace("Z", "+00:00"))
                diff_s = (e_dt - s_dt).total_seconds()
                # A malformed window (end < start) yields a meaningless negative
                # duration — publish null (untrustworthy), never a negative bar
                # (slice-9.1.1y).
                duration_min = round(diff_s / 60.0) if diff_s >= 0 else None
            except (ValueError, TypeError):
                duration_min = None

        # routes/stops come as PostgreSQL arrays (list) or None.
        # SQL uses array_agg(DISTINCT ...) which deduplicates in the DB, but we
        # also deduplicate here for safety (unit-test fake rows pass raw lists).
        raw_routes = r["routes"] or []
        raw_stops = r["stops"] or []

        def _natural_sort_dedup(items: list) -> list[str]:
            seen: set[str] = set()
            unique = []
            for x in items:
                s = str(x)
                if s not in seen:
                    seen.add(s)
                    unique.append(s)
            unique.sort(key=_route_sort_key)
            return unique

        # alert_id is always NULL in this feed — synthesize a content-stable id
        # from header + severity + active period (mirrors live build_alerts).
        basis = "|".join(
            str(r[c] or "")
            for c in ("alert_header_text", "severity", "start_utc", "end_utc")
        )
        alert_id = f"{provider_id}-alert-{hashlib.sha1(basis.encode()).hexdigest()[:12]}"
        severity_code = _severity_code(r["severity"])
        breakdown_records.append((r.get("cause"), r.get("effect"), severity_code, duration_min))
        entries.append(
            AlertHistoryEntry(
                id=alert_id,
                severity=severity_code,
                # slice-9.1.1s: header + MAX'd EN header (grouping unchanged).
                header_text=r["alert_header_text"],
                header_text_en=_sane_en(r["header_text_en"]),
                routes=_natural_sort_dedup(raw_routes),
                stops=_natural_sort_dedup(raw_stops),
                start_utc=_opt_iso(start),
                end_utc=_opt_iso(end),
                duration_min=duration_min,
                impact_passages=None,  # v1 deferral: not stored in gold
            )
        )
    return AlertHistory(
        generated_utc=generated_utc,
        alerts=entries,
        breakdown=_alert_breakdown(breakdown_records),
    )


# --------------------------------------------------------------------------
# build_provenance
# --------------------------------------------------------------------------

_PROVENANCE_SOURCES_SQL = text(
    """
    SELECT dataset_kind, storage_backend, storage_path, source_url, loaded_at_utc
    FROM gold.source_lineage_reporting
    WHERE provider_id = :provider_id
      AND is_current = true
    ORDER BY dataset_kind
    """
)

_PROVENANCE_FRESHNESS_SQL = text(
    """
    SELECT endpoint_key, status, completed_age_seconds
    FROM gold.feed_freshness_current
    WHERE provider_id = :provider_id
    ORDER BY endpoint_key
    """
)

# Feed conformance for the provider's current static load: the out-of-norm signal
# is the unknown/extra GTFS members captured verbatim in silver.gtfs_extra_rows
# (mirrors /health check_feed_conformance, scoped to this provider). Empty result
# => no current static dataset => no conformance block.
_PROVENANCE_CONFORMANCE_SQL = text(
    """
    SELECT
        (
            SELECT count(*)
            FROM silver.gtfs_extra_rows AS ger
            WHERE ger.dataset_version_id = dv.dataset_version_id
        )::bigint AS extra_row_count,
        (
            SELECT array_agg(DISTINCT ger.source_file_name)
            FROM silver.gtfs_extra_rows AS ger
            WHERE ger.dataset_version_id = dv.dataset_version_id
        ) AS unknown_members
    FROM core.dataset_versions AS dv
    WHERE dv.provider_id = :provider_id
      AND dv.is_current IS TRUE
      AND dv.dataset_kind = 'static_schedule'
    """
)


_PROVIDER_GAPS: dict[str, list[str]] = {"stm": ["metro_realtime"]}


def build_provenance(
    conn: Connection, provider_id: str = "stm", *, generated_utc: str
) -> Provenance:
    """Build provenance.json — feed lineage, freshness, retention policy, methodology.

    Sources from gold.source_lineage_reporting (is_current=true only).
    Freshness from gold.feed_freshness_current.
    Retention and methodology are hardcoded v1 constants.
    gaps lists known missing feeds (STM metro publishes no realtime feed).
    """
    params = {"provider_id": provider_id}

    # Provider-specific known gaps. metro_realtime is STM's: it runs a métro whose
    # realtime is unpublished. Bus/LRT-only networks (STO/OC/STS) have no such gap.
    gaps = list(_PROVIDER_GAPS.get(provider_id, []))

    sources: list[ProvenanceSource] = []
    for r in conn.execute(_PROVENANCE_SOURCES_SQL, params).mappings():
        backend = r["storage_backend"]
        path = r["storage_path"]
        chain = f"{backend}:{path}" if backend else r["source_url"]
        sources.append(
            ProvenanceSource(
                feed=str(r["dataset_kind"]),
                chain=chain,
                last_loaded_utc=_opt_iso(r["loaded_at_utc"]),
            )
        )

    freshness: list[ProvenanceFreshness] = []
    for r in conn.execute(_PROVENANCE_FRESHNESS_SQL, params).mappings():
        freshness.append(
            ProvenanceFreshness(
                feed=str(r["endpoint_key"]),
                status=r["status"],
                age_s=(
                    int(r["completed_age_seconds"])
                    if r["completed_age_seconds"] is not None
                    else None
                ),
            )
        )

    conformance = _build_provenance_conformance(conn, params)

    # Retention numbers derive from settings so the citizen-facing policy can
    # never drift from the actual prune defaults (detail = capped facts, aggregate
    # = warm rollups). The methodology copy below mirrors aggregate_days verbatim.
    _settings = get_settings()
    return Provenance(
        generated_utc=generated_utc,
        sources=sources,
        freshness=freshness,
        conformance=conformance,
        retention={
            "detail_days": _settings.GOLD_FACT_RETENTION_DAYS,
            "aggregate_days": _settings.GOLD_WARM_ROLLUP_RETENTION_DAYS,
        },
        methodology={
            "otp_definition": (
                "on-time = observed delay between -60s and +300s "
                "(at most 1 min early, less than 5 min late); route OTP = "
                "on-time observations / observations with known delay; "
                "stop-level otp_pct is observations not severe(>300s) over "
                "per-stop delay observations, a severe-delay proxy rather "
                "than true on-time-band OTP"
            ),
            "reliability_floor": (
                f"reliable-enough = {MIN_N_RATE} known-delay observations "
                "(Chart Doctrine MIN_N_RATE). Rates below it are shown with their "
                "raw observation_count but flagged low-confidence, never suppressed. "
                "Each reliability period carries observation_count plus the 95% "
                "Wilson score bounds (wilson_lo / wilson_hi) so the UI gates display "
                "by depth and ranks on the lower bound, not the raw rate."
            ),
            # Machine-readable so the web reads ONE authoritative value (methodology
            # is additionalProperties:true / z.unknown() — no schema or Zod change).
            "min_n_rate": MIN_N_RATE,
            "wilson_z": WILSON_Z,
            "delay_unit": (
                "seconds from schedule; delay statistics exclude observations "
                "with |delay| > 1 hour (ghost-trip guard); severe = >300s and <=3600s"
            ),
            "percentiles": (
                "network p90 from fact (live + trailing 14d trend); route and "
                "stop p50/p90 from a daily fact-derived percentile rollup, "
                "computed per closed local day and retained 730 days"
            ),
            "headway": (
                "observed = median gap between consecutive trip starts "
                "(first realtime observation with a computed delay) in the "
                "busiest direction, per weekday service day, trailing 14d; "
                "scheduled = representative-weekday first-stop departures, "
                "busiest direction; excess_wait = max(0, observed - scheduled)"
            ),
            "history_freeze": (
                "closed reporting periods are immutable after they leave the "
                "10-day open window; later runs rebuild only open hours/dates "
                "and derived files read frozen hourly/daily history"
            ),
            "service_time_conversion": (
                "GTFS stop_times are interpreted as elapsed service-day offsets "
                "from the local noon-minus-12h anchor; on fall-back days the "
                "repeated 01:00-01:59 hour follows that elapsed-time convention"
            ),
            "alert_text_en": (
                "English alert text (header_text_en, description_en) is present "
                "only where STM published an explicit English variant and only "
                "for content-hashed rows captured since 2026-06-09; it is "
                "honest-NULL otherwise, including for pre-2026-06-09 legacy "
                "history entries built from NULL-hash rows, which carry no EN "
                "text until they age out of the history window"
            ),
            "network_no_data": (
                "network.json on_time_pct, coverage_pct, delay_p50_min, "
                "delay_p90_min and feed_freshness_s are null (not 0) when their "
                "denominator is empty — no known-status vehicles, no live fleet, "
                "no delay observations, or no completed ingestion run; a feed "
                "blackout is reported as no-data, never as a fabricated 0% or 0s"
            ),
            "cancellation": (
                "cancellation_rate = canceled trip-days / observed trip-days, "
                "where a trip-day is a distinct (trip_id, start_date) seen in the "
                "realtime feed and counts canceled if ever reported with "
                "schedule_relationship=CANCELED; the denominator is RT-reported "
                "trips, NOT the full published schedule; computed per closed local "
                "day and retained 730 days; null when no trips were observed"
            ),
            "occupancy": (
                "historic crowding = GTFS-RT OccupancyStatus band shares over "
                "band-bearing pings (no numeric load factor); CRUSHED_STANDING "
                "folds into standing; NOT_ACCEPTING/NO_DATA/NOT_BOARDABLE excluded; "
                "summed per closed local day and retained 730 days; null when no "
                "occupancy telemetry exists, never an all-zero mix"
            ),
            "headway_regularity": (
                "cov = stddev/mean of observed trip-start gaps in the busiest "
                "weekday direction per shift (trailing 14d), null with fewer than "
                "2 gaps; bunched = share of gaps under half the shift median "
                "headway; the 0.5x threshold is a fixed bunching definition"
            ),
            "service_span": (
                "first/last trip = earliest/latest first-realtime-observation "
                "trip-start per route per closed local day (observed activity, not "
                "the scheduled departure); span in minutes; first/last delay = that "
                "trip's first-observation schedule deviation; retained 730 days"
            ),
            "alert_breakdown": (
                "distinct content-hashed alerts in the 30-day window grouped by "
                "GTFS cause/effect/severity; NULL/blank labeled 'unknown' (STM "
                "frequently omits cause/effect); median duration from active-period "
                "start/end, the high-confidence dimension; over the 200-alert cap"
            ),
            "skipped_stops": (
                "skipped-stop rate = stop-time updates flagged SKIPPED (GTFS-RT "
                "StopTimeUpdate.ScheduleRelationship=1) / all observed stop-time "
                "updates per route per closed local day; accrued FORWARD from the "
                "date this metric shipped (ramp-in, no historical backfill); null "
                "when no stop-time updates were observed"
            ),
        },
        gaps=gaps,
    )


def _build_provenance_conformance(
    conn: Connection, params: dict
) -> ProvenanceConformance | None:
    """Feed conformance for the provider's current static load, or None when the
    provider has no current static dataset (nothing to describe)."""
    rows = list(conn.execute(_PROVENANCE_CONFORMANCE_SQL, params).mappings())
    if not rows:
        return None
    row = rows[0]
    unknown_members = sorted(row.get("unknown_members") or [])
    extra_row_count = int(row.get("extra_row_count") or 0)
    status = "out_of_norm" if (unknown_members or extra_row_count) else "conformant"
    return ProvenanceConformance(
        status=status,
        unknown_members=unknown_members,
        extra_row_count=extra_row_count,
    )
