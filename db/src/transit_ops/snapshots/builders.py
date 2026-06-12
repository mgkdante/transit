"""Live- and static-tier builders: gold/silver -> /v1 snapshot pydantic models.

Each ``build_*`` function runs one or more SELECTs and maps the rows onto the
contract models in :mod:`transit_ops.snapshots.contract`.  SQL is written
against column names verified by reading the view-defining Alembic migrations
AND by querying production directly.

LIVE sources:
    * ``gold.current_vehicle_map_with_status`` (0020) — vehicle positions +
      bilingual ``status_band`` + ``trip_avg_delay_seconds``.  No bearing/speed/
      occupancy, so we LEFT JOIN ``gold.latest_vehicle_snapshot`` (0006).
      NOTE: ``latest_vehicle_snapshot.speed`` is GTFS-RT meters/second.
    * ``gold.current_trip_delay_computed`` (0018) — per-trip ``avg_delay_seconds``.
    * ``gold.current_stop_next_departures`` (0027) — per-stop predicted departures
      (``predicted_departure_utc`` + ``stop_sequence``).
    * ``gold.current_i3_alerts`` (0024) — alerts; STM leaves ``alert_id`` and
      ``severity`` NULL, so the id is content-hashed and severity maps to 'watch'.
    * ``gold.non_responding_current`` (0027), ``gold.feed_freshness_current`` (0013),
      ``gold.dim_provider`` (0013), ``core.dataset_versions`` (0001).

STATIC sources: ``gold.dim_route``/``dim_stop``/``map_stops``, ``gold.map_route_lines``
(``geojson`` is jsonb), ``silver.trips``/``stop_times``/``calendar``, ``gold.report_labels``.
Static schedules are computed for a deterministic *representative service date*
(busiest weekday / weekend in the dataset's current window) so headways and stop
times reflect one coherent day rather than the union of all 144 service calendars.

Status-band thresholds mirror migration 0020; network OTP counts on_time+late
as the unified [-60s,+300s) band over vehicles with known status.
"""

from __future__ import annotations

import hashlib
import statistics
from datetime import UTC
from typing import TYPE_CHECKING

from sqlalchemy import text

from transit_ops.snapshots.contract import (
    Alert,
    AlertsFile,
    Manifest,
    ManifestFiles,
    ManifestLiveFiles,
    NetworkFile,
    OccupancyMix,
    StatusDist,
    StopEta,
    Trip,
    TripsFile,
    Vehicle,
    VehiclesFile,
)

if TYPE_CHECKING:  # pragma: no cover - typing only
    from sqlalchemy.engine import Connection

# --------------------------------------------------------------------------
# Value-domain mappings
# --------------------------------------------------------------------------

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


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------


def _round5(x: object) -> float | None:
    return round(float(x), 5) if x is not None else None  # type: ignore[arg-type]


def _opt_int(x: object) -> int | None:
    return int(x) if x is not None else None  # type: ignore[arg-type]


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


def _status_from_delay_seconds(avg_delay_seconds: object) -> str:
    """Bucket an average delay (SECONDS) into a Status code (mirrors migration 0020)."""
    if avg_delay_seconds is None:
        return "unknown"
    secs = float(avg_delay_seconds)  # type: ignore[arg-type]
    if secs < -60:
        return "early"
    if secs < 60:
        return "on_time"
    if secs < 300:
        return "late"
    return "severe"


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


# --------------------------------------------------------------------------
# build_vehicles
# --------------------------------------------------------------------------

_VEHICLES_SQL = text(
    """
    SELECT cvm.vehicle_id                AS id,
           cvm.route_id                  AS route,
           cvm.trip_id                   AS trip,
           cvm.latitude                  AS lat,
           cvm.longitude                 AS lon,
           lvs.bearing                   AS bearing,
           lvs.speed                     AS speed_ms,
           cvm.status_band               AS status_band,
           lvs.occupancy_status          AS occupancy_status,
           cvm.stop_id                   AS next_stop,
           cvm.captured_at_utc           AS updated_utc,
           cvm.trip_avg_delay_seconds    AS delay_seconds
    FROM gold.current_vehicle_map_with_status AS cvm
    LEFT JOIN gold.latest_vehicle_snapshot AS lvs
        ON  lvs.provider_id          = cvm.provider_id
        AND lvs.realtime_snapshot_id = cvm.realtime_snapshot_id
        AND lvs.entity_index         = cvm.entity_index
    WHERE cvm.provider_id = :provider_id
    """
)


def build_vehicles(
    conn: Connection,
    *,
    provider_id: str = "stm",
    generated_utc: str,
) -> VehiclesFile:
    """Build the live vehicles file from gold.current_vehicle_map_with_status."""
    vehicles: list[Vehicle] = []
    for r in conn.execute(_VEHICLES_SQL, {"provider_id": provider_id}).mappings():
        occ_raw = r["occupancy_status"]
        vehicles.append(
            Vehicle(
                id=str(r["id"]),
                route=r["route"],
                trip=r["trip"],
                lat=_round5(r["lat"]),
                lon=_round5(r["lon"]),
                bearing=_opt_int(r["bearing"]),
                speed_kmh=_kmh(r["speed_ms"]),
                status=_status_from_band(r["status_band"]),
                occupancy=(_OCCUPANCY_MAP.get(int(occ_raw)) if occ_raw is not None else None),
                next_stop=r["next_stop"],
                updated_utc=_iso(r["updated_utc"]),
                delay_min=_delay_min(r["delay_seconds"]),
            )
        )
    return VehiclesFile(generated_utc=generated_utc, vehicles=vehicles)


# --------------------------------------------------------------------------
# build_trips
# --------------------------------------------------------------------------

_TRIP_DELAY_SQL = text(
    """
    SELECT trip_id, route_id, avg_delay_seconds
    FROM gold.current_trip_delay_computed
    WHERE provider_id = :provider_id
    """
)

# Order by predicted ETA (primary) + stop_sequence (deterministic tiebreak) so
# the per-trip stops list is chronological.  departure_rank is partitioned by
# STOP, not trip, so it must NOT be used to order a trip's stops.
_TRIP_DEPARTURES_SQL = text(
    """
    SELECT trip_id, route_id, stop_id, predicted_departure_utc, stop_sequence
    FROM gold.current_stop_next_departures
    WHERE provider_id = :provider_id
    ORDER BY trip_id, predicted_departure_utc, stop_sequence
    """
)


def build_trips(conn: Connection, *, provider_id: str = "stm") -> TripsFile:
    """Build the live trips file: per-trip status + delay + chronological next-stop ETAs."""
    trips: dict[str, Trip] = {}

    for r in conn.execute(_TRIP_DELAY_SQL, {"provider_id": provider_id}).mappings():
        trip_id = str(r["trip_id"])
        trips[trip_id] = Trip(
            route=r["route_id"],
            status=_status_from_delay_seconds(r["avg_delay_seconds"]),
            delay_min=_delay_min(r["avg_delay_seconds"]),
            stops=[],
        )

    for r in conn.execute(_TRIP_DEPARTURES_SQL, {"provider_id": provider_id}).mappings():
        trip_id = str(r["trip_id"])
        trip = trips.get(trip_id)
        if trip is None:
            # in-progress trip with predictions but no computed delay row; the
            # departures view carries route_id on every row, so don't lose it.
            trip = Trip(route=r["route_id"], status="unknown", delay_min=None, stops=[])
            trips[trip_id] = trip
        trip.stops.append(
            StopEta(
                stop=str(r["stop_id"]),
                eta_utc=_iso(r["predicted_departure_utc"]),
                delay_min=trip.delay_min,
            )
        )

    return TripsFile(trips=trips)


# --------------------------------------------------------------------------
# build_alerts
# --------------------------------------------------------------------------

# Deterministic ORDER BY so synthesized ids and array order are stable per cycle.
_ALERTS_SQL = text(
    """
    SELECT alert_id,
           alert_header_text,
           description_text,
           severity,
           cause,
           effect,
           route_ids,
           stop_ids,
           active_period_start_utc,
           active_period_end_utc
    FROM gold.current_i3_alerts
    WHERE provider_id = :provider_id
    ORDER BY active_period_start_utc NULLS LAST, alert_header_text, description_text
    """
)


def _severity_code(severity: object) -> str:
    return _SEVERITY_MAP.get((severity or "").strip().upper(), "watch")  # type: ignore[union-attr]


def build_alerts(conn: Connection, *, provider_id: str = "stm") -> AlertsFile:
    """Build the live alerts file from gold.current_i3_alerts."""
    alerts: list[Alert] = []
    for r in conn.execute(_ALERTS_SQL, {"provider_id": provider_id}).mappings():
        # STM's i3 feed leaves alert_id NULL; synthesize a CONTENT-stable id
        # (not positional) so a diffing client can key/dedup across cycles.
        alert_id = r["alert_id"]
        if not alert_id:
            basis = "|".join(
                str(r[c] or "") for c in ("description_text", "severity", "cause", "effect")
            )
            alert_id = f"{provider_id}-alert-{hashlib.sha1(basis.encode()).hexdigest()[:12]}"
        alerts.append(
            Alert(
                id=str(alert_id),
                severity=_severity_code(r["severity"]),
                header_key=r["alert_header_text"] or "",
                routes=_split_csv(r["route_ids"]),
                stops=_split_csv(r["stop_ids"]),
                start_utc=_opt_iso(r["active_period_start_utc"]),
                end_utc=_opt_iso(r["active_period_end_utc"]),
            )
        )
    return AlertsFile(alerts=alerts)


# --------------------------------------------------------------------------
# build_network
# --------------------------------------------------------------------------

_NETWORK_VEHICLES_SQL = text(
    """
    SELECT status_band, lvs.occupancy_status AS occupancy_status
    FROM gold.current_vehicle_map_with_status AS cvm
    LEFT JOIN gold.latest_vehicle_snapshot AS lvs
        ON  lvs.provider_id          = cvm.provider_id
        AND lvs.realtime_snapshot_id = cvm.realtime_snapshot_id
        AND lvs.entity_index         = cvm.entity_index
    WHERE cvm.provider_id = :provider_id
    """
)

_NETWORK_DELAYS_SQL = text(
    """
    SELECT avg_delay_seconds
    FROM gold.current_trip_delay_computed
    WHERE provider_id = :provider_id
      AND avg_delay_seconds IS NOT NULL
    """
)

_NETWORK_NON_RESPONDING_SQL = text(
    """
    SELECT COALESCE(SUM(non_responding_count), 0) AS non_responding
    FROM gold.non_responding_current
    WHERE provider_id = :provider_id
    """
)

_NETWORK_FRESHNESS_SQL = text(
    """
    SELECT COALESCE(MAX(completed_age_seconds), 0) AS feed_freshness_s
    FROM gold.feed_freshness_current
    WHERE provider_id = :provider_id
      AND endpoint_key IN ('vehicle_positions', 'trip_updates')
    """
)


def build_network(conn: Connection, *, provider_id: str = "stm") -> NetworkFile:
    """Pre-aggregate network-health KPIs into a single NetworkFile.

    on_time_pct is the unified [-60s,+300s) OTP band (on_time+late) over
    vehicles with a KNOWN status; unknown is a coverage gap reported separately
    as coverage_pct. occupancy_mix is over vehicles that actually report an
    occupancy code, so the fractions sum to ~1.
    """
    params = {"provider_id": provider_id}

    dist = StatusDist()
    occ_counts: dict[str, int] = {k: 0 for k in ("empty", "many_seats", "few_seats", "standing", "full")}
    vehicles_in_service = 0
    for r in conn.execute(_NETWORK_VEHICLES_SQL, params).mappings():
        vehicles_in_service += 1
        code = _status_from_band(r["status_band"])
        setattr(dist, code, getattr(dist, code) + 1)
        occ_raw = r["occupancy_status"]
        if occ_raw is not None:
            occ_code = _OCCUPANCY_MAP.get(int(occ_raw))
            if occ_code is not None:
                occ_counts[occ_code] += 1

    known = vehicles_in_service - dist.unknown
    on_time_band = dist.on_time + dist.late
    on_time_pct = round(100 * on_time_band / known) if known else 0

    occ_total = sum(occ_counts.values())
    occupancy_mix = (
        OccupancyMix(**{k: v / occ_total for k, v in occ_counts.items()})
        if occ_total
        else OccupancyMix()
    )

    # coverage_pct: share of the live fleet with a KNOWN punctuality status.
    coverage_pct = (
        round(100 * known / vehicles_in_service) if vehicles_in_service else 0
    )

    delays_min = sorted(
        float(r["avg_delay_seconds"]) / 60.0
        for r in conn.execute(_NETWORK_DELAYS_SQL, params).mappings()
    )
    delay_p50_min = round(_percentile(delays_min, 0.50)) if delays_min else 0
    delay_p90_min = round(_percentile(delays_min, 0.90)) if delays_min else 0

    non_responding = int(conn.execute(_NETWORK_NON_RESPONDING_SQL, params).scalar_one() or 0)
    feed_freshness_s = int(conn.execute(_NETWORK_FRESHNESS_SQL, params).scalar_one() or 0)

    return NetworkFile(
        vehicles_in_service=vehicles_in_service,
        on_time_pct=on_time_pct,
        status_dist=dist,
        delay_p50_min=delay_p50_min,
        delay_p90_min=delay_p90_min,
        occupancy_mix=occupancy_mix,
        non_responding=non_responding,
        feed_freshness_s=feed_freshness_s,
        coverage_pct=coverage_pct,
    )


# --------------------------------------------------------------------------
# build_manifest
# --------------------------------------------------------------------------

_MANIFEST_PROVIDER_SQL = text(
    """
    SELECT provider_id, display_name, timezone, default_language, attribution_text,
           min_latitude, max_latitude, min_longitude, max_longitude
    FROM gold.dim_provider
    WHERE provider_id = :provider_id
    """
)

_MANIFEST_VERSION_SQL = text(
    """
    SELECT COALESCE(source_version, dataset_version_id::text) AS dataset_version
    FROM core.dataset_versions
    WHERE provider_id = :provider_id
      AND dataset_kind = 'static_schedule'
      AND is_current = true
    ORDER BY loaded_at_utc DESC
    LIMIT 1
    """
)


def build_manifest(
    conn: Connection,
    *,
    provider_id: str = "stm",
    generated_utc: str,
    settings: object,
) -> Manifest:
    """Assemble the manifest from provider config + current dataset version."""
    prov = conn.execute(_MANIFEST_PROVIDER_SQL, {"provider_id": provider_id}).mappings()
    prow = next(iter(prov), None) or {}

    display_name = prow.get("display_name") or provider_id
    tz = prow.get("timezone") or "America/Toronto"
    default_lang = prow.get("default_language") or "fr"
    attribution = prow.get("attribution_text") or ""

    bbox = [
        float(prow.get("min_longitude") or 0.0),
        float(prow.get("min_latitude") or 0.0),
        float(prow.get("max_longitude") or 0.0),
        float(prow.get("max_latitude") or 0.0),
    ]

    version_rows = conn.execute(_MANIFEST_VERSION_SQL, {"provider_id": provider_id}).mappings()
    vrow = next(iter(version_rows), None)
    dataset_version = (vrow["dataset_version"] if vrow else None) or "unknown"

    base_url = (getattr(settings, "SNAPSHOT_PUBLIC_BASE_URL", None) or "").rstrip("/")
    basemap = f"{base_url}/v1/{provider_id}/static/basemap.json"

    return Manifest(
        provider=provider_id,
        display_name=display_name,
        tz=tz,
        bbox=bbox,
        default_lang=default_lang,
        attribution=attribution,
        basemap=basemap,
        dataset_version=str(dataset_version),
        labels={"fr": "labels/fr.json", "en": "labels/en.json"},
        files=ManifestFiles(live=ManifestLiveFiles(generated_utc=generated_utc)),
        surfaces=list(_SURFACES),
    )


# ---------------------------------------------------------------------------
# Static labels
# ---------------------------------------------------------------------------

_STATIC_LABELS_FR: dict[str, str] = {
    "status.early": "En avance",
    "status.on_time": "À l'heure",
    "status.late": "En retard",
    "status.severe": "Critique",
    "status.unknown": "Inconnu",
    "severity.critical": "Critique",
    "severity.high": "Élevé",
    "severity.watch": "Surveillance",
    "occupancy.empty": "Vide",
    "occupancy.many_seats": "Nombreuses places",
    "occupancy.few_seats": "Quelques places",
    "occupancy.standing": "Debout seulement",
    "occupancy.full": "Complet",
}

_STATIC_LABELS_EN: dict[str, str] = {
    "status.early": "Early",
    "status.on_time": "On time",
    "status.late": "Late",
    "status.severe": "Severe",
    "status.unknown": "Unknown",
    "severity.critical": "Critical",
    "severity.high": "High",
    "severity.watch": "Watch",
    "occupancy.empty": "Empty",
    "occupancy.many_seats": "Many seats available",
    "occupancy.few_seats": "Few seats available",
    "occupancy.standing": "Standing room only",
    "occupancy.full": "Full",
}

_LABELS_SQL = text(
    """
    SELECT label_key, label_fr, label_en
    FROM gold.report_labels
    ORDER BY sort_order NULLS LAST, label_key
    """
)  # not provider-scoped


def build_labels(conn: Connection, *, lang: str = "fr") -> "LabelsFile":
    """Build labels/{lang}.json: static code translations + metric catalog labels.

    Every metric.* key is emitted in BOTH languages (with cross-language / raw-key
    fallback) so fr.json and en.json always carry an identical key set.
    """
    from transit_ops.snapshots.contract import LabelsFile

    static = _STATIC_LABELS_FR if lang == "fr" else _STATIC_LABELS_EN
    labels: dict[str, str] = dict(static)

    for r in conn.execute(_LABELS_SQL).mappings():
        key = f"metric.{r['label_key']}"
        primary = r["label_fr"] if lang == "fr" else r["label_en"]
        fallback = r["label_en"] if lang == "fr" else r["label_fr"]
        labels[key] = primary or fallback or r["label_key"]

    return LabelsFile(labels=labels)


# ---------------------------------------------------------------------------
# STATIC indexes
# ---------------------------------------------------------------------------

_ROUTES_INDEX_SQL = text(
    """
    SELECT route_id, route_short_name, route_long_name, route_color, route_type
    FROM gold.dim_route
    WHERE provider_id = :provider_id
    ORDER BY route_sort_order NULLS LAST, route_short_name
    """
)

_STOPS_INDEX_SQL = text(
    f"""
    SELECT s.stop_id, s.stop_code, s.stop_name, s.stop_lat, s.stop_lon
    FROM gold.dim_stop AS s
    WHERE s.provider_id = :provider_id
      AND {_BOARDABLE_STOP.replace("location_type", "s.location_type")}
    ORDER BY s.stop_id
    """
)


def build_routes_index(conn: Connection, *, provider_id: str = "stm") -> "RoutesIndex":
    """Build static/routes_index.json from gold.dim_route."""
    from transit_ops.snapshots.contract import RouteIndexEntry, RoutesIndex

    routes = []
    for r in conn.execute(_ROUTES_INDEX_SQL, {"provider_id": provider_id}).mappings():
        routes.append(
            RouteIndexEntry(
                id=str(r["route_id"]),
                short=str(r["route_short_name"] or r["route_id"]),
                long=r["route_long_name"],
                color=r["route_color"],
                # preserve legitimate GTFS route_type 0 (tram); only NULL -> bus(3)
                type=int(r["route_type"]) if r["route_type"] is not None else 3,
            )
        )
    routes.sort(key=lambda e: _route_sort_key(e.id))
    return RoutesIndex(routes=routes)


def build_stops_index(conn: Connection, *, provider_id: str = "stm") -> "StopsIndex":
    """Build static/stops_index.json from gold.dim_stop."""
    from transit_ops.snapshots.contract import StopIndexEntry, StopsIndex

    stops = []
    for r in conn.execute(_STOPS_INDEX_SQL, {"provider_id": provider_id}).mappings():
        lat, lon = r["stop_lat"], r["stop_lon"]
        if lat is None or lon is None:
            continue
        stops.append(
            StopIndexEntry(
                id=str(r["stop_id"]),
                code=r["stop_code"],
                name=str(r["stop_name"] or r["stop_id"]),
                lat=_round5(float(lat)),
                lon=_round5(float(lon)),
            )
        )
    return StopsIndex(stops=stops)


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


# ---------------------------------------------------------------------------
# STATIC route file
# ---------------------------------------------------------------------------

_ROUTE_SHAPES_SQL = text(
    """
    SELECT mrl.shape_id, mrl.geojson, t.direction_id, t.trip_headsign,
           count(*) AS trip_count
    FROM gold.map_route_lines AS mrl
    JOIN silver.trips AS t
        ON  t.provider_id        = mrl.provider_id
        AND t.dataset_version_id = mrl.dataset_version_id
        AND t.shape_id           = mrl.shape_id
        AND t.route_id           = mrl.route_id
    WHERE mrl.provider_id        = :provider_id
      AND mrl.dataset_version_id = :dataset_version_id
      AND mrl.route_id           = :route_id
    GROUP BY mrl.shape_id, mrl.geojson, t.direction_id, t.trip_headsign
    ORDER BY t.direction_id, count(*) DESC, mrl.shape_id
    """
)

_ROUTE_STOPS_SQL = text(
    """
    SELECT DISTINCT ON (st.stop_sequence)
        st.stop_sequence, st.stop_id, ds.stop_name
    FROM silver.trips AS t
    JOIN silver.stop_times AS st
        ON  st.trip_id           = t.trip_id
        AND st.dataset_version_id = t.dataset_version_id
        AND st.provider_id       = t.provider_id
    LEFT JOIN gold.dim_stop AS ds
        ON  ds.stop_id           = st.stop_id
        AND ds.provider_id       = t.provider_id
        AND ds.dataset_version_id = t.dataset_version_id
    WHERE t.provider_id        = :provider_id
      AND t.dataset_version_id = :dataset_version_id
      AND t.route_id           = :route_id
      AND t.shape_id           = :shape_id
    ORDER BY st.stop_sequence
    LIMIT 400
    """
)

# First-stop departures for a route on the representative service days, tagged
# weekday/weekend and de-duplicated to distinct (direction, daytype, time).
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


def build_route(conn: Connection, *, provider_id: str = "stm", route_id: str) -> "RouteFile":
    """Build static/routes/{route_id}.json — branches + shapes + stops + schedule.

    One RouteDirection is emitted per real branch ((direction, headsign) with its
    most-used shape + that shape's full stop list), so multi-branch routes are not
    truncated.  Headways are the median gap between DISTINCT first-stop departures
    of the busiest direction on a representative weekday, per time-of-day shift,
    plus one 'weekend' period.  Times are wall-clock (GTFS >=24:00 normalised).
    """
    from collections import defaultdict

    from transit_ops.snapshots.contract import RouteDirection, RouteFile, RouteStop, ServicePeriod

    dv_row = conn.execute(_CURRENT_DATASET_VERSION_SQL, {"provider_id": provider_id}).mappings().fetchone()
    if dv_row is None:
        return RouteFile(id=route_id)
    dv_id = dv_row["dataset_version_id"]
    params = {"provider_id": provider_id, "dataset_version_id": dv_id, "route_id": route_id}

    weekday_services, weekend_services = _representative_services(
        conn, provider_id=provider_id, dataset_version_id=dv_id
    )

    name_row = conn.execute(
        text(
            "SELECT route_long_name FROM gold.dim_route "
            "WHERE provider_id=:provider_id AND route_id=:route_id LIMIT 1"
        ),
        {"provider_id": provider_id, "route_id": route_id},
    ).mappings().fetchone()
    long_name = name_row["route_long_name"] if name_row else None

    # --- branches: one per (direction, headsign), best (most-used) shape ---
    branches: dict[tuple, dict] = {}
    for row in conn.execute(_ROUTE_SHAPES_SQL, params).mappings():
        key = (int(row["direction_id"] or 0), row["trip_headsign"])
        if key not in branches:  # rows ordered direction, count DESC, shape_id
            branches[key] = {"shape_id": row["shape_id"], "geojson": row["geojson"]}

    directions: list[RouteDirection] = []
    for (dir_id, headsign), best in sorted(branches.items(), key=lambda kv: (kv[0][0], str(kv[0][1] or ""))):
        stop_rows = conn.execute(_ROUTE_STOPS_SQL, {**params, "shape_id": best["shape_id"]}).mappings()
        stops = [
            RouteStop(id=str(s["stop_id"]), seq=int(s["stop_sequence"]), name=s["stop_name"])
            for s in stop_rows
        ]
        directions.append(
            RouteDirection(dir=dir_id, headsign=headsign, shape=best["geojson"], stops=stops)
        )

    # --- schedule: distinct first-stop departures by daytype + direction ---
    sched_rows = conn.execute(
        _ROUTE_SCHEDULE_SQL,
        {**params, "weekday_services": weekday_services or [""], "weekend_services": weekend_services or [""]},
    ).mappings()
    wd_by_dir: dict[int, list[str]] = defaultdict(list)
    we_times: list[str] = []
    for r in sched_rows:
        t = str(r["departure_time"])
        if r["is_weekday"]:
            wd_by_dir[int(r["direction_id"] or 0)].append(t)
        else:
            we_times.append(t)

    service_periods: list[ServicePeriod] = []
    if wd_by_dir:
        # busiest direction is representative of the route's frequency
        best_dir = max(wd_by_dir, key=lambda d: len(set(wd_by_dir[d])))
        shift_times: dict[str, list[str]] = defaultdict(list)
        for t in set(wd_by_dir[best_dir]):
            shift_times[_infer_shift((_gtfs_min(t) // 60) % 24)].append(t)
        for shift in _SHIFT_ORDER:
            bucket = shift_times.get(shift)
            if not bucket:
                continue
            mins = [_shift_sort_min(t, shift) for t in bucket]
            service_periods.append(
                ServicePeriod(shift=shift, window=_SHIFT_WINDOWS[shift], headway_min=_median_headway(mins))
            )
    if we_times:
        service_periods.append(
            ServicePeriod(
                shift="weekend",
                window=None,
                headway_min=_median_headway([_gtfs_min(t) % 1440 for t in set(we_times)]),
            )
        )

    # span from the representative weekday (fallback weekend), wall-clock display
    all_wd = sorted({t for ts in wd_by_dir.values() for t in ts}, key=_gtfs_min)
    span = all_wd or sorted(set(we_times), key=_gtfs_min)
    first_dep = _wallclock(span[0]) if span else None
    last_dep = _wallclock(span[-1]) if span else None

    return RouteFile(
        id=route_id,
        long=long_name,
        directions=directions,
        service_periods=service_periods,
        first_departure=first_dep,
        last_departure=last_dep,
    )


# ---------------------------------------------------------------------------
# STATIC stop files (batch — one pass for all stops)
# ---------------------------------------------------------------------------

_ALL_STOPS_SQL = text(
    f"""
    SELECT stop_id, stop_code, stop_name, stop_lat, stop_lon, wheelchair_boarding
    FROM gold.dim_stop
    WHERE provider_id = :provider_id
      AND {_BOARDABLE_STOP}
    ORDER BY stop_id
    """
)

# Distinct departures per (stop, route, headsign) for the representative WEEKDAY
# service only, so each stop shows one coherent day's schedule (not the union of
# all 144 calendars).  DISTINCT collapses simultaneous branch departures.
_ALL_STOP_SCHEDULES_SQL = text(
    """
    SELECT DISTINCT st.stop_id, t.route_id, t.trip_headsign, st.departure_time
    FROM silver.stop_times AS st
    JOIN silver.trips AS t
        ON  t.trip_id            = st.trip_id
        AND t.dataset_version_id = st.dataset_version_id
        AND t.provider_id        = st.provider_id
    WHERE st.provider_id        = :provider_id
      AND st.dataset_version_id = :dataset_version_id
      AND st.departure_time IS NOT NULL
      AND t.service_id = ANY(:weekday_services)
    ORDER BY st.stop_id, t.route_id, st.departure_time
    """
)

_STOP_TIMES_CAP = 12  # representative all-day sample per (route, headsign)


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


def build_all_stops_data(conn: Connection, *, provider_id: str = "stm") -> "dict[str, StopFile]":
    """Build all StopFile objects in a single two-query pass (representative weekday).

    Returns stop_id -> StopFile. The schedule is a representative all-day sample
    of the busiest weekday's service; weekend-only stops have an empty schedule.
    """
    import logging
    from collections import defaultdict

    from transit_ops.snapshots.contract import ScheduledRoute, StopFile

    logger = logging.getLogger(__name__)
    params_base = {"provider_id": provider_id}

    dv_row = conn.execute(_CURRENT_DATASET_VERSION_SQL, params_base).mappings().fetchone()
    if dv_row is None:
        return {}
    dv_id = dv_row["dataset_version_id"]
    weekday_services, _weekend = _representative_services(
        conn, provider_id=provider_id, dataset_version_id=dv_id
    )

    stops: dict[str, StopFile] = {}
    for r in conn.execute(_ALL_STOPS_SQL, params_base).mappings():
        sid = str(r["stop_id"])
        lat, lon = r["stop_lat"], r["stop_lon"]
        if lat is None or lon is None:
            continue
        raw = r["wheelchair_boarding"]
        # GTFS: 1=accessible, 2=not accessible, 0/NULL=unknown. The contract field
        # is a bare bool with no 'unknown'; STM only emits 1/2 today.
        if raw not in (1, 2):
            logger.warning(
                "stop %s wheelchair_boarding=%r not in (1,2); publishing wheelchair=False", sid, raw
            )
        stops[sid] = StopFile(
            id=sid,
            code=r["stop_code"],
            name=str(r["stop_name"] or sid),
            lat=_round5(float(lat)),
            lon=_round5(float(lon)),
            wheelchair=(raw == 1),
            routes_served=[],
            scheduled=[],
        )

    schedule: dict[str, dict[tuple, list[str]]] = defaultdict(lambda: defaultdict(list))
    for r in conn.execute(
        _ALL_STOP_SCHEDULES_SQL, {**params_base, "dataset_version_id": dv_id, "weekday_services": weekday_services or [""]}
    ).mappings():
        sid = str(r["stop_id"])
        key = (str(r["route_id"]), r["trip_headsign"] or "")
        schedule[sid][key].append(str(r["departure_time"]))  # raw, already chronological

    for sid, route_map in schedule.items():
        stop = stops.get(sid)
        if stop is None:
            continue
        routes_seen: set[str] = set()
        scheduled: list[ScheduledRoute] = []
        for (route_id, headsign), raw_times in route_map.items():
            routes_seen.add(route_id)
            scheduled.append(
                ScheduledRoute(route=route_id, headsign=headsign or None, times=_sample_times(raw_times))
            )
        scheduled.sort(key=lambda s: (_route_sort_key(s.route), s.headsign or ""))
        stops[sid] = StopFile(
            id=stop.id,
            code=stop.code,
            name=stop.name,
            lat=stop.lat,
            lon=stop.lon,
            wheelchair=stop.wheelchair,
            routes_served=sorted(routes_seen, key=_route_sort_key),
            scheduled=scheduled,
        )

    return stops


# ---------------------------------------------------------------------------
# HISTORIC tier builders (Phase 3) — gold reliability rollups -> /v1/historic
# ---------------------------------------------------------------------------
#
# OTP convention: otp_pct = round(100 * on_time / known), NULL if either side is
# unknown or known==0. Stop reliability keeps a documented severe-delay proxy,
# now over real per-stop delay observations rather than route-smeared values.
# avg_delay_min = round(avg_delay_seconds/60, 1); severe_pct = round(100*sev/known, 1).
# p50_min/p90_min for route/stop reliability are NOT stored in gold and are left
# None (v1 deferral); only network_trend computes a real p90 from the fact table.


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


def build_network_trend(conn: Connection, *, provider_id: str = "stm") -> "NetworkTrend":
    """Build historic/network_trend.json — one TrendPoint per local date.

    Two daily series merged by date: OTP + weighted-avg delay from the hourly
    rollup (~90 days) and p90 delay + distinct vehicles from the raw fact table
    (~14 days retained), so p90_min/vehicles are present only for the recent days
    the fact table still covers.
    """
    from transit_ops.snapshots.contract import NetworkTrend, TrendPoint

    params = {"provider_id": provider_id}
    points: dict[str, dict] = {}

    for r in conn.execute(_TREND_DAILY_SQL, params).mappings():
        known_obs = r["known_obs"]
        weighted = r["weighted_delay_sec"]
        avg_delay_sec = (
            (float(weighted) / float(known_obs))
            if known_obs and weighted is not None
            else None
        )
        points[_iso_date(r["local_date"])] = {
            "otp_pct": _otp_pct(r["on_time"], known_obs),
            "avg_delay_min": _avg_delay_min(avg_delay_sec),
            "p90_min": None,
            "vehicles": None,
        }

    for r in conn.execute(_TREND_FACT_SQL, params).mappings():
        key = _iso_date(r["local_date"])
        entry = points.setdefault(
            key, {"otp_pct": None, "avg_delay_min": None, "p90_min": None, "vehicles": None}
        )
        entry["p90_min"] = round(float(r["p90_min"]), 1) if r["p90_min"] is not None else None
        entry["vehicles"] = _opt_int(r["vehicles"])

    series = [
        TrendPoint(
            date=d,
            otp_pct=v["otp_pct"],
            avg_delay_min=v["avg_delay_min"],
            p90_min=v["p90_min"],
            vehicles=v["vehicles"],
        )
        for d, v in sorted(points.items())
    ]
    return NetworkTrend(series=series)


def _iso_date(d: object) -> str:
    """Render a date (or datetime/date-like) as 'YYYY-MM-DD'. Strings pass through."""
    if isinstance(d, str):
        return d[:10]
    return d.isoformat()[:10]  # type: ignore[union-attr]


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

# Observed headway per shift (pre-computed in gold).
_ROUTE_HEADWAY_OBSERVED_SQL = text(
    """
    SELECT shift, observed_headway_min, sample_count
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

# Display-name lookups resolve current-dim-first (pri 0) and fall back to the
# newest gold.dim_*_history row, so ids retired/renamed by a GTFS drop keep
# their last known name on historic surfaces (slice-9.1.1u).
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


def build_route_reliability(
    conn: Connection, *, provider_id: str = "stm", route_id: str
) -> "RouteReliability":
    """Build historic/route_reliability/{route_id}.json.

    periods: daily (last 30) + weekly + monthly, all using observation-based OTP.
    headway: observed (gold rollup) vs scheduled (representative-weekday median,
             mirroring build_route) with excess_wait per shift.
    habits:  7x24 repeat-problem-score matrix (isodow 1..7 x hour 0..23).
    weak_stops: top 5 stops on the route by average delay.
    """
    from transit_ops.snapshots.contract import (
        HeadwayPeriod,
        ReliabilityPeriod,
        RouteHabits,
        RouteReliability,
        WeakStop,
    )

    params = {"provider_id": provider_id, "route_id": route_id}

    # --- periods (daily/weekly/monthly observation-based OTP) ---
    periods: list[ReliabilityPeriod] = []
    for r in conn.execute(_ROUTE_REL_DAILY_SQL, params).mappings():
        periods.append(
                ReliabilityPeriod(
                    grain="day",
                    date=_iso_date(r["d"]),
                    otp_pct=_otp_pct(r["on_time"], r["known_obs"]),
                    avg_delay_min=_avg_delay_min(r["avg_delay_sec"]),
                    p50_min=None,  # percentiles not stored in gold (v1 deferral)
                    p90_min=None,
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

    # --- headway: observed (gold) vs scheduled (representative weekday) ---
    observed: dict[str, float] = {}
    for r in conn.execute(_ROUTE_HEADWAY_OBSERVED_SQL, params).mappings():
        if r["observed_headway_min"] is not None:
            observed[str(r["shift"])] = float(r["observed_headway_min"])

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
        excess = round(max(0.0, obs - sched), 1) if both else None
        headway.append(
            HeadwayPeriod(
                shift=shift,
                scheduled_min=sched,
                observed_min=round(obs, 1) if obs is not None else None,
                excess_wait_min=excess,
            )
        )

    # --- habits: 7x24 matrix (rows isodow 1..7, cols hour 0..23) ---
    matrix = [[0.0 for _ in range(24)] for _ in range(7)]
    for r in conn.execute(_ROUTE_HABIT_SQL, params).mappings():
        dow = r["day_of_week_iso"]
        hour = r["hour_of_day_local"]
        if dow is None or hour is None:
            continue
        di, hi = int(dow) - 1, int(hour)
        if 0 <= di < 7 and 0 <= hi < 24:
            matrix[di][hi] = float(r["repeat_problem_score"] or 0.0)
    habits = RouteHabits(scale="repeat_problem_score", matrix=matrix)

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
        WeakStop(id=sid, name=names.get(sid), median_delay_min=round(avg_sec / 60.0, 1))
        for sid, avg_sec in weak_rows[:5]
    ]

    # --- route display name: current dim first, dim_route_history fallback ---
    route_names = {
        str(r["route_id"]): r["route_name"]
        for r in conn.execute(_ROUTE_NAMES_SQL, {"provider_id": provider_id}).mappings()
    }

    return RouteReliability(
        id=route_id,
        name=route_names.get(route_id),
        periods=periods,
        headway=headway,
        habits=habits,
        weak_stops=weak_stops,
    )


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
    GROUP BY stop_id, route_id
    """
)


def build_stop_reliability(
    conn: Connection, *, provider_id: str = "stm"
) -> "dict[str, StopReliability]":
    """Build all historic/stop_reliability/{stop_id}.json in a batched pass.

    For every stop in gold.stop_delay_weekly/monthly: weekly+monthly periods
    aggregated across the stop's routes. Stop OTP remains a severe(>300s)-only
    proxy, now over per-stop delay observations. Returns stop_id -> model.
    """
    from transit_ops.snapshots.contract import (
        StopByRoute,
        StopReliability,
        StopReliabilityPeriod,
    )

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
                median_delay_min=(round(avg_sec / 60.0, 1) if avg_sec is not None else None),
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
                median_delay_min=(round(avg_sec / 60.0, 1) if avg_sec is not None else None),
            )
        )

    # stop display names: current dim first, dim_stop_history fallback
    names = {
        str(r["stop_id"]): r["stop_name"]
        for r in conn.execute(_STOP_NAMES_SQL, params).mappings()
    }

    out: dict[str, StopReliability] = {}
    for sid in set(periods) | set(by_route):
        grain_map = periods.get(sid, {})
        ordered = [grain_map[g] for g in ("week", "month") if g in grain_map]
        routes = sorted(by_route.get(sid, []), key=lambda b: _route_sort_key(b.route))
        out[sid] = StopReliability(id=sid, name=names.get(sid), periods=ordered, by_route=routes)
    return out


# --------------------------------------------------------------------------
# build_hotspots
# --------------------------------------------------------------------------

# Most-recent week period from gold.repeated_problem_route_stop.
# Fall back to the max period_start_local of any grain if no 'week' rows exist.
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
    ORDER BY rp.issue_count DESC
    LIMIT 20
    """
)


def build_hotspots(conn: "Connection", provider_id: str = "stm") -> "Hotspots":
    """Build historic/hotspots.json — top 20 problem entities in the most recent week.

    Source: gold.repeated_problem_route_stop. Uses the most-recent week-grain period;
    falls back to the most-recent period of any grain if no week rows are present.
    otp_delta_pts is None in v1 (not stored in gold).
    """
    from transit_ops.snapshots.contract import Hotspot, Hotspots

    rows = list(conn.execute(_HOTSPOTS_SQL, {"provider_id": provider_id}).mappings())
    route_names, stop_names = _entity_name_maps(conn, provider_id=provider_id)
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
        for i, r in enumerate(rows)
    ]
    return Hotspots(hotspots=hotspots)


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
    conn: "Connection", provider_id: str = "stm"
) -> "RepeatOffenders":
    """Build historic/repeat_offenders.json — top 50 most-persistent problem entities.

    Source: gold.repeat_offender_daily (P3 mart).
    Ordered by recurrence_days desc, avg_delay_seconds desc.
    """
    from transit_ops.snapshots.contract import Offender, RepeatOffenders

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
    return RepeatOffenders(offenders=offenders)


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
    ORDER BY provider_local_date, avg_delay_seconds DESC, stop_id
    """
)


def build_receipts(
    conn: "Connection", provider_id: str = "stm"
) -> "dict[str, Receipt]":
    """Build historic/receipts/{date}.json for each date in the last 30 days.

    The citizen_accountability_daily table is the driver — one Receipt per date
    present there.  Network OTP/delay come from route_delay_hourly (hourly rollup
    aggregated to daily); worst_route and worst_stop come from the public daily
    views (max avg_delay_seconds per date).

    vehicles is None in v1 (not stored in the receipt source mart).
    worst_route.otp_delta_pts is None in v1 (not stored in gold).
    """
    from transit_ops.snapshots.contract import Receipt, ReceiptWorstRoute, ReceiptWorstStop

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
            "rider_impact_score": (
                float(r["rider_impact_score"]) if r["rider_impact_score"] is not None else None
            ),
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
        ds = _iso_date(r["d"])
        if ds not in worst_stop:  # first = max avg_delay (ordered DESC)
            worst_stop[ds] = ReceiptWorstStop(
                id=str(r["stop_id"]),
                name=stop_names.get(str(r["stop_id"])),
                median_delay_min=_avg_delay_min(r["avg_delay_seconds"]),
            )

    # merge: only emit dates present in accountability (the driver)
    out: dict[str, Receipt] = {}
    for ds, a in acct.items():
        n = net.get(ds, {})
        out[ds] = Receipt(
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
           MAX(severity)                                            AS severity,
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


def build_alert_history(
    conn: "Connection", provider_id: str = "stm"
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
    from transit_ops.snapshots.contract import AlertHistory, AlertHistoryEntry

    rows = list(
        conn.execute(_ALERT_HISTORY_SQL, {"provider_id": provider_id}).mappings()
    )
    entries: list[AlertHistoryEntry] = []
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
                duration_min = round(diff_s / 60.0)
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
        entries.append(
            AlertHistoryEntry(
                id=alert_id,
                severity=_severity_code(r["severity"]),
                routes=_natural_sort_dedup(raw_routes),
                stops=_natural_sort_dedup(raw_stops),
                start_utc=_opt_iso(start),
                end_utc=_opt_iso(end),
                duration_min=duration_min,
                impact_passages=None,  # v1 deferral: not stored in gold
            )
        )
    return AlertHistory(alerts=entries)


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


def build_provenance(
    conn: "Connection", provider_id: str = "stm"
) -> "Provenance":
    """Build provenance.json — feed lineage, freshness, retention policy, methodology.

    Sources from gold.source_lineage_reporting (is_current=true only).
    Freshness from gold.feed_freshness_current.
    Retention and methodology are hardcoded v1 constants.
    gaps lists known missing feeds (STM metro publishes no realtime feed).
    """
    from transit_ops.snapshots.contract import Provenance, ProvenanceFreshness, ProvenanceSource

    params = {"provider_id": provider_id}

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

    return Provenance(
        sources=sources,
        freshness=freshness,
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
                "network p90 from fact; route/stop percentiles deferred"
            ),
            "history_freeze": (
                "closed reporting periods are immutable after they leave the "
                "10-day open window; later runs rebuild only open hours/dates "
                "and derived files read frozen hourly/daily history"
            ),
        },
        gaps=["metro_realtime"],  # STM metro publishes no realtime feed
    )
