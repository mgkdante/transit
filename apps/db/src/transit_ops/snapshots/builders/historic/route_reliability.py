"""build_route_reliability — per-route reliability payload.

Split out of the former monolithic ``historic.py`` (S7-close C3). The route SQL
constants and the section mappers moved verbatim; ``build_route_reliability`` is now
a thin orchestrator that calls the per-section mappers IN THE SAME ORDER and with
the SAME query count as the pre-split builder. The single-read anchors (route spine
anchor for §1; stop-delay anchor shared by the scalar + windowed weak-stops) are read
ONCE in the orchestrator and threaded into the mappers, exactly as before.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from transit_ops.gold.reader import (
    ROUTE_HABIT_SPINE_SQL,
    all_time_window,
    current_date_trailing_clause,
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

# Observed headway per shift (pre-computed in gold) + Tier-2 regularity columns.
_ROUTE_HEADWAY_OBSERVED_SQL = named_query(
    "route.headway.observed_by_shift",
    """
    SELECT shift, observed_headway_min, sample_count, headway_cov, bunched_count
    FROM gold.route_headway_by_shift
    WHERE provider_id = :provider_id AND route_id = :route_id
    """
)

# The scalar whole-history habits matrix reads through the SAME reader SQL as the
# windowed habits_by_grain (gold/reader ROUTE_HABIT_SPINE_SQL — the ONE reconciled
# repeat_problem_score, S14 2026-07-02), bound to an ALL-TIME window (score.all_time_window:
# epoch floor → the route's spine anchor). This replaces the dropped gold.route_habit_score
# mart (migration 0076) + its 'route.habit.score' read: the published `habits` field stays
# VALUE-identical for identical spine content (parity proven by
# tests/test_habit_score_reconciliation_realdb.py). ROUTE_HABIT_SPINE_SQL additionally
# selects known_obs, which _build_habits_matrix ignores.

# Per-stop delay for this route — top weak stops by average delay, recomposed from the
# daily gold.stop_delay_spine over the trailing-month window (DB-0067 Phase 2: the
# stop_delay_weekly mart it used to read was dropped). weighted_delay_sec is the spine's
# pooled SUM(sum_delay_seconds) (the rebaselined avg numerator). The mart was the ~10-day
# open window; bounding to the trailing 30d (the month grain, via _grain_windows) keeps the
# scalar from ballooning toward the spine's 730d retention while staying recent — its
# windowed companion weak_stops_by_grain carries the per-grain breakdowns. A real route_id
# never matches the spine's '__unrouted__' sentinel, so NULL-route obs are excluded.
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


# Daily p50/p90 delay from the append-only percentile rollup (route grain).
_ROUTE_PERCENTILE_DAILY_SQL = named_query(
    "route.percentile.daily",
    """
    SELECT provider_local_date, p50_delay_seconds, p90_delay_seconds
    FROM gold.route_delay_percentile_daily
    WHERE provider_id = :provider_id AND route_id = :route_id
    """
)

# The per-route day_of_week / by_shift / by_daytype / by_shift_daytype breakdowns now
# derive at read time from gold.route_delay_spine (see _ROUTE_SPINE_* + the spine
# consumer helpers in _spine); the stored fold tables were dropped in migration 0064.

# Per-direction + weekday/weekend observed headway (sibling table; the busiest-direction
# route_headway_by_shift is left untouched). Direction is encoded into the free shift string.
_ROUTE_HEADWAY_DIRECTION_SQL = named_query(
    "route.headway.by_direction_shift",
    """
    SELECT shift, direction_id, service_day_kind, observed_headway_min
    FROM gold.route_headway_by_direction_shift
    WHERE provider_id = :provider_id AND route_id = :route_id
    ORDER BY direction_id, service_day_kind, shift
    """
)

# Per-route daily cancellation rate from the append-only rollup (last 30 closed
# local days). cancellation_rate_pct is None when total_trip_days=0. The scheduled-
# universe columns (GC2 H1) are NULL on pre-0073 history + no-schedule editions;
# service_completeness_pct is derived read-time = 100 * delivered / scheduled, NULL
# when scheduled is NULL or 0 (honest-unknown, never a fabricated 100%).
# 2026-07-02 (GC2): delivered > scheduled is LEGITIMATE (added/unscheduled trips),
# so the ratio is CLAMPED at 100 — over-delivery reads as fully complete rather than
# >100% (which the publish gate's 0-100 rate check would otherwise ABORT on). The
# batch-level id-drift detector (gate.py GATE_ID_DRIFT_WARN_FRACTION) is the signal
# for systemic overshoot.
# 2026-07-03 (P5.3e / GC2): the capture-day-vs-service-day overnight-spillover cause
# of over-delivery is ELIMINATED at the source — the rollup now filters the observed
# universe to the service day (rollups.py UPSERT_ROUTE_CANCELLATION_DAILY, 2-day
# capture window + start_date = local_date), so numerator and denominator share ONE
# universe. Remaining delivered > scheduled is real added/unscheduled service only.
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

# Trailing-30d crowding band-shares for the route from the append-only daily
# band-count reduction. Summed counts are divided into shares at read time;
# honest-None when no band-bearing telemetry exists in the window.
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

# S7 §04: crowding band-shares grouped by ISO weekday (1=Mon..7=Sun) over the same
# trailing-30d window as occupancy_mix, for the weekday/weekend split. Reuses the
# route_occupancy_band_daily source; honest-None per weekday with no band telemetry
# (handled by _occupancy_mix_from_bands). provider_local_date is ALREADY provider-
# local, so ISODOW needs NO timezone cast (unlike route_delay_day_of_week, which
# extracts from a UTC timestamp).
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

# S7 §04: per-day band counts over the trailing-30d window, bucketed in Python into
# grain-aware crowding mixes (day = most recent closed local day, week = trailing
# 7d, month = full 30d — month reconciles with the scalar occupancy_mix).
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

# GC2 H3 §04: crowding band-shares grouped by LOCAL hour-of-day (0..23) over the same
# trailing-30d window as occupancy_mix, for the time-of-day (rush-hour vs midday) split.
# Reads gold.route_occupancy_band_hourly (migration 0074, daily == Σ hourly); honest-None
# per hour with no band telemetry (handled by _occupancy_mix_from_bands). Clone of
# _ROUTE_OCCUPANCY_BY_DOW_SQL keyed on hour_of_day_local instead of ISODOW.
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

# Per-route service-span / first-last punctuality from the append-only daily
# rollup (last 30 closed local days). Unique discriminator for test dispatch:
# "first_trip_start_utc". (Ends with the shared ORDER BY provider_local_date DESC.)
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

# Per-route skipped-stop rate from the append-only daily rollup (last 30 closed
# local days). Unique discriminator for test dispatch: "skipped_stop_rate_pct".
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

# Track-B delay×crowding: TRUE co-observed per-band delay (FIX-3). Reads the append-only
# route_delay_by_crowding_daily rollup — where each delay observation already carries its OWN
# occupancy band (the vpm match) — and SUMs the additive moments per band over a trailing 30d
# window. No more day-dominant-band attribution: the full/standing tail is uncensored.
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


# --------------------------------------------------------------------------
# Per-section mappers (S7-close C3). Each wraps one contiguous slice of the
# former build_route_reliability body verbatim; the orchestrator calls them in
# source order so the executed-query sequence + count are unchanged.
# --------------------------------------------------------------------------


def _route_periods(conn: Connection, params: dict) -> list[ReliabilityPeriod]:
    """Daily (last 30) + weekly + monthly + by-shift/by-daytype ReliabilityPeriods.

    Query order: _ROUTE_PERCENTILE_DAILY_SQL, _ROUTE_REL_DAILY_SQL, then the spine
    period queries inside _spine_route_periods — UNCHANGED.
    """
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
    return periods


def _route_headway(
    conn: Connection, params: dict, *, provider_id: str, route_id: str
) -> tuple[list[HeadwayPeriod], dict]:
    """Whole-history per-shift headway + the scheduled-by-shift dict (reused by §2).

    Query order: observed, scheduled (which itself issues the rep-date + schedule
    queries), direction — UNCHANGED. Returns the scheduled dict so the windowed §2
    reader reuses it without re-querying.
    """
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

    # Shift buckets ordered by the canonical time-of-day sequence (module-level _shift_key,
    # shared with the windowed _headway_by_grain reader).
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
    return headway, scheduled


def _route_weak_stops(
    conn: Connection, params: dict, *, names: dict, weak_anchor, weak_stops_limit: int
) -> list[WeakStop]:
    """Scalar worst-N weak stops over the trailing-month window (honest, never padded).

    weak_anchor is the SHARED stop-delay anchor read ONCE by the orchestrator and
    threaded into both this scalar read and the windowed companion (one MAX scan).
    """
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
    weak_rows.sort(key=lambda t: t[1], reverse=True)
    return [
        WeakStop(id=sid, name=names.get(sid), avg_delay_min=_avg_delay_min(avg_sec))
        for sid, avg_sec in weak_rows[:weak_stops_limit]
    ]


def _route_cancellations(conn: Connection, params: dict) -> list[CancellationPeriod]:
    """Per-day cancellation-rate history (most recent 30 closed days, ASC)."""
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
    """Scalar trailing-30d occupancy_mix + weekday split + grain-aware + hour-of-day mix.

    Query order: band_window, by_dow, by_grain, by_hour — the by_hour read is a pure
    APPEND at the tail (GC2 H3), preserving the documented executed-query order.
    """
    # occupancy_mix: trailing-30d crowding band-shares (honest-None)
    occupancy_mix = _occupancy_mix_from_bands(
        conn.execute(_ROUTE_OCCUPANCY_BAND_WINDOW_SQL, params).mappings().fetchone()
    )

    # occupancy_by_dow: crowding mix per ISO weekday (S7 §04 weekday/weekend split;
    # honest-None per weekday with no band telemetry; sparse)
    occupancy_by_dow = [
        OccupancyByDow(
            day_of_week_iso=int(r["day_of_week_iso"]),
            mix=_occupancy_mix_from_bands(r),
            n=_band_total(r),
        )
        for r in conn.execute(_ROUTE_OCCUPANCY_BY_DOW_SQL, params).mappings()
    ]

    # occupancy_by_grain: grain-aware crowding mix (S7 §04). day = most recent
    # closed local day, week = trailing 7d, month = full 30d window (month
    # reconciles with occupancy_mix). Bucketed in Python; honest-None per grain
    # with no band telemetry; empty list when there is no occupancy telemetry.
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
    # occupancy_by_hour: crowding mix per LOCAL hour-of-day (GC2 H3 §04 time-of-day
    # split; honest-None per hour with no band telemetry; sparse). Reads the hour-grain
    # spine (daily == Σ hourly). APPENDED at the tail so the executed-query order stays
    # a pure extension of band_window/by_dow/by_grain.
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
    """Per-day first/last + span history (30 closed days, ASC)."""
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
    """Per-day skipped-stop-rate history (30 closed days, ASC; ramp-in)."""
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

    S7-close C3: the body is a thin orchestrator over per-section mappers; the
    executed-query order + count are preserved (the mappers run in source order,
    the two single-read anchors are read ONCE here and threaded in).
    """
    params = {"provider_id": provider_id, "route_id": route_id}

    # --- periods (daily/weekly/monthly + spine granularity grains) ---
    periods = _route_periods(conn, params)

    # --- headway: whole-history per-shift + scheduled dict (reused by §2 below) ---
    headway, scheduled = _route_headway(
        conn, params, provider_id=provider_id, route_id=route_id
    )

    # --- spine anchor: the route's newest closed day, read ONCE (S6) and threaded into the
    #     scalar all-time habits read below + both windowed builders. ---
    spine_anchor = _spine_anchor(conn, params)

    # --- habits: 7x24 per-route relative-problem matrix (isodow 1..7 x hour 0..23),
    #     whole-history via the reconciled reader score over an ALL-TIME window (S14;
    #     replaces the dropped gold.route_habit_score mart). No anchor -> no spine rows ->
    #     honest all-None matrix (never a fabricated calm 0). ---
    if spine_anchor is None:
        habits = _build_habits_matrix(())
    else:
        win_start, win_end = all_time_window(spine_anchor)
        habit_rows = conn.execute(
            ROUTE_HABIT_SPINE_SQL, {**params, "win_start": win_start, "win_end": win_end}
        ).mappings()
        habits = _build_habits_matrix(habit_rows)

    # --- S7-B windowable §1: the When-to-ride breakdowns + heatmap per time window
    #     (day/week/month) off gold.route_delay_spine. The scalar habits / periods /
    #     day_of_week / by_shift_daytype above stay the whole-history representation. ---
    periods_by_grain = _spine_periods_by_grain(conn, params, spine_anchor)
    habits_by_grain = _spine_habits_by_grain(conn, params, spine_anchor)

    # --- S7-B windowable §2: per-shift headway recomposed per time window off
    #     gold.route_headway_shift_daily (busiest direction per window). The scalar `headway`
    #     above stays whole-history (route_headway_by_shift) until the 0066 fast-follow. ---
    headway_by_grain = _headway_by_grain(conn, params, scheduled)

    # --- weak_stops: worst N (weak_stops_limit) by average delay seconds ---
    names = stop_names
    if names is None:
        names = {
            str(r["stop_id"]): r["stop_name"]
            for r in conn.execute(_STOP_NAMES_SQL, params).mappings()
        }
    # Shared spine anchor (newest closed day for this route) — drives BOTH the scalar
    # weak_stops trailing-month window AND the windowed companion below (one MAX scan).
    weak_anchor = _stop_delay_anchor(conn, params)
    weak_stops = _route_weak_stops(
        conn, params, names=names, weak_anchor=weak_anchor, weak_stops_limit=weak_stops_limit
    )

    # --- S7-B windowable §4: worst-N stops recomposed per time window off gold.stop_delay_spine,
    #     ranked by the not-severe Wilson lower bound (the build_stop_reliability house pattern).
    #     The scalar weak_stops[] above is the trailing-month (30d) recompose off the same spine
    #     and MIN_N-free; the windowed companion applies the MIN_N=30 hard floor. names + anchor
    #     reused (DB-0067 Phase 2 re-pointed the scalar off the dropped stop_delay_weekly). ---
    weak_stops_by_grain = _weak_stops_by_grain(conn, params, names, anchor=weak_anchor)

    # --- route display name: current dim first, dim_route_history fallback ---
    if route_names is None:
        route_names = {
            str(r["route_id"]): r["route_name"]
            for r in conn.execute(_ROUTE_NAMES_SQL, {"provider_id": provider_id}).mappings()
        }

    # --- day_of_week: per-route weekday seasonality (spine GROUP BY ISO dow) ---
    route_dow = _spine_route_dow(conn, params)

    # --- cancellations: per-day rate history (most recent 30 closed days, ASC) ---
    cancellations = _route_cancellations(conn, params)

    # --- occupancy: scalar mix + weekday split + grain-aware + hour-of-day mix ---
    occupancy_mix, occupancy_by_dow, occupancy_by_grain, occupancy_by_hour = _route_occupancy(
        conn, params
    )

    # --- service spans: per-day first/last + span history (30 closed days, ASC) ---
    service_spans = _route_service_spans(conn, params)

    # --- skipped stops: per-day rate history (30 closed days, ASC; ramp-in) ---
    skipped_stops = _route_skipped_stops(conn, params)

    # --- delay_by_crowding: TRUE per-band co-observed delay over trailing 30d (FIX-3;
    #     honest empty until the co-observed rollup ramps in) ---
    delay_by_crowding = _delay_by_crowding_cells(
        conn.execute(_ROUTE_CROWDING_DELAY_SQL, params).mappings()
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
        occupancy_by_hour=occupancy_by_hour,
        periods_by_grain=periods_by_grain,
        habits_by_grain=habits_by_grain,
        headway_by_grain=headway_by_grain,
        weak_stops_by_grain=weak_stops_by_grain,
    )
