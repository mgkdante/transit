from __future__ import annotations

from transit_ops.gold.reader import (
    ROUTE_HABIT_SPINE_SQL as _ROUTE_HABIT_SPINE_SQL,
)
from transit_ops.gold.reader import (
    SPINE_WINDOW_CLAUSE as _SPINE_WINDOW_CLAUSE,
)
from transit_ops.gold.reader import (
    GrainWindows,
    bunched_pct,
    cdf_percentile,
    cov_case_sql,
    daytype_case_sql,
    delay_histogram_bins,
    ewt_min,
    hist_and_avg,
    hist_cols,
    pctile_min_from_hist,
    round_half_away,
    shift_case_sql,
    spine_project_sql,
)
from transit_ops.gold.rollups import DELAY_HISTOGRAM_EDGES as _SPINE_EDGES
from transit_ops.gold.rollups import HEADWAY_GAP_HISTOGRAM_EDGES as _GAP_EDGES
from transit_ops.snapshots.builders._helpers import (
    _SHIFT_ORDER,
    MIN_N_RATE,
    _avg_delay_min,
    _build_habits_matrix,
    _iso_date,
    _opt_int,
    _otp_pct,
    _severe_pct,
    _wilson_hi,
    _wilson_lo,
)
from transit_ops.snapshots.contract import (
    CrosstabCell,
    CrowdingDelayCell,
    HeadwayByGrain,
    HeadwayPeriod,
    NetworkShift,
    OccupancyMix,
    ReliabilityByGrain,
    ReliabilityPeriod,
    RouteDayOfWeek,
    RouteDelayHistogramBin,
    RouteHabitsByGrain,
    WeakStop,
    WeakStopGrain,
)
from transit_ops.sql_registry import named_query

_OCCUPANCY_BANDS = ("empty", "many_seats", "few_seats", "standing", "full")


def _pctile_from_hist(hist: list[int] | None, q: float) -> float | None:
    return pctile_min_from_hist(hist, q, _SPINE_EDGES)


def _band_total(row: object) -> int | None:
    if row is None:
        return None
    return sum(int(row[band] or 0) for band in _OCCUPANCY_BANDS)


def _occupancy_mix_from_bands(row: object) -> OccupancyMix | None:
    if row is None:
        return None
    counts = {band: int(row[band] or 0) for band in _OCCUPANCY_BANDS}
    total = sum(counts.values())
    if not total:
        return None
    return OccupancyMix(**{band: counts[band] / total for band in _OCCUPANCY_BANDS})


def _delay_by_crowding_cells(rows) -> list[CrowdingDelayCell]:  # noqa: ANN001
    by_band = {str(r["band"]): r for r in rows if r["band"] is not None}
    cells: list[CrowdingDelayCell] = []
    for band in _OCCUPANCY_BANDS:
        r = by_band.get(band)
        if r is None:
            continue
        obs = int(r["delay_obs"] or 0)
        p50_obs = int(r["p50_obs"] or 0)
        sum_delay_sec = float(r["sum_delay_sec"] or 0.0)
        w_p50_sec = float(r["w_p50_sec"] or 0.0)
        cells.append(
            CrowdingDelayCell(
                band=band,
                avg_delay_min=(_avg_delay_min(sum_delay_sec / obs) if obs else None),
                p50_min=(_avg_delay_min(w_p50_sec / p50_obs) if p50_obs else None),
                observation_count=(obs or None),
                day_count=int(r["day_count"] or 0),
            )
        )
    return cells


# Read provider-local date/hour columns directly without another timezone conversion.

_SPINE_SHIFT_CASE = shift_case_sql("hour_of_day_local")

_SPINE_DAYTYPE_CASE = daytype_case_sql("provider_local_date")

_spine_project_sql = spine_project_sql


def _route_spine_sql(name: str, dims: str, group_by: str, window_clause: str = ""):  # noqa: ANN202
    return _spine_project_sql(name, dims, group_by, window_clause=window_clause)


_ROUTE_SPINE_BY_SHIFT_SQL = _route_spine_sql(
    "route.spine.by_shift", f"{_SPINE_SHIFT_CASE} AS grain,", "1"
)
_ROUTE_SPINE_BY_DAYTYPE_SQL = _route_spine_sql(
    "route.spine.by_daytype", f"{_SPINE_DAYTYPE_CASE} AS grain,", "1"
)
_ROUTE_SPINE_WEEKLY_SQL = _route_spine_sql(
    "route.spine.weekly", "date_trunc('week', provider_local_date)::date AS d,", "1"
)
_ROUTE_SPINE_MONTHLY_SQL = _route_spine_sql(
    "route.spine.monthly", "date_trunc('month', provider_local_date)::date AS d,", "1"
)
_ROUTE_SPINE_DOW_SQL = _route_spine_sql(
    "route.spine.dow",
    "EXTRACT(ISODOW FROM provider_local_date)::integer AS day_of_week_iso,",
    "1",
)
_ROUTE_SPINE_CROSSTAB_SQL = _route_spine_sql(
    "route.spine.crosstab",
    f"{_SPINE_SHIFT_CASE} AS shift,\n        {_SPINE_DAYTYPE_CASE} AS day_type,",
    "1, 2",
)

# Network reads include all attributed routes; silent cells add nothing to known-delay sums.
_NETWORK_SPINE_BY_SHIFT_SQL = _spine_project_sql(
    "network.spine.by_shift", f"{_SPINE_SHIFT_CASE} AS grain,", "1", ""
)
_NETWORK_SPINE_BY_DAYTYPE_SQL = _spine_project_sql(
    "network.spine.by_daytype", f"{_SPINE_DAYTYPE_CASE} AS grain,", "1", ""
)

_MIN_N_HABIT_CELL = 30

_SPINE_ANCHOR_SQL = named_query(
    "route.spine.anchor",
    "SELECT MAX(provider_local_date) AS anchor FROM gold.route_delay_spine "
    "WHERE provider_id = :provider_id AND route_id = :route_id"
)

_W_BY_SHIFT = _route_spine_sql(
    "route.spine.by_shift_windowed", f"{_SPINE_SHIFT_CASE} AS grain,", "1", _SPINE_WINDOW_CLAUSE
)
_W_BY_DAYTYPE = _route_spine_sql(
    "route.spine.by_daytype_windowed",
    f"{_SPINE_DAYTYPE_CASE} AS grain,",
    "1",
    _SPINE_WINDOW_CLAUSE,
)
_W_DOW = _route_spine_sql(
    "route.spine.dow_windowed",
    "EXTRACT(ISODOW FROM provider_local_date)::integer AS day_of_week_iso,",
    "1",
    _SPINE_WINDOW_CLAUSE,
)
_W_CROSSTAB = _route_spine_sql(
    "route.spine.crosstab_windowed",
    f"{_SPINE_SHIFT_CASE} AS shift,\n        {_SPINE_DAYTYPE_CASE} AS day_type,",
    "1, 2",
    _SPINE_WINDOW_CLAUSE,
)

def _grain_windows(anchor):  # noqa: ANN001, ANN202
    return GrainWindows(anchor)


_spine_hist_and_avg = hist_and_avg


def _spine_delay_histogram(hist: list[int]) -> list[RouteDelayHistogramBin] | None:
    bins = delay_histogram_bins(hist, _SPINE_EDGES)
    if bins is None:
        return None
    return [RouteDelayHistogramBin(lo_sec=lo, hi_sec=hi, count=count) for lo, hi, count in bins]


def _spine_reliability_period(  # noqa: ANN001
    r, *, grain: str, date, with_histogram: bool = True
) -> ReliabilityPeriod:
    # Windowed shift/day-type rows omit histogram arrays; scalar percentiles still use them.
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
        delay_histogram=_spine_delay_histogram(hist) if with_histogram else None,
    )


def _spine_route_periods(conn, params) -> list[ReliabilityPeriod]:  # noqa: ANN001
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


def _spine_route_dow(conn, params, sql=_ROUTE_SPINE_DOW_SQL) -> list[RouteDayOfWeek]:  # noqa: ANN001
    out: list[RouteDayOfWeek] = []
    for r in conn.execute(sql, params).mappings():
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


def _spine_route_crosstab(conn, params, sql=_ROUTE_SPINE_CROSSTAB_SQL) -> list[CrosstabCell]:  # noqa: ANN001
    out: list[CrosstabCell] = []
    for r in conn.execute(sql, params).mappings():
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


def _network_spine_rows(conn, sql, params, order) -> list[NetworkShift]:  # noqa: ANN001
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


def _windowed_periods(conn, sql, params, *, with_histogram=False):  # noqa: ANN001, ANN202
    return [
        _spine_reliability_period(
            r, grain=str(r["grain"]), date=None, with_histogram=with_histogram
        )
        for r in conn.execute(sql, params).mappings()
    ]


def _windowed_otp_index(conn, sql, params):  # noqa: ANN001, ANN202
    return {
        str(r["grain"]): (r["on_time"], r["known_obs"])
        for r in conn.execute(sql, params).mappings()
    }


def _attach_prior(periods, prior_index):  # noqa: ANN001, ANN202
    for p in periods:
        pri = prior_index.get(p.grain)
        if pri is None:
            continue
        on_time, known = pri
        p.prior_observation_count = _opt_int(known)
        p.prior_on_time = _opt_int(on_time)
        p.prior_otp_pct = _otp_pct(on_time, known)


def _spine_anchor(conn, params):  # noqa: ANN001, ANN202
    row = conn.execute(_SPINE_ANCHOR_SQL, params).mappings().fetchone()
    return row["anchor"] if row else None


def _spine_periods_by_grain(conn, params, anchor=None) -> list[ReliabilityByGrain]:  # noqa: ANN001
    if anchor is None:
        anchor = _spine_anchor(conn, params)
    if anchor is None:
        return []
    out: list[ReliabilityByGrain] = []
    windows = _grain_windows(anchor)
    for grain, (win_start, win_end) in windows.items():
        pri_start, pri_end = windows.prior(grain)
        cur = {**params, "win_start": win_start, "win_end": win_end}
        pri = {**params, "win_start": pri_start, "win_end": pri_end}
        by_shift = _windowed_periods(conn, _W_BY_SHIFT, cur)
        by_daytype = _windowed_periods(conn, _W_BY_DAYTYPE, cur)
        _attach_prior(by_shift, _windowed_otp_index(conn, _W_BY_SHIFT, pri))
        _attach_prior(by_daytype, _windowed_otp_index(conn, _W_BY_DAYTYPE, pri))
        dow = _spine_route_dow(conn, cur, sql=_W_DOW)
        crosstab = _spine_route_crosstab(conn, cur, sql=_W_CROSSTAB)
        if by_shift or by_daytype or dow or crosstab:
            out.append(
                ReliabilityByGrain(
                    grain=grain,
                    date=_iso_date(win_start),
                    by_shift=by_shift,
                    by_daytype=by_daytype,
                    day_of_week=dow,
                    by_shift_daytype=crosstab,
                )
            )
    return out


def _spine_habits_by_grain(conn, params, anchor=None) -> list[RouteHabitsByGrain]:  # noqa: ANN001
    if anchor is None:
        anchor = _spine_anchor(conn, params)
    if anchor is None:
        return []
    out: list[RouteHabitsByGrain] = []
    for grain, (win_start, win_end) in _grain_windows(anchor).items():
        rows = conn.execute(
            _ROUTE_HABIT_SPINE_SQL, {**params, "win_start": win_start, "win_end": win_end}
        ).mappings()
        cells: list[dict] = []
        suppressed = 0
        for r in rows:
            if int(r["known_obs"] or 0) < _MIN_N_HABIT_CELL:
                suppressed += 1
                continue
            cells.append(
                {
                    "day_of_week_iso": r["day_of_week_iso"],
                    "hour_of_day_local": r["hour_of_day_local"],
                    "repeat_problem_score": float(r["repeat_problem_score"]),
                }
            )
        habits = _build_habits_matrix(cells) if cells else None
        out.append(
            RouteHabitsByGrain(
                grain=grain,
                date=_iso_date(win_start),
                habits=habits,
                cells_observed=len(cells),
                cells_suppressed=suppressed,
            )
        )
    return out


_GAP_NBINS = len(_GAP_EDGES) - 1


# Match PostgreSQL ties-away-from-zero rounding.
_round_half_away = round_half_away


def _shift_key(s: str) -> tuple[int, str]:
    return (_SHIFT_ORDER.index(s), "") if s in _SHIFT_ORDER else (len(_SHIFT_ORDER), s)


def _headway_pctile_from_hist(hist, q, edges):  # noqa: ANN001, ANN202
    return cdf_percentile(hist, q, edges)


_bunched_pct_from_hist = bunched_pct


# Headway and delay spines have independent newest-closed-day anchors.
_HEADWAY_SHIFT_ANCHOR_SQL = named_query(
    "route.headway.anchor",
    "SELECT MAX(provider_local_date) AS anchor FROM gold.route_headway_shift_daily "
    "WHERE provider_id = :provider_id AND route_id = :route_id"
)

_GAP_HIST_COLS = hist_cols("gap_histogram", "g", _GAP_NBINS)

_HEADWAY_WINDOW_SQL = named_query(
    "route.headway.window",
    f"""
    SELECT
        direction_id,
        shift,
        SUM(gap_count)::bigint        AS n,
        SUM(trip_count)::bigint       AS trips,
        SUM(sum_gap_min)::numeric     AS sum_gap_min,
        SUM(sum_gap_sq_min)::numeric  AS sum_gap_sq_min,
{cov_case_sql(n="SUM(gap_count)", total="SUM(sum_gap_min)", total_sq="SUM(sum_gap_sq_min)")} AS cov,
        {_GAP_HIST_COLS}
    FROM gold.route_headway_shift_daily
    WHERE provider_id = :provider_id AND route_id = :route_id
      AND provider_local_date >= :win_start AND provider_local_date <= :win_end
    GROUP BY direction_id, shift
    """
)


def _headway_shift_anchor(conn, params):  # noqa: ANN001, ANN202
    row = conn.execute(_HEADWAY_SHIFT_ANCHOR_SQL, params).mappings().fetchone()
    return row["anchor"] if row else None


def _headway_period_from_summed(rows, scheduled):  # noqa: ANN001, ANN202
    by_dir: dict[int, list] = {}
    for r in rows:
        by_dir.setdefault(int(r["direction_id"]), []).append(r)
    if not by_dir:
        return {}
    # Choose the busiest direction by trip count, then ascending direction ID.
    busiest = min(by_dir, key=lambda d: (-sum(int(x["trips"] or 0) for x in by_dir[d]), d))
    out: dict[str, HeadwayPeriod] = {}
    for r in by_dir[busiest]:
        shift = str(r["shift"])
        n = int(r["n"] or 0)
        hist = [int(r[f"g{k}"] or 0) for k in range(1, _GAP_NBINS + 1)]
        raw_med = _headway_pctile_from_hist(hist, 0.5, _GAP_EDGES)
        median = float(_round_half_away(raw_med, 1)) if raw_med is not None else None
        cov = float(r["cov"]) if r["cov"] is not None else None
        raw_b = _bunched_pct_from_hist(hist, _GAP_EDGES, median)
        bunched_pct = float(_round_half_away(raw_b, 1)) if raw_b is not None else None
        sched = scheduled.get(shift)
        # Windowed excess wait is passenger-weighted using pooled gap moments.
        excess = ewt_min(float(r["sum_gap_min"] or 0.0), float(r["sum_gap_sq_min"] or 0.0), sched)
        out[shift] = HeadwayPeriod(
            shift=shift,
            scheduled_min=sched,
            observed_min=median,
            excess_wait_min=excess,
            cov=cov,
            bunched_pct=bunched_pct,
            observation_count=_opt_int(n),
        )
    return out


def _headway_by_grain(conn, params, scheduled, anchor=None) -> list[HeadwayByGrain]:  # noqa: ANN001
    if anchor is None:
        anchor = _headway_shift_anchor(conn, params)
    if anchor is None:
        return []
    out: list[HeadwayByGrain] = []
    windows = _grain_windows(anchor)
    for grain, (win_start, win_end) in windows.items():
        pri_start, pri_end = windows.prior(grain)
        cur = {**params, "win_start": win_start, "win_end": win_end}
        pri = {**params, "win_start": pri_start, "win_end": pri_end}
        cur_by_shift = _headway_period_from_summed(
            list(conn.execute(_HEADWAY_WINDOW_SQL, cur).mappings()), scheduled
        )
        if not cur_by_shift:
            continue
        prior_by_shift = _headway_period_from_summed(
            list(conn.execute(_HEADWAY_WINDOW_SQL, pri).mappings()), scheduled
        )
        headway: list[HeadwayPeriod] = []
        for shift in sorted(cur_by_shift, key=_shift_key):
            p = cur_by_shift[shift]
            prv = prior_by_shift.get(shift)
            if prv is not None:
                p.prior_observation_count = prv.observation_count
                p.prior_observed_min = prv.observed_min
            headway.append(p)
        out.append(HeadwayByGrain(grain=grain, date=_iso_date(win_start), headway=headway))
    return out


# Enforce MIN_N even with Wilson bounds: an all-severe tiny sample has lower bound zero.
_MIN_N_WEAK_STOP = MIN_N_RATE
_WEAK_STOPS_BY_GRAIN_CAP = 15

# Stop history has its own newest-closed-day anchor.
_STOP_DELAY_ANCHOR_SQL = named_query(
    "stop.delay.anchor",
    "SELECT MAX(provider_local_date) AS anchor FROM gold.stop_delay_spine "
    "WHERE provider_id = :provider_id AND route_id = :route_id"
)

_STOP_WEAK_WINDOW_SQL = named_query(
    "route.weak_stops.by_grain",
    """
    SELECT
        stop_id,
        SUM(observation_count)::bigint  AS obs,
        SUM(severe_delay_count)::bigint AS severe,
        SUM(sum_delay_seconds)::bigint  AS sum_delay_sec
    FROM gold.stop_delay_spine
    WHERE provider_id = :provider_id AND route_id = :route_id
      AND provider_local_date >= :win_start AND provider_local_date <= :win_end
    GROUP BY stop_id
    """
)


def _stop_delay_anchor(conn, params):  # noqa: ANN001, ANN202
    row = conn.execute(_STOP_DELAY_ANCHOR_SQL, params).mappings().fetchone()
    return row["anchor"] if row else None


def _weak_stops_by_grain(conn, params, names, anchor=None) -> list[WeakStopGrain]:  # noqa: ANN001
    if anchor is None:
        anchor = _stop_delay_anchor(conn, params)
    if anchor is None:
        return []
    out: list[WeakStopGrain] = []
    for grain, (win_start, win_end) in _grain_windows(anchor).items():
        cur = {**params, "win_start": win_start, "win_end": win_end}
        ranked: list[tuple] = []
        for r in conn.execute(_STOP_WEAK_WINDOW_SQL, cur).mappings():
            obs = int(r["obs"] or 0)
            if obs < _MIN_N_WEAK_STOP:
                continue
            severe = int(r["severe"] or 0)
            severe_k = obs - severe
            w_lo = _wilson_lo(severe_k, obs)
            w_hi = _wilson_hi(severe_k, obs)
            if w_lo is None:
                continue
            sum_sec = r["sum_delay_sec"]
            avg_min = _avg_delay_min(float(sum_sec) / obs) if sum_sec is not None else None
            sid = str(r["stop_id"])
            stop = WeakStop(
                id=sid,
                name=names.get(sid),
                avg_delay_min=avg_min,
                observation_count=_opt_int(obs),
                severe_pct=_severe_pct(obs, severe),
                wilson_lo=w_lo,
                wilson_hi=w_hi,
            )
            # Rank before truncating: lower not-severe Wilson bound, higher mean delay, then stable
            # ID.
            ranked.append((w_lo, -(avg_min or 0.0), sid, stop))
        if not ranked:
            continue
        ranked.sort(key=lambda t: (t[0], t[1], t[2]))
        stops = [t[3] for t in ranked[:_WEAK_STOPS_BY_GRAIN_CAP]]
        out.append(WeakStopGrain(grain=grain, date=_iso_date(win_start), stops=stops))
    return out
