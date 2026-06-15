"""Historic-tier builders (Phase 3) — gold reliability rollups -> /v1/historic.

OTP convention: otp_pct = round(100 * on_time / known), NULL if either side is
unknown or known==0. Stop reliability keeps a documented severe-delay proxy,
now over real per-stop delay observations rather than route-smeared values.
avg_delay_min = round(avg_delay_seconds/60, 1); severe_pct = round(100*sev/known, 1).
p50_min/p90_min for route/stop reliability are NOT stored in gold and are left
None (v1 deferral); only network_trend computes a real p90 from the fact table.
"""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING

from sqlalchemy import text

from transit_ops.snapshots.builders._helpers import (
    _ROUTE_NAMES_SQL,
    _ROUTE_SCHEDULE_SQL,  # noqa: F401 - re-exported via package __init__ for parity
    _SHIFT_ORDER,
    _STOP_NAMES_SQL,
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
    _scheduled_headway_by_shift,
    _severe_pct,
    _severity_code,
)
from transit_ops.snapshots.contract import (
    AlertHistory,
    AlertHistoryEntry,
    HeadwayPeriod,
    Hotspot,
    Hotspots,
    NetworkTrend,
    Offender,
    Provenance,
    ProvenanceFreshness,
    ProvenanceSource,
    Receipt,
    ReceiptWorstRoute,
    ReceiptWorstStop,
    ReliabilityPeriod,
    RepeatOffenders,
    RouteReliability,
    StopByRoute,
    StopReliability,
    StopReliabilityPeriod,
    TrendPoint,
    WeakStop,
)

if TYPE_CHECKING:  # pragma: no cover - typing only
    from sqlalchemy.engine import Connection


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
      AND fts.captured_at_utc >= now() - interval '14 days'
    GROUP BY timezone(dp.timezone, fts.captured_at_utc)::date
    """
)


def build_network_trend(conn: Connection, *, provider_id: str = "stm", generated_utc: str) -> "NetworkTrend":
    """Build historic/network_trend.json — one TrendPoint per local date.

    Two daily series merged by date: OTP + weighted-avg delay from the hourly
    rollup (~90 days) and p90 delay + distinct vehicles from the raw fact table
    (~14 days retained), so p90_min/vehicles are present only for the recent days
    the fact table still covers.
    """
    params = {"provider_id": provider_id}
    points: dict[str, dict] = {}

    for r in conn.execute(_TREND_DAILY_SQL, params).mappings():
        known_obs = r["known_obs"]
        weighted = r["weighted_delay_sec"]
        avg_delay_sec = (
            (float(weighted) / float(known_obs))
            if known_obs and weighted is not None
            else None
        )
        points[_iso_date(r["local_date"])] = {
            "otp_pct": _otp_pct(r["on_time"], known_obs),
            "avg_delay_min": _avg_delay_min(avg_delay_sec),
            "p90_min": None,
            "vehicles": None,
        }

    for r in conn.execute(_TREND_FACT_SQL, params).mappings():
        key = _iso_date(r["local_date"])
        entry = points.setdefault(
            key, {"otp_pct": None, "avg_delay_min": None, "p90_min": None, "vehicles": None}
        )
        entry["p90_min"] = round(float(r["p90_min"]), 1) if r["p90_min"] is not None else None
        entry["vehicles"] = _opt_int(r["vehicles"])

    series = [
        TrendPoint(
            date=d,
            otp_pct=v["otp_pct"],
            avg_delay_min=v["avg_delay_min"],
            p90_min=v["p90_min"],
            vehicles=v["vehicles"],
        )
        for d, v in sorted(points.items())
    ]
    return NetworkTrend(generated_utc=generated_utc, series=series)


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

_ROUTE_REL_WEEKLY_SQL = text(
    """
    SELECT week_start_local      AS d,
           delay_observation_count AS known_obs,
           on_time_observation_count AS on_time,
           avg_delay_seconds     AS avg_delay_sec,
           severe_delay_count    AS severe
    FROM gold.route_reliability_weekly
    WHERE provider_id = :provider_id AND route_id = :route_id
    ORDER BY week_start_local
    """
)

_ROUTE_REL_MONTHLY_SQL = text(
    """
    SELECT month_start_local     AS d,
           delay_observation_count AS known_obs,
           on_time_observation_count AS on_time,
           avg_delay_seconds     AS avg_delay_sec,
           severe_delay_count    AS severe
    FROM gold.route_reliability_monthly
    WHERE provider_id = :provider_id AND route_id = :route_id
    ORDER BY month_start_local
    """
)

# Observed headway per shift (pre-computed in gold).
_ROUTE_HEADWAY_OBSERVED_SQL = text(
    """
    SELECT shift, observed_headway_min, sample_count
    FROM gold.route_headway_daily
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


def build_route_reliability(
    conn: Connection, *, provider_id: str = "stm", route_id: str, generated_utc: str
) -> "RouteReliability":
    """Build historic/route_reliability/{route_id}.json.

    periods: daily (last 30) + weekly + monthly, all using observation-based OTP.
    headway: observed weekday trip-start gaps from the busiest direction (gold
             rollup) vs scheduled representative-weekday first-stop departures
             from the busiest direction, with non-negative excess_wait per shift.
    habits:  7x24 per-route relative-problem matrix (isodow 1..7 x hour 0..23;
             each cell a fraction of the route's worst hour, null = no data).
    weak_stops: top 5 stops on the route by average delay.
    """
    params = {"provider_id": provider_id, "route_id": route_id}

    # --- periods (daily/weekly/monthly observation-based OTP) ---
    periods: list[ReliabilityPeriod] = []
    for r in conn.execute(_ROUTE_REL_DAILY_SQL, params).mappings():
        periods.append(
                ReliabilityPeriod(
                    grain="day",
                    date=_iso_date(r["d"]),
                    otp_pct=_otp_pct(r["on_time"], r["known_obs"]),
                    avg_delay_min=_avg_delay_min(r["avg_delay_sec"]),
                    p50_min=None,  # percentiles not stored in gold (v1 deferral)
                    p90_min=None,
                    severe_pct=_severe_pct(r["known_obs"], r["severe"]),
            )
        )
    for grain, sql in (("week", _ROUTE_REL_WEEKLY_SQL), ("month", _ROUTE_REL_MONTHLY_SQL)):
        for r in conn.execute(sql, params).mappings():
            periods.append(
                ReliabilityPeriod(
                    grain=grain,
                    date=_iso_date(r["d"]),
                    otp_pct=_otp_pct(r["on_time"], r["known_obs"]),
                    avg_delay_min=_avg_delay_min(r["avg_delay_sec"]),
                    p50_min=None,
                    p90_min=None,
                    severe_pct=_severe_pct(r["known_obs"], r["severe"]),
                )
            )

    # --- headway: observed and scheduled both use weekday busiest-direction semantics ---
    observed: dict[str, float] = {}
    for r in conn.execute(_ROUTE_HEADWAY_OBSERVED_SQL, params).mappings():
        if r["observed_headway_min"] is not None:
            observed[str(r["shift"])] = float(r["observed_headway_min"])

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
        headway.append(
            HeadwayPeriod(
                shift=shift,
                scheduled_min=sched,
                observed_min=round(obs, 1) if obs is not None else None,
                excess_wait_min=excess,
            )
        )

    # --- habits: 7x24 per-route relative-problem matrix (isodow 1..7 x hour 0..23) ---
    habits = _build_habits_matrix(conn.execute(_ROUTE_HABIT_SQL, params).mappings())

    # --- weak_stops: top 5 by average delay seconds ---
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
        WeakStop(id=sid, name=names.get(sid), median_delay_min=round(avg_sec / 60.0, 1))
        for sid, avg_sec in weak_rows[:5]
    ]

    # --- route display name: current dim first, dim_route_history fallback ---
    route_names = {
        str(r["route_id"]): r["route_name"]
        for r in conn.execute(_ROUTE_NAMES_SQL, {"provider_id": provider_id}).mappings()
    }

    return RouteReliability(
        generated_utc=generated_utc,
        id=route_id,
        name=route_names.get(route_id),
        periods=periods,
        headway=headway,
        habits=habits,
        weak_stops=weak_stops,
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
    GROUP BY stop_id, route_id
    """
)


def build_stop_reliability(
    conn: Connection, *, provider_id: str = "stm", generated_utc: str
) -> "dict[str, StopReliability]":
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
            periods.setdefault(sid, {})[grain] = StopReliabilityPeriod(
                grain=grain,
                otp_pct=_otp_pct_severe_proxy(r["obs"], r["severe"]),
                median_delay_min=(round(avg_sec / 60.0, 1) if avg_sec is not None else None),
                severe_pct=_severe_pct(r["obs"], r["severe"]),
            )

    # by_route breakdown keyed stop_id -> list[StopByRoute]
    by_route: dict[str, list[StopByRoute]] = {}
    for r in conn.execute(_STOP_REL_BY_ROUTE_SQL, params).mappings():
        sid = str(r["stop_id"])
        avg_sec = _weighted_avg_sec(r["obs"], r["weighted_delay_sec"])
        by_route.setdefault(sid, []).append(
            StopByRoute(
                route=str(r["route_id"]),
                median_delay_min=(round(avg_sec / 60.0, 1) if avg_sec is not None else None),
            )
        )

    # stop display names: current dim first, dim_stop_history fallback
    names = {
        str(r["stop_id"]): r["stop_name"]
        for r in conn.execute(_STOP_NAMES_SQL, params).mappings()
    }

    out: dict[str, StopReliability] = {}
    for sid in set(periods) | set(by_route):
        grain_map = periods.get(sid, {})
        ordered = [grain_map[g] for g in ("week", "month") if g in grain_map]
        routes = sorted(by_route.get(sid, []), key=lambda b: _route_sort_key(b.route))
        out[sid] = StopReliability(
            generated_utc=generated_utc, id=sid, name=names.get(sid), periods=ordered, by_route=routes
        )
    return out


# --------------------------------------------------------------------------
# build_hotspots
# --------------------------------------------------------------------------

# Most-recent week period from gold.repeated_problem_route_stop.
# Fall back to the max period_start_local of any grain if no 'week' rows exist.
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
    )
    SELECT rp.entity_kind, rp.entity_id, rp.issue_count, rp.severity_label
    FROM gold.repeated_problem_route_stop AS rp, target
    WHERE rp.provider_id = :provider_id
      AND rp.period_start_local = target.target_start
      AND rp.period_grain = target.target_grain
    ORDER BY rp.issue_count DESC
    LIMIT 20
    """
)


def build_hotspots(conn: "Connection", provider_id: str = "stm", *, generated_utc: str) -> "Hotspots":
    """Build historic/hotspots.json — top 20 problem entities in the most recent week.

    Source: gold.repeated_problem_route_stop. Uses the most-recent week-grain period;
    falls back to the most-recent period of any grain if no week rows are present.
    otp_delta_pts is None in v1 (not stored in gold).
    """
    rows = list(conn.execute(_HOTSPOTS_SQL, {"provider_id": provider_id}).mappings())
    route_names, stop_names = _entity_name_maps(conn, provider_id=provider_id)
    hotspots = [
        Hotspot(
            rank=i + 1,
            type=str(r["entity_kind"]),
            id=str(r["entity_id"]),
            # kinds verified 'route'/'stop' in the mart — per-kind name lookup
            name=(
                route_names.get(str(r["entity_id"]))
                if str(r["entity_kind"]) == "route"
                else stop_names.get(str(r["entity_id"]))
            ),
            severity=r["severity_label"],
            otp_delta_pts=None,  # v1 deferral: not stored in gold.repeated_problem_route_stop
        )
        for i, r in enumerate(rows)
    ]
    return Hotspots(generated_utc=generated_utc, hotspots=hotspots)


# --------------------------------------------------------------------------
# build_repeat_offenders
# --------------------------------------------------------------------------

# P3 mart: gold.repeat_offender_daily — persistent problem entities.
_REPEAT_OFFENDERS_SQL = text(
    """
    SELECT entity_kind, entity_id, route_id,
           recurrence_days, window_days, avg_delay_seconds, severity_label
    FROM gold.repeat_offender_daily
    WHERE provider_id = :provider_id
    ORDER BY recurrence_days DESC, avg_delay_seconds DESC
    LIMIT 50
    """
)


def build_repeat_offenders(
    conn: "Connection", provider_id: str = "stm", *, generated_utc: str
) -> "RepeatOffenders":
    """Build historic/repeat_offenders.json — top 50 most-persistent problem entities.

    Source: gold.repeat_offender_daily (P3 mart).
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
_RECEIPTS_WORST_ROUTE_SQL = text(
    """
    SELECT provider_local_date AS d,
           route_id,
           avg_delay_seconds
    FROM gold.public_route_reliability_daily
    WHERE provider_id = :provider_id
      AND provider_local_date >= current_date - 30
      AND avg_delay_seconds IS NOT NULL
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
    ORDER BY provider_local_date, avg_delay_seconds DESC, stop_id
    """
)


def build_receipts(
    conn: "Connection", provider_id: str = "stm", *, generated_utc: str
) -> "dict[str, Receipt]":
    """Build historic/receipts/{date}.json for each date in the last 30 days.

    The citizen_accountability_daily table is the driver — one Receipt per date
    present there.  Network OTP/delay come from route_delay_hourly (hourly rollup
    aggregated to daily); worst_route and worst_stop come from the public daily
    views (max avg_delay_seconds per date).

    vehicles is None in v1 (not stored in the receipt source mart).
    worst_route.otp_delta_pts is None in v1 (not stored in gold).
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
        ds = _iso_date(r["d"])
        if ds not in worst_route:  # first = max avg_delay (ordered DESC)
            worst_route[ds] = ReceiptWorstRoute(
                id=str(r["route_id"]),
                name=route_names.get(str(r["route_id"])),
                otp_delta_pts=None,  # v1 deferral: not stored in gold
            )

    # 4. worst stop per date: first row after ORDER BY avg_delay_seconds DESC
    worst_stop: dict[str, ReceiptWorstStop] = {}
    for r in conn.execute(_RECEIPTS_WORST_STOP_SQL, params).mappings():
        ds = _iso_date(r["d"])
        if ds not in worst_stop:  # first = max avg_delay (ordered DESC)
            worst_stop[ds] = ReceiptWorstStop(
                id=str(r["stop_id"]),
                name=stop_names.get(str(r["stop_id"])),
                median_delay_min=_avg_delay_min(r["avg_delay_seconds"]),
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


def build_alert_history(
    conn: "Connection", provider_id: str = "stm", *, generated_utc: str
) -> "AlertHistory":
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
        entries.append(
            AlertHistoryEntry(
                id=alert_id,
                severity=_severity_code(r["severity"]),
                # slice-9.1.1s: header + MAX'd EN header (grouping unchanged).
                header_text=r["alert_header_text"],
                header_text_en=r["header_text_en"],
                routes=_natural_sort_dedup(raw_routes),
                stops=_natural_sort_dedup(raw_stops),
                start_utc=_opt_iso(start),
                end_utc=_opt_iso(end),
                duration_min=duration_min,
                impact_passages=None,  # v1 deferral: not stored in gold
            )
        )
    return AlertHistory(generated_utc=generated_utc, alerts=entries)


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


def build_provenance(
    conn: "Connection", provider_id: str = "stm", *, generated_utc: str
) -> "Provenance":
    """Build provenance.json — feed lineage, freshness, retention policy, methodology.

    Sources from gold.source_lineage_reporting (is_current=true only).
    Freshness from gold.feed_freshness_current.
    Retention and methodology are hardcoded v1 constants.
    gaps lists known missing feeds (STM metro publishes no realtime feed).
    """
    params = {"provider_id": provider_id}

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

    return Provenance(
        generated_utc=generated_utc,
        sources=sources,
        freshness=freshness,
        retention={"detail_days": 14, "aggregate_days": 365},
        methodology={
            "otp_definition": (
                "on-time = observed delay between -60s and +300s "
                "(at most 1 min early, less than 5 min late); route OTP = "
                "on-time observations / observations with known delay; "
                "stop-level otp_pct is observations not severe(>300s) over "
                "per-stop delay observations, a severe-delay proxy rather "
                "than true on-time-band OTP"
            ),
            "delay_unit": (
                "seconds from schedule; delay statistics exclude observations "
                "with |delay| > 1 hour (ghost-trip guard); severe = >300s and <=3600s"
            ),
            "percentiles": (
                "network p90 from fact; route/stop percentiles deferred"
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
        },
        gaps=["metro_realtime"],  # STM metro publishes no realtime feed
    )
