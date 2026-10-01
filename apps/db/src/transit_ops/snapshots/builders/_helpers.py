from __future__ import annotations

import statistics
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING

# Keep compatibility exports while gold.reader owns rate and confidence calculations.
from transit_ops.gold.reader import (
    MIN_N_RATE,  # noqa: F401 - re-exported
    WILSON_Z,  # noqa: F401 - re-exported
    infer_shift,
    round_half_away,
)
from transit_ops.gold.reader import avg_delay_min as _avg_delay_min  # noqa: F401 - re-exported
from transit_ops.gold.reader import otp_pct as _otp_pct  # noqa: F401 - re-exported
from transit_ops.gold.reader import (
    otp_pct_severe_proxy as _otp_pct_severe_proxy,  # noqa: F401 - re-exported
)
from transit_ops.gold.reader import severe_pct as _severe_pct  # noqa: F401 - re-exported
from transit_ops.gold.reader import wilson_bounds as _wilson_bounds  # noqa: F401 - re-exported
from transit_ops.gold.reader import wilson_hi as _wilson_hi  # noqa: F401 - re-exported
from transit_ops.gold.reader import wilson_lo as _wilson_lo  # noqa: F401 - re-exported
from transit_ops.sql_registry import named_query

if TYPE_CHECKING:  # pragma: no cover - typing only
    from collections.abc import Iterable, Mapping

    from sqlalchemy.engine import Connection

    from transit_ops.snapshots.contract import RouteHabits


# Status CASE text must match migration 0020.
STATUS_BAND_CASE_SQL = """
        CASE
            WHEN {col} IS NULL THEN 'Inconnu / Unknown'
            WHEN {col} < -60  THEN 'En avance / Early'
            WHEN {col} <  60  THEN 'À l''heure / On time'
            WHEN {col} < 300  THEN 'En retard / Late'
            ELSE                   'Critique / Severe'
        END"""

_STATUS_MAP: dict[str, str] = {
    "EN AVANCE / EARLY": "early",
    "À L'HEURE / ON TIME": "on_time",
    "A L'HEURE / ON TIME": "on_time",
    "EN RETARD / LATE": "late",
    "CRITIQUE / SEVERE": "severe",
    "INCONNU / UNKNOWN": "unknown",
}

# GTFS-RT OccupancyStatus numeric codes.
_OCCUPANCY_MAP: dict[int, str] = {
    0: "empty",
    1: "many_seats",
    2: "few_seats",
    3: "standing",
    4: "standing",# CRUSHED_STANDING_ROOM_ONLY
    5: "full",
    # NOT_ACCEPTING / NO_DATA / NOT_BOARDABLE map to None.
}

_SCHEDULE_RELATIONSHIP_MAP: dict[int, str] = {
    0: "scheduled",
    1: "added",
    2: "unscheduled",
    3: "canceled",
    5: "duplicate",
    6: "deleted",
}

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

# A boardable stop has location_type 0 or NULL.
_BOARDABLE_STOP = "(location_type = 0 OR location_type IS NULL)"

_STOP_TIMES_CAP = 12


def _round5(x: object) -> float | None:
    return float(round_half_away(float(x), 5)) if x is not None else None  # type: ignore[arg-type]


def _opt_int(x: object) -> int | None:
    return int(x) if x is not None else None  # type: ignore[arg-type]


def _opt_float(x: object) -> float | None:
    return float(x) if x is not None else None  # type: ignore[arg-type]


def _sane_en(value: str | None) -> str | None:
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
    if speed_ms is None:
        return None
    return int(round_half_away(float(speed_ms) * 3.6, 0))  # type: ignore[arg-type]


def _iso(v: object) -> str:
    if isinstance(v, str):
        return v
    dt = v if v.tzinfo is not None else v.replace(tzinfo=UTC)  # type: ignore[union-attr]
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _opt_iso(v: object) -> str | None:
    return None if v is None else _iso(v)


def _coerce_ts(value: object) -> object:
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
    return value


def _alert_active_periods(raw: object, scalar_start: object, scalar_end: object):  # noqa: ANN201
    from transit_ops.snapshots.contract import AlertActivePeriod

    periods: list = []
    if isinstance(raw, list) and raw:
        for item in raw:
            if not isinstance(item, dict):
                continue
            periods.append(
                AlertActivePeriod(
                    start_utc=_opt_iso(_coerce_ts(item.get("start_utc"))),
                    end_utc=_opt_iso(_coerce_ts(item.get("end_utc"))),
                )
            )
        if periods:
            return periods
    if scalar_start is not None or scalar_end is not None:
        return [AlertActivePeriod(start_utc=_opt_iso(scalar_start), end_utc=_opt_iso(scalar_end))]
    return []


def _wallclock(t: object) -> str | None:
    if not t:
        return None
    parts = str(t).split(":")
    try:
        h, m = int(parts[0]) % 24, int(parts[1])
    except (ValueError, IndexError):
        return str(t)[:5]
    return f"{h:02d}:{m:02d}"


def _gtfs_min(t: object) -> int:
    parts = str(t).split(":")
    try:
        return int(parts[0]) * 60 + int(parts[1])
    except (ValueError, IndexError):
        return 0


def _route_sort_key(route_id: object):
    s = str(route_id)
    return (0, int(s), "") if s.isdigit() else (1, 0, s)


def _status_from_band(band: object) -> str:
    return _STATUS_MAP.get((band or "").upper(), "unknown")  # type: ignore[union-attr]


def _delay_min(avg_delay_seconds: object) -> int | None:
    if avg_delay_seconds is None:
        return None
    return int(round_half_away(float(avg_delay_seconds) / 60.0, 0))  # type: ignore[arg-type]


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
    uniq = sorted(set(minutes))
    if len(uniq) < 2:
        return None
    gaps = [uniq[i] - uniq[i - 1] for i in range(1, len(uniq))]
    return float(round_half_away(statistics.median(gaps), 1)) if gaps else None


_infer_shift = infer_shift


def _shift_sort_min(t: object, shift: str) -> float:
    m = _gtfs_min(t) % 1440
    if shift == "night" and m < 6 * 60:
        return m + 1440
    return m


def _severity_code(severity: object) -> str:
    return _SEVERITY_MAP.get((severity or "").strip().upper(), "watch")  # type: ignore[union-attr]


def _sample_times(raw_sorted: list[str], cap: int = _STOP_TIMES_CAP) -> list[str]:
    distinct: list[str] = []
    for t in raw_sorted:
        if not distinct or distinct[-1] != t:
            distinct.append(t)
    if len(distinct) <= cap:
        picked = distinct
    else:
        step = len(distinct) / cap
        picked = [distinct[int(i * step)] for i in range(cap)]
        picked[-1] = distinct[-1]
    return [_wallclock(t) or "" for t in picked]


def _public_impact_score(value: object, *, cap: float = 9999.9999) -> float | None:
    if value is None:
        return None
    v = float(value)  # type: ignore[arg-type]
    if v >= cap or v < 0:
        return None
    return v


def _iso_date(d: object) -> str:
    if isinstance(d, str):
        return d[:10]
    return d.isoformat()[:10]  # type: ignore[union-attr]


_CURRENT_DATASET_VERSION_SQL = named_query(
    "static.dataset_version",
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

# Select deterministic busiest dates including calendar_dates additions and removals.
_REP_DATES_SQL = named_query(
    "static.rep_dates",
    """
    WITH bounds AS (
        SELECT hi, (hi - 42) AS lo
        FROM (
            SELECT COALESCE(
                (SELECT max(end_date) FROM silver.calendar
                 WHERE provider_id = :provider_id
                   AND dataset_version_id = :dataset_version_id),
                (SELECT max(service_date) FROM silver.calendar_dates
                 WHERE provider_id = :provider_id
                   AND dataset_version_id = :dataset_version_id)
            ) AS hi
        ) b
    ),
    days AS (
        SELECT gs::date AS d, extract(isodow FROM gs)::int AS dow
        FROM bounds, generate_series(bounds.lo, bounds.hi, interval '1 day') AS gs
        WHERE bounds.hi IS NOT NULL
    ),
    active AS (
        -- service active on d via weekly pattern minus type-2 removals ...
        SELECT d.d, d.dow, c.service_id
        FROM days d
        JOIN silver.calendar c
            ON c.provider_id = :provider_id AND c.dataset_version_id = :dataset_version_id
           AND d.d BETWEEN c.start_date AND c.end_date
           AND CASE d.dow
                 WHEN 1 THEN c.monday WHEN 2 THEN c.tuesday WHEN 3 THEN c.wednesday
                 WHEN 4 THEN c.thursday WHEN 5 THEN c.friday WHEN 6 THEN c.saturday
                 ELSE c.sunday END
        WHERE NOT EXISTS (
            SELECT 1 FROM silver.calendar_dates cd
            WHERE cd.provider_id = :provider_id
              AND cd.dataset_version_id = :dataset_version_id
              AND cd.service_id = c.service_id
              AND cd.service_date = d.d
              AND cd.exception_type = 2
        )
        UNION
        -- ... OR added via a type-1 exception (fires with zero calendar rows).
        SELECT d.d, d.dow, cd.service_id
        FROM days d
        JOIN silver.calendar_dates cd
            ON cd.provider_id = :provider_id AND cd.dataset_version_id = :dataset_version_id
           AND cd.service_date = d.d
           AND cd.exception_type = 1
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

_ACTIVE_SERVICES_SQL = named_query(
    "static.active_services",
    """
    SELECT c.service_id
    FROM silver.calendar c
    WHERE c.provider_id = :provider_id AND c.dataset_version_id = :dataset_version_id
      AND :repdate BETWEEN c.start_date AND c.end_date
      AND CASE extract(isodow FROM CAST(:repdate AS date))
            WHEN 1 THEN c.monday WHEN 2 THEN c.tuesday WHEN 3 THEN c.wednesday
            WHEN 4 THEN c.thursday WHEN 5 THEN c.friday WHEN 6 THEN c.saturday
            ELSE c.sunday END
      AND NOT EXISTS (
          SELECT 1 FROM silver.calendar_dates cd
          WHERE cd.provider_id = :provider_id
            AND cd.dataset_version_id = :dataset_version_id
            AND cd.service_id = c.service_id
            AND cd.service_date = CAST(:repdate AS date)
            AND cd.exception_type = 2
      )
    UNION
    SELECT cd.service_id
    FROM silver.calendar_dates cd
    WHERE cd.provider_id = :provider_id AND cd.dataset_version_id = :dataset_version_id
      AND cd.service_date = CAST(:repdate AS date)
      AND cd.exception_type = 1
    """
)

_ROUTE_SCHEDULE_SQL = named_query(
    "static.route_schedule",
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

_ALL_ROUTE_SCHEDULES_SQL = named_query(
    "static.all_route_schedules",
    """
    SELECT DISTINCT
        t.route_id,
        t.direction_id,
        (t.service_id = ANY(:weekday_services)) AS is_weekday,
        st.departure_time
    FROM silver.trips AS t
    JOIN silver.stop_times AS st
        ON  st.trip_id            = t.trip_id
        AND st.dataset_version_id = t.dataset_version_id
        AND st.provider_id        = t.provider_id
    WHERE t.provider_id        = :provider_id
      AND t.dataset_version_id = :dataset_version_id
      AND st.stop_sequence     = 1
      AND st.departure_time IS NOT NULL
      AND (t.service_id = ANY(:weekday_services) OR t.service_id = ANY(:weekend_services))
    """,
)


@dataclass(frozen=True)
class StaticScheduleContext:
    """Dataset and representative service IDs shared across one static publish."""

    dataset_version_id: int | None
    weekday_services: tuple[str, ...] = ()
    weekend_services: tuple[str, ...] = ()


def _representative_services(
    conn: Connection, *, provider_id: str, dataset_version_id: int
) -> tuple[list[str], list[str]]:
    params = {"provider_id": provider_id, "dataset_version_id": dataset_version_id}
    rep = conn.execute(_REP_DATES_SQL, params).mappings().fetchone()
    if rep is None:
        return [], []
    weekday: list[str] = []
    weekend: list[str] = []
    if rep["weekday_date"] is not None:
        weekday = [
            row[0]
            for row in conn.execute(
                _ACTIVE_SERVICES_SQL,
                {**params, "repdate": rep["weekday_date"]},
            )
        ]
    if rep["weekend_date"] is not None:
        weekend = [
            row[0]
            for row in conn.execute(
                _ACTIVE_SERVICES_SQL,
                {**params, "repdate": rep["weekend_date"]},
            )
        ]
    return weekday, weekend


def _static_schedule_context(
    conn: Connection, *, provider_id: str
) -> StaticScheduleContext:

    dv_row = (
        conn.execute(_CURRENT_DATASET_VERSION_SQL, {"provider_id": provider_id})
        .mappings()
        .fetchone()
    )
    if dv_row is None:
        return StaticScheduleContext(dataset_version_id=None)

    dataset_version_id = int(dv_row["dataset_version_id"])
    weekday_services, weekend_services = _representative_services(
        conn,
        provider_id=provider_id,
        dataset_version_id=dataset_version_id,
    )
    return StaticScheduleContext(
        dataset_version_id=dataset_version_id,
        weekday_services=tuple(weekday_services),
        weekend_services=tuple(weekend_services),
    )


# Resolve current dimension names first, then the newest historical name.
_STOP_NAMES_SQL = named_query(
    "static.stop_names",
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

_ROUTE_NAMES_SQL = named_query(
    "static.route_names",
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
    rows: Iterable[Mapping[str, object]], *, scale: str = "repeat_problem_relative"
) -> RouteHabits:
    from transit_ops.snapshots.contract import RouteHabits

    raw: list[list[float | None]] = [[None] * 24 for _ in range(7)]
    for r in rows:
        dow = r["day_of_week_iso"]
        hour = r["hour_of_day_local"]
        if dow is None or hour is None:
            continue
        di, hi = int(dow) - 1, int(hour)  # type: ignore[arg-type]
        if 0 <= di < 7 and 0 <= hi < 24:
            # NULL scores remain unknown; genuine zero scores remain zero.
            score = r["repeat_problem_score"]
            raw[di][hi] = None if score is None else float(score)  # type: ignore[arg-type]

    observed = [v for row in raw for v in row if v is not None]
    route_max = max(observed) if observed else 0.0
    matrix: list[list[float | None]] = [
        [
            None
            if v is None
            else (float(round_half_away(v / route_max, 4)) if route_max > 0 else 0.0)
            for v in row
        ]
        for row in raw
    ]
    return RouteHabits(scale=scale, matrix=matrix)


def _scheduled_headway_by_shift(
    conn: Connection, *, provider_id: str, route_id: str
) -> dict[str, float]:
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
