"""build_stop_reliability — batched per-stop reliability payloads.

Split out of the former monolithic ``historic.py`` (S7-close C3) verbatim. Mirrors
build_all_stops_data: one batched pass over gold.stop_delay_spine + the stop hourly
mart, keyed stop_id -> StopReliability.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from transit_ops.gold.reader import (
    current_date_trailing_clause,
    daytype_case_sql,
    shift_case_sql,
)
from transit_ops.snapshots.builders._helpers import (
    _STOP_NAMES_SQL,
    _avg_delay_min,
    _build_habits_matrix,
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
    StopReliability,
    StopReliabilityPeriod,
)
from transit_ops.sql_registry import named_query

if TYPE_CHECKING:  # pragma: no cover - typing only
    from sqlalchemy.engine import Connection


# Per-stop weekly/monthly delay, aggregated across the stop's routes — recomposed
# from the daily gold.stop_delay_spine (DB-0067 Phase 1) over a trailing window.
# MIRRORS THE ROUTE PRECEDENT (_spine_route_periods): week = trailing-7d,
# month = trailing-30d via _grain_windows(anchor); the (dropped) marts were the
# whole open window, so this makes stops grain-consistent with routes. The spine
# stores route_id COALESCE'd to '__unrouted__', so SUM-across-all-routes (the
# whole-stop view) includes the unrouted obs exactly as the marts did (which also
# carried an '__unrouted__' route partition per stop). weighted_delay_sec is the
# spine's pooled in-clamp SUM(sum_delay_seconds) directly (the rebaselined avg
# numerator), NOT the marts' SUM(avg*obs) approximation. avg = weighted/obs is the
# deliberate, accepted pooled rebaseline. :win_start/:win_end bound the window.
_STOP_REL_WEEKLY_SQL = named_query(
    "stop.reliability.weekly",
    """
    SELECT stop_id,
           SUM(observation_count)  AS obs,
           SUM(sum_delay_seconds)  AS weighted_delay_sec,
           SUM(severe_delay_count) AS severe
    FROM gold.stop_delay_spine
    WHERE provider_id = :provider_id
      AND service_local_date >= :win_start AND service_local_date <= :win_end
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
      AND service_local_date >= :win_start AND service_local_date <= :win_end
    GROUP BY stop_id
    """
)

# Per-(stop, route) average delay across the trailing weekly window, recomposed
# from the spine. route_id is COALESCE'd to '__unrouted__' in the spine; drop it
# so a stop's per-route breakdown never lists the internal sentinel (parity with
# the dropped mart read). weighted_delay_sec = pooled SUM(sum_delay_seconds).
_STOP_REL_BY_ROUTE_SQL = named_query(
    "stop.reliability.by_route",
    """
    SELECT stop_id, route_id,
           SUM(observation_count) AS obs,
           SUM(sum_delay_seconds) AS weighted_delay_sec
    FROM gold.stop_delay_spine
    WHERE provider_id = :provider_id
      AND route_id <> '__unrouted__'
      AND service_local_date >= :win_start AND service_local_date <= :win_end
    GROUP BY stop_id, route_id
    """
)

# Provider-wide newest-closed-day anchor for the stop reliability windows (no
# route filter — build_stop_reliability is a cross-route batch over ALL stops).
_STOP_REL_ANCHOR_SQL = named_query(
    "stop.reliability.anchor",
    "SELECT MAX(service_local_date) AS anchor FROM gold.stop_delay_spine "
    "WHERE provider_id = :provider_id"
)


# Per-stop 7x24 severe-delay heatmap source (dow x hour from the open-window
# hourly mart). Cell magnitude = summed severe-delay count; fed to
# _build_habits_matrix on the DISTINCT 'severe_relative' scale.
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

# Most-recent closed local day's p50/p90 per stop (append-only percentile rollup).
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


# Trailing-30d crowding band-shares per stop from the append-only daily band-count
# reduction (twin of _ROUTE_OCCUPANCY_BAND_WINDOW_SQL, but batched over ALL stops:
# one summed row per stop_id rather than a single per-entity bind). Summed counts
# are divided into shares at read time; honest-None when no band-bearing telemetry
# exists in the window. Unique discriminator for test dispatch:
# "stop_occupancy_band_daily AS sob".
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


# Granularity grains for stops, computed ON THE FLY from the hourly mart (stops
# have no rollup table). The hour->shift band CASE and the ISODOW weekday/weekend
# split are emitted from the ONE gold.reader.buckets source (the same bounds the
# route populate logic in gold/rollups.py uses) so stop grains line up with route
# grains — the mart stores UTC, so the hour/dow exprs re-apply timezone(). Avg
# delay mirrors the stop weekly rollup: COALESCE(arrival, departure),
# observation-weighted (_weighted_avg_sec). Stop OTP stays a severe(>300s)-only
# proxy (no on_time column in the stop hourly mart), so only obs + severe are
# aggregated. One UNION'd pass over both grain families.
_STOP_TS_EXPR = "timezone(dp.timezone, sd.period_start_utc)"
_STOP_HOUR_EXPR = f"EXTRACT(HOUR FROM {_STOP_TS_EXPR})"
_STOP_BY_GRAIN_SQL = named_query(
    "stop.reliability.by_grain",
    f"""
    SELECT stop_id, grain,
           SUM(observation_count)::numeric                AS obs,
           SUM(severe_delay_count)::numeric               AS severe,
           SUM(avg_delay_sec * NULLIF(observation_count, 0)) AS weighted_delay_sec
    FROM (
        SELECT sd.stop_id,
{shift_case_sql(_STOP_HOUR_EXPR, indent=15, lead=True, wrap=True)} AS grain,
               sd.observation_count,
               sd.severe_delay_count,
               COALESCE(sd.avg_arrival_delay_seconds, sd.avg_departure_delay_seconds)
                   AS avg_delay_sec
        FROM gold.stop_delay_hourly AS sd
        INNER JOIN gold.dim_provider AS dp ON dp.provider_id = sd.provider_id
        WHERE sd.provider_id = :provider_id
        UNION ALL
        SELECT sd.stop_id,
{daytype_case_sql(_STOP_TS_EXPR, indent=15, lead=True, wrap=True)} AS grain,
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
_STOP_DOW_SQL = named_query(
    "stop.reliability.dow",
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

    For every stop in gold.stop_delay_spine: weekly (trailing-7d) + monthly
    (trailing-30d) periods recomposed across the stop's routes (DB-0067 Phase 1),
    consistent with the route reliability grain windows. Stop OTP remains a
    severe(>300s)-only proxy, now over per-stop delay observations. Returns
    stop_id -> model.
    """
    params = {"provider_id": provider_id}

    def _weighted_avg_sec(obs: object, weighted: object) -> float | None:
        return (float(weighted) / float(obs)) if obs and weighted is not None else None

    # Trailing windows for the spine recompose (DB-0067 Phase 1): week = trailing-7d,
    # month = trailing-30d, anchored on the newest closed day in the spine for this
    # provider (mirrors the route precedent _spine_route_periods). When the spine is
    # empty the anchor is None -> the windowed reads are skipped (no rows, honest absence).
    anchor_row = conn.execute(_STOP_REL_ANCHOR_SQL, params).mappings().fetchone()
    anchor = anchor_row["anchor"] if anchor_row else None
    windows = _grain_windows(anchor) if anchor is not None else {}

    # period rows keyed stop_id -> {grain: StopReliabilityPeriod}
    periods: dict[str, dict[str, StopReliabilityPeriod]] = {}
    for grain, sql in (("week", _STOP_REL_WEEKLY_SQL), ("month", _STOP_REL_MONTHLY_SQL)):
        if grain not in windows:
            continue
        win_start, win_end = windows[grain]
        win_params = {**params, "win_start": win_start, "win_end": win_end}
        for r in conn.execute(sql, win_params).mappings():
            sid = str(r["stop_id"])
            avg_sec = _weighted_avg_sec(r["obs"], r["weighted_delay_sec"])
            # severe-proxy Wilson success = not-severe count (obs - severe); bounds
            # the NOT-SEVERE proportion, NOT a real OTP (see StopReliabilityPeriod).
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
            avg_delay_min=_avg_delay_min(avg_sec),
            severe_pct=_severe_pct(r["obs"], r["severe"]),
            observation_count=_opt_int(r["obs"]),
            wilson_lo=_wilson_lo(severe_k, r["obs"]),
            wilson_hi=_wilson_hi(severe_k, r["obs"]),
        )

    # by_route breakdown keyed stop_id -> list[StopByRoute] (trailing-7d week window).
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
                avg_delay_min=_avg_delay_min(avg_sec),
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
