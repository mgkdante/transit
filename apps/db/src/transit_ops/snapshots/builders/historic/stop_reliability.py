from __future__ import annotations

from typing import TYPE_CHECKING

from transit_ops.gold.reader import (
    current_date_trailing_clause,
    daytype_case_sql,
)
from transit_ops.snapshots.builders._helpers import (
    _STOP_NAMES_SQL,
    _avg_delay_min,
    _build_habits_matrix,
    _iso_date,
    _opt_int,
    _otp_pct_severe_proxy,
    _route_sort_key,
    _severe_pct,
    _wilson_hi,
    _wilson_lo,
)
from transit_ops.snapshots.builders.historic._spine import (
    _grain_windows,
    _occupancy_mix_from_bands,
)
from transit_ops.snapshots.contract import (
    OccupancyMix,
    RouteDayOfWeek,
    StopByRoute,
    StopDailyPoint,
    StopReliability,
    StopReliabilityPeriod,
)
from transit_ops.sql_registry import named_query

if TYPE_CHECKING:  # pragma: no cover - typing only
    from sqlalchemy.engine import Connection


# Pool in-clamp delay across all routes, including unrouted observations.
_STOP_REL_WEEKLY_SQL = named_query(
    "stop.reliability.weekly",
    """
    SELECT stop_id,
           SUM(observation_count)  AS obs,
           SUM(sum_delay_seconds)  AS weighted_delay_sec,
           SUM(severe_delay_count) AS severe
    FROM gold.stop_delay_spine
    WHERE provider_id = :provider_id
      AND provider_local_date >= :win_start AND provider_local_date <= :win_end
    GROUP BY stop_id
    """
)

_STOP_REL_MONTHLY_SQL = named_query(
    "stop.reliability.monthly",
    """
    SELECT stop_id,
           SUM(observation_count)  AS obs,
           SUM(sum_delay_seconds)  AS weighted_delay_sec,
           SUM(severe_delay_count) AS severe
    FROM gold.stop_delay_spine
    WHERE provider_id = :provider_id
      AND provider_local_date >= :win_start AND provider_local_date <= :win_end
    GROUP BY stop_id
    """
)

# Exclude the unrouted sentinel from named route breakdowns.
_STOP_REL_BY_ROUTE_SQL = named_query(
    "stop.reliability.by_route",
    """
    SELECT stop_id, route_id,
           SUM(observation_count) AS obs,
           SUM(sum_delay_seconds) AS weighted_delay_sec
    FROM gold.stop_delay_spine
    WHERE provider_id = :provider_id
      AND route_id <> '__unrouted__'
      AND provider_local_date >= :win_start AND provider_local_date <= :win_end
    GROUP BY stop_id, route_id
    """
)

_STOP_REL_ANCHOR_SQL = named_query(
    "stop.reliability.anchor",
    "SELECT MAX(provider_local_date) AS anchor FROM gold.stop_delay_spine "
    "WHERE provider_id = :provider_id"
)


# Heatmaps use hourly attribution and a severe-relative scale, distinct from route problem scores.
_STOP_HABIT_SQL = named_query(
    "stop.habit.score",
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

# Emit additive counts for observed days; do not zero-fill absent dates.
_STOP_DAILY_SQL = named_query(
    "stop.reliability.daily",
    f"""
    SELECT sds.stop_id                        AS stop_id,
           sds.provider_local_date            AS d,
           SUM(sds.observation_count)::numeric AS daily_obs,
           SUM(sds.severe_delay_count)::numeric AS severe,
           SUM(sds.sum_delay_seconds)         AS weighted_delay_sec
    FROM gold.stop_delay_spine AS sds
    JOIN gold.dim_provider AS dp ON dp.provider_id = sds.provider_id
    WHERE sds.provider_id = :provider_id
      AND {current_date_trailing_clause("sds.provider_local_date", days=90)}
    GROUP BY sds.stop_id, sds.provider_local_date
    ORDER BY sds.stop_id, sds.provider_local_date
    """
)


_STOP_PERCENTILE_DAILY_SQL = named_query(
    "stop.percentile.daily",
    """
    SELECT DISTINCT ON (stop_id)
        stop_id, p50_delay_seconds, p90_delay_seconds
    FROM gold.stop_delay_percentile_daily
    WHERE provider_id = :provider_id
    ORDER BY stop_id, provider_local_date DESC
    """
)


_STOP_OCCUPANCY_BAND_WINDOW_SQL = named_query(
    "stop.occupancy.band_window",
    f"""
    SELECT sob.stop_id                    AS stop_id,
           SUM(sob.empty_count)           AS empty,
           SUM(sob.many_seats_count)      AS many_seats,
           SUM(sob.few_seats_count)       AS few_seats,
           SUM(sob.standing_count)        AS standing,
           SUM(sob.full_count)            AS full
    FROM gold.stop_occupancy_band_daily AS sob
    JOIN gold.dim_provider AS dp ON dp.provider_id = sob.provider_id
    WHERE sob.provider_id = :provider_id
      AND {current_date_trailing_clause("sob.provider_local_date")}
    GROUP BY sob.stop_id
    """
)


# Read already-local dates/shifts without timezone conversion.
_STOP_BY_GRAIN_SQL = named_query(
    "stop.reliability.by_grain",
    f"""
    SELECT stop_id, grain,
           SUM(observation_count)::numeric AS obs,
           SUM(severe_delay_count)::numeric AS severe,
           SUM(sum_delay_seconds)          AS weighted_delay_sec
    FROM (
        SELECT sd.stop_id,
               sd.shift AS grain,
               sd.observation_count,
               sd.severe_delay_count,
               sd.sum_delay_seconds
        FROM gold.stop_delay_shift_daily AS sd
        WHERE sd.provider_id = :provider_id
        UNION ALL
        SELECT sd.stop_id,
{daytype_case_sql("sd.provider_local_date", indent=15, lead=True, wrap=True)} AS grain,
               sd.observation_count,
               sd.severe_delay_count,
               sd.sum_delay_seconds
        FROM gold.stop_delay_shift_daily AS sd
        WHERE sd.provider_id = :provider_id
    ) AS banded
    GROUP BY stop_id, grain
    """
)


_STOP_DOW_SQL = named_query(
    "stop.reliability.dow",
    """
    SELECT sd.stop_id,
           EXTRACT(ISODOW FROM sd.provider_local_date)::integer
               AS day_of_week_iso,
           SUM(sd.observation_count)::numeric AS dow_obs,
           SUM(sd.severe_delay_count)::numeric AS severe,
           SUM(sd.sum_delay_seconds)          AS weighted_delay_sec
    FROM gold.stop_delay_shift_daily AS sd
    WHERE sd.provider_id = :provider_id
    GROUP BY sd.stop_id, 2
    ORDER BY sd.stop_id, 2
    """
)


def build_stop_reliability(
    conn: Connection, *, provider_id: str = "stm", generated_utc: str
) -> dict[str, StopReliability]:
    params = {"provider_id": provider_id}

    def _weighted_avg_sec(obs: object, weighted: object) -> float | None:
        return (float(weighted) / float(obs)) if obs and weighted is not None else None

    anchor_row = conn.execute(_STOP_REL_ANCHOR_SQL, params).mappings().fetchone()
    anchor = anchor_row["anchor"] if anchor_row else None
    windows = _grain_windows(anchor) if anchor is not None else {}

    periods: dict[str, dict[str, StopReliabilityPeriod]] = {}
    for grain, sql in (("week", _STOP_REL_WEEKLY_SQL), ("month", _STOP_REL_MONTHLY_SQL)):
        if grain not in windows:
            continue
        win_start, win_end = windows[grain]
        win_params = {**params, "win_start": win_start, "win_end": win_end}
        for r in conn.execute(sql, win_params).mappings():
            sid = str(r["stop_id"])
            avg_sec = _weighted_avg_sec(r["obs"], r["weighted_delay_sec"])
            # Wilson bounds describe the not-severe share, not scheduled OTP.
            severe_k = (r["obs"] - (r["severe"] or 0)) if r["obs"] else None
            periods.setdefault(sid, {})[grain] = StopReliabilityPeriod(
                grain=grain,
                otp_pct=_otp_pct_severe_proxy(r["obs"], r["severe"]),
                avg_delay_min=_avg_delay_min(avg_sec),
                severe_pct=_severe_pct(r["obs"], r["severe"]),
                observation_count=_opt_int(r["obs"]),
                wilson_lo=_wilson_lo(severe_k, r["obs"]),
                wilson_hi=_wilson_hi(severe_k, r["obs"]),
            )

    for r in conn.execute(_STOP_BY_GRAIN_SQL, params).mappings():
        sid = str(r["stop_id"])
        grain = str(r["grain"])
        avg_sec = _weighted_avg_sec(r["obs"], r["weighted_delay_sec"])
        severe_k = (r["obs"] - (r["severe"] or 0)) if r["obs"] else None
        periods.setdefault(sid, {})[grain] = StopReliabilityPeriod(
            grain=grain,
            otp_pct=_otp_pct_severe_proxy(r["obs"], r["severe"]),
            avg_delay_min=_avg_delay_min(avg_sec),
            severe_pct=_severe_pct(r["obs"], r["severe"]),
            observation_count=_opt_int(r["obs"]),
            wilson_lo=_wilson_lo(severe_k, r["obs"]),
            wilson_hi=_wilson_hi(severe_k, r["obs"]),
        )

    by_route: dict[str, list[StopByRoute]] = {}
    if "week" in windows:
        win_start, win_end = windows["week"]
        by_route_params = {**params, "win_start": win_start, "win_end": win_end}
        by_route_rows = conn.execute(_STOP_REL_BY_ROUTE_SQL, by_route_params).mappings()
    else:
        by_route_rows = []
    for r in by_route_rows:
        sid = str(r["stop_id"])
        avg_sec = _weighted_avg_sec(r["obs"], r["weighted_delay_sec"])
        by_route.setdefault(sid, []).append(
            StopByRoute(
                route=str(r["route_id"]),
                avg_delay_min=_avg_delay_min(avg_sec),
            )
        )

    names = {
        str(r["stop_id"]): r["stop_name"]
        for r in conn.execute(_STOP_NAMES_SQL, params).mappings()
    }

    habit_rows: dict[str, list] = {}
    for r in conn.execute(_STOP_HABIT_SQL, params).mappings():
        habit_rows.setdefault(str(r["stop_id"]), []).append(r)
    habits = {
        sid: _build_habits_matrix(rows, scale="severe_relative")
        for sid, rows in habit_rows.items()
    }

    day_of_week: dict[str, list[RouteDayOfWeek]] = {}
    for r in conn.execute(_STOP_DOW_SQL, params).mappings():
        sid = str(r["stop_id"])
        obs = r["dow_obs"]
        avg_sec = _weighted_avg_sec(obs, r["weighted_delay_sec"])
        day_of_week.setdefault(sid, []).append(
            RouteDayOfWeek(
                day_of_week_iso=int(r["day_of_week_iso"]),
                avg_delay_min=_avg_delay_min(avg_sec),
                severe_pct=_severe_pct(obs, r["severe"]),
                observation_count=(_opt_int(obs) if obs else None),
            )
        )

    day_period: dict[str, StopReliabilityPeriod] = {
        str(r["stop_id"]): StopReliabilityPeriod(
            grain="day",
            p50_min=_avg_delay_min(r["p50_delay_seconds"]),
            p90_min=_avg_delay_min(r["p90_delay_seconds"]),
        )
        for r in conn.execute(_STOP_PERCENTILE_DAILY_SQL, params).mappings()
    }

    occupancy_mix: dict[str, OccupancyMix] = {}
    for r in conn.execute(_STOP_OCCUPANCY_BAND_WINDOW_SQL, params).mappings():
        mix = _occupancy_mix_from_bands(r)
        if mix is not None:
            occupancy_mix[str(r["stop_id"])] = mix

    daily: dict[str, list[StopDailyPoint]] = {}
    for r in conn.execute(_STOP_DAILY_SQL, params).mappings():
        obs = _opt_int(r["daily_obs"])
        if not obs:
            continue
        severe = int(r["severe"] or 0)
        avg_sec = _weighted_avg_sec(r["daily_obs"], r["weighted_delay_sec"])
        daily.setdefault(str(r["stop_id"]), []).append(
            StopDailyPoint(
                date=_iso_date(r["d"]),
                observation_count=obs,
                severe_count=severe,
                severe_pct=_severe_pct(r["daily_obs"], r["severe"]),
                avg_delay_min=_avg_delay_min(avg_sec),
            )
        )

    out: dict[str, StopReliability] = {}
    for sid in (
        set(periods)
        | set(by_route)
        | set(habits)
        | set(day_period)
        | set(day_of_week)
        | set(occupancy_mix)
        | set(daily)
    ):
        grain_map = periods.get(sid, {})
        ordered: list[StopReliabilityPeriod] = []
        if sid in day_period:
            ordered.append(day_period[sid])
        ordered.extend(grain_map[g] for g in ("week", "month") if g in grain_map)
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
            daily=daily.get(sid, []),
        )
    return out
