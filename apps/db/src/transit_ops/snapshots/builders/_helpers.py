"""Shared value-domain constants + private helpers for the builders package.

This module is the leaf of the builders dependency graph:
``{live,static,historic} -> _helpers -> contract``.  It holds the value-domain
mappings, the small pure helpers, and the deterministic *representative service
date* resolution shared by the static route/stop builders and the historic
``_scheduled_headway_by_shift`` headway computation.

Status-band thresholds mirror migration 0020; see the package ``__init__``
docstring and the per-tier modules for the publishing rationale.
"""

from __future__ import annotations

import statistics
from datetime import UTC
from typing import TYPE_CHECKING

from sqlalchemy import text

if TYPE_CHECKING:  # pragma: no cover - typing only
    from collections.abc import Iterable, Mapping

    from sqlalchemy.engine import Connection

    from transit_ops.snapshots.contract import RouteHabits

# --------------------------------------------------------------------------
# Value-domain mappings
# --------------------------------------------------------------------------

# Reusable status-band CASE fragment. This MUST stay CHARACTER-IDENTICAL to the
# CASE in migration 0020 (gold.current_vehicle_map_with_status.status_band) so a
# Python builder that computes the band in-query produces the exact same labels
# the view does — never re-bucket avg_delay_seconds in Python (that was the old
# drift risk this constant retires). The doubled single-quote in À l''heure is the
# SQL string-literal escape for the apostrophe; ``{col}`` is the delay column name.
STATUS_BAND_CASE_SQL = """
        CASE
            WHEN {col} IS NULL THEN 'Inconnu / Unknown'
            WHEN {col} < -60  THEN 'En avance / Early'
            WHEN {col} <  60  THEN 'À l''heure / On time'
            WHEN {col} < 300  THEN 'En retard / Late'
            ELSE                   'Critique / Severe'
        END"""

# gold.current_vehicle_map_with_status.status_band emits bilingual labels (0020).
_STATUS_MAP: dict[str, str] = {
    "EN AVANCE / EARLY": "early",
    "À L'HEURE / ON TIME": "on_time",
    "A L'HEURE / ON TIME": "on_time",  # accent-stripped fallback
    "EN RETARD / LATE": "late",
    "CRITIQUE / SEVERE": "severe",
    "INCONNU / UNKNOWN": "unknown",
}

# GTFS-RT OccupancyStatus enum (INTEGER in latest_vehicle_snapshot, 0006).
_OCCUPANCY_MAP: dict[int, str] = {
    0: "empty",
    1: "many_seats",
    2: "few_seats",
    3: "standing",
    4: "standing",  # CRUSHED_STANDING_ROOM_ONLY
    5: "full",
    # 6/7/8 NOT_ACCEPTING / NO_DATA / NOT_BOARDABLE -> None
}

# Alert severity tokens -> contract Severity. STM sends NULL (-> 'watch').
_SEVERITY_MAP: dict[str, str] = {
    "SEVERE": "critical",
    "CRITICAL": "critical",
    "WARNING": "high",
    "HIGH": "high",
    "MAJOR": "high",
    "INFO": "watch",
    "UNKNOWN_SEVERITY": "watch",
    "UNKNOWN": "watch",
}

_SURFACES: list[str] = [
    "live_map",
    "network_health",
    "lookups",
    "reliability",
    "accountability",
    "data_trust",
]

_SHIFT_ORDER = ["am_peak", "midday", "pm_peak", "evening", "night"]
_SHIFT_WINDOWS = {
    "am_peak": "06:00–09:00",
    "midday": "09:00–15:00",
    "pm_peak": "15:00–19:00",
    "evening": "19:00–23:00",
    "night": "23:00–06:00",
}

# Boardable-stop predicate shared by the index and per-stop builders so they
# can never diverge (GTFS location_type 0 or NULL == a stop you can board at).
_BOARDABLE_STOP = "(location_type = 0 OR location_type IS NULL)"

_STOP_TIMES_CAP = 12  # representative all-day sample per (route, headsign)


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------


def _round5(x: object) -> float | None:
    return round(float(x), 5) if x is not None else None  # type: ignore[arg-type]


def _opt_int(x: object) -> int | None:
    return int(x) if x is not None else None  # type: ignore[arg-type]


def _sane_en(value: str | None) -> str | None:
    """Drop legacy Python-repr EN alert garbage from the published contract."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.startswith("{'") and "'language'" in text and "'text'" in text:
        return None
    if text.startswith('{"') and '"language"' in text and '"text"' in text:
        return None
    return text


def _kmh(speed_ms: object) -> int | None:
    """GTFS-RT Position.speed is meters/second; the contract field is km/h."""
    if speed_ms is None:
        return None
    return round(float(speed_ms) * 3.6)  # type: ignore[arg-type]


def _iso(v: object) -> str:
    """Render a timestamp as ISO-8601 UTC 'Z'. Strings pass through untouched.

    tz-aware datetimes are converted to UTC; naive datetimes are assumed UTC.
    """
    if isinstance(v, str):
        return v
    dt = v if v.tzinfo is not None else v.replace(tzinfo=UTC)  # type: ignore[union-attr]
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _opt_iso(v: object) -> str | None:
    return None if v is None else _iso(v)


def _wallclock(t: object) -> str | None:
    """Normalize a GTFS time (possibly extended >=24:00) to wall-clock 'HH:MM'.

    Display-only: callers keep the RAW text for ordering (raw extended strings
    sort lexicographically == chronologically), and only normalize the value
    shown to riders.  '25:48' -> '01:48', '29:03' -> '05:03'.
    """
    if not t:
        return None
    parts = str(t).split(":")
    try:
        h, m = int(parts[0]) % 24, int(parts[1])
    except (ValueError, IndexError):
        return str(t)[:5]
    return f"{h:02d}:{m:02d}"


def _gtfs_min(t: object) -> int:
    """GTFS time 'HH:MM[:SS]' -> minutes since the service-day start (may be >=1440)."""
    parts = str(t).split(":")
    try:
        return int(parts[0]) * 60 + int(parts[1])
    except (ValueError, IndexError):
        return 0


def _route_sort_key(route_id: object):
    """Natural sort: numeric routes order 1,2,...,72,...,229; alpha routes stay grouped."""
    s = str(route_id)
    return (0, int(s), "") if s.isdigit() else (1, 0, s)


def _status_from_band(band: object) -> str:
    return _STATUS_MAP.get((band or "").upper(), "unknown")  # type: ignore[union-attr]


def _delay_min(avg_delay_seconds: object) -> int | None:
    if avg_delay_seconds is None:
        return None
    return round(float(avg_delay_seconds) / 60.0)  # type: ignore[arg-type]


def _split_csv(value: object) -> list[str]:
    if not value:
        return []
    return [piece.strip() for piece in str(value).split(",") if piece.strip()]


def _percentile(sorted_values: list[float], pct: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = (len(sorted_values) - 1) * pct
    lo = int(rank)
    hi = min(lo + 1, len(sorted_values) - 1)
    frac = rank - lo
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * frac


def _median_headway(minutes: list[float]) -> float | None:
    """Median gap (minutes) between successive DISTINCT departure minutes."""
    uniq = sorted(set(minutes))
    if len(uniq) < 2:
        return None
    gaps = [uniq[i] - uniq[i - 1] for i in range(1, len(uniq))]
    return round(statistics.median(gaps), 1) if gaps else None


def _infer_shift(hour: int) -> str:
    if 6 <= hour < 9:
        return "am_peak"
    if 9 <= hour < 15:
        return "midday"
    if 15 <= hour < 19:
        return "pm_peak"
    if 19 <= hour < 23:
        return "evening"
    return "night"  # {23, 0..5}


def _shift_sort_min(t: object, shift: str) -> float:
    """Order key within a shift bucket. For 'night', fold post-midnight after 23:xx
    (23:00->1380 ... 05:59->1799) so the sampled gaps describe contiguous service."""
    m = _gtfs_min(t) % 1440
    if shift == "night" and m < 6 * 60:
        return m + 1440
    return m


def _severity_code(severity: object) -> str:
    return _SEVERITY_MAP.get((severity or "").strip().upper(), "watch")  # type: ignore[union-attr]


def _sample_times(raw_sorted: list[str], cap: int = _STOP_TIMES_CAP) -> list[str]:
    """Even-sample raw chronologically-sorted GTFS times across the day to <= cap,
    always keeping the last departure, then render wall-clock for display."""
    distinct: list[str] = []
    for t in raw_sorted:  # already chronological (raw text sort == chronological)
        if not distinct or distinct[-1] != t:
            distinct.append(t)
    if len(distinct) <= cap:
        picked = distinct
    else:
        step = len(distinct) / cap
        picked = [distinct[int(i * step)] for i in range(cap)]
        picked[-1] = distinct[-1]
    return [_wallclock(t) or "" for t in picked]


def _otp_pct(on_time: object, known: object) -> int | None:
    """round(100 * on_time / known) as int; None when numerator or denominator is unknown."""
    if on_time is None or not known:
        return None
    known_obs = float(known)  # type: ignore[arg-type]
    if known_obs <= 0:
        return None
    return round(100.0 * float(on_time) / known_obs)


def _otp_pct_severe_proxy(observation_count: object, severe: object) -> int | None:
    """Stop OTP proxy: per-stop delay observations not severe over observations."""
    if not observation_count:
        return None
    obs = float(observation_count)  # type: ignore[arg-type]
    if obs <= 0:
        return None
    return round(100.0 * (obs - float(severe or 0)) / obs)


def _avg_delay_min(avg_delay_seconds: object) -> float | None:
    if avg_delay_seconds is None:
        return None
    return round(float(avg_delay_seconds) / 60.0, 1)  # type: ignore[arg-type]


def _severe_pct(observation_count: object, severe: object) -> float | None:
    if not observation_count:
        return None
    obs = float(observation_count)  # type: ignore[arg-type]
    if obs <= 0:
        return None
    return round(100.0 * float(severe or 0) / obs, 1)


def _public_impact_score(value: object, *, cap: float = 9999.9999) -> float | None:
    """Guard the rider_impact_score before it reaches public receipts (slice-9.1.1t).

    The mart clamps the raw score with LEAST(raw, 9999.9999) (gold/rollups.py), so an
    at-cap value means the true magnitude overflowed and is unknown — publish honest
    NULL, never the sentinel. Negative values (impossible by construction; defensive)
    are also nulled. Receipt.rider_impact_score is already float | None.
    """
    if value is None:
        return None
    v = float(value)  # type: ignore[arg-type]
    if v >= cap or v < 0:
        return None
    return v


def _iso_date(d: object) -> str:
    """Render a date (or datetime/date-like) as 'YYYY-MM-DD'. Strings pass through."""
    if isinstance(d, str):
        return d[:10]
    return d.isoformat()[:10]  # type: ignore[union-attr]


# ---------------------------------------------------------------------------
# Representative service date resolution (deterministic per dataset_version)
# ---------------------------------------------------------------------------

_CURRENT_DATASET_VERSION_SQL = text(
    """
    SELECT dataset_version_id
    FROM core.dataset_versions
    WHERE provider_id = :provider_id
      AND dataset_kind = 'static_schedule'
      AND is_current = true
    ORDER BY loaded_at_utc DESC
    LIMIT 1
    """
)

# Pick the busiest weekday and weekend DATE within the dataset's most recent
# 6 weeks (deterministic; avoids CURRENT_DATE so the static file is reproducible).
_REP_DATES_SQL = text(
    """
    WITH bounds AS (
        SELECT max(end_date) AS hi, (max(end_date) - 42) AS lo
        FROM silver.calendar
        WHERE provider_id = :provider_id AND dataset_version_id = :dataset_version_id
    ),
    days AS (
        SELECT gs::date AS d, extract(isodow FROM gs)::int AS dow
        FROM bounds, generate_series(bounds.lo, bounds.hi, interval '1 day') AS gs
    ),
    active AS (
        SELECT d.d, d.dow, c.service_id
        FROM days d
        JOIN silver.calendar c
            ON c.provider_id = :provider_id AND c.dataset_version_id = :dataset_version_id
           AND d.d BETWEEN c.start_date AND c.end_date
           AND CASE d.dow
                 WHEN 1 THEN c.monday WHEN 2 THEN c.tuesday WHEN 3 THEN c.wednesday
                 WHEN 4 THEN c.thursday WHEN 5 THEN c.friday WHEN 6 THEN c.saturday
                 ELSE c.sunday END
    ),
    tally AS (
        SELECT a.d, a.dow, count(t.trip_id) AS n
        FROM active a
        JOIN silver.trips t
            ON t.provider_id = :provider_id AND t.dataset_version_id = :dataset_version_id
           AND t.service_id = a.service_id
        GROUP BY a.d, a.dow
    )
    SELECT
        (SELECT d FROM tally WHERE dow <= 5 ORDER BY n DESC, d LIMIT 1) AS weekday_date,
        (SELECT d FROM tally WHERE dow >= 6 ORDER BY n DESC, d LIMIT 1) AS weekend_date
    """
)

_ACTIVE_SERVICES_SQL = text(
    """
    SELECT c.service_id
    FROM silver.calendar c
    WHERE c.provider_id = :provider_id AND c.dataset_version_id = :dataset_version_id
      AND :repdate BETWEEN c.start_date AND c.end_date
      AND CASE extract(isodow FROM :repdate)
            WHEN 1 THEN c.monday WHEN 2 THEN c.tuesday WHEN 3 THEN c.wednesday
            WHEN 4 THEN c.thursday WHEN 5 THEN c.friday WHEN 6 THEN c.saturday
            ELSE c.sunday END
    """
)

# First-stop departures for a route on the representative service days, tagged
# weekday/weekend and de-duplicated to distinct (direction, daytype, time).
# Shared by build_route (static) and _scheduled_headway_by_shift (historic).
_ROUTE_SCHEDULE_SQL = text(
    """
    SELECT DISTINCT
        t.direction_id,
        (t.service_id = ANY(:weekday_services)) AS is_weekday,
        st.departure_time
    FROM silver.trips AS t
    JOIN silver.stop_times AS st
        ON  st.trip_id           = t.trip_id
        AND st.dataset_version_id = t.dataset_version_id
        AND st.provider_id       = t.provider_id
    WHERE t.provider_id        = :provider_id
      AND t.dataset_version_id = :dataset_version_id
      AND t.route_id           = :route_id
      AND st.stop_sequence     = 1
      AND st.departure_time IS NOT NULL
      AND (t.service_id = ANY(:weekday_services) OR t.service_id = ANY(:weekend_services))
    """
)


def _representative_services(
    conn: Connection, *, provider_id: str, dataset_version_id: int
) -> tuple[list[str], list[str]]:
    """Return (weekday_service_ids, weekend_service_ids) active on the busiest
    weekday / weekend date of the dataset's current window."""
    params = {"provider_id": provider_id, "dataset_version_id": dataset_version_id}
    rep = conn.execute(_REP_DATES_SQL, params).mappings().fetchone()
    if rep is None:
        return [], []
    weekday: list[str] = []
    weekend: list[str] = []
    if rep["weekday_date"] is not None:
        weekday = [row[0] for row in conn.execute(_ACTIVE_SERVICES_SQL, {**params, "repdate": rep["weekday_date"]})]
    if rep["weekend_date"] is not None:
        weekend = [row[0] for row in conn.execute(_ACTIVE_SERVICES_SQL, {**params, "repdate": rep["weekend_date"]})]
    return weekday, weekend


# Display-name lookups resolve current-dim-first (pri 0) and fall back to the
# newest gold.dim_*_history row, so ids retired/renamed by a GTFS drop keep
# their last known name on historic surfaces (slice-9.1.1u). These live here
# (not in :mod:`historic`) because the shared :func:`_entity_name_maps` resolver
# needs them, and ``_helpers`` is the leaf of the dependency graph; the historic
# tier re-imports them from here.
_STOP_NAMES_SQL = text(
    """
    SELECT DISTINCT ON (u.stop_id) u.stop_id, u.stop_name
    FROM (
        SELECT stop_id, stop_name, 0 AS pri, NULL::timestamptz AS vf
        FROM gold.dim_stop
        WHERE provider_id = :provider_id
        UNION ALL
        SELECT stop_id, stop_name, 1 AS pri, valid_from_utc AS vf
        FROM gold.dim_stop_history
        WHERE provider_id = :provider_id
    ) AS u
    ORDER BY u.stop_id, u.pri, u.vf DESC NULLS LAST
    """
)

_ROUTE_NAMES_SQL = text(
    """
    SELECT DISTINCT ON (u.route_id) u.route_id, u.route_name
    FROM (
        SELECT route_id,
               COALESCE(route_long_name, route_short_name) AS route_name,
               0 AS pri,
               NULL::timestamptz AS vf
        FROM gold.dim_route
        WHERE provider_id = :provider_id
        UNION ALL
        SELECT route_id,
               COALESCE(route_long_name, route_short_name) AS route_name,
               1 AS pri,
               valid_from_utc AS vf
        FROM gold.dim_route_history
        WHERE provider_id = :provider_id
    ) AS u
    ORDER BY u.route_id, u.pri, u.vf DESC NULLS LAST
    """
)


def _entity_name_maps(
    conn: Connection, *, provider_id: str
) -> tuple[dict[str, str], dict[str, str]]:
    """(route_id -> name, stop_id -> name) — current dim first, history fallback."""
    params = {"provider_id": provider_id}
    route_names = {
        str(r["route_id"]): r["route_name"]
        for r in conn.execute(_ROUTE_NAMES_SQL, params).mappings()
    }
    stop_names = {
        str(r["stop_id"]): r["stop_name"]
        for r in conn.execute(_STOP_NAMES_SQL, params).mappings()
    }
    return route_names, stop_names


def _build_habits_matrix(
    rows: "Iterable[Mapping[str, object]]", *, scale: str = "repeat_problem_relative"
) -> "RouteHabits":
    """7x24 per-route problem heatmap (rows isodow 1..7, cols hour 0..23).

    Each observed (dow, hour) cell is normalized to its fraction of the route's
    worst cell, so values land in [0, 1] (1.0 = this route's worst hour). This
    keeps the mart's Numeric(8,4) storage cap (9999.9999) — an overflow guard,
    not a real magnitude — from leaking onto the public matrix (slice-9.1.1x):
    an at-cap cell is simply the route max and normalizes to 1.0. Cells the route
    never ran (no row) are null (no service / no data), kept distinct from an
    observed-but-calm 0.0. A route whose every observed cell is 0.0 normalizes to
    0.0 without dividing by zero.
    """
    from transit_ops.snapshots.contract import RouteHabits

    raw: list[list[float | None]] = [[None] * 24 for _ in range(7)]
    for r in rows:
        dow = r["day_of_week_iso"]
        hour = r["hour_of_day_local"]
        if dow is None or hour is None:
            continue
        di, hi = int(dow) - 1, int(hour)  # type: ignore[arg-type]
        if 0 <= di < 7 and 0 <= hi < 24:
            # A present row with a NULL score is "observed but unknown" — keep it
            # null (no data), never coerce to a false observed-calm 0.0
            # (slice-9.1.1x honesty rule). A genuine 0.0 score stays 0.0.
            score = r["repeat_problem_score"]
            raw[di][hi] = None if score is None else float(score)  # type: ignore[arg-type]

    observed = [v for row in raw for v in row if v is not None]
    route_max = max(observed) if observed else 0.0
    matrix: list[list[float | None]] = [
        [
            None
            if v is None
            else (round(v / route_max, 4) if route_max > 0 else 0.0)
            for v in row
        ]
        for row in raw
    ]
    return RouteHabits(scale=scale, matrix=matrix)


def _scheduled_headway_by_shift(
    conn: Connection, *, provider_id: str, route_id: str
) -> dict[str, float]:
    """Per-shift scheduled headway (minutes) for a route on the representative
    weekday — mirrors the scheduled-headway computation in :func:`build_route`
    (busiest-direction first-stop departures, bucketed by ``_infer_shift``)."""
    from collections import defaultdict

    dv_row = (
        conn.execute(_CURRENT_DATASET_VERSION_SQL, {"provider_id": provider_id})
        .mappings()
        .fetchone()
    )
    if dv_row is None:
        return {}
    dv_id = dv_row["dataset_version_id"]
    weekday_services, weekend_services = _representative_services(
        conn, provider_id=provider_id, dataset_version_id=dv_id
    )

    sched_rows = conn.execute(
        _ROUTE_SCHEDULE_SQL,
        {
            "provider_id": provider_id,
            "dataset_version_id": dv_id,
            "route_id": route_id,
            "weekday_services": weekday_services or [""],
            "weekend_services": weekend_services or [""],
        },
    ).mappings()

    wd_by_dir: dict[int, list[str]] = defaultdict(list)
    for r in sched_rows:
        if r["is_weekday"]:
            wd_by_dir[int(r["direction_id"] or 0)].append(str(r["departure_time"]))
    if not wd_by_dir:
        return {}

    # busiest direction is representative of the route's frequency (== build_route)
    best_dir = max(wd_by_dir, key=lambda d: len(set(wd_by_dir[d])))
    shift_times: dict[str, list[str]] = defaultdict(list)
    for t in set(wd_by_dir[best_dir]):
        shift_times[_infer_shift((_gtfs_min(t) // 60) % 24)].append(t)

    out: dict[str, float] = {}
    for shift, bucket in shift_times.items():
        hw = _median_headway([_shift_sort_min(t, shift) for t in bucket])
        if hw is not None:
            out[shift] = hw
    return out
