"""Current small historic surfaces: hotspots, repeat offenders, receipts, alerts.

The ranking doctrine shared with immutable point history lives in
``ranking_kernel``; this module owns the current snapshot queries and assembly.
"""

from __future__ import annotations

import hashlib
from datetime import date, timedelta
from typing import TYPE_CHECKING

from transit_ops.gold.reader import (
    SHIFT_BOUNDS,
    SHIFT_DEFAULT,
    GrainWindows,
    shift_case_sql,
)
from transit_ops.snapshots.builders._helpers import (
    _ROUTE_NAMES_SQL,
    _alert_active_periods,
    _avg_delay_min,
    _entity_name_maps,
    _iso,
    _iso_date,
    _opt_float,
    _opt_int,
    _opt_iso,
    _otp_pct,
    _otp_pct_severe_proxy,
    _public_impact_score,
    _route_sort_key,
    _sane_en,
    _severe_pct,
    _severity_code,
)
from transit_ops.snapshots.builders.historic.ranking_kernel import (
    HOTSPOT_PEAK_SHIFTS,
    OFFENDERS_GRAINS,
    OFFENDERS_TRAY_CAP,
    SENTINEL_ENTITY_IDS,
    build_hotspot_kind_ladder,
    build_offender_kind_ladder,
    merge_hotspot_grain,
    otp_delta_points,
)
from transit_ops.snapshots.contract import (
    NOT_REPORTED_ROUTES_CAP,
    AlertBreakdown,
    AlertBreakdownBucket,
    AlertHistory,
    AlertHistoryEntry,
    Hotspot,
    HotspotGrain,
    Hotspots,
    Offender,
    Receipt,
    ReceiptNotReportedRoute,
    ReceiptServiceStates,
    ReceiptShiftCut,
    ReceiptWorstRoute,
    ReceiptWorstStop,
    RepeatOffenderGrain,
    RepeatOffenders,
)
from transit_ops.sql_registry import named_query

if TYPE_CHECKING:  # pragma: no cover - typing only
    from sqlalchemy.engine import Connection


# --------------------------------------------------------------------------
# build_hotspots
# --------------------------------------------------------------------------

# Most-recent week period from gold.repeated_problem_route_stop.
# Fall back to the max period_start_local of any grain if no 'week' rows exist.
# Selects the top-20 problem cells for the target period AND, per cell, the raw
# OTP counts needed to compute otp_delta_pts honestly at read time:
#   * route cells  -> real OTP counts from the route_spine_weekly CTE (the per-
#                     (route, ISO-week) SUM of on_time/delay observation counts off
#                     gold.route_delay_spine), joined ONLY when entity_kind = 'route'
#                     so a stop never picks up a route's counts.
#   * stop cells   -> per-stop obs + severe from the stop_spine_weekly CTE (the
#                     per-(stop, ISO-week) SUM off gold.stop_delay_spine, summed
#                     across the stop's routes for the target week), joined ONLY
#                     when entity_kind = 'stop'. Stops have no on_time column, so
#                     their OTP stays the documented severe(>300s) proxy.
#   * net_on_time / net_known -> the ROUTE network baseline = real on-time OTP
#                     aggregated across ALL routes for the SAME target week
#                     (scalar). Used ONLY for route cells.
#   * net_stop_obs / net_stop_severe -> the STOP network baseline = the SAME
#                     severe(>300s) proxy aggregated across ALL stops for the
#                     target week (scalar). Used ONLY for stop cells, so a stop's
#                     delta is severe-proxy-vs-severe-proxy (same metric, no
#                     lenient-vs-strict offset). Both baselines identical on
#                     every row.
# The per-kind JOIN keys (route_id vs stop_id) keep route and stop OTP from ever
# cross-contaminating, and each kind subtracts its OWN-metric network baseline.
# The OTP math + honest-None live in Python (_otp_pct / _otp_pct_severe_proxy /
# otp_delta_points) so the convention matches the rest of the historic surface
# byte-for-byte. Network baselines are week-grain only; on a non-week fallback
# target the route/stop weekly joins miss and the delta is None.
_HOTSPOTS_SQL = named_query(
    "hotspots.list",
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
    ),
    -- Per-route weekly OTP counts derived from the route delay spine (S7-B): the
    -- ISO-week SUMs of on_time/delay observation counts are byte-identical to the
    -- (dropped) route_reliability_weekly columns, so the route OTP + the network
    -- baseline below are unchanged. The spine has no '__unrouted__' (route_id NOT
    -- NULL at build); week_start_local is the feed-local ISO-week Monday.
    route_spine_weekly AS (
        SELECT route_id,
               date_trunc('week', provider_local_date)::date AS week_start_local,
               SUM(on_time_observation_count) AS on_time_observation_count,
               SUM(delay_observation_count)   AS delay_observation_count
        FROM gold.route_delay_spine
        WHERE provider_id = :provider_id
        GROUP BY route_id, date_trunc('week', provider_local_date)::date
    ),
    -- Network baseline OTP for the target week: real on_time/known aggregated
    -- over ALL routes, numerator and denominator scoped together to on-time-known
    -- rows so the gold NULL-guard does not bias OTP low (mirrors network_trend).
    net AS (
        SELECT SUM(rrw.on_time_observation_count) AS net_on_time,
               SUM(rrw.delay_observation_count) FILTER (
                   WHERE rrw.on_time_observation_count IS NOT NULL) AS net_known
        FROM route_spine_weekly AS rrw, target
        WHERE rrw.week_start_local = target.target_start
    ),
    -- Per-stop weekly obs + severe derived from the stop delay spine (DB-0067
    -- Phase 1): the ISO-week SUMs are byte-identical to the (dropped)
    -- stop_delay_weekly columns, so the stop OTP proxy + the stop-grain network
    -- baseline below are unchanged. week_start_local is the feed-local ISO-week
    -- Monday (same date_trunc the mart used). The spine COALESCEs route_id to
    -- '__unrouted__', so SUM-across-all-routes per stop matches the mart's
    -- per-stop total (which also carried the unrouted partition).
    stop_spine_weekly AS (
        SELECT stop_id,
               date_trunc('week', provider_local_date)::date AS week_start_local,
               SUM(observation_count)  AS observation_count,
               SUM(severe_delay_count) AS severe_delay_count
        FROM gold.stop_delay_spine
        WHERE provider_id = :provider_id
        GROUP BY stop_id, date_trunc('week', provider_local_date)::date
    ),
    -- Stop-grain network baseline for the target week: the SAME severe(>300s)
    -- proxy a stop cell uses ((obs - severe)/obs), aggregated across ALL stops.
    -- A stop cell's delta must be same-metric-vs-same-metric, so its baseline is
    -- this stop-grain severe-proxy network OTP, NOT the route on-time net above.
    net_stop AS (
        SELECT SUM(ssw.observation_count)  AS net_stop_obs,
               SUM(ssw.severe_delay_count) AS net_stop_severe
        FROM stop_spine_weekly AS ssw, target
        WHERE ssw.week_start_local = target.target_start
    ),
    -- Per-stop obs + severe summed across the stop's routes for the target week.
    stop_otp AS (
        SELECT ssw.stop_id,
               SUM(ssw.observation_count)  AS stop_obs,
               SUM(ssw.severe_delay_count) AS stop_severe
        FROM stop_spine_weekly AS ssw, target
        WHERE ssw.week_start_local = target.target_start
        GROUP BY ssw.stop_id
    )
    SELECT rp.entity_kind, rp.entity_id, rp.issue_count, rp.severity_label,
           rrw.on_time_observation_count AS route_on_time,
           rrw.delay_observation_count   AS route_known,
           so.stop_obs                   AS stop_obs,
           so.stop_severe                AS stop_severe,
           net.net_on_time               AS net_on_time,
           net.net_known                 AS net_known,
           net_stop.net_stop_obs         AS net_stop_obs,
           net_stop.net_stop_severe      AS net_stop_severe
    FROM gold.repeated_problem_route_stop AS rp
    CROSS JOIN target
    CROSS JOIN net
    CROSS JOIN net_stop
    LEFT JOIN route_spine_weekly AS rrw
           ON rp.entity_kind = 'route'
          AND rrw.route_id = rp.entity_id
          AND rrw.week_start_local = target.target_start
    LEFT JOIN stop_otp AS so
           ON rp.entity_kind = 'stop'
          AND so.stop_id = rp.entity_id
    WHERE rp.provider_id = :provider_id
      AND rp.period_start_local = target.target_start
      AND rp.period_grain = target.target_grain
      AND NOT (rp.entity_kind = 'route' AND rp.entity_id = '__unrouted__')
      AND NOT (rp.entity_kind = 'stop' AND rp.entity_id = '__unknown_stop__')
    ORDER BY rp.issue_count DESC
    LIMIT 20
    """,
)


def build_hotspots(conn: Connection, provider_id: str = "stm", *, generated_utc: str) -> Hotspots:
    """Build historic/hotspots.json — top 20 problem entities in the most recent week.

    Source: gold.repeated_problem_route_stop. Uses the most-recent week-grain period;
    falls back to the most-recent period of any grain if no week rows are present.

    otp_delta_pts = the cell's own OTP minus a SAME-METRIC network baseline OTP
    for the same target week, in percentage points (negative = worse than the
    network). Route cells use the real OTP from the spine-derived weekly CTE vs
    the route on-time network baseline; stop cells use the documented severe-delay
    proxy (no on_time column at stop grain) vs a stop-grain severe-proxy network
    baseline, so the delta is never lenient-metric-minus-strict-metric. Honest-None
    when either side is unknown (otp_delta_points).
    """
    rows = list(conn.execute(_HOTSPOTS_SQL, {"provider_id": provider_id}).mappings())
    route_names, stop_names = _entity_name_maps(conn, provider_id=provider_id)
    # Defense-in-depth: never publish a sentinel-bucket entity even if a query path
    # ever forgets the SQL filter (re-ranks over the surviving rows).
    kept = [r for r in rows if str(r["entity_id"]) not in SENTINEL_ENTITY_IDS]
    hotspots = []
    for i, r in enumerate(kept):
        kind = str(r["entity_kind"])
        # Per-kind OTP, with a MATCHING-metric baseline so the delta is
        # same-definition-vs-same-definition (never lenient-vs-strict):
        #   route -> real on_time/known   vs route on-time network baseline
        #   stop  -> severe(>300s) proxy  vs stop severe-proxy network baseline
        # The SQL only populates the matching kind's columns, so cross-kind
        # contamination is impossible, but key the Python branch on kind too.
        if kind == "route":
            cell_otp = _otp_pct(r.get("route_on_time"), r.get("route_known"))
            network_otp = _otp_pct(r.get("net_on_time"), r.get("net_known"))
        else:
            cell_otp = _otp_pct_severe_proxy(r.get("stop_obs"), r.get("stop_severe"))
            network_otp = _otp_pct_severe_proxy(r.get("net_stop_obs"), r.get("net_stop_severe"))
        hotspots.append(
            Hotspot(
                rank=i + 1,
                type=kind,
                id=str(r["entity_id"]),
                # kinds verified 'route'/'stop' in the mart — per-kind name lookup
                name=(
                    route_names.get(str(r["entity_id"]))
                    if kind == "route"
                    else stop_names.get(str(r["entity_id"]))
                ),
                severity=r["severity_label"],
                otp_delta_pts=otp_delta_points(cell_otp, network_otp),
            )
        )
    # S12 additive: the evidence-rich by_grain ladders. The scalar hotspots[] above is
    # UNTOUCHED (byte-identical); by_grain is appended off the same spines at read time.
    by_grain = _hotspots_by_grain(conn, provider_id, route_names, stop_names)
    return Hotspots(generated_utc=generated_utc, hotspots=hotspots, by_grain=by_grain)


# --------------------------------------------------------------------------
# S12 — re-granulated hotspot ladders (day/week/month + shift) off the spines
# --------------------------------------------------------------------------
# The mart gold.repeated_problem_route_stop is WEEK-GRAIN ONLY, so day/month/time-of-
# day CANNOT come from it. The honest path (matching the S7 _weak_stops_by_grain house
# pattern) is to recompose the ladders at READ TIME off the SAME spines the mart derives
# from — gold.route_delay_spine (routes) + gold.stop_delay_spine (stops) — with NO new
# mart and NO migration. Ranking is the NOT-severe Wilson LOWER bound ASC on the SEVERE-
# delay proxy, the SAME cross-kind metric for both route and stop (WEB1) so a route and a
# stop share one comparable scale in the ladder. MIN_N=30 is the load-bearing floor: the
# Wilson LB does not demote an extreme tiny-n fluke (a 4-of-4-severe entity pins the
# not-severe LB at 0.0%, n-independent), so a hard exclude to the un-ranked tray is the
# only rail.
# The peak (rush-hour) shifts the 'shift' grain scopes to — the time-of-day cut where a
# hotspot bites hardest. Both source paths share these kernel labels (route via the
# hour->shift CASE, stop via gold.stop_delay_shift_daily.shift), so the two kinds bucket
# the SAME observation to the SAME shift. These are FIXED kernel constants (never user
# input), so they embed as SQL literals — no expanding bind needed.
_PEAK_SHIFT_IN_LITERAL = ", ".join(f"'{s}'" for s in HOTSPOT_PEAK_SHIFTS)

# Network-wide newest CLOSED day per spine (NO route filter — hotspots are all-per-city,
# unlike the per-route weak_stops anchor). Read once per kind and threaded into windows.
_HOTSPOTS_ROUTE_ANCHOR_SQL = named_query(
    "hotspots.route.anchor",
    "SELECT MAX(provider_local_date) AS anchor FROM gold.route_delay_spine "
    "WHERE provider_id = :provider_id",
)
_HOTSPOTS_STOP_ANCHOR_SQL = named_query(
    "hotspots.stop.anchor",
    "SELECT MAX(provider_local_date) AS anchor FROM gold.stop_delay_spine "
    "WHERE provider_id = :provider_id",
)

# Per-ROUTE windowed aggregate across ALL routes for a trailing window: the additive spine
# counts SUMmed per route. Ranking + the display otp_delta_pts BOTH use the severe(>300s)
# proxy (obs = the in-clamp delay count) so a route and a stop share ONE comparable scale in
# the merged ladder (WEB1) — route on_time is deliberately NOT read here. The '__unrouted__'
# sentinel is excluded (never a named hotspot). No route filter — the all-per-city universe.
_HOTSPOTS_ROUTE_WINDOW_SQL = named_query(
    "hotspots.route.by_grain",
    """
    SELECT
        route_id,
        SUM(delay_observation_count)::bigint  AS obs,
        SUM(severe_delay_count)::bigint       AS severe,
        SUM(sum_delay_seconds)::bigint        AS sum_delay_sec
    FROM gold.route_delay_spine
    WHERE provider_id = :provider_id
      AND provider_local_date >= :win_start AND provider_local_date <= :win_end
      AND route_id <> '__unrouted__'
    GROUP BY route_id
    """,
)

# Per-STOP windowed aggregate across ALL stops (summed over the stop's routes) for a
# trailing window. Stops have no on_time column, so their OTP stays the severe(>300s)
# proxy — the SAME metric routes rank on. '__unknown_stop__' excluded.
_HOTSPOTS_STOP_WINDOW_SQL = named_query(
    "hotspots.stop.by_grain",
    """
    SELECT
        stop_id,
        SUM(observation_count)::bigint  AS obs,
        SUM(severe_delay_count)::bigint AS severe,
        SUM(sum_delay_seconds)::bigint  AS sum_delay_sec
    FROM gold.stop_delay_spine
    WHERE provider_id = :provider_id
      AND provider_local_date >= :win_start AND provider_local_date <= :win_end
      AND stop_id <> '__unknown_stop__'
    GROUP BY stop_id
    """,
)

# ── 'shift' grain source reads: the anchor WEEK window scoped to the peak (rush-hour)
#    shifts. Route reads route_delay_spine through the ONE gold.reader hour->shift CASE
#    (byte-identical to the route projector + stop_delay_shift_daily's build-time bucket);
#    stop reads gold.stop_delay_shift_daily (5 pre-bucketed shift rows — the stop spine has
#    no hour column, so this is the ONLY honest stop time-of-day source). ──
_HOTSPOTS_ROUTE_SHIFT_SQL = named_query(
    "hotspots.route.by_shift",
    f"""
    SELECT
        route_id,
        SUM(delay_observation_count)::bigint  AS obs,
        SUM(severe_delay_count)::bigint       AS severe,
        SUM(sum_delay_seconds)::bigint        AS sum_delay_sec
    FROM gold.route_delay_spine
    WHERE provider_id = :provider_id
      AND provider_local_date >= :win_start AND provider_local_date <= :win_end
      AND route_id <> '__unrouted__'
      AND ({shift_case_sql("hour_of_day_local", indent=6)}) IN ({_PEAK_SHIFT_IN_LITERAL})
    GROUP BY route_id
    """,
)
_HOTSPOTS_STOP_SHIFT_SQL = named_query(
    "hotspots.stop.by_shift",
    f"""
    SELECT
        stop_id,
        SUM(observation_count)::bigint  AS obs,
        SUM(severe_delay_count)::bigint AS severe,
        SUM(sum_delay_seconds)::bigint  AS sum_delay_sec
    FROM gold.stop_delay_shift_daily
    WHERE provider_id = :provider_id
      AND provider_local_date >= :win_start AND provider_local_date <= :win_end
      AND stop_id <> '__unknown_stop__'
      AND shift IN ({_PEAK_SHIFT_IN_LITERAL})
    GROUP BY stop_id
    """,
)


def _hotspots_anchor(conn: Connection, sql, provider_id: str):  # noqa: ANN001, ANN202
    row = conn.execute(sql, {"provider_id": provider_id}).mappings().fetchone()
    return row["anchor"] if row else None


def _hotspots_by_grain(
    conn: Connection, provider_id: str, route_names: dict, stop_names: dict
) -> list[HotspotGrain]:
    """The S12 re-granulated ladders: day/week/month (trailing windows) + shift (peak-hour
    cut over the anchor week), each a SINGLE cross-kind Wilson-ranked ladder + un-ranked
    tray. Route + stop anchor INDEPENDENTLY off their own spine's newest closed day. Honest
    absence: a grain with no qualifying entity (neither ranked nor tray) is OMITTED."""
    route_anchor = _hotspots_anchor(conn, _HOTSPOTS_ROUTE_ANCHOR_SQL, provider_id)
    stop_anchor = _hotspots_anchor(conn, _HOTSPOTS_STOP_ANCHOR_SQL, provider_id)
    if route_anchor is None and stop_anchor is None:
        return []
    out: list[HotspotGrain] = []
    route_windows = GrainWindows(route_anchor) if route_anchor is not None else None
    stop_windows = GrainWindows(stop_anchor) if stop_anchor is not None else None
    # day/week/month — each kind ranks on its OWN per-kind ladder off its OWN anchor
    # window; the two ladders are then assembled (concatenated, per-kind rank preserved).
    for grain in ("day", "week", "month"):
        r_start = r_end = s_start = s_end = None
        route_l = stop_l = None
        if route_windows is not None:
            r_start, r_end = route_windows[grain]
            r_rows = conn.execute(
                _HOTSPOTS_ROUTE_WINDOW_SQL,
                {"provider_id": provider_id, "win_start": r_start, "win_end": r_end},
            ).mappings()
            route_l = build_hotspot_kind_ladder(r_rows, "route", route_names)
        if stop_windows is not None:
            s_start, s_end = stop_windows[grain]
            s_rows = conn.execute(
                _HOTSPOTS_STOP_WINDOW_SQL,
                {"provider_id": provider_id, "win_start": s_start, "win_end": s_end},
            ).mappings()
            stop_l = build_hotspot_kind_ladder(s_rows, "stop", stop_names)
        # window START/END for the merged label = the route window when present else stop's
        # (both anchor off the same feed, so they coincide save the rare split-anchor edge).
        merged = merge_hotspot_grain(
            route_l,
            stop_l,
            grain=grain,
            window_start=r_start if r_start is not None else s_start,
            window_end=r_end if r_end is not None else s_end,
        )
        if merged is not None:
            out.append(merged)
    # shift — PEAK-ONLY: the anchor WEEK window scoped to the am+pm peak shifts; date=None
    # (a within-week time-of-day cut, not a trailing window). Ranked PER KIND like the rest.
    route_shift = stop_shift = None
    if route_windows is not None:
        r_start, r_end = route_windows["week"]
        r_rows = conn.execute(
            _HOTSPOTS_ROUTE_SHIFT_SQL,
            {"provider_id": provider_id, "win_start": r_start, "win_end": r_end},
        ).mappings()
        route_shift = build_hotspot_kind_ladder(r_rows, "route", route_names)
    if stop_windows is not None:
        s_start, s_end = stop_windows["week"]
        s_rows = conn.execute(
            _HOTSPOTS_STOP_SHIFT_SQL,
            {"provider_id": provider_id, "win_start": s_start, "win_end": s_end},
        ).mappings()
        stop_shift = build_hotspot_kind_ladder(s_rows, "stop", stop_names)
    shift_merged = merge_hotspot_grain(
        route_shift,
        stop_shift,
        grain="shift",
        window_start=None,
        window_end=None,
    )
    if shift_merged is not None:
        out.append(shift_merged)
    return out


# --------------------------------------------------------------------------
# build_repeat_offenders
# --------------------------------------------------------------------------

# P3 mart: gold.repeat_offender — persistent problem entities.
_REPEAT_OFFENDERS_SQL = named_query(
    "repeat.offenders",
    """
    SELECT entity_kind, entity_id, route_id,
           recurrence_days, window_days, avg_delay_seconds, severity_label
    FROM gold.repeat_offender
    WHERE provider_id = :provider_id
    ORDER BY recurrence_days DESC, avg_delay_seconds DESC
    LIMIT 50
    """,
)


def build_repeat_offenders(
    conn: Connection, provider_id: str = "stm", *, generated_utc: str
) -> RepeatOffenders:
    """Build historic/repeat_offenders.json — top 50 most-persistent problem entities.

    Source: gold.repeat_offender (P3 mart).
    Ordered by recurrence_days desc, avg_delay_seconds desc.
    """
    rows = list(conn.execute(_REPEAT_OFFENDERS_SQL, {"provider_id": provider_id}).mappings())
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
            route_name=(route_names.get(str(r["route_id"])) if r["route_id"] is not None else None),
            recurrence=f"{r['recurrence_days']}/{r['window_days']}d",
            # S14 additive structured twins (columns the query already selects): the web
            # reads these instead of parsing "N/14d" + re-deriving severity client-side.
            recurrence_days=_opt_int(r["recurrence_days"]),
            window_days=_opt_int(r["window_days"]),
            avg_delay_min=round(float(r["avg_delay_seconds"]) / 60.0, 1),
            severity=r["severity_label"],
        )
        for r in rows
    ]
    # S14 additive: the evidence-rich by_grain recurrence ladders. The scalar offenders[]
    # above is UNTOUCHED (order + legacy fields byte-identical); by_grain is recomposed off
    # the 0075 daily offender spine at read time.
    by_grain = _repeat_offenders_by_grain(conn, provider_id, route_names)
    return RepeatOffenders(generated_utc=generated_utc, offenders=offenders, by_grain=by_grain)


# --------------------------------------------------------------------------
# S14 — re-granulated repeat-offender ladders (week/month) off the 0075 spine
# --------------------------------------------------------------------------
# The scalar mart gold.repeat_offender is a single 14d-recurrence snapshot, so
# week/month recurrence CANNOT come from it. The honest path (matching the S12
# _hotspots_by_grain house pattern) recomposes the ladders at READ TIME off the
# 0075 daily offender spine gold.repeat_offender_daily_spine — NO new mart read.
# Ranking is the NOT-severe Wilson LOWER bound ASC on the SEVERE-delay proxy, the
# SAME per-kind metric as hotspots (MIN_N_RATE=30 observation floor), per-kind
# ladders (trip + vehicle) with rank restarting per kind. recurrence_days ("N of M
# observed days") is EVIDENCE, not the rank key. Grains are week|month ONLY — a
# repeat offender is undefined on a single day (see RepeatOffenderGrain).

# Newest CLOSED offender-spine day (NO entity filter — offenders are all-per-city). Read once
# and threaded into the trailing week/month windows.
_OFFENDERS_ANCHOR_SQL = named_query(
    "repeat.offenders.spine.anchor",
    "SELECT MAX(provider_local_date) AS anchor FROM gold.repeat_offender_daily_spine "
    "WHERE provider_id = :provider_id",
)

# Per-ENTITY windowed aggregate for a trailing window: the additive spine daily rows SUMmed per
# (entity_kind, entity_id, route_id), plus the two DISTINCT-day evidence counts. recurrence_days
# = COUNT(DISTINCT date WHERE that day was severe) — reproduces the mart's recurrence_days by
# construction (a spine day has severe_delay_count>0 iff it had a severe observation). No entity
# filter — the all-per-city universe; the fact predicate already excluded null-route rows at
# build, so no sentinel can appear here.
_OFFENDERS_WINDOW_SQL = named_query(
    "repeat.offenders.by_grain",
    """
    SELECT
        entity_kind,
        entity_id,
        route_id,
        SUM(observation_count)::bigint   AS obs,
        SUM(severe_delay_count)::bigint  AS severe,
        SUM(sum_delay_seconds)::bigint   AS sum_delay_sec,
        COUNT(DISTINCT provider_local_date)
            FILTER (WHERE severe_delay_count > 0)  AS recurrence_days,
        COUNT(DISTINCT provider_local_date)        AS observed_days
    FROM gold.repeat_offender_daily_spine
    WHERE provider_id = :provider_id
      AND provider_local_date >= :win_start AND provider_local_date <= :win_end
    GROUP BY entity_kind, entity_id, route_id
    """,
)


def _repeat_offenders_by_grain(
    conn: Connection, provider_id: str, route_names: dict
) -> list[RepeatOffenderGrain]:
    """The S14 re-granulated recurrence ladders: week + month trailing windows off the 0075
    daily offender spine, each a per-kind (trip|vehicle) Wilson-ranked ladder + un-ranked tray.
    Honest absence: a grain with no qualifying entity (neither ranked nor tray) is OMITTED, and
    when the spine has no rows at all NO grain is emitted."""
    anchor = _hotspots_anchor(conn, _OFFENDERS_ANCHOR_SQL, provider_id)
    if anchor is None:
        return []
    windows = GrainWindows(anchor)
    out: list[RepeatOffenderGrain] = []
    for grain in OFFENDERS_GRAINS:
        win_start, win_end = windows[grain]
        window_days = (win_end - win_start).days + 1
        rows = list(
            conn.execute(
                _OFFENDERS_WINDOW_SQL,
                {"provider_id": provider_id, "win_start": win_start, "win_end": win_end},
            ).mappings()
        )
        # stamp the trailing window length onto each row (a plain dict copy — mappings are
        # read-only) so the entry builders read window_days from one source.
        trip_rows = [dict(r, window_days=window_days) for r in rows if r["entity_kind"] == "trip"]
        veh_rows = [dict(r, window_days=window_days) for r in rows if r["entity_kind"] == "vehicle"]
        trip_entries, trip_total, trip_tray = build_offender_kind_ladder(
            trip_rows, "trip", route_names
        )
        veh_entries, veh_total, veh_tray = build_offender_kind_ladder(
            veh_rows, "vehicle", route_names
        )
        # entries[] = the two per-kind ladders concatenated (trip first, then vehicle); each
        # keeps its own 1..N rank. The web filters by type into per-kind tabs losslessly.
        entries = trip_entries + veh_entries
        # tray union: worst-severe first across BOTH kinds, then id ASC for stability.
        union = trip_tray + veh_tray
        tray_total = len(union)
        if not entries and tray_total == 0:
            continue  # honest absence — omit the grain entirely
        union.sort(key=lambda e: (-(e.severe_pct or 0.0), e.id))
        tray = union[:OFFENDERS_TRAY_CAP]
        out.append(
            RepeatOffenderGrain(
                grain=grain,
                window_days=window_days,
                entries=entries,
                tray=tray,
                total_ranked_trips=trip_total,
                total_ranked_vehicles=veh_total,
                tray_total=tray_total,
            )
        )
    return out


# --------------------------------------------------------------------------
# build_receipts
# --------------------------------------------------------------------------

# Accountability daily summary — one row per date, drives the receipt set.
_RECEIPTS_ACCOUNTABILITY_SQL = named_query(
    "receipts.accountability",
    """
    SELECT provider_local_date,
           affected_route_count,
           affected_stop_count,
           delayed_trip_count,
           severe_delay_count,
           alert_count,
           rider_impact_score
    FROM gold.citizen_accountability_daily AS cad
    JOIN gold.dim_provider AS dp ON dp.provider_id = cad.provider_id
    WHERE cad.provider_id = :provider_id
    ORDER BY provider_local_date
    """,
)

# Network-level daily aggregation from the route delay spine over the actual retained
# accountability span.
# GC1 / Step G1: re-pointed off gold.route_delay_hourly onto gold.route_delay_spine.
# SCOPE REBASELINE (2026-07-02): spine sums cover route-attributed observations only
# (route_id IS NOT NULL at build); the legacy path included the '__unrouted__'
# partition. GC1.5 quantifies the unrouted share on prod before the hourly drop.
# (route_delay_hourly is KEPT — public_route_reliability_daily, read by worst_route
# below, still depends on it; its drop is deferred beyond G1). provider_local_date is
# provider-local, dropping the timezone()::date cast + the dim_provider join. Parity:
#  * known_obs = SUM(delay_observation_count) and severe = SUM(severe_delay_count)
#    are EXACT — so otp_pct / severe_pct are byte-identical.
#  * on_time is a PLAIN SUM (NOT the fold CASE guard): a spine cell's on_time is NULL
#    iff delay_obs=0, adding nothing to either SUM, so SUM(on_time)/SUM(known)
#    reproduces the fold otp EXACTLY, whereas the CASE guard would spuriously NULL the
#    day off the spine's per-direction silent cells (verified byte-for-byte on the seed).
#  * pooled_delay_sec / inclamp_obs give the ghost-excluded pooled mean (hist_and_avg
#    convention) — avg_delay_min REBASELINES (allow-move) vs the legacy obs-weighted
#    avg-of-hourly-averages (dated methodology note on the GC1 commit).
_RECEIPTS_NETWORK_DAILY_SQL = named_query(
    "receipts.network_daily",
    """
    SELECT sp.provider_local_date                        AS local_date,
           SUM(sp.delay_observation_count)              AS known_obs,
           SUM(sp.on_time_observation_count)            AS on_time,
           SUM(sp.severe_delay_count)                   AS severe,
           SUM(sp.sum_delay_seconds)                    AS pooled_delay_sec,
           SUM((SELECT COALESCE(SUM(x), 0)
                FROM unnest(sp.delay_histogram) AS x))  AS inclamp_obs
    FROM gold.route_delay_spine AS sp
    WHERE sp.provider_id = :provider_id
      AND sp.provider_local_date >= :receipt_start
      AND sp.provider_local_date <= :receipt_end
    GROUP BY sp.provider_local_date
    """,
)

# Worst route per date: max avg_delay_seconds from the public reliability view.
# on_time / known carry the worst route's own daily OTP so the receipt can show
# its on-time-vs-network gap (otp_delta_pts) against the day's network baseline.
_RECEIPTS_WORST_ROUTE_SQL = named_query(
    "receipts.worst_route",
    """
    SELECT DISTINCT ON (prr.provider_local_date)
           prr.provider_local_date AS d,
           prr.route_id,
           prr.avg_delay_seconds,
           prr.on_time_observation_count AS on_time,
           prr.delay_observation_count   AS known_obs
    FROM gold.public_route_reliability_daily AS prr
    JOIN gold.dim_provider AS dp ON dp.provider_id = prr.provider_id
    WHERE prr.provider_id = :provider_id
      AND prr.provider_local_date >= :receipt_start
      AND prr.provider_local_date <= :receipt_end
      AND prr.avg_delay_seconds IS NOT NULL
      AND prr.route_id <> '__unrouted__'
    ORDER BY prr.provider_local_date, prr.avg_delay_seconds DESC, prr.route_id
    """,
)

# Worst stop per date: max avg_delay_seconds from the public stop delay view.
_RECEIPTS_WORST_STOP_SQL = named_query(
    "receipts.worst_stop",
    """
    SELECT DISTINCT ON (psd.provider_local_date)
           psd.provider_local_date AS d,
           psd.stop_id,
           psd.avg_delay_seconds,
           psd.max_delay_seconds
    FROM gold.public_stop_delay_daily AS psd
    JOIN gold.dim_provider AS dp ON dp.provider_id = psd.provider_id
    WHERE psd.provider_id = :provider_id
      AND psd.provider_local_date >= :receipt_start
      AND psd.provider_local_date <= :receipt_end
      AND psd.avg_delay_seconds IS NOT NULL
      AND psd.stop_id <> '__unknown_stop__'
    ORDER BY psd.provider_local_date, psd.avg_delay_seconds DESC, psd.stop_id
    """,
)


# S13 time-of-day cut: per-date, per-shift network-wide delay reading off the delay
# spine at its hour grain. WINDOW (DECISIONS DB2 / spec risk-1): matches the retained
# accountability span used by receipts.network_daily, so a shift cut and the day-level
# scalar reconcile — the shift split literally re-sums the same spine cells the network
# query aggregates. The pooled avg is the SAME ghost-
# excluded Σ sum_delay_seconds / Σ in-clamp histogram methodology (folded per-shift in
# build_receipts). Sentinel-guarded in SQL (route_id <> '__unrouted__') + defense-in-depth
# Python set. The hour->shift bucket is the ONE kernel CASE (shift_case_sql).
_RECEIPTS_SHIFT_DAILY_SQL = named_query(
    "receipts.shift_daily",
    f"""
    SELECT sp.provider_local_date                        AS local_date,
           ({shift_case_sql("sp.hour_of_day_local", indent=11)}) AS shift,
           SUM(sp.delay_observation_count)              AS known_obs,
           SUM(sp.severe_delay_count)                   AS severe,
           SUM(sp.sum_delay_seconds)                    AS pooled_delay_sec,
           SUM((SELECT COALESCE(SUM(x), 0)
                FROM unnest(sp.delay_histogram) AS x))  AS inclamp_obs
    FROM gold.route_delay_spine AS sp
    WHERE sp.provider_id = :provider_id
      AND sp.route_id <> '__unrouted__'
      AND sp.provider_local_date >= :receipt_start
      AND sp.provider_local_date <= :receipt_end
    GROUP BY sp.provider_local_date,
             ({shift_case_sql("sp.hour_of_day_local", indent=13)})
    """,
)

# S13 service-state cut: per-date network-wide scheduled→delivered→cancelled→silent split
# off gold.route_cancellation_daily (GC2 scheduled universe). WINDOW: the actual retained
# accountability span (this is a per-date driver-annotating cut, not a spine-sourced one
# — spec risk-1). delivered/silent FILTER(scheduled known) so a route
# with an unknown scheduled universe (pre-0073) never fabricates a 0 into the sum;
# service_completeness_pct uses the SAME LEAST(100, ...)/NULL-guard CASE as
# route.cancellation.daily (route_reliability.py) — None when Σscheduled is NULL or 0.
_RECEIPTS_SERVICE_STATES_SQL = named_query(
    "receipts.service_states",
    """
    SELECT rcd.provider_local_date AS local_date,
           SUM(rcd.scheduled_trip_days) AS scheduled_trip_days,
           SUM(rcd.delivered_trip_days)
               FILTER (WHERE rcd.scheduled_trip_days IS NOT NULL) AS delivered_trip_days,
           -- ONE universe for all four states: schedule-known rows only (an
           -- edition-flip cancellation on a schedule-unknown route belongs to the
           -- network cancellation series, not this scheduled-universe accounting).
           SUM(rcd.canceled_trip_days)
               FILTER (WHERE rcd.scheduled_trip_days IS NOT NULL) AS cancelled_trip_days,
           SUM(rcd.silent_trip_days)
               FILTER (WHERE rcd.scheduled_trip_days IS NOT NULL) AS silent_trip_days,
           CASE
               WHEN SUM(rcd.scheduled_trip_days) IS NULL
                    OR SUM(rcd.scheduled_trip_days) = 0
                    OR SUM(rcd.delivered_trip_days)
                        FILTER (WHERE rcd.scheduled_trip_days IS NOT NULL) IS NULL THEN NULL
               ELSE LEAST(100.0, ROUND(
                   100.0 * SUM(rcd.delivered_trip_days)
                       FILTER (WHERE rcd.scheduled_trip_days IS NOT NULL)
                   / SUM(rcd.scheduled_trip_days), 2))
           END AS service_completeness_pct
    FROM gold.route_cancellation_daily AS rcd
    JOIN gold.dim_provider AS dp ON dp.provider_id = rcd.provider_id
    WHERE rcd.provider_id = :provider_id
      AND rcd.provider_local_date >= :receipt_start
      AND rcd.provider_local_date <= :receipt_end
    GROUP BY rcd.provider_local_date
    ORDER BY rcd.provider_local_date
    """,
)

# S13 not-reported route list: per-date routes SCHEDULED that day (scheduled_trip_days>0)
# with ZERO realtime observations (total_trip_days=0) — DISTINCT from cancelled
# (canceled_trip_days>0, which the RT feed explicitly reported as cancelled). Sentinel-
# guarded in SQL + Python. NO cap in SQL: the builder caps per-date at
# NOT_REPORTED_ROUTES_CAP after computing the honest pre-cap count. Same window as the
# service_states cut (actual retained accountability span).
_RECEIPTS_NOT_REPORTED_ROUTES_SQL = named_query(
    "receipts.not_reported_routes",
    """
    SELECT rcd.provider_local_date AS local_date,
           rcd.route_id,
           rcd.scheduled_trip_days
    FROM gold.route_cancellation_daily AS rcd
    JOIN gold.dim_provider AS dp ON dp.provider_id = rcd.provider_id
    WHERE rcd.provider_id = :provider_id
      AND rcd.provider_local_date >= :receipt_start
      AND rcd.provider_local_date <= :receipt_end
      AND rcd.total_trip_days = 0
      AND rcd.scheduled_trip_days > 0
      AND rcd.route_id <> '__unrouted__'
    ORDER BY rcd.provider_local_date, rcd.scheduled_trip_days DESC, rcd.route_id
    """,
)

# Canonical shift order for by_shift emission (the kernel SHIFT_BOUNDS order + default).
_SHIFT_ORDER: tuple[str, ...] = tuple(label for _lo, _hi, label in SHIFT_BOUNDS) + (SHIFT_DEFAULT,)
_SHIFT_RANK: dict[str, int] = {s: i for i, s in enumerate(_SHIFT_ORDER)}


def build_receipts(
    conn: Connection, provider_id: str = "stm", *, generated_utc: str
) -> dict[str, Receipt]:
    """Build historic/receipts/{date}.json for every retained accountability date.

    The citizen_accountability_daily table is the driver — one Receipt per date
    present there.  Network OTP/delay come from gold.route_delay_spine aggregated to
    the local day (GC1 / Step G1 re-point off route_delay_hourly, which is KEPT for the
    public views); worst_route and worst_stop come from the public daily views (max
    avg_delay_seconds per date).

    vehicles is None in v1 (not stored in the receipt source mart).
    worst_route.otp_delta_pts = the worst route's daily OTP minus the day's network
    baseline OTP, in percentage points (honest-None when either side is unknown).
    """
    params = {"provider_id": provider_id}

    # 1. accountability rows: one per date (the driver set)
    acct: dict[str, dict] = {}
    accountability_dates: list[date] = []
    for r in conn.execute(_RECEIPTS_ACCOUNTABILITY_SQL, params).mappings():
        raw_date = r["provider_local_date"]
        accountability_dates.append(raw_date)
        ds = _iso_date(raw_date)
        acct[ds] = {
            "affected_routes": _opt_int(r["affected_route_count"]),
            "affected_stops": _opt_int(r["affected_stop_count"]),
            "alerts": _opt_int(r["alert_count"]),
            "rider_impact_score": _public_impact_score(r["rider_impact_score"]),
        }
    if not accountability_dates:
        return {}

    params = {
        "provider_id": provider_id,
        "receipt_start": min(accountability_dates),
        "receipt_end": max(accountability_dates),
    }
    route_names, stop_names = _entity_name_maps(conn, provider_id=provider_id)

    # 2. network daily OTP/delay from hourly rollup
    net: dict[str, dict] = {}
    for r in conn.execute(_RECEIPTS_NETWORK_DAILY_SQL, params).mappings():
        ds = _iso_date(r["local_date"])
        known_obs = r["known_obs"]
        # GC1 spine re-point: pooled mean = ghost-excluded Σ sum_delay_seconds over the
        # ghost-excluded in-clamp count (Σ histogram bins), matching hist_and_avg.
        pooled, inclamp = r["pooled_delay_sec"], r["inclamp_obs"]
        avg_sec = (float(pooled) / float(inclamp)) if inclamp and pooled is not None else None
        net[ds] = {
            "otp_pct": _otp_pct(r["on_time"], known_obs),
            "avg_delay_min": _avg_delay_min(avg_sec),
            "severe_pct": _severe_pct(known_obs, r["severe"]),
        }

    # 3. worst route per date: first row after ORDER BY avg_delay_seconds DESC
    worst_route: dict[str, ReceiptWorstRoute] = {}
    for r in conn.execute(_RECEIPTS_WORST_ROUTE_SQL, params).mappings():
        if str(r["route_id"]) in SENTINEL_ENTITY_IDS:
            continue  # defense-in-depth: never crown the routeless sentinel as worst
        ds = _iso_date(r["d"])
        if ds not in worst_route:  # first = max avg_delay (ordered DESC)
            # On-time-vs-network gap: the worst route's own daily OTP minus the
            # day's network baseline OTP (already computed in net[ds]). Honest-None
            # when either side is unknown (otp_delta_points) — never a fabricated 0.
            route_otp = _otp_pct(r.get("on_time"), r.get("known_obs"))
            network_otp = net.get(ds, {}).get("otp_pct")
            worst_route[ds] = ReceiptWorstRoute(
                id=str(r["route_id"]),
                name=route_names.get(str(r["route_id"])),
                otp_delta_pts=otp_delta_points(route_otp, network_otp),
            )

    # 4. worst stop per date: first row after ORDER BY avg_delay_seconds DESC
    worst_stop: dict[str, ReceiptWorstStop] = {}
    for r in conn.execute(_RECEIPTS_WORST_STOP_SQL, params).mappings():
        if str(r["stop_id"]) in SENTINEL_ENTITY_IDS:
            continue  # defense-in-depth: never crown the unknown-stop sentinel as worst
        ds = _iso_date(r["d"])
        if ds not in worst_stop:  # first = max avg_delay (ordered DESC)
            worst_stop[ds] = ReceiptWorstStop(
                id=str(r["stop_id"]),
                name=stop_names.get(str(r["stop_id"])),
                avg_delay_min=_avg_delay_min(r["avg_delay_seconds"]),
            )

    # 5. time-of-day cut per date: group spine shift rows into ordered ReceiptShiftCut
    #    lists. The pooled avg reproduces the day scalar's ghost-excluded mean EXACTLY
    #    (Σ sum_delay_seconds / Σ in-clamp histogram) so a shift cut reconciles with the
    #    day-level avg_delay_min (spec risk-2).
    by_shift: dict[str, list[ReceiptShiftCut]] = {}
    shift_rows: dict[str, dict[str, dict]] = {}
    for r in conn.execute(_RECEIPTS_SHIFT_DAILY_SQL, params).mappings():
        ds = _iso_date(r["local_date"])
        shift_rows.setdefault(ds, {})[str(r["shift"])] = r
    for ds, buckets in shift_rows.items():
        cuts: list[ReceiptShiftCut] = []
        for shift in sorted(buckets, key=lambda s: _SHIFT_RANK.get(s, len(_SHIFT_ORDER))):
            r = buckets[shift]
            known_obs = r["known_obs"]
            pooled, inclamp = r["pooled_delay_sec"], r["inclamp_obs"]
            avg_sec = (float(pooled) / float(inclamp)) if inclamp and pooled is not None else None
            cuts.append(
                ReceiptShiftCut(
                    shift=shift,
                    observation_count=_opt_int(known_obs),
                    severe_count=_opt_int(r["severe"]),
                    severe_pct=_severe_pct(known_obs, r["severe"]),
                    avg_delay_min=_avg_delay_min(avg_sec),
                )
            )
        if cuts:
            by_shift[ds] = cuts

    # 6. service-state cut per date: the scheduled→delivered→cancelled→silent split +
    #    completeness + the not-reported route list (capped, with honest pre-cap count).
    not_reported: dict[str, list] = {}
    not_reported_total: dict[str, int] = {}
    for r in conn.execute(_RECEIPTS_NOT_REPORTED_ROUTES_SQL, params).mappings():
        rid = str(r["route_id"])
        if rid in SENTINEL_ENTITY_IDS:
            continue  # defense-in-depth: the sentinel is never a named not-reported route
        ds = _iso_date(r["local_date"])
        not_reported_total[ds] = not_reported_total.get(ds, 0) + 1  # honest PRE-cap count
        bucket = not_reported.setdefault(ds, [])
        if len(bucket) < NOT_REPORTED_ROUTES_CAP:  # rows arrive scheduled DESC — top-N
            bucket.append(
                ReceiptNotReportedRoute(
                    id=rid,
                    name=route_names.get(rid),
                    scheduled_trip_days=_opt_int(r["scheduled_trip_days"]),
                )
            )

    service_states: dict[str, ReceiptServiceStates] = {}
    for r in conn.execute(_RECEIPTS_SERVICE_STATES_SQL, params).mappings():
        ds = _iso_date(r["local_date"])
        scheduled = _opt_int(r["scheduled_trip_days"])
        # Known universe + zero dark routes = an honest 0 ("all lines reported");
        # None only when the scheduled universe itself is unknown for the day.
        dark_count = not_reported_total.get(ds)
        if dark_count is None and scheduled is not None:
            dark_count = 0
        service_states[ds] = ReceiptServiceStates(
            scheduled_trip_days=scheduled,
            delivered_trip_days=_opt_int(r["delivered_trip_days"]),
            cancelled_trip_days=_opt_int(r["cancelled_trip_days"]),
            silent_trip_days=_opt_int(r["silent_trip_days"]),
            not_reported_route_count=dark_count,
            service_completeness_pct=_opt_float(r["service_completeness_pct"]),
            not_reported_routes=not_reported.get(ds, []),
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
            by_shift=by_shift.get(ds, []),
            service_states=service_states.get(ds),
        )
    return out


# --------------------------------------------------------------------------
# build_alert_history
# --------------------------------------------------------------------------

# 8M-row table — always filter by date BEFORE aggregating.
# S15 bounds: the served window is the full honest retention span
# (SILVER_I3_CLOSED_RETENTION_DAYS, bound as :win_start/:win_end — the
# hotspots/offenders precedent), newest-first, LIMIT 500. impact_passages is None
# (not in source). array_agg(...) FILTER (WHERE ...) requires PostgreSQL 9.4+.
#
# active_periods: aggregated from silver.i3_alert_active_periods (0077 child
# table) via a correlated LATERAL matched on the SAME group identity (provider +
# header + the scalar period[0] pair, IS NOT DISTINCT FROM for the nullable
# bounds). Rows predating 0077 have no child periods → the LATERAL returns empty
# and the builder falls back to the scalar pair as a 1-element list.
_ALERT_HISTORY_SQL = named_query(
    "alerts.history",
    """
    SELECT grp.alert_header_text,
           MAX(grp.header_text_en)                                  AS header_text_en,
           MAX(grp.description)                                     AS description,
           MAX(grp.description_en)                                  AS description_en,
           MAX(grp.severity)                                        AS severity,
           MAX(grp.cause)                                           AS cause,
           MAX(grp.effect)                                          AS effect,
           ARRAY_AGG(DISTINCT grp.route_id)
               FILTER (WHERE grp.route_id IS NOT NULL)              AS routes,
           ARRAY_AGG(DISTINCT grp.stop_id)
               FILTER (WHERE grp.stop_id IS NOT NULL)               AS stops,
           grp.start_utc,
           grp.end_utc,
           -- url + active_periods are correlated subqueries keyed on the SAME
           -- group identity (provider + header + scalar period[0]), so they never
           -- fan out the 8M-row aggregation. url = one non-NULL display link if
           -- any matching silver row carries one (honest-NULL otherwise).
           (
               SELECT MAX(a2.url)
               FROM silver.i3_alerts a2
               WHERE a2.provider_id = :provider_id
                 AND a2.alert_header_text IS NOT DISTINCT FROM grp.alert_header_text
                 AND a2.active_period_start_utc IS NOT DISTINCT FROM grp.start_utc
                 AND a2.active_period_end_utc IS NOT DISTINCT FROM grp.end_utc
           )                                                        AS url,
           -- One window per period_index, ordered. Re-rowed multi-period alerts
           -- (the S15 hash cutover mints a new SCD-2 row when periods beyond [0]
           -- change) can share header+period[0] across versions with DIFFERENT
           -- later bounds — DISTINCT ON keeps the NEWEST version's bound per
           -- period_index. NULL when no child rows exist (pre-0077 history).
           (
               SELECT json_agg(
                          json_build_object('start_utc', ap.start_utc,
                                            'end_utc', ap.end_utc)
                          ORDER BY ap.period_index
                      )
               FROM (
                   SELECT DISTINCT ON (p.period_index)
                          p.period_index, p.start_utc, p.end_utc
                   FROM silver.i3_alerts a2
                   JOIN silver.i3_alert_active_periods p
                     ON p.i3_alert_snapshot_id = a2.i3_alert_snapshot_id
                    AND p.alert_index = a2.alert_index
                   WHERE a2.provider_id = :provider_id
                     AND a2.alert_header_text IS NOT DISTINCT FROM grp.alert_header_text
                     AND a2.active_period_start_utc IS NOT DISTINCT FROM grp.start_utc
                     AND a2.active_period_end_utc IS NOT DISTINCT FROM grp.end_utc
                   ORDER BY p.period_index,
                            a2.i3_alert_snapshot_id DESC, a2.alert_index DESC
               ) AS ap
           )                                                        AS active_periods
    FROM (
        SELECT iah.alert_header_text,
               iah.alert_header_text_en                             AS header_text_en,
               iah.description_text                                 AS description,
               iah.description_text_en                              AS description_en,
               iah.severity,
               iah.cause,
               iah.effect,
               iah.route_id,
               iah.stop_id,
               iah.active_period_start_utc                          AS start_utc,
               iah.active_period_end_utc                            AS end_utc
        FROM gold.i3_alert_history_reporting AS iah
        JOIN gold.dim_provider AS dp ON dp.provider_id = iah.provider_id
        WHERE iah.provider_id = :provider_id
          AND iah.provider_local_date >= :win_start
          AND iah.provider_local_date <= :win_end
    ) AS grp
    GROUP BY grp.alert_header_text, grp.start_utc, grp.end_utc
    ORDER BY grp.start_utc DESC NULLS LAST
    LIMIT 500
    """,
)


# The TRUE pre-cap distinct-alert count for the window: the SAME grouped identity
# as _ALERT_HISTORY_SQL with NO LIMIT. total_in_window must be able to EXCEED the
# cap or the truncation disclosure degenerates to a self-contradictory "500 of
# 500" that cannot distinguish a 501-alert window from a 5000-alert one.
_ALERT_HISTORY_COUNT_SQL = named_query(
    "alerts.history.count",
    """
    SELECT COUNT(*) AS total
    FROM (
        SELECT 1
        FROM gold.i3_alert_history_reporting AS iah
        WHERE iah.provider_id = :provider_id
          AND iah.provider_local_date >= :win_start
          AND iah.provider_local_date <= :win_end
        GROUP BY iah.alert_header_text,
                 iah.active_period_start_utc,
                 iah.active_period_end_utc
    ) AS grouped
    """,
)


# The provider-local "today" — the newest date the trailing alert-history window
# ends on. Resolved in the DB so the timezone authority stays dim_provider (the
# same (now() AT TIME ZONE dp.timezone)::date the old trailing clause used).
_ALERT_HISTORY_ANCHOR_SQL = named_query(
    "alerts.history.anchor",
    """
    SELECT (now() AT TIME ZONE dp.timezone)::date AS anchor
    FROM gold.dim_provider AS dp
    WHERE dp.provider_id = :provider_id
    """,
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


# S15: the emitted-alerts cap. Newest-first LIMIT 500 in _ALERT_HISTORY_SQL; the
# builder discloses total_in_window + truncated when the window held more.
_ALERT_HISTORY_LIMIT = 500


def build_alert_history(
    conn: Connection, provider_id: str = "stm", *, generated_utc: str
) -> AlertHistory:
    """Build historic/alert_history.json — the full retention window, capped at 500 alerts.

    Source: gold.i3_alert_history_reporting (8M rows — always filter first).
    STM's i3 feed leaves alert_id NULL, so grouping by it would collapse every
    row into one mega-alert; instead we group by the content key
    (header + active period) and synthesize a content-stable id, mirroring the
    live build_alerts approach.  Routes/stops are deduped and natural-sorted.
    duration_min is computed from start/end; impact_passages is None in v1.

    S15 windowing: the served window is the trailing SILVER_I3_CLOSED_RETENTION_DAYS
    (serve everything we honestly retain — ONE constant, no magic number),
    provider-local, resolved via the DB anchor so dim_provider stays the timezone
    authority. window_start / window_end + total_in_window + truncated disclose the
    window and the cap. active_periods lists ALL windows (a 1-element list = the
    scalar pair for pre-0077 history); cause / effect / severity_level / url are
    additive per-entry passthroughs (url honest-NULL before 0077).
    """
    from transit_ops.settings import get_settings

    retention_days = get_settings().SILVER_I3_CLOSED_RETENTION_DAYS
    anchor_row = (
        conn.execute(_ALERT_HISTORY_ANCHOR_SQL, {"provider_id": provider_id}).mappings().fetchone()
    )
    win_end: date | None = anchor_row["anchor"] if anchor_row else None
    win_start: date | None = (
        win_end - timedelta(days=retention_days) if win_end is not None else None
    )
    window_binds = {"provider_id": provider_id, "win_start": win_start, "win_end": win_end}
    rows = list(conn.execute(_ALERT_HISTORY_SQL, window_binds).mappings())
    # The TRUE pre-cap window total (S15 review F1): a separate un-LIMITed count
    # over the same grouped identity, so truncated can honestly say how much the
    # newest-first cap dropped. Honest-None when the count query yields nothing.
    count_row = conn.execute(_ALERT_HISTORY_COUNT_SQL, window_binds).mappings().fetchone()
    total_in_window: int | None = int(count_row["total"]) if count_row else None
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
            str(r[c] or "") for c in ("alert_header_text", "severity", "start_utc", "end_utc")
        )
        alert_id = f"{provider_id}-alert-{hashlib.sha1(basis.encode()).hexdigest()[:12]}"
        severity_code = _severity_code(r["severity"])
        cause = r.get("cause")
        effect = r.get("effect")
        severity_level = r.get("severity")
        breakdown_records.append((cause, effect, severity_code, duration_min))
        active_periods = _alert_active_periods(r.get("active_periods"), start, end)
        entries.append(
            AlertHistoryEntry(
                id=alert_id,
                severity=severity_code,
                # slice-9.1.1s: header + MAX'd EN header (grouping unchanged).
                header_text=r["alert_header_text"],
                header_text_en=_sane_en(r["header_text_en"]),
                description=r.get("description"),
                description_en=_sane_en(r.get("description_en")),
                routes=_natural_sort_dedup(raw_routes),
                stops=_natural_sort_dedup(raw_stops),
                start_utc=_opt_iso(start),
                end_utc=_opt_iso(end),
                duration_min=duration_min,
                impact_passages=None,  # v1 deferral: not stored in gold
                # S15 additive passthroughs (raw upstream + child-table windows).
                cause=cause,
                effect=effect,
                severity_level=severity_level,
                url=r.get("url"),
                active_periods=active_periods,
            )
        )
    return AlertHistory(
        generated_utc=generated_utc,
        alerts=entries,
        breakdown=_alert_breakdown(breakdown_records),
        window_start=_iso_date(win_start) if win_start is not None else None,
        window_end=_iso_date(win_end) if win_end is not None else None,
        # total_in_window is the TRUE pre-cap count (dedicated un-LIMITed count
        # query), so it can EXCEED the cap and truncated is a real disclosure —
        # never the self-contradictory "500 of 500" (S15 review F1).
        total_in_window=total_in_window,
        truncated=(total_in_window is not None and total_in_window > len(rows)),
    )
