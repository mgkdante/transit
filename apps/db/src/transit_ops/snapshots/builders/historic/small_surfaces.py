from __future__ import annotations

import hashlib
from datetime import date, timedelta
from typing import TYPE_CHECKING

from transit_ops.gold.reader import (
    SHIFT_BOUNDS,
    SHIFT_DEFAULT,
    GrainWindows,
    round_half_away,
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
    rows = list(conn.execute(_HOTSPOTS_SQL, {"provider_id": provider_id}).mappings())
    route_names, stop_names = _entity_name_maps(conn, provider_id=provider_id)
    kept = [r for r in rows if str(r["entity_id"]) not in SENTINEL_ENTITY_IDS]
    hotspots = []
    for i, r in enumerate(kept):
        kind = str(r["entity_kind"])
        if kind == "route":
            delta = otp_delta_points(
                r.get("route_on_time"),
                r.get("route_known"),
                r.get("net_on_time"),
                r.get("net_known"),
            )
        else:
            stop_obs, network_obs = r.get("stop_obs"), r.get("net_stop_obs")
            delta = otp_delta_points(
                None if stop_obs is None else stop_obs - (r.get("stop_severe") or 0),
                stop_obs,
                None if network_obs is None else network_obs - (r.get("net_stop_severe") or 0),
                network_obs,
            )
        hotspots.append(
            Hotspot(
                rank=i + 1,
                type=kind,
                id=str(r["entity_id"]),
                name=(
                    route_names.get(str(r["entity_id"]))
                    if kind == "route"
                    else stop_names.get(str(r["entity_id"]))
                ),
                severity=r["severity_label"],
                otp_delta_pts=delta,
            )
        )
    by_grain = _hotspots_by_grain(conn, provider_id, route_names, stop_names)
    return Hotspots(generated_utc=generated_utc, hotspots=hotspots, by_grain=by_grain)


_PEAK_SHIFT_IN_LITERAL = ", ".join(f"'{s}'" for s in HOTSPOT_PEAK_SHIFTS)

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

_HOTSPOTS_ROUTE_WINDOW_SQL = named_query(
    "hotspots.route.by_grain",
    """
    SELECT
        route_id,
        SUM((SELECT SUM(value) FROM unnest(delay_histogram) AS value))::bigint AS obs,
        SUM(severe_delay_count)::bigint       AS severe,
        SUM(sum_delay_seconds)::bigint        AS sum_delay_sec
    FROM gold.route_delay_spine
    WHERE provider_id = :provider_id
      AND provider_local_date >= :win_start AND provider_local_date <= :win_end
      AND route_id <> '__unrouted__'
    GROUP BY route_id
    """,
)

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

_HOTSPOTS_ROUTE_SHIFT_SQL = named_query(
    "hotspots.route.by_shift",
    f"""
    SELECT
        route_id,
        SUM((SELECT SUM(value) FROM unnest(delay_histogram) AS value))::bigint AS obs,
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
    route_anchor = _hotspots_anchor(conn, _HOTSPOTS_ROUTE_ANCHOR_SQL, provider_id)
    stop_anchor = _hotspots_anchor(conn, _HOTSPOTS_STOP_ANCHOR_SQL, provider_id)
    if route_anchor is None and stop_anchor is None:
        return []
    out: list[HotspotGrain] = []
    route_windows = GrainWindows(route_anchor) if route_anchor is not None else None
    stop_windows = GrainWindows(stop_anchor) if stop_anchor is not None else None
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
        merged = merge_hotspot_grain(
            route_l,
            stop_l,
            grain=grain,
            window_start=r_start if r_start is not None else s_start,
            window_end=r_end if r_end is not None else s_end,
        )
        if merged is not None:
            out.append(merged)
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
    rows = list(conn.execute(_REPEAT_OFFENDERS_SQL, {"provider_id": provider_id}).mappings())
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
            recurrence_days=_opt_int(r["recurrence_days"]),
            window_days=_opt_int(r["window_days"]),
            avg_delay_min=_avg_delay_min(r["avg_delay_seconds"]),
            severity=r["severity_label"],
        )
        for r in rows
    ]
    by_grain = _repeat_offenders_by_grain(conn, provider_id, route_names)
    return RepeatOffenders(generated_utc=generated_utc, offenders=offenders, by_grain=by_grain)


_OFFENDERS_ANCHOR_SQL = named_query(
    "repeat.offenders.spine.anchor",
    "SELECT MAX(provider_local_date) AS anchor FROM gold.repeat_offender_daily_spine "
    "WHERE provider_id = :provider_id",
)

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
        trip_rows = [dict(r, window_days=window_days) for r in rows if r["entity_kind"] == "trip"]
        veh_rows = [dict(r, window_days=window_days) for r in rows if r["entity_kind"] == "vehicle"]
        trip_entries, trip_total, trip_tray = build_offender_kind_ladder(
            trip_rows, "trip", route_names
        )
        veh_entries, veh_total, veh_tray = build_offender_kind_ladder(
            veh_rows, "vehicle", route_names
        )
        entries = trip_entries + veh_entries
        union = trip_tray + veh_tray
        tray_total = len(union)
        if not entries and tray_total == 0:
            continue
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

_RECEIPTS_WORST_ROUTE_SQL = named_query(
    "receipts.worst_route",
    """
    WITH candidates AS (
        SELECT * FROM gold.public_route_reliability_daily
        WHERE provider_id = :provider_id
          AND provider_local_date >= :receipt_start
          AND provider_local_date <= :receipt_end
          AND route_id <> '__unrouted__'
    ), incomplete_dates AS (
        SELECT DISTINCT c.provider_local_date
        FROM candidates AS c
        JOIN gold.dim_provider AS dp ON dp.provider_id = c.provider_id
        WHERE c.avg_delay_seconds IS NULL
          AND EXISTS (
              SELECT 1 FROM gold.route_delay_hourly AS h
              WHERE h.provider_id = c.provider_id AND h.route_id = c.route_id
                AND h.period_start_utc >= c.provider_local_date::timestamp AT TIME ZONE dp.timezone
                AND h.period_start_utc <
                    (c.provider_local_date + 1)::timestamp AT TIME ZONE dp.timezone
                AND (
                    h.usable_delay_observation_count > 0
                    OR (h.usable_delay_observation_count IS NULL AND (
                        h.observation_count > 0 OR h.delay_observation_count > 0
                        OR h.trip_count > 0 OR h.delayed_trip_count > 0 OR h.severe_delay_count > 0
                        OR h.avg_delay_seconds IS NOT NULL OR h.max_delay_seconds IS NOT NULL
                    ))
                )
          )
    )
    SELECT DISTINCT ON (prr.provider_local_date)
           prr.provider_local_date AS d,
           prr.route_id,
           prr.avg_delay_seconds,
           prr.on_time_observation_count AS on_time,
           prr.delay_observation_count   AS known_obs
    FROM candidates AS prr
    WHERE prr.avg_delay_seconds IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM incomplete_dates AS i WHERE i.provider_local_date = prr.provider_local_date
      )
    ORDER BY prr.provider_local_date, prr.avg_delay_seconds DESC, prr.route_id
    """,
)

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

_SHIFT_ORDER: tuple[str, ...] = tuple(label for _lo, _hi, label in SHIFT_BOUNDS) + (SHIFT_DEFAULT,)
_SHIFT_RANK: dict[str, int] = {s: i for i, s in enumerate(_SHIFT_ORDER)}


def build_receipts(
    conn: Connection, provider_id: str = "stm", *, generated_utc: str
) -> dict[str, Receipt]:
    params = {"provider_id": provider_id}

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

    net: dict[str, dict] = {}
    for r in conn.execute(_RECEIPTS_NETWORK_DAILY_SQL, params).mappings():
        ds = _iso_date(r["local_date"])
        known_obs = r["known_obs"]
        # Pool in-clamp delay sums and counts.
        pooled, inclamp = r["pooled_delay_sec"], r["inclamp_obs"]
        avg_sec = (float(pooled) / float(inclamp)) if inclamp and pooled is not None else None
        net[ds] = {
            "on_time": r["on_time"],
            "known_obs": known_obs,
            "otp_pct": _otp_pct(r["on_time"], known_obs),
            "avg_delay_min": _avg_delay_min(avg_sec),
            "severe_pct": _severe_pct(known_obs, r["severe"]),
        }

    worst_route: dict[str, ReceiptWorstRoute] = {}
    for r in conn.execute(_RECEIPTS_WORST_ROUTE_SQL, params).mappings():
        if str(r["route_id"]) in SENTINEL_ENTITY_IDS:
            continue
        ds = _iso_date(r["d"])
        if ds not in worst_route:
            network = net.get(ds, {})
            worst_route[ds] = ReceiptWorstRoute(
                id=str(r["route_id"]),
                name=route_names.get(str(r["route_id"])),
                otp_delta_pts=otp_delta_points(
                    r.get("on_time"),
                    r.get("known_obs"),
                    network.get("on_time"),
                    network.get("known_obs"),
                ),
            )

    worst_stop: dict[str, ReceiptWorstStop] = {}
    for r in conn.execute(_RECEIPTS_WORST_STOP_SQL, params).mappings():
        if str(r["stop_id"]) in SENTINEL_ENTITY_IDS:
            continue
        ds = _iso_date(r["d"])
        if ds not in worst_stop:
            worst_stop[ds] = ReceiptWorstStop(
                id=str(r["stop_id"]),
                name=stop_names.get(str(r["stop_id"])),
                avg_delay_min=_avg_delay_min(r["avg_delay_seconds"]),
            )

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

    not_reported: dict[str, list] = {}
    not_reported_total: dict[str, int] = {}
    for r in conn.execute(_RECEIPTS_NOT_REPORTED_ROUTES_SQL, params).mappings():
        rid = str(r["route_id"])
        if rid in SENTINEL_ENTITY_IDS:
            continue
        ds = _iso_date(r["local_date"])
        not_reported_total[ds] = not_reported_total.get(ds, 0) + 1
        bucket = not_reported.setdefault(ds, [])
        if len(bucket) < NOT_REPORTED_ROUTES_CAP:
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
        # Known schedule with no dark routes is zero; unknown schedule remains None.
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

    out: dict[str, Receipt] = {}
    for ds, a in acct.items():
        n = net.get(ds, {})
        out[ds] = Receipt(
            generated_utc=generated_utc,
            date=ds,
            vehicles=None,
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


# Period enrichment includes retained versions beyond the displayed alert window.
_ALERT_HISTORY_SQL = named_query(
    "alerts.history",
    """
    WITH metadata AS MATERIALIZED (
        SELECT alert_header_text, start_utc, end_utc,
               MAX(url) AS url,
               json_agg(json_build_object('start_utc', period_start,
                                          'end_utc', period_end)
                        ORDER BY period_index)
                   FILTER (WHERE period_index IS NOT NULL AND newest = 1) AS active_periods
        FROM (
            SELECT a.alert_header_text,
                   a.active_period_start_utc AS start_utc,
                   a.active_period_end_utc AS end_utc,
                   a.url, p.period_index,
                   p.start_utc AS period_start, p.end_utc AS period_end,
                   ROW_NUMBER() OVER (
                       PARTITION BY a.alert_header_text, a.active_period_start_utc,
                                    a.active_period_end_utc, p.period_index
                       ORDER BY a.i3_alert_snapshot_id DESC, a.alert_index DESC
                   ) AS newest
            FROM silver.i3_alerts a
            LEFT JOIN silver.i3_alert_active_periods p
              ON p.i3_alert_snapshot_id = a.i3_alert_snapshot_id
             AND p.alert_index = a.alert_index
            WHERE a.provider_id = :provider_id
        ) AS versions
        GROUP BY alert_header_text, start_utc, end_utc
    ), grouped AS (
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
           grp.end_utc
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
    )
    SELECT grouped.*, metadata.url, metadata.active_periods
    FROM grouped
    LEFT JOIN metadata
      ON metadata.alert_header_text IS NOT DISTINCT FROM grouped.alert_header_text
     AND metadata.start_utc IS NOT DISTINCT FROM grouped.start_utc
     AND metadata.end_utc IS NOT DISTINCT FROM grouped.end_utc
    ORDER BY grouped.start_utc DESC NULLS LAST
    """,
)


# Count distinct alerts before capping so truncation reports the full total.
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
                    statistics.median(grouped[key]) if grouped.get(key) else None
                ),
            )
            for key in counts
        ]
        out.sort(key=lambda b: (-b.count, b.key))
        return out

    return AlertBreakdown(
        by_cause=_buckets(0),
        by_effect=_buckets(1),
        by_severity=_buckets(2),
    )


_ALERT_HISTORY_LIMIT = 500


def build_alert_history(
    conn: Connection, provider_id: str = "stm", *, generated_utc: str
) -> AlertHistory:
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
    count_row = conn.execute(_ALERT_HISTORY_COUNT_SQL, window_binds).mappings().fetchone()
    total_in_window: int | None = int(count_row["total"]) if count_row else None
    entries: list[AlertHistoryEntry] = []
    breakdown_records: list[tuple[str | None, str | None, str | None, float | None]] = []
    for r in rows:
        start = r["start_utc"]
        end = r["end_utc"]
        duration_min: float | None = None
        if start is not None and end is not None:
            try:
                start_s = _iso(start)
                end_s = _iso(end)
                import datetime as _dt

                s_dt = _dt.datetime.fromisoformat(start_s.replace("Z", "+00:00"))
                e_dt = _dt.datetime.fromisoformat(end_s.replace("Z", "+00:00"))
                diff_s = (e_dt - s_dt).total_seconds()
                # Malformed negative durations remain None.
                duration_min = float(round_half_away(diff_s / 60.0, 0)) if diff_s >= 0 else None
            except (ValueError, TypeError):
                duration_min = None

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

        # Synthesize content-stable IDs for alerts without source IDs.
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
                header_text=r["alert_header_text"],
                header_text_en=_sane_en(r["header_text_en"]),
                description=r.get("description"),
                description_en=_sane_en(r.get("description_en")),
                routes=_natural_sort_dedup(raw_routes),
                stops=_natural_sort_dedup(raw_stops),
                start_utc=_opt_iso(start),
                end_utc=_opt_iso(end),
                duration_min=duration_min,
                impact_passages=None,
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
        total_in_window=total_in_window,
        truncated=(total_in_window is not None and total_in_window > len(rows)),
    )
