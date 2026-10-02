from __future__ import annotations

from typing import TYPE_CHECKING

from transit_ops.gold.reader import (
    ROUTE_HABIT_SPINE_SQL,
    all_time_window,
    current_date_trailing_clause,
    round_half_away,
)
from transit_ops.snapshots.builders._helpers import (
    _ROUTE_NAMES_SQL,
    _STOP_NAMES_SQL,
    _avg_delay_min,
    _build_habits_matrix,
    _iso_date,
    _opt_float,
    _opt_int,
    _opt_iso,
    _otp_pct,
    _scheduled_headway_by_shift,
    _severe_pct,
    _wilson_hi,
    _wilson_lo,
)
from transit_ops.snapshots.builders.historic._spine import (
    _OCCUPANCY_BANDS,
    _band_total,
    _delay_by_crowding_cells,
    _grain_windows,
    _headway_by_grain,
    _occupancy_mix_from_bands,
    _shift_key,
    _spine_anchor,
    _spine_habits_by_grain,
    _spine_periods_by_grain,
    _spine_route_crosstab,
    _spine_route_dow,
    _spine_route_periods,
    _stop_delay_anchor,
    _weak_stops_by_grain,
)
from transit_ops.snapshots.contract import (
    CancellationPeriod,
    HeadwayPeriod,
    OccupancyByDow,
    OccupancyByGrain,
    OccupancyByHour,
    ReliabilityPeriod,
    RouteReliability,
    ServiceSpanPeriod,
    SkippedStopPeriod,
    WeakStop,
)
from transit_ops.sql_registry import named_query

if TYPE_CHECKING:  # pragma: no cover - typing only
    from collections.abc import Mapping

    from sqlalchemy.engine import Connection


_ROUTE_REL_DAILY_SQL = named_query(
    "route.reliability.daily",
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

_ROUTE_HEADWAY_OBSERVED_SQL = named_query(
    "route.headway.observed_by_shift",
    """
    SELECT shift, observed_headway_min, sample_count, headway_cov, bunched_count
    FROM gold.route_headway_by_shift
    WHERE provider_id = :provider_id AND route_id = :route_id
    """
)

# Scalar habits use the shared reader with an all-time window.

# Scalar weak stops use 30 closed days and exclude the unrouted sentinel.
_ROUTE_WEAK_STOPS_SQL = named_query(
    "route.weak_stops.legacy",
    """
    SELECT stop_id,
           SUM(observation_count)  AS obs,
           SUM(sum_delay_seconds)  AS weighted_delay_sec,
           SUM(severe_delay_count) AS severe
    FROM gold.stop_delay_spine
    WHERE provider_id = :provider_id AND route_id = :route_id
      AND provider_local_date >= :win_start AND provider_local_date <= :win_end
    GROUP BY stop_id
    """
)


_ROUTE_PERCENTILE_DAILY_SQL = named_query(
    "route.percentile.daily",
    """
    SELECT provider_local_date, p50_delay_seconds, p90_delay_seconds
    FROM gold.route_delay_percentile_daily
    WHERE provider_id = :provider_id AND route_id = :route_id
    """
)


_ROUTE_HEADWAY_DIRECTION_SQL = named_query(
    "route.headway.by_direction_shift",
    """
    SELECT shift, direction_id, service_day_kind, observed_headway_min
    FROM gold.route_headway_by_direction_shift
    WHERE provider_id = :provider_id AND route_id = :route_id
    ORDER BY direction_id, service_day_kind, shift
    """
)

# Cancellation uses RT-reported trips; completeness uses schedule counts capped at 100.
_ROUTE_CANCELLATION_DAILY_SQL = named_query(
    "route.cancellation.daily",
    """
    SELECT
        provider_local_date, cancellation_rate_pct, canceled_trip_days, total_trip_days,
        scheduled_trip_days, delivered_trip_days, silent_trip_days,
        -- LEAST() SWALLOWS NULLs (LEAST(100.0, NULL) = 100.0), so guard the honest-NULL
        -- (unknown scheduled universe) with a CASE — only clamp a REAL over-100 ratio.
        CASE
            WHEN delivered_trip_days IS NULL OR scheduled_trip_days IS NULL
                 OR scheduled_trip_days = 0 THEN NULL
            ELSE LEAST(100.0, ROUND(100.0 * delivered_trip_days / scheduled_trip_days, 2))
        END AS service_completeness_pct
    FROM gold.route_cancellation_daily
    WHERE provider_id = :provider_id AND route_id = :route_id
    ORDER BY provider_local_date DESC
    LIMIT 30
    """
)

_ROUTE_OCCUPANCY_BAND_WINDOW_SQL = named_query(
    "route.occupancy.band_window",
    f"""
    SELECT SUM(rob.empty_count)       AS empty,
           SUM(rob.many_seats_count)  AS many_seats,
           SUM(rob.few_seats_count)   AS few_seats,
           SUM(rob.standing_count)    AS standing,
           SUM(rob.full_count)        AS full
    FROM gold.route_occupancy_band_daily AS rob
    JOIN gold.dim_provider AS dp ON dp.provider_id = rob.provider_id
    WHERE rob.provider_id = :provider_id AND rob.route_id = :route_id
      AND {current_date_trailing_clause("rob.provider_local_date")}
    """
)

# Provider-local dates must not be timezone-converted again.
_ROUTE_OCCUPANCY_BY_DOW_SQL = named_query(
    "route.occupancy.by_dow",
    f"""
    SELECT EXTRACT(ISODOW FROM rob.provider_local_date)::int AS day_of_week_iso,
           SUM(rob.empty_count)       AS empty,
           SUM(rob.many_seats_count)  AS many_seats,
           SUM(rob.few_seats_count)   AS few_seats,
           SUM(rob.standing_count)    AS standing,
           SUM(rob.full_count)        AS full
    FROM gold.route_occupancy_band_daily AS rob
    JOIN gold.dim_provider AS dp ON dp.provider_id = rob.provider_id
    WHERE rob.provider_id = :provider_id AND rob.route_id = :route_id
      AND {current_date_trailing_clause("rob.provider_local_date")}
    GROUP BY EXTRACT(ISODOW FROM rob.provider_local_date)
    ORDER BY day_of_week_iso
    """
)

_ROUTE_OCCUPANCY_BY_GRAIN_SQL = named_query(
    "route.occupancy.by_grain",
    f"""
    SELECT rob.provider_local_date AS d,
           rob.empty_count       AS empty,
           rob.many_seats_count  AS many_seats,
           rob.few_seats_count   AS few_seats,
           rob.standing_count    AS standing,
           rob.full_count        AS full
    FROM gold.route_occupancy_band_daily AS rob
    JOIN gold.dim_provider AS dp ON dp.provider_id = rob.provider_id
    WHERE rob.provider_id = :provider_id AND rob.route_id = :route_id
      AND {current_date_trailing_clause("rob.provider_local_date")}
    ORDER BY rob.provider_local_date DESC
    """
)

_ROUTE_OCCUPANCY_BY_HOUR_SQL = named_query(
    "route.occupancy.by_hour",
    f"""
    SELECT rob.hour_of_day_local   AS hour_of_day_local,
           SUM(rob.empty_count)       AS empty,
           SUM(rob.many_seats_count)  AS many_seats,
           SUM(rob.few_seats_count)   AS few_seats,
           SUM(rob.standing_count)    AS standing,
           SUM(rob.full_count)        AS full
    FROM gold.route_occupancy_band_hourly AS rob
    JOIN gold.dim_provider AS dp ON dp.provider_id = rob.provider_id
    WHERE rob.provider_id = :provider_id AND rob.route_id = :route_id
      AND {current_date_trailing_clause("rob.provider_local_date")}
    GROUP BY rob.hour_of_day_local
    ORDER BY rob.hour_of_day_local
    """
)

_ROUTE_SERVICE_SPAN_SQL = named_query(
    "route.service_span.daily",
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

_ROUTE_SKIPPED_STOP_SQL = named_query(
    "route.skipped_stop.daily",
    """
    SELECT provider_local_date, skipped_stop_rate_pct, skipped_stop_count,
           stop_time_update_count
    FROM gold.route_skipped_stop_daily
    WHERE provider_id = :provider_id AND route_id = :route_id
    ORDER BY provider_local_date DESC
    LIMIT 30
    """
)

_ROUTE_CROWDING_DELAY_SQL = named_query(
    "route.delay.by_crowding",
    f"""
    SELECT rdc.band                                          AS band,
           SUM(rdc.delay_observation_count)                  AS delay_obs,
           SUM(rdc.sum_delay_seconds)                        AS sum_delay_sec,
           SUM(rdc.p50_delay_seconds * rdc.delay_observation_count)
               FILTER (WHERE rdc.p50_delay_seconds IS NOT NULL) AS w_p50_sec,
           SUM(rdc.delay_observation_count)
               FILTER (WHERE rdc.p50_delay_seconds IS NOT NULL) AS p50_obs,
           COUNT(*)                                          AS day_count
    FROM gold.route_delay_by_crowding_daily AS rdc
    JOIN gold.dim_provider AS dp ON dp.provider_id = rdc.provider_id
    WHERE rdc.provider_id = :provider_id AND rdc.route_id = :route_id
      AND {current_date_trailing_clause("rdc.provider_local_date")}
    GROUP BY rdc.band
    """
)


def _route_periods(conn: Connection, params: dict) -> list[ReliabilityPeriod]:
    # Daily percentiles cannot be recomposed exactly into weekly/monthly percentiles.
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
    periods.extend(_spine_route_periods(conn, params))
    return periods


def _route_headway(
    conn: Connection, params: dict, *, provider_id: str, route_id: str
) -> tuple[list[HeadwayPeriod], dict]:
    observed: dict[str, float] = {}
    regularity: dict[str, tuple[float | None, float | None]] = {}
    for r in conn.execute(_ROUTE_HEADWAY_OBSERVED_SQL, params).mappings():
        shift = str(r["shift"])
        if r["observed_headway_min"] is not None:
            observed[shift] = float(r["observed_headway_min"])
        cov_raw = r.get("headway_cov")
        bunched = r.get("bunched_count")
        sample = r.get("sample_count")
        cov = float(cov_raw) if cov_raw is not None else None
        bunched_pct = (
            float(round_half_away(100.0 * float(bunched) / float(sample), 1))
            if bunched is not None and sample
            else None
        )
        regularity[shift] = (cov, bunched_pct)

    scheduled = _scheduled_headway_by_shift(conn, provider_id=provider_id, route_id=route_id)

    headway: list[HeadwayPeriod] = []
    for shift in sorted(set(scheduled) | set(observed), key=_shift_key):
        sched = scheduled.get(shift)
        obs = observed.get(shift)
        both = sched is not None and obs is not None
        # Excess wait stays zero when observed service is earlier or more frequent.
        excess = float(round_half_away(max(0.0, obs - sched), 1)) if both else None
        cov, bunched_pct = regularity.get(shift, (None, None))
        headway.append(
            HeadwayPeriod(
                shift=shift,
                scheduled_min=sched,
                observed_min=obs,
                excess_wait_min=excess,
                cov=cov,
                bunched_pct=bunched_pct,
            )
        )

    for r in conn.execute(_ROUTE_HEADWAY_DIRECTION_SQL, params).mappings():
        dir_obs = r["observed_headway_min"]
        headway.append(
            HeadwayPeriod(
                shift=str(r["shift"]),
                direction_id=int(r["direction_id"]),
                day_type=str(r["service_day_kind"]),
                scheduled_min=None,
                observed_min=float(dir_obs) if dir_obs is not None else None,
                excess_wait_min=None,
            )
        )
    return headway, scheduled


def _route_weak_stops(
    conn: Connection, params: dict, *, names: dict, weak_anchor, weak_stops_limit: int
) -> list[WeakStop]:
    weak_rows = []
    if weak_anchor is not None:
        ws_start, ws_end = _grain_windows(weak_anchor)["month"]
        ws_params = {**params, "win_start": ws_start, "win_end": ws_end}
        for r in conn.execute(_ROUTE_WEAK_STOPS_SQL, ws_params).mappings():
            obs = r["obs"]
            weighted = r["weighted_delay_sec"]
            avg_sec = (float(weighted) / float(obs)) if obs and weighted is not None else None
            if avg_sec is None:
                continue
            weak_rows.append((str(r["stop_id"]), avg_sec))
    weak_rows.sort(key=lambda item: (-item[1], item[0]))
    return [
        WeakStop(id=sid, name=names.get(sid), avg_delay_min=_avg_delay_min(avg_sec))
        for sid, avg_sec in weak_rows[:weak_stops_limit]
    ]


def _route_cancellations(conn: Connection, params: dict) -> list[CancellationPeriod]:
    return [
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
            scheduled_trip_days=_opt_int(r["scheduled_trip_days"]),
            delivered_trip_days=_opt_int(r["delivered_trip_days"]),
            silent_trip_days=_opt_int(r["silent_trip_days"]),
            service_completeness_pct=_opt_float(r["service_completeness_pct"]),
        )
        for r in sorted(
            conn.execute(_ROUTE_CANCELLATION_DAILY_SQL, params).mappings(),
            key=lambda r: r["provider_local_date"],
        )
    ]


def _route_occupancy(
    conn: Connection, params: dict
) -> tuple[object, list[OccupancyByDow], list[OccupancyByGrain], list[OccupancyByHour]]:
    occupancy_mix = _occupancy_mix_from_bands(
        conn.execute(_ROUTE_OCCUPANCY_BAND_WINDOW_SQL, params).mappings().fetchone()
    )

    occupancy_by_dow = [
        OccupancyByDow(
            day_of_week_iso=int(r["day_of_week_iso"]),
            mix=_occupancy_mix_from_bands(r),
            n=_band_total(r),
        )
        for r in conn.execute(_ROUTE_OCCUPANCY_BY_DOW_SQL, params).mappings()
    ]

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
    occupancy_by_hour = [
        OccupancyByHour(
            hour_of_day_local=int(r["hour_of_day_local"]),
            mix=_occupancy_mix_from_bands(r),
            n=_band_total(r),
        )
        for r in conn.execute(_ROUTE_OCCUPANCY_BY_HOUR_SQL, params).mappings()
    ]
    return occupancy_mix, occupancy_by_dow, occupancy_by_grain, occupancy_by_hour


def _route_service_spans(conn: Connection, params: dict) -> list[ServiceSpanPeriod]:
    return [
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


def _route_skipped_stops(conn: Connection, params: dict) -> list[SkippedStopPeriod]:
    return [
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


def build_route_reliability(
    conn: Connection,
    *,
    provider_id: str = "stm",
    route_id: str,
    generated_utc: str,
    weak_stops_limit: int = 100,
    route_names: Mapping[str, str] | None = None,
    stop_names: Mapping[str, str] | None = None,
) -> RouteReliability:
    params = {"provider_id": provider_id, "route_id": route_id}

    periods = _route_periods(conn, params)

    headway, scheduled = _route_headway(
        conn, params, provider_id=provider_id, route_id=route_id
    )

    spine_anchor = _spine_anchor(conn, params)

    if spine_anchor is None:
        habits = _build_habits_matrix(())
    else:
        win_start, win_end = all_time_window(spine_anchor)
        habit_rows = conn.execute(
            ROUTE_HABIT_SPINE_SQL, {**params, "win_start": win_start, "win_end": win_end}
        ).mappings()
        habits = _build_habits_matrix(habit_rows)

    periods_by_grain = _spine_periods_by_grain(conn, params, spine_anchor)
    habits_by_grain = _spine_habits_by_grain(conn, params, spine_anchor)

    headway_by_grain = _headway_by_grain(conn, params, scheduled)

    names = stop_names
    if names is None:
        names = {
            str(r["stop_id"]): r["stop_name"]
            for r in conn.execute(_STOP_NAMES_SQL, params).mappings()
        }
    weak_anchor = _stop_delay_anchor(conn, params)
    weak_stops = _route_weak_stops(
        conn, params, names=names, weak_anchor=weak_anchor, weak_stops_limit=weak_stops_limit
    )

    # Windowed weak stops apply MIN_N=30; scalar trailing-month weak stops have no floor.
    weak_stops_by_grain = _weak_stops_by_grain(conn, params, names, anchor=weak_anchor)

    if route_names is None:
        route_names = {
            str(r["route_id"]): r["route_name"]
            for r in conn.execute(_ROUTE_NAMES_SQL, {"provider_id": provider_id}).mappings()
        }

    route_dow = _spine_route_dow(conn, params)

    cancellations = _route_cancellations(conn, params)

    occupancy_mix, occupancy_by_dow, occupancy_by_grain, occupancy_by_hour = _route_occupancy(
        conn, params
    )

    service_spans = _route_service_spans(conn, params)

    skipped_stops = _route_skipped_stops(conn, params)

    delay_by_crowding = _delay_by_crowding_cells(
        conn.execute(_ROUTE_CROWDING_DELAY_SQL, params).mappings()
    )

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
        occupancy_by_hour=occupancy_by_hour,
        periods_by_grain=periods_by_grain,
        habits_by_grain=habits_by_grain,
        headway_by_grain=headway_by_grain,
        weak_stops_by_grain=weak_stops_by_grain,
    )
