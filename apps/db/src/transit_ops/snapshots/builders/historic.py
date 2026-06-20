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
    _sane_en,
    _severe_pct,
    _severity_code,
)
from transit_ops.snapshots.contract import (
    AlertBreakdown,
    AlertBreakdownBucket,
    AlertHistory,
    AlertHistoryEntry,
    CancellationPeriod,
    HeadwayPeriod,
    Hotspot,
    Hotspots,
    NetworkTrend,
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


def build_network_trend(conn: Connection, *, provider_id: str = "stm", generated_utc: str) -> "NetworkTrend":
    """Build historic/network_trend.json — one TrendPoint per local date.

    Two daily series merged by date: OTP + weighted-avg delay from the hourly
    rollup (~90 days) and p90 delay + distinct vehicles from the raw fact table
    (~14 days retained), so p90_min/vehicles are present only for the recent days
    the fact table still covers.
    """
    params = {"provider_id": provider_id}
    points: dict[str, dict] = {}

    def _blank_point() -> dict:
        return {
            "otp_pct": None,
            "avg_delay_min": None,
            "p90_min": None,
            "vehicles": None,
            "cancellation_rate": None,
            "occupancy_mix": None,
        }

    for r in conn.execute(_TREND_DAILY_SQL, params).mappings():
        known_obs = r["known_obs"]
        weighted = r["weighted_delay_sec"]
        avg_delay_sec = (
            (float(weighted) / float(known_obs))
            if known_obs and weighted is not None
            else None
        )
        entry = _blank_point()
        entry["otp_pct"] = _otp_pct(r["on_time"], known_obs)
        entry["avg_delay_min"] = _avg_delay_min(avg_delay_sec)
        points[_iso_date(r["local_date"])] = entry

    for r in conn.execute(_TREND_FACT_SQL, params).mappings():
        key = _iso_date(r["local_date"])
        entry = points.setdefault(key, _blank_point())
        entry["p90_min"] = round(float(r["p90_min"]), 1) if r["p90_min"] is not None else None
        entry["vehicles"] = _opt_int(r["vehicles"])

    for r in conn.execute(_TREND_CANCELLATION_SQL, params).mappings():
        entry = points.setdefault(_iso_date(r["local_date"]), _blank_point())
        total = r["total"]
        canceled = r["canceled"]
        entry["cancellation_rate"] = (
            round(100.0 * float(canceled) / float(total), 2)
            if total and canceled is not None
            else None
        )

    for r in conn.execute(_TREND_OCCUPANCY_SQL, params).mappings():
        entry = points.setdefault(_iso_date(r["local_date"]), _blank_point())
        entry["occupancy_mix"] = _occupancy_mix_from_bands(r)

    series = [
        TrendPoint(
            date=d,
            otp_pct=v["otp_pct"],
            avg_delay_min=v["avg_delay_min"],
            p90_min=v["p90_min"],
            vehicles=v["vehicles"],
            cancellation_rate=v["cancellation_rate"],
            occupancy_mix=v["occupancy_mix"],
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

# Observed headway per shift (pre-computed in gold) + Tier-2 regularity columns.
_ROUTE_HEADWAY_OBSERVED_SQL = text(
    """
    SELECT shift, observed_headway_min, sample_count, headway_cov, bunched_count
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


# Daily p50/p90 delay from the append-only percentile rollup (route grain).
_ROUTE_PERCENTILE_DAILY_SQL = text(
    """
    SELECT provider_local_date, p50_delay_seconds, p90_delay_seconds
    FROM gold.route_delay_percentile_daily
    WHERE provider_id = :provider_id AND route_id = :route_id
    """
)

# Per-route weekday seasonality (ISO 1=Mon..7=Sun) from the latent daily mart.
_ROUTE_DOW_SQL = text(
    """
    SELECT day_of_week_iso, observation_count, delay_observation_count,
           avg_delay_seconds, severe_delay_count
    FROM gold.route_delay_day_of_week
    WHERE provider_id = :provider_id AND route_id = :route_id
    ORDER BY day_of_week_iso
    """
)


# Granularity grains (time-of-day shift + weekday/weekend day-type), regrouped from
# the hourly spine; published as additive free-string-grain ReliabilityPeriod rows.
_ROUTE_BY_SHIFT_SQL = text(
    """
    SELECT shift AS grain,
           delay_observation_count AS known_obs,
           on_time_observation_count AS on_time,
           avg_delay_seconds AS avg_delay_sec,
           severe_delay_count AS severe
    FROM gold.route_delay_by_shift
    WHERE provider_id = :provider_id AND route_id = :route_id
    """
)

_ROUTE_BY_DAYTYPE_SQL = text(
    """
    SELECT day_type AS grain,
           delay_observation_count AS known_obs,
           on_time_observation_count AS on_time,
           avg_delay_seconds AS avg_delay_sec,
           severe_delay_count AS severe
    FROM gold.route_delay_by_daytype
    WHERE provider_id = :provider_id AND route_id = :route_id
    """
)

# Per-direction + weekday/weekend observed headway (sibling table; the busiest-direction
# route_headway_daily is left untouched). Direction is encoded into the free shift string.
_ROUTE_HEADWAY_DIRECTION_SQL = text(
    """
    SELECT shift, direction_id, service_day_kind, observed_headway_min
    FROM gold.route_headway_direction_daily
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

    # --- granularity grains (additive, free-string grain): time-of-day shift +
    #     weekday/weekend day-type. The live web strip filters to day/week/month;
    #     these feed the dedicated grouped sections in the 9.6 reliability surface.
    for grain_sql in (_ROUTE_BY_SHIFT_SQL, _ROUTE_BY_DAYTYPE_SQL):
        for r in conn.execute(grain_sql, params).mappings():
            periods.append(
                ReliabilityPeriod(
                    grain=str(r["grain"]),
                    date=None,
                    otp_pct=_otp_pct(r["on_time"], r["known_obs"]),
                    avg_delay_min=_avg_delay_min(r["avg_delay_sec"]),
                    p50_min=None,
                    p90_min=None,
                    severe_pct=_severe_pct(r["known_obs"], r["severe"]),
                )
            )

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

    # --- per-direction + weekday/weekend headway (additive HeadwayPeriod rows;
    #     direction encoded in the free shift string). The live strip filters out
    #     '_dir' shifts; the 9.6 surface renders them grouped.
    for r in conn.execute(_ROUTE_HEADWAY_DIRECTION_SQL, params).mappings():
        dir_obs = r["observed_headway_min"]
        kind = str(r["service_day_kind"])
        suffix = "" if kind == "weekday" else "_weekend"
        headway.append(
            HeadwayPeriod(
                shift=f'{r["shift"]}_dir{int(r["direction_id"])}{suffix}',
                scheduled_min=None,
                observed_min=round(float(dir_obs), 1) if dir_obs is not None else None,
                excess_wait_min=None,
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
        WeakStop(id=sid, name=names.get(sid), avg_delay_min=round(avg_sec / 60.0, 1))
        for sid, avg_sec in weak_rows[:5]
    ]

    # --- route display name: current dim first, dim_route_history fallback ---
    route_names = {
        str(r["route_id"]): r["route_name"]
        for r in conn.execute(_ROUTE_NAMES_SQL, {"provider_id": provider_id}).mappings()
    }

    # --- day_of_week: per-route weekday seasonality (latent daily mart) ---
    route_dow = [
        RouteDayOfWeek(
            day_of_week_iso=int(r["day_of_week_iso"]),
            avg_delay_min=_avg_delay_min(r["avg_delay_seconds"]),
            # severe_pct over observations with a KNOWN delay (matches every other
            # grain); COUNT(*) observation_count would understate it (honesty-fix 3/3).
            severe_pct=_severe_pct(r["delay_observation_count"], r["severe_delay_count"]),
            observation_count=_opt_int(r["observation_count"]),
        )
        for r in conn.execute(_ROUTE_DOW_SQL, params).mappings()
    ]

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
                avg_delay_min=(round(avg_sec / 60.0, 1) if avg_sec is not None else None),
                severe_pct=_severe_pct(r["obs"], r["severe"]),
            )

    # Granularity grains (additive, free-string grain): time-of-day shift +
    # weekday/weekend day-type, computed on the fly from the hourly mart with the
    # canonical route hour->shift / ISODOW split. Stop OTP stays the severe proxy;
    # honest-None (never 0) flows from the helpers when obs is 0/missing.
    for r in conn.execute(_STOP_BY_GRAIN_SQL, params).mappings():
        sid = str(r["stop_id"])
        grain = str(r["grain"])
        avg_sec = _weighted_avg_sec(r["obs"], r["weighted_delay_sec"])
        periods.setdefault(sid, {})[grain] = StopReliabilityPeriod(
            grain=grain,
            otp_pct=_otp_pct_severe_proxy(r["obs"], r["severe"]),
            avg_delay_min=(round(avg_sec / 60.0, 1) if avg_sec is not None else None),
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

    # Per-stop most-recent-day p50/p90 from the append-only percentile rollup.
    day_period: dict[str, StopReliabilityPeriod] = {
        str(r["stop_id"]): StopReliabilityPeriod(
            grain="day",
            p50_min=_avg_delay_min(r["p50_delay_seconds"]),
            p90_min=_avg_delay_min(r["p90_delay_seconds"]),
        )
        for r in conn.execute(_STOP_PERCENTILE_DAILY_SQL, params).mappings()
    }

    out: dict[str, StopReliability] = {}
    for sid in set(periods) | set(by_route) | set(habits) | set(day_period):
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
            by_route=routes,
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
      AND NOT (rp.entity_kind = 'route' AND rp.entity_id = '__unrouted__')
      AND NOT (rp.entity_kind = 'stop' AND rp.entity_id = '__unknown_stop__')
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
    # Defense-in-depth: never publish a sentinel-bucket entity even if a query path
    # ever forgets the SQL filter (re-ranks over the surviving rows).
    kept = [r for r in rows if str(r["entity_id"]) not in _SENTINEL_ENTITY_IDS]
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
        for i, r in enumerate(kept)
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
        if str(r["route_id"]) in _SENTINEL_ENTITY_IDS:
            continue  # defense-in-depth: never crown the routeless sentinel as worst
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
    conn: "Connection", provider_id: str = "stm", *, generated_utc: str
) -> "Provenance":
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

    return Provenance(
        generated_utc=generated_utc,
        sources=sources,
        freshness=freshness,
        conformance=conformance,
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
                "network p90 from fact (live + trailing 14d trend); route and "
                "stop p50/p90 from a daily fact-derived percentile rollup, "
                "computed per closed local day and retained 365 days"
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
                "day and retained 365 days; null when no trips were observed"
            ),
            "occupancy": (
                "historic crowding = GTFS-RT OccupancyStatus band shares over "
                "band-bearing pings (no numeric load factor); CRUSHED_STANDING "
                "folds into standing; NOT_ACCEPTING/NO_DATA/NOT_BOARDABLE excluded; "
                "summed per closed local day and retained 365 days; null when no "
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
                "trip's first-observation schedule deviation; retained 365 days"
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
    conn: "Connection", params: dict
) -> "ProvenanceConformance | None":
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
