"""Shared spine kernel leaf for the historic builders (S7-close C3 de-monolith).

The value-domain helpers, the ONE spine projector fold catalog, the spine consumer
helpers, and the windowable headway / weak-stop kernels shared by
``network_trend`` and ``route_reliability``. Split out of the former monolithic
``historic.py`` verbatim — a pure mechanical move, byte-identical SQL and math.

Import graph (acyclic): ``historic/__init__ -> {network_trend, route_reliability,
stop_reliability, small_surfaces, provenance} -> _spine -> {gold.reader, _helpers,
contract}``; ``_helpers -> gold.reader`` (gold.reader never imports snapshots).
"""

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
    """q-th percentile (minutes) over the 21-bin spine histogram (gold.reader kernel).

    ``hist[i]`` is the observation count in bin ``i`` = ``[_SPINE_EDGES[i],
    _SPINE_EDGES[i+1])`` seconds for i in 0..19; bin 20 is the ``[3600, +inf)``
    overflow (no upper edge). Honest-None on empty/all-zero; rounded to 0.1 min
    to match ``_avg_delay_min``. Finding B (terminal floor): mass landing in bin
    20 pins at ``_SPINE_EDGES[20] / 60`` = 60.0 min — the kernel's shared
    overflow-floor branch, locked by a test; bin-0 mass interpolates to a
    negative-minute value without indexing past the edge array.
    """
    return pctile_min_from_hist(hist, q, _SPINE_EDGES)


def _band_total(row: object) -> int | None:
    """Sum of the 5 occupancy band counts (the mix share denominator), or None when
    the row itself is absent. A real 0 (data-day present, no band telemetry) is kept
    as 0 so consumers can distinguish "no data-days" (row omitted) from "0 band obs"."""
    if row is None:
        return None
    return sum(int(row[band] or 0) for band in _OCCUPANCY_BANDS)


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


def _delay_by_crowding_cells(rows) -> list[CrowdingDelayCell]:  # noqa: ANN001
    """Build per-band delay×crowding cells from the CO-OBSERVED per-band daily rollup (FIX-3).

    Each delay observation already carries its OWN occupancy band (matched to the vehicle's
    occupancy_status by the delay-fact build's vpm LATERAL), so a band gets its TRUE delay
    distribution — the full/standing tail is no longer censored by a day's dominant band.
    avg_delay_min = Σdelay_seconds / Σobs over the window (the rollup's additive sum/count);
    p50_min is a best-effort observation-weighted mean of the daily band p50s (an approximation —
    daily percentiles are not exactly additively composable); observation_count sums the
    co-observed delay observations; day_count counts the contributing days. Each field is
    honest-None when its input is absent; emitted in canonical band order; bands with no
    co-observed delay in the window are omitted (the result is empty until the rollup ramps in).
    """
    by_band = {str(r["band"]): r for r in rows if r["band"] is not None}
    cells: list[CrowdingDelayCell] = []
    for band in _OCCUPANCY_BANDS:  # canonical band order
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
# expressions read hour_of_day_local and provider_local_date DIRECTLY — both are
# already provider-local in the spine, so timezone() is NEVER re-applied — and
# mirror the fold builders' CASE / EXTRACT / date_trunc logic exactly.

# Shift + day_type buckets over the spine's pre-localized columns, emitted from
# the ONE gold.reader.buckets source (the same bounds every rollup CASE uses).
_SPINE_SHIFT_CASE = shift_case_sql("hour_of_day_local")

_SPINE_DAYTYPE_CASE = daytype_case_sql("provider_local_date")

# Projector mechanics (template, hist cols, entity clause) live in
# gold.reader.projector; this module owns only the fold catalog below.
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

# Network-wide reads: the SAME projector with NO route filter -> aggregate the spine
# across ALL routes by shift / day_type. otp_known == known_obs here because a spine
# cell's on_time is NULL iff delay_obs=0 (so SUM(delay_obs) FILTER(on_time NOT NULL)
# equals SUM(delay_obs)), reproducing the fact network's scoped-OTP denominator.
_NETWORK_SPINE_BY_SHIFT_SQL = _spine_project_sql(
    "network.spine.by_shift", f"{_SPINE_SHIFT_CASE} AS grain,", "1", ""
)
_NETWORK_SPINE_BY_DAYTYPE_SQL = _spine_project_sql(
    "network.spine.by_daytype", f"{_SPINE_DAYTYPE_CASE} AS grain,", "1", ""
)

# --- S7-B windowable §1 ("When to ride" follows the grain rail) ---------------
# The breakdowns + heatmap recomputed per TIME WINDOW off the spine, so §1 answers
# Today / This week / This month (the scalar reads above stay whole-history). Windows
# are trailing-N-days anchored on the route's newest CLOSED day, matching the web's
# windowByGrain so the windowed arrays need no client re-trim.
_MIN_N_HABIT_CELL = 30  # per-(dow,hour)-cell known-delay floor for the windowed heatmap
# _SPINE_WINDOW_CLAUSE + _ROUTE_HABIT_SPINE_SQL are imported from gold.reader
# (window policy + the spine habit read with its divergence note).

_SPINE_ANCHOR_SQL = named_query(
    "route.spine.anchor",
    "SELECT MAX(provider_local_date) AS anchor FROM gold.route_delay_spine "
    "WHERE provider_id = :provider_id AND route_id = :route_id"
)

# Windowed twins of the whole-history breakdown projectors (only :win_start/:win_end vary).
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
    """Trailing-N-day [start, end] windows anchored on the route's latest closed day."""
    return GrainWindows(anchor)


# (21-bin summed histogram, ghost-excluded pooled avg seconds-or-None) from a row —
# the gold.reader kernel helper (Finding C: ghost-excluded numerator AND denominator).
_spine_hist_and_avg = hist_and_avg


def _spine_delay_histogram(hist: list[int]) -> list[RouteDelayHistogramBin] | None:
    """Signed-delay distribution bins from the 21-bin spine histogram (honest-None).

    bin i = [_SPINE_EDGES[i], _SPINE_EDGES[i + 1]) seconds for i in 0..19; bin 20 is
    the [3600s, +inf) overflow (hi_sec=None). None when there are no in-window
    observations; otherwise ALL 21 bins are emitted (zeros included) so the UI draws
    the full shape. Edges are the same DELAY_HISTOGRAM_EDGES that power p50/p90.
    """
    bins = delay_histogram_bins(hist, _SPINE_EDGES)
    if bins is None:
        return None
    return [RouteDelayHistogramBin(lo_sec=lo, hi_sec=hi, count=count) for lo, hi, count in bins]


def _spine_reliability_period(  # noqa: ANN001
    r, *, grain: str, date, with_histogram: bool = True
) -> ReliabilityPeriod:
    # with_histogram=False suppresses the bulky 21-bin array on windowed by_shift/by_daytype
    # periods (the scalar percentiles p50/p90 are still computed from the same hist) — the §1
    # distribution chart reads the whole-window/daily series, not per-window-per-shift bins.
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


def _spine_route_dow(conn, params, sql=_ROUTE_SPINE_DOW_SQL) -> list[RouteDayOfWeek]:  # noqa: ANN001
    # sql defaults to the whole-history projector; pass _W_DOW for a windowed read.
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
    # sql defaults to the whole-history projector; pass _W_CROSSTAB for a windowed read.
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


def _windowed_periods(conn, sql, params, *, with_histogram=False):  # noqa: ANN001, ANN202
    """ReliabilityPeriod rows from a windowed by_shift/by_daytype projector (grain = the
    bucket label). Histograms suppressed by default (payload)."""
    return [
        _spine_reliability_period(
            r, grain=str(r["grain"]), date=None, with_histogram=with_histogram
        )
        for r in conn.execute(sql, params).mappings()
    ]


def _windowed_otp_index(conn, sql, params):  # noqa: ANN001, ANN202
    """bucket label -> (on_time, known_obs) for the PRIOR window, for the period-over-period
    delta. Keyed by the same grain label the current periods carry."""
    return {
        str(r["grain"]): (r["on_time"], r["known_obs"])
        for r in conn.execute(sql, params).mappings()
    }


def _attach_prior(periods, prior_index):  # noqa: ANN001, ANN202
    """Set prior_observation_count (= prior KNOWN_obs, matching observation_count) + the prior
    real OTP on each current period, so a two-proportion delta is valid. No prior -> left None."""
    for p in periods:
        pri = prior_index.get(p.grain)
        if pri is None:
            continue
        on_time, known = pri
        p.prior_observation_count = _opt_int(known)
        p.prior_on_time = _opt_int(on_time)
        p.prior_otp_pct = _otp_pct(on_time, known)


def _spine_anchor(conn, params):  # noqa: ANN001, ANN202
    """The route's newest CLOSED day in the spine (MAX(provider_local_date)), or None when the
    route has no spine rows. Read ONCE per route and threaded into both windowed builders."""
    row = conn.execute(_SPINE_ANCHOR_SQL, params).mappings().fetchone()
    return row["anchor"] if row else None


def _spine_periods_by_grain(conn, params, anchor=None) -> list[ReliabilityByGrain]:  # noqa: ANN001
    """The §1 breakdowns (by_shift / by_daytype / day_of_week / crosstab) per trailing window,
    each by_shift/by_daytype period carrying its prior-window n + OTP for a delta."""
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
    """The §1 7x24 repeat-problem heatmap recomposed per trailing window (B1)."""
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
        # Explicit guard: _build_habits_matrix([]) returns an all-None 7x24 (route_max=0) —
        # the forbidden "sea of grey cells". An empty/too-sparse window -> honest habits=None.
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


# ── S7-B §2 windowable headway: read-time recompose off gold.route_headway_shift_daily ──
_GAP_NBINS = len(_GAP_EDGES) - 1  # 20 finite bins (no overflow — the clamp is finite 0<gap<240)


# Half-away-from-zero round (Python's builtin round() is banker's) — the
# gold.reader kernel convention, matching Postgres ROUND(::numeric, n).
_round_half_away = round_half_away


def _shift_key(s: str) -> tuple[int, str]:
    """Canonical time-of-day order for shift buckets (am_peak<midday<...); unknown labels last."""
    return (_SHIFT_ORDER.index(s), "") if s in _SHIFT_ORDER else (len(_SHIFT_ORDER), s)


def _headway_pctile_from_hist(hist, q, edges):  # noqa: ANN001, ANN202
    """q-th percentile (MINUTES) over the gap histogram — the ONE gold.reader CDF walk.

    Honest-None on empty/all-zero. The final round is done by the caller in half-away
    (D3); this returns the raw float. The kernel's overflow-floor terminal branch is
    dead code here (the finite 0<gap<240 clamp means bin_idx caps at 19 over 21 edges)."""
    return cdf_percentile(hist, q, edges)


# Windowed %bunched: pooled-histogram mass below 0.5*median / total (D4) — kernel-owned.
_bunched_pct_from_hist = bunched_pct


# Own anchor (NEVER reuse the delay-spine anchor — the headway table's newest closed day differs).
_HEADWAY_SHIFT_ANCHOR_SQL = named_query(
    "route.headway.anchor",
    "SELECT MAX(provider_local_date) AS anchor FROM gold.route_headway_shift_daily "
    "WHERE provider_id = :provider_id AND route_id = :route_id"
)

_GAP_HIST_COLS = hist_cols("gap_histogram", "g", _GAP_NBINS)

# Windowed projector. CoV recomposed in SQL (D2): the gold.reader Bessel n-1 fragment
# (sample SD / mean, guarded n>=2 AND mean>0, ROUND(::numeric,4) half-away) —
# byte-identical to the legacy stddev_samp. Median / %bunched are recomposed in
# Python from the element-wise-summed gap histogram.
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
    """{shift: HeadwayPeriod} for the WINDOW's busiest direction. cov comes from SQL (frozen);
    median / %bunched are recomposed in Python (median ALLOW_MOVE). Honest-None throughout."""
    by_dir: dict[int, list] = {}
    for r in rows:
        by_dir.setdefault(int(r["direction_id"]), []).append(r)
    if not by_dir:
        return {}
    # D5: argmax SUM(trip_count) (legacy trip-COUNT basis), tie-break direction_id ASC.
    busiest = min(by_dir, key=lambda d: (-sum(int(x["trips"] or 0) for x in by_dir[d]), d))
    out: dict[str, HeadwayPeriod] = {}
    for r in by_dir[busiest]:
        shift = str(r["shift"])
        n = int(r["n"] or 0)
        hist = [int(r[f"g{k}"] or 0) for k in range(1, _GAP_NBINS + 1)]
        raw_med = _headway_pctile_from_hist(hist, 0.5, _GAP_EDGES)
        median = float(_round_half_away(raw_med, 1)) if raw_med is not None else None
        cov = float(r["cov"]) if r["cov"] is not None else None  # frozen, from SQL (D2)
        raw_b = _bunched_pct_from_hist(hist, _GAP_EDGES, median)
        bunched_pct = float(_round_half_away(raw_b, 1)) if raw_b is not None else None
        sched = scheduled.get(shift)
        # FIX-1: true passenger-weighted Excess Wait Time (Welding/Osuna-Newell; see
        # gold.reader.ewt_min), windowed grain only — the additive moment sums
        # (Σgap, Σgap²) are on route_headway_shift_daily.
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
    """§2 per-shift headway recomposed per trailing window (busiest direction), with the prior
    window's n + observed median attached for a period-over-period delta."""
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
            continue  # honest absence: no in-clamp gaps in the window -> omit the grain
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


# ── S7-B §4 windowable weak-stops: read-time recompose off gold.stop_delay_spine ──
# MIN_N is the LOAD-BEARING window floor (NEW path only): the Wilson lower bound does NOT
# demote an extreme tiny-n fluke — a 4-of-4-severe stop pins the not-severe LB at exactly
# 0.0% (n-independent), so a hard exclude is the only rail. Non-removable.
_MIN_N_WEAK_STOP = MIN_N_RATE      # 30
_WEAK_STOPS_BY_GRAIN_CAP = 15      # stored per-grain cap (byte budget; web "All" = all 15 stored)

# Own anchor (NEVER reuse the delay-spine / headway anchors — a different builder + a different
# newest-closed-day front means the stop spine's anchor differs).
_STOP_DELAY_ANCHOR_SQL = named_query(
    "stop.delay.anchor",
    "SELECT MAX(provider_local_date) AS anchor FROM gold.stop_delay_spine "
    "WHERE provider_id = :provider_id AND route_id = :route_id"
)

# Windowed projector: additive per-stop counts over a trailing window for ONE route. A real
# route_id never matches '__unrouted__', so NULL-route obs are correctly excluded (mirrors the
# legacy per-route _ROUTE_WEAK_STOPS_SQL). avg = pooled raw sum/n (a documented rebaseline vs the
# legacy triple-ROUND weekly avg); severe_k = obs - severe; ranked on _wilson_lo(severe_k, obs) ASC.
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
    """§4 worst-N stops recomposed per trailing window, ranked by the Wilson LOWER bound of the
    NOT-severe rate ASC (a low LB = chronically severe = worst), MIN_N=30 hard EXCLUDE floor,
    honest-absence omit. `names` is the _STOP_NAMES_SQL dict built ONCE in build_route_reliability.
    """
    if anchor is None:
        anchor = _stop_delay_anchor(conn, params)
    if anchor is None:
        return []
    out: list[WeakStopGrain] = []
    for grain, (win_start, win_end) in _grain_windows(anchor).items():
        cur = {**params, "win_start": win_start, "win_end": win_end}
        ranked: list[tuple] = []  # (wilson_lo, -avg_min, stop_id, WeakStop)
        for r in conn.execute(_STOP_WEAK_WINDOW_SQL, cur).mappings():
            obs = int(r["obs"] or 0)
            if obs < _MIN_N_WEAK_STOP:  # D-C: hard floor — EXCLUDE (never a fabricated avg=0)
                continue
            severe = int(r["severe"] or 0)
            # not-severe successes (design S, the build_stop_reliability shape)
            severe_k = obs - severe
            w_lo = _wilson_lo(severe_k, obs)  # [0,100] PERCENT; lower band of the NOT-severe rate
            w_hi = _wilson_hi(severe_k, obs)
            if w_lo is None:  # defensive: obs>=30 guarantees non-None
                continue
            sum_sec = r["sum_delay_sec"]
            avg_min = _avg_delay_min(float(sum_sec) / obs) if sum_sec is not None else None
            sid = str(r["stop_id"])
            stop = WeakStop(
                id=sid,
                name=names.get(sid),
                avg_delay_min=avg_min,  # displayed lollipop magnitude (honest-null)
                observation_count=_opt_int(obs),
                severe_pct=_severe_pct(obs, severe),  # the severe-delay rate %
                wilson_lo=w_lo,  # rank key + whisker floor (not-severe lower bound)
                wilson_hi=w_hi,
            )
            # rank: LOW not-severe wilson_lo = worst (ASC). Tie-break: HIGHER avg worst, then id ASC
            # (stable, deterministic). Rank the FULL set, THEN truncate — a smaller display-N never
            # rescales (mirrors the scalar weak_stops + the web selectWeakStops invariant).
            ranked.append((w_lo, -(avg_min or 0.0), sid, stop))
        if not ranked:
            continue  # honest absence: no stop clears MIN_N in this window -> omit the grain
        ranked.sort(key=lambda t: (t[0], t[1], t[2]))
        stops = [t[3] for t in ranked[:_WEAK_STOPS_BY_GRAIN_CAP]]
        out.append(WeakStopGrain(grain=grain, date=_iso_date(win_start), stops=stops))
    return out
