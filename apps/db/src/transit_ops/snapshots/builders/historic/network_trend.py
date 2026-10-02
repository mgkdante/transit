from __future__ import annotations

from typing import TYPE_CHECKING

from transit_ops.gold.reader import round_half_away
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


# Network delay aggregates include route-attributed observations only.
_TREND_DAILY_SQL = named_query(
    "network.trend.daily_hourly",
    """
    SELECT sp.provider_local_date                        AS local_date,
           SUM(sp.delay_observation_count)              AS known_obs,
           SUM(sp.on_time_observation_count)            AS on_time,
           SUM(sp.sum_delay_seconds)                    AS pooled_delay_sec,
           SUM((SELECT COALESCE(SUM(x), 0)
                FROM unnest(sp.delay_histogram) AS x))  AS inclamp_obs
    FROM gold.route_delay_spine AS sp
    WHERE sp.provider_id = :provider_id
      AND sp.provider_local_date >= (now() AT TIME ZONE 'UTC')::date - 90
    GROUP BY sp.provider_local_date
    """
)

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

_TREND_CANCELLATION_SQL = named_query(
    "network.trend.daily_cancel",
    """
    SELECT provider_local_date AS local_date,
           SUM(canceled_trip_days)   AS canceled,
           SUM(total_trip_days)      AS total,
           -- delivered is summed ONLY over rows with a known scheduled universe so the
           -- completeness numerator matches its Σscheduled denominator (rows with NULL
           -- scheduled contribute nothing to either side; else the rate inflates).
           SUM(delivered_trip_days) FILTER (WHERE scheduled_trip_days IS NOT NULL)
               AS delivered,
           SUM(scheduled_trip_days)  AS scheduled
    FROM gold.route_cancellation_daily
    WHERE provider_id = :provider_id
    GROUP BY provider_local_date
    """
)

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

# Weekly/monthly buckets use local starts; percentiles and distinct vehicles cannot be summed.

# Bound spine scans; pooled delay excludes ghost observations.
_TREND_WEEKLY_SQL = named_query(
    "network.trend.week_hourly",
    """
    SELECT date_trunc('week', sp.provider_local_date)::date AS local_date,
           SUM(sp.delay_observation_count)                 AS known_obs,
           SUM(sp.on_time_observation_count)               AS on_time,
           SUM(sp.sum_delay_seconds)                       AS pooled_delay_sec,
           SUM((SELECT COALESCE(SUM(x), 0)
                FROM unnest(sp.delay_histogram) AS x))     AS inclamp_obs
    FROM gold.route_delay_spine AS sp
    WHERE sp.provider_id = :provider_id
      AND sp.provider_local_date >= (now() AT TIME ZONE 'UTC')::date - 371
    GROUP BY date_trunc('week', sp.provider_local_date)::date
    """
)

_TREND_MONTHLY_SQL = named_query(
    "network.trend.month_hourly",
    """
    SELECT date_trunc('month', sp.provider_local_date)::date AS local_date,
           SUM(sp.delay_observation_count)                  AS known_obs,
           SUM(sp.on_time_observation_count)                AS on_time,
           SUM(sp.sum_delay_seconds)                        AS pooled_delay_sec,
           SUM((SELECT COALESCE(SUM(x), 0)
                FROM unnest(sp.delay_histogram) AS x))      AS inclamp_obs
    FROM gold.route_delay_spine AS sp
    WHERE sp.provider_id = :provider_id
      AND sp.provider_local_date >= (now() AT TIME ZONE 'UTC')::date - 371
    GROUP BY date_trunc('month', sp.provider_local_date)::date
    """
)

# Cancellation windows match the daily source; do not independently shorten coarse buckets.
_TREND_CANCELLATION_WEEKLY_SQL = named_query(
    "network.trend.week_cancel",
    """
    SELECT date_trunc('week', provider_local_date)::date AS local_date,
           SUM(canceled_trip_days)   AS canceled,
           SUM(total_trip_days)      AS total,
           -- delivered summed ONLY over known-scheduled rows (see daily variant): keeps
           -- the completeness numerator aligned with its Σscheduled denominator.
           SUM(delivered_trip_days) FILTER (WHERE scheduled_trip_days IS NOT NULL)
               AS delivered,
           SUM(scheduled_trip_days)  AS scheduled
    FROM gold.route_cancellation_daily
    WHERE provider_id = :provider_id
    GROUP BY date_trunc('week', provider_local_date)::date
    """
)

_TREND_CANCELLATION_MONTHLY_SQL = named_query(
    "network.trend.month_cancel",
    """
    SELECT date_trunc('month', provider_local_date)::date AS local_date,
           SUM(canceled_trip_days)   AS canceled,
           SUM(total_trip_days)      AS total,
           -- delivered summed ONLY over known-scheduled rows (see daily variant): keeps
           -- the completeness numerator aligned with its Σscheduled denominator.
           SUM(delivered_trip_days) FILTER (WHERE scheduled_trip_days IS NOT NULL)
               AS delivered,
           SUM(scheduled_trip_days)  AS scheduled
    FROM gold.route_cancellation_daily
    WHERE provider_id = :provider_id
    GROUP BY date_trunc('month', provider_local_date)::date
    """
)

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

_NETWORK_SHIFT_ORDER = ("am_peak", "midday", "pm_peak", "evening", "night")
_NETWORK_DAYTYPE_ORDER = ("weekday", "weekend")


def _blank_trend_point() -> dict:
    return {
        "otp_pct": None,
        "avg_delay_min": None,
        "p90_min": None,
        "vehicles": None,
        "cancellation_rate": None,
        "service_completeness_rate": None,
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
    points: dict[str, dict] = {}

    for r in conn.execute(otp_sql, params).mappings():
        known_obs = r["known_obs"]
        # OTP uses known-delay counts; pooled means use the in-clamp histogram denominator.
        pooled = r["pooled_delay_sec"]
        inclamp = r["inclamp_obs"]
        avg_delay_sec = (
            (float(pooled) / float(inclamp))
            if inclamp and pooled is not None
            else None
        )
        entry = _blank_trend_point()
        entry["otp_pct"] = _otp_pct(r["on_time"], known_obs)
        entry["avg_delay_min"] = _avg_delay_min(avg_delay_sec)
        # Cancellation and occupancy retain their own denominators.
        entry["observation_count"] = _opt_int(known_obs)
        entry["wilson_lo"] = _wilson_lo(r["on_time"], known_obs)
        entry["wilson_hi"] = _wilson_hi(r["on_time"], known_obs)
        points[_iso_date(r["local_date"])] = entry

    if fact_sql is not None:
        for r in conn.execute(fact_sql, params).mappings():
            entry = points.setdefault(_iso_date(r["local_date"]), _blank_trend_point())
            entry["p90_min"] = (
                float(round_half_away(r["p90_min"], 1)) if r["p90_min"] is not None else None
            )
            entry["vehicles"] = _opt_int(r["vehicles"])

    for r in conn.execute(cancellation_sql, params).mappings():
        entry = points.setdefault(_iso_date(r["local_date"]), _blank_trend_point())
        total = r["total"]
        canceled = r["canceled"]
        entry["cancellation_rate"] = (
            float(round_half_away(100.0 * float(canceled) / float(total), 2))
            if total and canceled is not None
            else None
        )
        # Completeness uses delivered/scheduled counts, capped at 100 for valid over-delivery.
        scheduled = r.get("scheduled")
        delivered = r.get("delivered")
        entry["service_completeness_rate"] = (
            min(100.0, float(round_half_away(100.0 * float(delivered) / float(scheduled), 2)))
            if scheduled and delivered is not None
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
            service_completeness_rate=v["service_completeness_rate"],
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
