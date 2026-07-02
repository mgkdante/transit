"""Small historic surfaces: hotspots, repeat offenders, receipts, alert history.

Split out of the former monolithic ``historic.py`` (S7-close C3) verbatim. These
four builders share the entity-name resolvers and the sentinel guard but no spine
machinery, so they co-locate here.
"""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING

from transit_ops.gold.reader import current_date_trailing_clause
from transit_ops.snapshots.builders._helpers import (
    _ROUTE_NAMES_SQL,
    _avg_delay_min,
    _entity_name_maps,
    _iso,
    _iso_date,
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
from transit_ops.snapshots.contract import (
    AlertBreakdown,
    AlertBreakdownBucket,
    AlertHistory,
    AlertHistoryEntry,
    Hotspot,
    Hotspots,
    Offender,
    Receipt,
    ReceiptWorstRoute,
    ReceiptWorstStop,
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
# Gold buckets NULL route/stop ids into these sentinels (rollups.py COALESCE).
# They must NEVER surface to a citizen as a named entity. The publish SQL filters
# them out; this set is the defense-in-depth publish-time invariant the builders
# also enforce, so a future un-filtered query path can't leak a phantom entity.
_SENTINEL_ENTITY_IDS = frozenset({"__unrouted__", "__unknown_stop__"})


def _otp_delta_pts(cell_otp: int | None, network_otp: int | None) -> float | None:
    """entity OTP minus the network baseline OTP, in percentage POINTS (1 dp).

    Negative = the entity is worse than the network (that's why it's a hotspot).
    Honest-None: the delta is None (NEVER 0) when EITHER the cell's own OTP or
    the network baseline OTP is unknown for the period — a missing magnitude must
    read as "no data", never as "exactly on par". Both inputs already carry the
    upstream honest-None convention (_otp_pct / _otp_pct_severe_proxy).
    """
    if cell_otp is None or network_otp is None:
        return None
    return round(float(cell_otp) - float(network_otp), 1)


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
# _otp_delta_pts) so the convention matches the rest of the historic surface
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
               date_trunc('week', service_local_date)::date AS week_start_local,
               SUM(on_time_observation_count) AS on_time_observation_count,
               SUM(delay_observation_count)   AS delay_observation_count
        FROM gold.route_delay_spine
        WHERE provider_id = :provider_id
        GROUP BY route_id, date_trunc('week', service_local_date)::date
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
               date_trunc('week', service_local_date)::date AS week_start_local,
               SUM(observation_count)  AS observation_count,
               SUM(severe_delay_count) AS severe_delay_count
        FROM gold.stop_delay_spine
        WHERE provider_id = :provider_id
        GROUP BY stop_id, date_trunc('week', service_local_date)::date
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
    """
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
    when either side is unknown (_otp_delta_pts).
    """
    rows = list(conn.execute(_HOTSPOTS_SQL, {"provider_id": provider_id}).mappings())
    route_names, stop_names = _entity_name_maps(conn, provider_id=provider_id)
    # Defense-in-depth: never publish a sentinel-bucket entity even if a query path
    # ever forgets the SQL filter (re-ranks over the surviving rows).
    kept = [r for r in rows if str(r["entity_id"]) not in _SENTINEL_ENTITY_IDS]
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
                otp_delta_pts=_otp_delta_pts(cell_otp, network_otp),
            )
        )
    return Hotspots(generated_utc=generated_utc, hotspots=hotspots)


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
    """
)


def build_repeat_offenders(
    conn: Connection, provider_id: str = "stm", *, generated_utc: str
) -> RepeatOffenders:
    """Build historic/repeat_offenders.json — top 50 most-persistent problem entities.

    Source: gold.repeat_offender (P3 mart).
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
_RECEIPTS_ACCOUNTABILITY_SQL = named_query(
    "receipts.accountability",
    f"""
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
      AND {current_date_trailing_clause("provider_local_date")}
    ORDER BY provider_local_date
    """
)

# Network-level daily aggregation from the hourly rollup.
_RECEIPTS_NETWORK_DAILY_SQL = named_query(
    "receipts.network_daily",
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
# on_time / known carry the worst route's own daily OTP so the receipt can show
# its on-time-vs-network gap (otp_delta_pts) against the day's network baseline.
_RECEIPTS_WORST_ROUTE_SQL = named_query(
    "receipts.worst_route",
    f"""
    SELECT provider_local_date AS d,
           route_id,
           avg_delay_seconds,
           on_time_observation_count AS on_time,
           delay_observation_count   AS known_obs
    FROM gold.public_route_reliability_daily AS prr
    JOIN gold.dim_provider AS dp ON dp.provider_id = prr.provider_id
    WHERE prr.provider_id = :provider_id
      AND {current_date_trailing_clause("provider_local_date")}
      AND avg_delay_seconds IS NOT NULL
      AND route_id <> '__unrouted__'
    ORDER BY provider_local_date, avg_delay_seconds DESC, route_id
    """
)

# Worst stop per date: max avg_delay_seconds from the public stop delay view.
_RECEIPTS_WORST_STOP_SQL = named_query(
    "receipts.worst_stop",
    f"""
    SELECT provider_local_date AS d,
           stop_id,
           avg_delay_seconds,
           max_delay_seconds
    FROM gold.public_stop_delay_daily AS psd
    JOIN gold.dim_provider AS dp ON dp.provider_id = psd.provider_id
    WHERE psd.provider_id = :provider_id
      AND {current_date_trailing_clause("provider_local_date")}
      AND avg_delay_seconds IS NOT NULL
      AND stop_id <> '__unknown_stop__'
    ORDER BY provider_local_date, avg_delay_seconds DESC, stop_id
    """
)


def build_receipts(
    conn: Connection, provider_id: str = "stm", *, generated_utc: str
) -> dict[str, Receipt]:
    """Build historic/receipts/{date}.json for each date in the last 30 days.

    The citizen_accountability_daily table is the driver — one Receipt per date
    present there.  Network OTP/delay come from route_delay_hourly (hourly rollup
    aggregated to daily); worst_route and worst_stop come from the public daily
    views (max avg_delay_seconds per date).

    vehicles is None in v1 (not stored in the receipt source mart).
    worst_route.otp_delta_pts = the worst route's daily OTP minus the day's network
    baseline OTP, in percentage points (honest-None when either side is unknown).
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
            # On-time-vs-network gap: the worst route's own daily OTP minus the
            # day's network baseline OTP (already computed in net[ds]). Honest-None
            # when either side is unknown (_otp_delta_pts) — never a fabricated 0.
            route_otp = _otp_pct(r.get("on_time"), r.get("known_obs"))
            network_otp = net.get(ds, {}).get("otp_pct")
            worst_route[ds] = ReceiptWorstRoute(
                id=str(r["route_id"]),
                name=route_names.get(str(r["route_id"])),
                otp_delta_pts=_otp_delta_pts(route_otp, network_otp),
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
_ALERT_HISTORY_SQL = named_query(
    "alerts.history",
    f"""
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
    FROM gold.i3_alert_history_reporting AS iah
    JOIN gold.dim_provider AS dp ON dp.provider_id = iah.provider_id
    WHERE iah.provider_id = :provider_id
      AND {current_date_trailing_clause("provider_local_date")}
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
    conn: Connection, provider_id: str = "stm", *, generated_utc: str
) -> AlertHistory:
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
