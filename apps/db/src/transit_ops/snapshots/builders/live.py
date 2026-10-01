from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING

from transit_ops.gold.reader import round_half_away
from transit_ops.snapshots.builders._helpers import (
    _OCCUPANCY_MAP,
    _SURFACES,
    STATUS_BAND_CASE_SQL,
    _alert_active_periods,
    _delay_min,
    _iso,
    _kmh,
    _opt_int,
    _opt_iso,
    _otp_pct,
    _percentile,
    _round5,
    _sane_en,
    _severity_code,
    _split_csv,
    _status_from_band,
)
from transit_ops.snapshots.contract import (
    Alert,
    AlertsFile,
    Capability,
    DataHealth,
    DataHealthFeed,
    DataHealthGate,
    DelayBucket,
    LaneHealth,
    Manifest,
    ManifestFiles,
    ManifestHistoricFiles,
    ManifestLiveFiles,
    ManifestStaticFiles,
    NetworkFile,
    NonRespondingRoute,
    OccupancyMix,
    ProviderCapabilities,
    StatusDist,
    StopDeparture,
    StopDeparturesFile,
    StopEta,
    Trip,
    TripsFile,
    Vehicle,
    VehiclesFile,
)
from transit_ops.sql_registry import named_query

if TYPE_CHECKING:  # pragma: no cover - typing only
    from sqlalchemy.engine import Connection


_VEHICLES_SQL = named_query(
    "live.vehicles",
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
           lvs.position_timestamp_utc    AS reported_utc,
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
                reported_utc=_opt_iso(r["reported_utc"]),
                delay_min=_delay_min(r["delay_seconds"]),
            )
        )
    return VehiclesFile(generated_utc=generated_utc, vehicles=vehicles)


_TRIP_DELAY_SQL = named_query(
    "live.trip_delay",
    """
    SELECT trip_id, route_id, avg_delay_seconds, """
    + STATUS_BAND_CASE_SQL.format(col="avg_delay_seconds")
    + """ AS status_band
    FROM gold.current_trip_delay_computed
    WHERE provider_id = :provider_id
    """
)

# Order trip stops by predicted ETA, then sequence; departure_rank is per stop.
_TRIP_DEPARTURES_SQL = named_query(
    "live.trip_departures",
    """
    SELECT trip_id, route_id, stop_id, predicted_departure_utc, stop_sequence
    FROM gold.current_stop_next_departures
    WHERE provider_id = :provider_id
      AND predicted_departure_utc < now() + interval '60 minutes'
    ORDER BY trip_id, predicted_departure_utc, stop_sequence
    """
)


def build_trips(conn: Connection, *, provider_id: str = "stm", generated_utc: str) -> TripsFile:
    trips: dict[str, Trip] = {}

    for r in conn.execute(_TRIP_DELAY_SQL, {"provider_id": provider_id}).mappings():
        trip_id = str(r["trip_id"])
        trips[trip_id] = Trip(
            route=r["route_id"],
            status=_status_from_band(r["status_band"]),
            delay_min=_delay_min(r["avg_delay_seconds"]),
            stops=[],
        )

    for r in conn.execute(_TRIP_DEPARTURES_SQL, {"provider_id": provider_id}).mappings():
        trip_id = str(r["trip_id"])
        trip = trips.get(trip_id)
        if trip is None:
            trip = Trip(route=r["route_id"], status="unknown", delay_min=None, stops=[])
            trips[trip_id] = trip
        trip.stops.append(
            StopEta(
                stop=str(r["stop_id"]),
                eta_utc=_iso(r["predicted_departure_utc"]),
                delay_min=trip.delay_min,
            )
        )

    return TripsFile(generated_utc=generated_utc, trips=trips)


# Cap departures per route so frequent routes cannot crowd out corridor neighbors.
_STOP_DEPARTURES_PER_ROUTE_CAP = 2

# Deduplicate per-trip delay rows before joining to avoid inflating departure ranks.
_STOP_DEPARTURES_SQL = named_query(
    "live.stop_departures",
    """
    SELECT stop_id, route_id, trip_id, predicted_departure_utc, avg_delay_seconds
    FROM (
        SELECT d.stop_id,
               d.route_id,
               d.trip_id,
               d.predicted_departure_utc,
               c.avg_delay_seconds,
               row_number() OVER (
                   PARTITION BY d.stop_id, d.route_id
                   ORDER BY d.predicted_departure_utc, d.trip_id, d.stop_sequence
               ) AS route_rank
        FROM gold.current_stop_next_departures AS d
        LEFT JOIN (
            SELECT provider_id, trip_id, avg(avg_delay_seconds) AS avg_delay_seconds
            FROM gold.current_trip_delay_computed
            WHERE provider_id = :provider_id
            GROUP BY provider_id, trip_id
        ) AS c
            ON c.provider_id = d.provider_id
           AND c.trip_id = d.trip_id
        WHERE d.provider_id = :provider_id
          AND d.stop_id IS NOT NULL
    ) AS ranked
    WHERE route_rank <= :per_route_cap
    ORDER BY stop_id, predicted_departure_utc, route_id, trip_id
    """
)


def build_stop_departures(
    conn: Connection,
    *,
    provider_id: str = "stm",
    generated_utc: str,
) -> StopDeparturesFile:
    stops: dict[str, list[StopDeparture]] = {}
    params = {"provider_id": provider_id, "per_route_cap": _STOP_DEPARTURES_PER_ROUTE_CAP}
    for r in conn.execute(_STOP_DEPARTURES_SQL, params).mappings():
        stops.setdefault(str(r["stop_id"]), []).append(
            StopDeparture(
                route=r["route_id"],
                trip=r["trip_id"],
                eta_utc=_iso(r["predicted_departure_utc"]),
                delay_min=_delay_min(r["avg_delay_seconds"]),
            )
        )
    return StopDeparturesFile(generated_utc=generated_utc, stops=stops)


_ALERTS_SQL = named_query(
    "live.alerts",
    """
    SELECT alert_id,
           alert_header_text,
           description_text,
           alert_header_text_en,
           description_text_en,
           severity,
           cause,
           effect,
           url,
           url_en,
           route_ids,
           stop_ids,
           active_period_start_utc,
           active_period_end_utc,
           active_periods
    FROM gold.current_i3_alerts
    WHERE provider_id = :provider_id
    ORDER BY active_period_start_utc NULLS LAST, alert_header_text, description_text
    """
)


def build_alerts(conn: Connection, *, provider_id: str = "stm", generated_utc: str) -> AlertsFile:
    alerts: list[Alert] = []
    for r in conn.execute(_ALERTS_SQL, {"provider_id": provider_id}).mappings():
        # Synthesize content-stable IDs for alerts without upstream IDs.
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
                header_text=r["alert_header_text"] or "",
                description=r["description_text"],
                header_text_en=_sane_en(r["alert_header_text_en"]),
                description_en=_sane_en(r["description_text_en"]),
                routes=_split_csv(r["route_ids"]),
                stops=_split_csv(r["stop_ids"]),
                start_utc=_opt_iso(r["active_period_start_utc"]),
                end_utc=_opt_iso(r["active_period_end_utc"]),
                cause=r["cause"],
                effect=r["effect"],
                severity_level=r["severity"],
                url=r.get("url"),
                url_en=_sane_en(r.get("url_en")),
                active_periods=_alert_active_periods(
                    r.get("active_periods"),
                    r["active_period_start_utc"],
                    r["active_period_end_utc"],
                ),
            )
        )
    return AlertsFile(generated_utc=generated_utc, alerts=alerts)


_NETWORK_VEHICLES_SQL = named_query(
    "network.live.vehicles",
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

_NETWORK_DELAYS_SQL = named_query(
    "network.live.delays",
    """
    SELECT avg_delay_seconds
    FROM gold.current_trip_delay_computed
    WHERE provider_id = :provider_id
      AND avg_delay_seconds IS NOT NULL
    """
)

_NETWORK_NON_RESPONDING_BY_ROUTE_SQL = named_query(
    "network.live.non_responding_by_route",
    """
    SELECT route_id, SUM(non_responding_count) AS nr_count
    FROM gold.non_responding_current
    WHERE provider_id = :provider_id
    GROUP BY route_id
    ORDER BY nr_count DESC, route_id ASC
    """
)


# Signed-minute bins are left-inclusive/right-exclusive; NULL bounds are unbounded.
_DELAY_HISTOGRAM_EDGES: tuple[tuple[int | None, int | None], ...] = (
    (None, -5),
    (-5, -2),
    (-2, 0),
    (0, 2),
    (2, 5),
    (5, 10),
    (10, 15),
    (15, None),
)


def _delay_histogram(delays_min: list[float]) -> list[DelayBucket] | None:
    if not delays_min:
        return None
    counts = [0] * len(_DELAY_HISTOGRAM_EDGES)
    for value in delays_min:
        d = int(round_half_away(value, 0))
        for i, (lo, hi) in enumerate(_DELAY_HISTOGRAM_EDGES):
            if (lo is None or lo <= d) and (hi is None or d < hi):
                counts[i] += 1
                break
    return [
        DelayBucket(lo_min=lo, hi_min=hi, count=counts[i])
        for i, (lo, hi) in enumerate(_DELAY_HISTOGRAM_EDGES)
    ]

_NETWORK_FRESHNESS_SQL = named_query(
    "network.live.freshness",
    """
    SELECT MAX(completed_age_seconds) AS feed_freshness_s
    FROM gold.feed_freshness_current
    WHERE provider_id = :provider_id
      AND endpoint_key IN ('vehicle_positions', 'trip_updates')
    """
)


def build_network(conn: Connection, *, provider_id: str = "stm", generated_utc: str) -> NetworkFile:
    params = {"provider_id": provider_id}

    dist = StatusDist()
    occupancy_states = ("empty", "many_seats", "few_seats", "standing", "full")
    occ_counts: dict[str, int] = {key: 0 for key in occupancy_states}
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
    on_time_pct = _otp_pct(on_time_band, known)

    occ_total = sum(occ_counts.values())
    occupancy_mix = (
        OccupancyMix(**{k: v / occ_total for k, v in occ_counts.items()})
        if occ_total
        else None
    )

    # Coverage is the share of live vehicles with known punctuality status.
    coverage_pct = _otp_pct(known, vehicles_in_service)

    delays_min = sorted(
        float(r["avg_delay_seconds"]) / 60.0
        for r in conn.execute(_NETWORK_DELAYS_SQL, params).mappings()
    )
    delay_p50_min = int(round_half_away(_percentile(delays_min, 0.50), 0)) if delays_min else None
    delay_p90_min = int(round_half_away(_percentile(delays_min, 0.90), 0)) if delays_min else None
    delay_histogram = _delay_histogram(delays_min)

    by_route = [
        NonRespondingRoute(route_id=str(r["route_id"]), count=int(r["nr_count"]))
        for r in conn.execute(_NETWORK_NON_RESPONDING_BY_ROUTE_SQL, params).mappings()
    ]
    freshness_raw = conn.execute(_NETWORK_FRESHNESS_SQL, params).scalar_one()
    feed_freshness_s = int(freshness_raw) if freshness_raw is not None else None

    return NetworkFile(
        generated_utc=generated_utc,
        vehicles_in_service=vehicles_in_service,
        on_time_pct=on_time_pct,
        status_dist=dist,
        delay_p50_min=delay_p50_min,
        delay_p90_min=delay_p90_min,
        occupancy_mix=occupancy_mix,
        non_responding=sum(route.count for route in by_route),
        feed_freshness_s=feed_freshness_s,
        coverage_pct=coverage_pct,
        delay_histogram=delay_histogram,
        non_responding_by_route=by_route or None,
    )


_MANIFEST_PROVIDER_SQL = named_query(
    "manifest.provider",
    """
    SELECT provider_id, display_name, short_name, city, timezone, default_language,
           attribution_text,
           min_latitude, max_latitude, min_longitude, max_longitude
    FROM core.providers
    WHERE provider_id = :provider_id
    """
)

_MANIFEST_VERSION_SQL = named_query(
    "manifest.version",
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

_MANIFEST_TIER_STATE_SQL = named_query(
    "manifest.tier_state",
    """
    SELECT tier, generated_utc
    FROM core.snapshot_publish_state
    WHERE provider_id = :provider_id
      AND tier IN ('static', 'historic')
    """
)


# Derive capabilities from enabled provider feeds.
_MANIFEST_CAPABILITY_ENDPOINTS_SQL = named_query(
    "manifest.capability_endpoints",
    """
    SELECT DISTINCT endpoint_key
    FROM core.feed_endpoints
    WHERE provider_id = :provider_id
      AND is_enabled = true
    """
)


def _derive_capabilities(endpoint_keys: set[str]) -> ProviderCapabilities:
    has_vehicles = "vehicle_positions" in endpoint_keys
    has_trips = "trip_updates" in endpoint_keys
    has_static = "static_schedule" in endpoint_keys
    has_delay_history = has_trips
    _on = Capability.enabled
    _off = Capability.unavailable
    return ProviderCapabilities(
        live_map=_on if has_vehicles else _off,
        network_health=_on if (has_trips or has_vehicles) else _off,
        lookups=_on if has_static else _off,
        reliability=_on if has_delay_history else _off,
        accountability=_on if has_delay_history else _off,
        data_trust=_on,
    )


def build_manifest(
    conn: Connection,
    *,
    provider_id: str = "stm",
    generated_utc: str,
    settings: object,
) -> Manifest:
    prov = conn.execute(_MANIFEST_PROVIDER_SQL, {"provider_id": provider_id}).mappings()
    prow = next(iter(prov), None) or {}

    display_name = prow.get("display_name") or provider_id
    short_name = prow.get("short_name") or None
    city = prow.get("city") or None
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

    endpoint_keys = {
        str(r["endpoint_key"])
        for r in conn.execute(
            _MANIFEST_CAPABILITY_ENDPOINTS_SQL, {"provider_id": provider_id}
        ).mappings()
    }
    capabilities = _derive_capabilities(endpoint_keys)

    tier_stamps: dict[str, str | None] = {}
    for r in conn.execute(_MANIFEST_TIER_STATE_SQL, {"provider_id": provider_id}).mappings():
        tier_stamps[str(r["tier"])] = _opt_iso(r["generated_utc"])

    base_url = (getattr(settings, "SNAPSHOT_PUBLIC_BASE_URL", None) or "").rstrip("/")
    if getattr(settings, "SNAPSHOT_BASEMAP_PMTILES_URL", None):
        basemap: str | None = f"{base_url}/v1/{provider_id}/static/basemap.json"
        static_basemap: str | None = "static/basemap.json"
    else:
        basemap = None
        static_basemap = None

    return Manifest(
        provider=provider_id,
        display_name=display_name,
        short_name=short_name,
        city=city,
        tz=tz,
        bbox=bbox,
        default_lang=default_lang,
        attribution=attribution,
        basemap=basemap,
        dataset_version=str(dataset_version),
        labels={"fr": "labels/fr.json", "en": "labels/en.json"},
        files=ManifestFiles(
            live=ManifestLiveFiles(generated_utc=generated_utc),
            static=ManifestStaticFiles(
                basemap=static_basemap,
                generated_utc=tier_stamps.get("static"),
            ),
            historic=ManifestHistoricFiles(
                generated_utc=tier_stamps.get("historic"),
            ),
        ),
        surfaces=list(_SURFACES),
        capabilities=capabilities,
    )


_DATA_HEALTH_LANES_SQL = named_query(
    "data_health.lanes",
    """
    SELECT
        tier,
        generated_utc,
        CASE
            WHEN generated_utc IS NULL THEN NULL
            ELSE floor(EXTRACT(EPOCH FROM (now() - generated_utc)))::bigint
        END AS age_s,
        files_written,
        files_skipped,
        files_total,
        gate_checks_run,
        gate_errors,
        gate_warnings,
        gate_verdict,
        gate_generated_utc
    FROM core.snapshot_publish_state
    WHERE provider_id = :provider_id
      AND tier IN ('live', 'static', 'historic')
    """
)

_DATA_HEALTH_FEEDS_SQL = named_query(
    "data_health.feeds",
    """
    SELECT endpoint_key, status, completed_age_seconds
    FROM gold.feed_freshness_current
    WHERE provider_id = :provider_id
    ORDER BY endpoint_key
    """
)

_DATA_HEALTH_TIER_LABELS: dict[str, str] = {
    "live": "live",
    "static": "static",
    "historic": "rollup",
}
_DATA_HEALTH_LANE_ORDER = ("live", "static", "rollup")


def _data_health_gate(row: dict) -> DataHealthGate | None:
    if (
        row.get("gate_checks_run") is None
        and row.get("gate_errors") is None
        and row.get("gate_warnings") is None
        and row.get("gate_verdict") is None
        and row.get("gate_generated_utc") is None
    ):
        return None
    return DataHealthGate(
        checks_run=_opt_int(row.get("gate_checks_run")),
        errors=_opt_int(row.get("gate_errors")),
        warnings=_opt_int(row.get("gate_warnings")),
        verdict=row.get("gate_verdict"),
        generated_utc=_opt_iso(row.get("gate_generated_utc")),
    )


def build_data_health(
    conn: Connection, provider_id: str = "stm", *, generated_utc: str
) -> DataHealth:
    params = {"provider_id": provider_id}

    rows_by_tier: dict[str, dict] = {}
    for r in conn.execute(_DATA_HEALTH_LANES_SQL, params).mappings():
        rows_by_tier[str(r["tier"])] = dict(r)

    lanes: list[LaneHealth] = []
    for tier, label in _DATA_HEALTH_TIER_LABELS.items():
        row = rows_by_tier.get(tier)
        if row is None:
            continue
        lanes.append(
            LaneHealth(
                lane=label,
                last_publish_utc=_opt_iso(row.get("generated_utc")),
                age_s=_opt_int(row.get("age_s")),
                files_written=_opt_int(row.get("files_written")),
                files_skipped=_opt_int(row.get("files_skipped")),
                files_total=_opt_int(row.get("files_total")),
                gate=_data_health_gate(row),
            )
        )
    lanes.sort(key=lambda lane: _DATA_HEALTH_LANE_ORDER.index(lane.lane))

    feeds: list[DataHealthFeed] = []
    for r in conn.execute(_DATA_HEALTH_FEEDS_SQL, params).mappings():
        feeds.append(
            DataHealthFeed(
                feed=str(r["endpoint_key"]),
                status=r["status"],
                age_s=(
                    int(r["completed_age_seconds"])
                    if r["completed_age_seconds"] is not None
                    else None
                ),
            )
        )

    return DataHealth(generated_utc=generated_utc, lanes=lanes, feeds=feeds)
