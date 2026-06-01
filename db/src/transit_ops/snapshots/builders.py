"""Live-tier builders: gold views -> /v1 snapshot pydantic models.

Each ``build_*`` function runs one or more SELECTs against the gold layer and
maps the resulting rows onto the contract models in
:mod:`transit_ops.snapshots.contract`.  The SQL here is written against the
column names verified by reading the view-defining Alembic migrations:

    * ``gold.current_vehicle_map_with_status``  (migration 0020) — vehicle
      positions + a French/English ``status_band`` categorical.  It does NOT
      carry bearing/speed/occupancy, so we LEFT JOIN ``gold.latest_vehicle_snapshot``
      (migration 0006) on (provider_id, realtime_snapshot_id, entity_index) to
      recover those raw fields.
    * ``gold.current_trip_delay_computed``      (migration 0018) — per-trip
      ``avg_delay_seconds`` (SECONDS, may be negative for early trips).
    * ``gold.current_stop_next_departures``     (migration 0027) — per-stop
      predicted departures with a ``departure_rank``.
    * ``gold.current_i3_alerts``                (migration 0024) — deduped
      alerts; ``route_ids`` / ``stop_ids`` are COMMA-SEPARATED STRINGS
      (``string_agg(..., ', ')``), not arrays.
    * ``gold.non_responding_current``           (migration 0027) — per-route
      ``non_responding_count``.
    * ``gold.feed_freshness_current``           (migration 0013) — per-endpoint
      ``completed_age_seconds``.
    * ``gold.dim_provider``                     (migration 0013) — provider
      display name / timezone / bbox / attribution.
    * ``core.dataset_versions``                 (migration 0001) — current
      static-schedule version string.

Status-band thresholds mirror migration 0020 exactly so the vehicle map and
the network KPIs agree:

    avg_delay < -60s        -> early
    -60s <= avg_delay < 60s -> on_time
    60s <= avg_delay < 300s -> late
    avg_delay >= 300s       -> severe
    avg_delay IS NULL       -> unknown
"""

from __future__ import annotations

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

# gold.current_vehicle_map_with_status.status_band emits bilingual labels
# (migration 0020).  Map them to the contract Status codes.
_STATUS_MAP: dict[str, str] = {
    "EN AVANCE / EARLY": "early",
    "À L'HEURE / ON TIME": "on_time",
    "A L'HEURE / ON TIME": "on_time",  # accent-stripped fallback
    "EN RETARD / LATE": "late",
    "CRITIQUE / SEVERE": "severe",
    "INCONNU / UNKNOWN": "unknown",
}

# GTFS-RT OccupancyStatus enum (stored as INTEGER in
# gold.latest_vehicle_snapshot.occupancy_status, migration 0006) ->
# contract Occupancy codes.
_OCCUPANCY_MAP: dict[int, str] = {
    0: "empty",  # EMPTY
    1: "many_seats",  # MANY_SEATS_AVAILABLE
    2: "few_seats",  # FEW_SEATS_AVAILABLE
    3: "standing",  # STANDING_ROOM_ONLY
    4: "standing",  # CRUSHED_STANDING_ROOM_ONLY
    5: "full",  # FULL
    # 6 NOT_ACCEPTING_PASSENGERS / 7 NO_DATA / 8 NOT_BOARDABLE -> None
}

# STM i3 / GTFS-RT alert severity tokens -> contract Severity codes.
# Confirmed sample value from tests/test_i3_silver.py: "warning".  GTFS-RT
# Alert.SeverityLevel adds INFO / WARNING / SEVERE / UNKNOWN_SEVERITY.  The
# contract only has critical|high|watch, so we collapse:
#   severe / critical            -> critical
#   warning / high / major       -> high
#   info / unknown / anything else -> watch
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

# Surfaces the citizen web-app renders, in nav order (slice-9 contract).
_SURFACES: list[str] = [
    "live_map",
    "network_health",
    "lookups",
    "reliability",
    "accountability",
    "data_trust",
]


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------


def _round5(x: object) -> float | None:
    return round(float(x), 5) if x is not None else None  # type: ignore[arg-type]


def _opt_int(x: object) -> int | None:
    return int(x) if x is not None else None  # type: ignore[arg-type]


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


def _status_from_band(band: object) -> str:
    return _STATUS_MAP.get((band or "").upper(), "unknown")  # type: ignore[union-attr]


def _status_from_delay_seconds(avg_delay_seconds: object) -> str:
    """Bucket an average delay (SECONDS) into a Status code.

    Mirrors the CASE in migration 0020 so trip status and vehicle status_band
    agree on identical input.
    """
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
    """Convert an average delay in SECONDS to a rounded integer of MINUTES."""
    if avg_delay_seconds is None:
        return None
    return round(float(avg_delay_seconds) / 60.0)  # type: ignore[arg-type]


def _split_csv(value: object) -> list[str]:
    """Split a ``string_agg(..., ', ')`` value into a list, dropping blanks."""
    if not value:
        return []
    return [piece.strip() for piece in str(value).split(",") if piece.strip()]


def _percentile(sorted_values: list[float], pct: float) -> float:
    """Linear-interpolation percentile (matches PG percentile_cont)."""
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = (len(sorted_values) - 1) * pct
    lo = int(rank)
    hi = min(lo + 1, len(sorted_values) - 1)
    frac = rank - lo
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * frac


# --------------------------------------------------------------------------
# 6a — build_vehicles
# --------------------------------------------------------------------------

_VEHICLES_SQL = text(
    """
    SELECT cvm.vehicle_id                AS id,
           cvm.route_id                  AS route,
           cvm.trip_id                   AS trip,
           cvm.latitude                  AS lat,
           cvm.longitude                 AS lon,
           lvs.bearing                   AS bearing,
           lvs.speed                     AS speed_kmh,
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
                speed_kmh=_opt_int(r["speed_kmh"]),
                status=_status_from_band(r["status_band"]),
                occupancy=(_OCCUPANCY_MAP.get(int(occ_raw)) if occ_raw is not None else None),
                next_stop=r["next_stop"],
                updated_utc=_iso(r["updated_utc"]),
                delay_min=_delay_min(r["delay_seconds"]),
            )
        )
    return VehiclesFile(generated_utc=generated_utc, vehicles=vehicles)


# --------------------------------------------------------------------------
# 6b — build_trips
# --------------------------------------------------------------------------

_TRIP_DELAY_SQL = text(
    """
    SELECT trip_id, route_id, avg_delay_seconds
    FROM gold.current_trip_delay_computed
    WHERE provider_id = :provider_id
    """
)

_TRIP_DEPARTURES_SQL = text(
    """
    SELECT trip_id, stop_id, predicted_departure_utc, departure_rank
    FROM gold.current_stop_next_departures
    WHERE provider_id = :provider_id
    ORDER BY trip_id, departure_rank
    """
)


def build_trips(conn: Connection, *, provider_id: str = "stm") -> TripsFile:
    """Build the live trips file: per-trip status + delay + next-stop ETAs.

    Trips appear if they have a delay row OR upcoming stop departures, so an
    in-progress trip with predictions but no computed delay still surfaces
    (status ``unknown``, ``delay_min`` None).
    """
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
            trip = Trip(route=None, status="unknown", delay_min=None, stops=[])
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
# 6c — build_alerts
# --------------------------------------------------------------------------

_ALERTS_SQL = text(
    """
    SELECT alert_id,
           alert_header_text,
           severity,
           route_ids,
           stop_ids,
           active_period_start_utc,
           active_period_end_utc
    FROM gold.current_i3_alerts
    WHERE provider_id = :provider_id
    """
)


def _severity_code(severity: object) -> str:
    return _SEVERITY_MAP.get((severity or "").strip().upper(), "watch")  # type: ignore[union-attr]


def build_alerts(conn: Connection, *, provider_id: str = "stm") -> AlertsFile:
    """Build the live alerts file from gold.current_i3_alerts."""
    alerts: list[Alert] = []
    for idx, r in enumerate(conn.execute(_ALERTS_SQL, {"provider_id": provider_id}).mappings()):
        # STM's i3 feed often leaves alert_id NULL; synthesize a stable,
        # within-snapshot-unique id so clients can key/dedupe.
        alert_id = r["alert_id"]
        if not alert_id:
            alert_id = f"{provider_id}-alert-{idx}"
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
# 6d — build_network
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

# Freshness for the realtime feeds the live map depends on; take the worst
# (oldest) age so the number reflects the staleness a citizen would feel.
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

    All divisions are guarded against an empty network (zero vehicles /
    zero trips) and degrade to 0.
    """
    params = {"provider_id": provider_id}

    # --- vehicles: status distribution + occupancy mix ---
    dist = StatusDist()
    occ_counts: dict[str, int] = {
        "empty": 0,
        "many_seats": 0,
        "few_seats": 0,
        "standing": 0,
        "full": 0,
    }
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

    on_time_pct = round(100 * dist.on_time / vehicles_in_service) if vehicles_in_service else 0

    # occupancy_mix as fractions of all in-service vehicles (0..1)
    if vehicles_in_service:
        occupancy_mix = OccupancyMix(**{k: v / vehicles_in_service for k, v in occ_counts.items()})
    else:
        occupancy_mix = OccupancyMix()

    # coverage_pct DECISION (see report): fraction of in-service vehicles whose
    # delay status is KNOWN (not "unknown") — i.e. the share of the live fleet
    # we can actually report a punctuality colour for.  This is a defensible,
    # self-consistent definition but is NOT specified by the contract source;
    # confirm with product before relying on it downstream.
    if vehicles_in_service:
        coverage_pct = round(100 * (vehicles_in_service - dist.unknown) / vehicles_in_service)
    else:
        coverage_pct = 0

    # --- trip delay percentiles (minutes) ---
    delays_min = sorted(
        float(r["avg_delay_seconds"]) / 60.0
        for r in conn.execute(_NETWORK_DELAYS_SQL, params).mappings()
    )
    delay_p50_min = round(_percentile(delays_min, 0.50)) if delays_min else 0
    delay_p90_min = round(_percentile(delays_min, 0.90)) if delays_min else 0

    # --- non-responding + freshness (single-row scalar aggregates) ---
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
# 6e — build_manifest
# --------------------------------------------------------------------------

_MANIFEST_PROVIDER_SQL = text(
    """
    SELECT provider_id,
           display_name,
           timezone,
           default_language,
           attribution_text,
           min_latitude,
           max_latitude,
           min_longitude,
           max_longitude
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
    """Assemble the top-level manifest from provider config + current version.

    ``settings`` must expose ``SNAPSHOT_PUBLIC_BASE_URL`` (used to build the
    absolute basemap URL).  Passed in rather than imported so the builder
    stays testable without env wiring.
    """
    prov = conn.execute(_MANIFEST_PROVIDER_SQL, {"provider_id": provider_id}).mappings()
    prow = next(iter(prov), None) or {}

    display_name = prow.get("display_name") or provider_id
    tz = prow.get("timezone") or "America/Toronto"
    default_lang = prow.get("default_language") or "fr"
    attribution = prow.get("attribution_text") or ""

    # bbox as [minLon, minLat, maxLon, maxLat] (GeoJSON / MapLibre order).
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
# Static labels (status/severity/occupancy codes + metric catalog family names)
# ---------------------------------------------------------------------------

_STATIC_LABELS_FR: dict[str, str] = {
    "status.early":     "En avance",
    "status.on_time":   "À l'heure",
    "status.late":      "En retard",
    "status.severe":    "Critique",
    "status.unknown":   "Inconnu",
    "severity.critical": "Critique",
    "severity.high":    "Élevé",
    "severity.watch":   "Surveillance",
    "occupancy.empty":        "Vide",
    "occupancy.many_seats":   "Nombreuses places",
    "occupancy.few_seats":    "Quelques places",
    "occupancy.standing":     "Debout seulement",
    "occupancy.full":         "Complet",
}

_STATIC_LABELS_EN: dict[str, str] = {
    "status.early":     "Early",
    "status.on_time":   "On time",
    "status.late":      "Late",
    "status.severe":    "Severe",
    "status.unknown":   "Unknown",
    "severity.critical": "Critical",
    "severity.high":    "High",
    "severity.watch":   "Watch",
    "occupancy.empty":        "Empty",
    "occupancy.many_seats":   "Many seats available",
    "occupancy.few_seats":    "Few seats available",
    "occupancy.standing":     "Standing room only",
    "occupancy.full":         "Full",
}

_LABELS_SQL = text("""
    SELECT label_key, label_fr, label_en
    FROM gold.report_labels
    ORDER BY sort_order NULLS LAST, label_key
""")  # no provider_id filter — report_labels is not provider-scoped

def build_labels(conn: Connection, *, lang: str = "fr") -> "LabelsFile":
    """Build labels/{lang}.json: static code translations + metric catalog family names."""
    from transit_ops.snapshots.contract import LabelsFile

    static = _STATIC_LABELS_FR if lang == "fr" else _STATIC_LABELS_EN
    labels: dict[str, str] = dict(static)

    for r in conn.execute(_LABELS_SQL).mappings():
        key = f"metric.{r['label_key']}"
        value = r["label_fr"] if lang == "fr" else r["label_en"]
        if value:
            labels[key] = value

    return LabelsFile(labels=labels)


# ---------------------------------------------------------------------------
# STATIC indexes
# ---------------------------------------------------------------------------

_ROUTES_INDEX_SQL = text("""
    SELECT route_id, route_short_name, route_long_name, route_color, route_type
    FROM gold.dim_route
    WHERE provider_id = :provider_id
    ORDER BY route_sort_order NULLS LAST, route_short_name
""")

_STOPS_INDEX_SQL = text("""
    SELECT s.stop_id, s.stop_code, s.stop_name, s.stop_lat, s.stop_lon
    FROM gold.dim_stop AS s
    WHERE s.provider_id = :provider_id
      AND s.location_type IN (0, NULL)
    ORDER BY s.stop_id
""")


def build_routes_index(conn: Connection, *, provider_id: str = "stm") -> "RoutesIndex":
    """Build static/routes_index.json from gold.dim_route."""
    from transit_ops.snapshots.contract import RoutesIndex, RouteIndexEntry
    routes = []
    for r in conn.execute(_ROUTES_INDEX_SQL, {"provider_id": provider_id}).mappings():
        routes.append(RouteIndexEntry(
            id=str(r["route_id"]),
            short=str(r["route_short_name"] or r["route_id"]),
            long=r["route_long_name"],
            color=r["route_color"],
            type=int(r["route_type"] or 3),
        ))
    return RoutesIndex(routes=routes)


def build_stops_index(conn: Connection, *, provider_id: str = "stm") -> "StopsIndex":
    """Build static/stops_index.json from gold.dim_stop."""
    from transit_ops.snapshots.contract import StopsIndex, StopIndexEntry
    stops = []
    for r in conn.execute(_STOPS_INDEX_SQL, {"provider_id": provider_id}).mappings():
        lat = r["stop_lat"]
        lon = r["stop_lon"]
        if lat is None or lon is None:
            continue
        stops.append(StopIndexEntry(
            id=str(r["stop_id"]),
            code=r["stop_code"],
            name=str(r["stop_name"] or r["stop_id"]),
            lat=_round5(float(lat)),
            lon=_round5(float(lon)),
        ))
    return StopsIndex(stops=stops)
