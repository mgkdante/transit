"""build_network_trend — network-wide daily/weekly/monthly reliability trend.

Split out of the former monolithic ``historic.py`` (S7-close C3) verbatim; the
trend SQL, the shared TrendPoint mapper, and the by_shift/by_daytype network reads
that derive from the delay spine (via ``_spine``).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from transit_ops.settings import get_settings
from transit_ops.snapshots.builders._helpers import (
    _avg_delay_min,
    _iso_date,
    _opt_int,
    _otp_pct,
    _wilson_hi,
    _wilson_lo,
)
from transit_ops.snapshots.builders.historic._spine import (
    _NETWORK_SPINE_BY_DAYTYPE_SQL,
    _NETWORK_SPINE_BY_SHIFT_SQL,
    _network_spine_rows,
    _occupancy_mix_from_bands,
)
from transit_ops.snapshots.contract import NetworkTrend, TrendPoint
from transit_ops.sql_registry import named_query

if TYPE_CHECKING:  # pragma: no cover - typing only
    from sqlalchemy.engine import Connection


# Daily OTP + weighted-avg delay from the hourly rollup (last ~90 local days).
# Local date = the provider's wall-clock date of the hour bucket.
_TREND_DAILY_SQL = named_query(
    "network.trend.daily_hourly",
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
_TREND_FACT_SQL = named_query(
    "network.trend.daily_p90",
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
_TREND_CANCELLATION_SQL = named_query(
    "network.trend.daily_cancel",
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
_TREND_OCCUPANCY_SQL = named_query(
    "network.trend.daily_occupancy",
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
# Each query carries its `-- q:<name>` registry marker (named_query) so the
# publish-test fakes dispatch a single canned row-set per query by exact name.

# Hourly-rollup OTP + weighted-avg delay, grouped by the bucket-start local date.
# Mirrors _TREND_DAILY_SQL: same SUM(delay)/CASE-guard on_time/weighted-delay and
# the same sargable upper-history bound on the indexed period_start_utc column,
# only the date expression is wrapped in date_trunc(<unit>, ...). The bound is
# widened to ~371 days (>= 53 ISO weeks / 12 months) so the coarse buckets stay
# useful while the scan over gold.route_delay_hourly stays bounded (the daily
# variant caps at 90 days; an unbounded full-retention scan is a cost/timeout
# risk — see the prior prod rollup-timeout incident).
_TREND_WEEKLY_SQL = named_query(
    "network.trend.week_hourly",
    """
    SELECT date_trunc('week', timezone(dp.timezone, rdh.period_start_utc))::date AS local_date,
           SUM(rdh.delay_observation_count)                  AS known_obs,
           CASE WHEN COUNT(*) = COUNT(rdh.on_time_observation_count)
                THEN SUM(rdh.on_time_observation_count)
           END AS on_time,
           SUM(rdh.avg_delay_seconds * rdh.delay_observation_count) AS weighted_delay_sec
    FROM gold.route_delay_hourly AS rdh
    JOIN gold.dim_provider AS dp ON dp.provider_id = rdh.provider_id
    WHERE rdh.provider_id = :provider_id
      AND rdh.period_start_utc >= now() - interval '371 days'
    GROUP BY date_trunc('week', timezone(dp.timezone, rdh.period_start_utc))::date
    """
)

_TREND_MONTHLY_SQL = named_query(
    "network.trend.month_hourly",
    """
    SELECT date_trunc('month', timezone(dp.timezone, rdh.period_start_utc))::date AS local_date,
           SUM(rdh.delay_observation_count)                  AS known_obs,
           CASE WHEN COUNT(*) = COUNT(rdh.on_time_observation_count)
                THEN SUM(rdh.on_time_observation_count)
           END AS on_time,
           SUM(rdh.avg_delay_seconds * rdh.delay_observation_count) AS weighted_delay_sec
    FROM gold.route_delay_hourly AS rdh
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
_TREND_CANCELLATION_WEEKLY_SQL = named_query(
    "network.trend.week_cancel",
    """
    SELECT date_trunc('week', provider_local_date)::date AS local_date,
           SUM(canceled_trip_days) AS canceled,
           SUM(total_trip_days)    AS total
    FROM gold.route_cancellation_daily
    WHERE provider_id = :provider_id
    GROUP BY date_trunc('week', provider_local_date)::date
    """
)

_TREND_CANCELLATION_MONTHLY_SQL = named_query(
    "network.trend.month_cancel",
    """
    SELECT date_trunc('month', provider_local_date)::date AS local_date,
           SUM(canceled_trip_days) AS canceled,
           SUM(total_trip_days)    AS total
    FROM gold.route_cancellation_daily
    WHERE provider_id = :provider_id
    GROUP BY date_trunc('month', provider_local_date)::date
    """
)

# Crowding band-counts summed across routes, bucketed by week/month.
# Mirrors _TREND_OCCUPANCY_SQL. Intentionally unbounded for the same reason as the
# cancellation variants above: gold.route_occupancy_band_daily is a small
# append-only per-route-day rollup; the daily variant is unbounded, so stay
# consistent with it rather than diverging the window.
_TREND_OCCUPANCY_WEEKLY_SQL = named_query(
    "network.trend.week_occupancy",
    """
    SELECT date_trunc('week', provider_local_date)::date AS local_date,
           SUM(empty_count)      AS empty,
           SUM(many_seats_count) AS many_seats,
           SUM(few_seats_count)  AS few_seats,
           SUM(standing_count)   AS standing,
           SUM(full_count)       AS full
    FROM gold.route_occupancy_band_daily
    WHERE provider_id = :provider_id
    GROUP BY date_trunc('week', provider_local_date)::date
    """
)

_TREND_OCCUPANCY_MONTHLY_SQL = named_query(
    "network.trend.month_occupancy",
    """
    SELECT date_trunc('month', provider_local_date)::date AS local_date,
           SUM(empty_count)      AS empty,
           SUM(many_seats_count) AS many_seats,
           SUM(few_seats_count)  AS few_seats,
           SUM(standing_count)   AS standing,
           SUM(full_count)       AS full
    FROM gold.route_occupancy_band_daily
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


def build_network_trend(
    conn: Connection, *, provider_id: str = "stm", generated_utc: str
) -> NetworkTrend:
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
