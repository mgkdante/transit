"""Live-tier builders: gold -> /v1 live snapshot pydantic models.

LIVE sources:
    * ``gold.current_vehicle_map_with_status`` (0020) — vehicle positions +
      bilingual ``status_band`` + ``trip_avg_delay_seconds``.  No bearing/speed/
      occupancy, so we LEFT JOIN ``gold.latest_vehicle_snapshot`` (0006).
      NOTE: ``latest_vehicle_snapshot.speed`` is GTFS-RT meters/second.
    * ``gold.current_trip_delay_computed`` (0018) — per-trip ``avg_delay_seconds``.
    * ``gold.current_stop_next_departures`` (0027) — per-stop predicted departures
      (``predicted_departure_utc`` + ``stop_sequence``); feeds both the trip-keyed
      ``build_trips`` (60-min horizon) and the stop-keyed ``build_stop_departures``
      (<=2 per route).
    * ``gold.current_i3_alerts`` (0024) — alerts; STM leaves ``alert_id`` and
      ``severity`` NULL, so the id is content-hashed and severity maps to 'watch'.
    * ``gold.non_responding_current`` (0027), ``gold.feed_freshness_current`` (0013),
      ``gold.dim_provider`` (0013), ``core.dataset_versions`` (0001).

Status-band thresholds mirror migration 0020; network OTP counts on_time+late
as the unified [-60s,+300s) band over vehicles with known status.
"""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING

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
    ProviderCapabilities,
    NonRespondingRoute,
    OccupancyMix,
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


# --------------------------------------------------------------------------
# build_vehicles
# --------------------------------------------------------------------------

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
                reported_utc=_opt_iso(r["reported_utc"]),
                delay_min=_delay_min(r["delay_seconds"]),
            )
        )
    return VehiclesFile(generated_utc=generated_utc, vehicles=vehicles)


# --------------------------------------------------------------------------
# build_trips
# --------------------------------------------------------------------------

# status_band is computed IN-QUERY from gold's authoritative 0020 CASE
# (STATUS_BAND_CASE_SQL) so build_trips no longer re-buckets avg_delay_seconds in
# Python (slice-9.1.1-theta). The FROM/WHERE are unchanged — the trip set is
# identical; only an extra derived label column is added.
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

# Order by predicted ETA (primary) + stop_sequence (deterministic tiebreak) so
# the per-trip stops list is chronological.  departure_rank is partitioned by
# STOP, not trip, so it must NOT be used to order a trip's stops.
#
# slice-9.1.1q: cap the per-trip stops list at the next 60 minutes — every poll
# shrinks (far-future stop-time updates are pure poll bloat for a live map).
# Trip-detail lookahead beyond 60 min is deferred to the 9.4 per-trip surfaces.
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
    """Build the live trips file: per-trip status + delay + chronological next-stop ETAs.

    The per-trip stops list is the next 60 minutes only (slice-9.1.1q poll-size
    cap); trip-detail lookahead beyond that horizon is deferred to the 9.4
    per-trip surfaces.
    """
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

    return TripsFile(generated_utc=generated_utc, trips=trips)


# --------------------------------------------------------------------------
# build_stop_departures (slice-9.1.1q)
# --------------------------------------------------------------------------

# Keep at most this many upcoming departures per (stop, route) so a multi-route
# corridor stop never has one frequent route crowd out the others, while the
# file stays small (~25-30k entries, ~200KB gzipped). Module constant so the
# cap is tunable without changing the JSON shape.
_STOP_DEPARTURES_PER_ROUTE_CAP = 2

# One bounded query over gold.current_stop_next_departures (0027) — the view
# already filters to the latest snapshot and to future departures. A window
# ranks each (stop, route)'s departures chronologically so we can keep only the
# next CAP per route. The delay join is a per-trip aggregate of
# gold.current_trip_delay_computed (0018), grouped by
# (realtime_snapshot_id, trip_id, route_id, direction_id). Its source table holds
# a single realtime_snapshot_id per provider per cycle, so in normal data a trip
# is one row — BUT a trip_id appearing under two (route_id, direction_id) groups
# in one snapshot (malformed feed) would yield several rows. The inner GROUP BY
# provider_id, trip_id de-dups defensively to one avg_delay_seconds per trip
# before the LEFT JOIN (else duplicate join rows would inflate the rank).
# stop_id IS NULL rows (informational stop_time_updates) are excluded.
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
    """Build the live stop-keyed departures file from gold.current_stop_next_departures.

    Each stop maps to its upcoming departures in chronological order, capped at
    ``_STOP_DEPARTURES_PER_ROUTE_CAP`` per route, so a 9.4 stop page can answer
    "next buses at MY stop" with one small fetch instead of inverting the
    trip-keyed live/trips.json. Stops with no live predictions are simply absent
    (the client falls back to the static schedule; metro is structurally absent).
    """
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


# --------------------------------------------------------------------------
# build_alerts
# --------------------------------------------------------------------------

# Deterministic ORDER BY so synthesized ids and array order are stable per cycle.
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
                # slice-9.1.1s: header_text aliases the header value (header_key
                # is frozen); description + EN fields are additive passthroughs.
                header_text=r["alert_header_text"] or "",
                description=r["description_text"],
                header_text_en=_sane_en(r["alert_header_text_en"]),
                description_en=_sane_en(r["description_text_en"]),
                routes=_split_csv(r["route_ids"]),
                stops=_split_csv(r["stop_ids"]),
                start_utc=_opt_iso(r["active_period_start_utc"]),
                end_utc=_opt_iso(r["active_period_end_utc"]),
                # raw GTFS-RT/i3 passthroughs (already selected for the id hash)
                cause=r["cause"],
                effect=r["effect"],
                severity_level=r["severity"],
                # S15 additive: citizen link + every active window (multi-period
                # visible on live too). active_periods falls back to the scalar
                # pair for rows predating the 0077 child table. .get() keeps the
                # builder honest if a caller/view path omits the column.
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


# --------------------------------------------------------------------------
# build_network
# --------------------------------------------------------------------------

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

_NETWORK_NON_RESPONDING_SQL = named_query(
    "network.live.non_responding",
    """
    SELECT COALESCE(SUM(non_responding_count), 0) AS non_responding
    FROM gold.non_responding_current
    WHERE provider_id = :provider_id
    """
)

# Per-route breakdown of the scalar non_responding total. SUM(nr_count) over these
# rows equals the scalar non_responding.
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


# 8 fixed signed-minute bins (lo inclusive, hi exclusive; null = unbounded).
# Edges mirror the contract: (-inf,-5)[-5,-2)[-2,0)[0,2)[2,5)[5,10)[10,15)[15,+inf).
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
    """Distribution of the (signed) network delay minutes into 8 fixed buckets.

    Each value is rounded to whole minutes (the same rounding p50/p90 emit) and
    classified into the single bucket where (lo is None or lo <= d) and (hi is
    None or d < hi). All 8 buckets are always returned (count may be 0) so the
    UI can draw the full shape; honest-None only when there are zero delay
    observations (the same guard that nulls delay_p50_min/delay_p90_min).
    """
    if not delays_min:
        return None
    counts = [0] * len(_DELAY_HISTOGRAM_EDGES)
    for value in delays_min:
        d = round(value)
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
    """Pre-aggregate network-health KPIs into a single NetworkFile.

    on_time_pct is the unified [-60s,+300s) OTP band (on_time+late) over
    vehicles with a KNOWN status; unknown is a coverage gap reported separately
    as coverage_pct. occupancy_mix is over vehicles that actually report an
    occupancy code, so the fractions sum to ~1.

    Honesty: on_time_pct, coverage_pct, delay_p50_min, delay_p90_min and
    feed_freshness_s are emitted as None (never a fabricated 0) when their
    denominator is empty — no known-status vehicles, no live fleet, no delay
    observations, or no completed run. During a feed blackout consumers must
    read "no data", not a misleading "0% on time" or "0s fresh".
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
    # Honesty: with no known-status vehicles the punctuality rate is unknown,
    # not 0%. Emit None so the UI shows "no data" instead of a fabricated 0.
    on_time_pct = round(100 * on_time_band / known) if known else None

    occ_total = sum(occ_counts.values())
    # Honesty: with no occupancy telemetry the distribution is unknown — None,
    # not an all-zero mix indistinguishable from a real all-empty fleet
    # (slice-9.1.1y; mirrors on_time_pct/coverage_pct None-when-empty below).
    occupancy_mix = (
        OccupancyMix(**{k: v / occ_total for k, v in occ_counts.items()})
        if occ_total
        else None
    )

    # coverage_pct: share of the live fleet with a KNOWN punctuality status.
    # Honesty: with no live fleet there is nothing to cover — None, not 0.
    coverage_pct = (
        round(100 * known / vehicles_in_service) if vehicles_in_service else None
    )

    delays_min = sorted(
        float(r["avg_delay_seconds"]) / 60.0
        for r in conn.execute(_NETWORK_DELAYS_SQL, params).mappings()
    )
    # Honesty: with no delay observations the percentiles are undefined — None,
    # not a fabricated 0-minute delay.
    delay_p50_min = round(_percentile(delays_min, 0.50)) if delays_min else None
    delay_p90_min = round(_percentile(delays_min, 0.90)) if delays_min else None
    # Distribution of the SAME delays_min list (None iff no observations, same
    # guard as the percentiles above; all 8 buckets emitted otherwise).
    delay_histogram = _delay_histogram(delays_min)

    non_responding = int(conn.execute(_NETWORK_NON_RESPONDING_SQL, params).scalar_one() or 0)
    # Per-route breakdown of non_responding (already grouped in gold). Honesty:
    # empty -> None so the UI stands down; never an empty-but-present list.
    by_route = [
        NonRespondingRoute(route_id=str(r["route_id"]), count=int(r["nr_count"]))
        for r in conn.execute(_NETWORK_NON_RESPONDING_BY_ROUTE_SQL, params).mappings()
    ]
    non_responding_by_route = by_route or None
    # Honesty: MAX over no completed runs is NULL — freshness is genuinely
    # unknown. Emit None rather than COALESCE-ing NULL into a false "0s = fresh".
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
        non_responding=non_responding,
        feed_freshness_s=feed_freshness_s,
        coverage_pct=coverage_pct,
        delay_histogram=delay_histogram,
        non_responding_by_route=non_responding_by_route,
    )


# --------------------------------------------------------------------------
# build_manifest
# --------------------------------------------------------------------------

# Provider identity for the manifest comes from core.providers (the config
# source of truth), same as the static builder's attribution read. short_name /
# city are UI copy, not analytics dimensions, so they live here rather than in
# the gold.dim_provider passthrough view.
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

# Per-tier DATA-time stamps for the manifest inventories, upserted by each
# tier's publisher in core.snapshot_publish_state (slice-9.1.1r). Rows absent ->
# None -> "tier never published" in the manifest contract.
_MANIFEST_TIER_STATE_SQL = named_query(
    "manifest.tier_state",
    """
    SELECT tier, generated_utc
    FROM core.snapshot_publish_state
    WHERE provider_id = :provider_id
      AND tier IN ('static', 'historic')
    """
)


# GC2 H4 — honest per-provider capability derivation. A surface is only 'enabled'
# when the provider ACTUALLY has the feed(s) that power it (core.feed_endpoints,
# is_enabled=true). Never hardcodes 'enabled' — a provider with no vehicle_positions
# feed publishes live_map='unavailable', an honest absence the web can gate on. The
# query returns ALL enabled endpoint_keys, but _derive_capabilities only consults the
# three that power the 6 surfaces — vehicle_positions (live_map, network_health),
# trip_updates (network_health, reliability, accountability), static_schedule
# (lookups); data_trust is always enabled (provenance emits every run). Alerts are NOT
# a capability surface, so no alerts endpoint_key gates any of the 6.
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
    """Map the provider's enabled feed endpoints to the 6 Manifest.surfaces capabilities.

    Honest-absence: each surface is 'enabled' only if its powering feed is present,
    else 'unavailable'. data_trust is always 'enabled' (provenance is emitted every
    run regardless of feed set). Field names + order match ProviderCapabilities, which
    a contract test pins 1:1 to _SURFACES.
    """
    has_vehicles = "vehicle_positions" in endpoint_keys
    has_trips = "trip_updates" in endpoint_keys
    has_static = "static_schedule" in endpoint_keys
    # Delay-history surfaces are powered by trip_updates (the delay fact source).
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
    """Assemble the manifest from provider config + current dataset version."""
    prov = conn.execute(_MANIFEST_PROVIDER_SQL, {"provider_id": provider_id}).mappings()
    prow = next(iter(prov), None) or {}

    display_name = prow.get("display_name") or provider_id
    # Copy identity (optional): None when the provider config omits them — the
    # contract keeps them nullable and the UI falls back to display_name.
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

    # GC2 H4: honest per-surface capabilities from the provider's enabled feed set.
    endpoint_keys = {
        str(r["endpoint_key"])
        for r in conn.execute(
            _MANIFEST_CAPABILITY_ENDPOINTS_SQL, {"provider_id": provider_id}
        ).mappings()
    }
    capabilities = _derive_capabilities(endpoint_keys)

    # Per-tier DATA-time stamps from core.snapshot_publish_state (None if the
    # tier has never been published, or the table is absent pre-migration).
    tier_stamps: dict[str, str | None] = {}
    for r in conn.execute(_MANIFEST_TIER_STATE_SQL, {"provider_id": provider_id}).mappings():
        tier_stamps[str(r["tier"])] = _opt_iso(r["generated_utc"])

    # basemap ships as a settings-driven pointer; null until the PMTiles archive
    # is hosted (SNAPSHOT_BASEMAP_PMTILES_URL set). Field is truthfully null
    # otherwise — no 404-pointing URL.
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


# --------------------------------------------------------------------------
# Data health (S11) — status/data_health.json
# --------------------------------------------------------------------------
# Per-lane publish freshness + last gate outcome. age_s is computed SERVER-SIDE
# off now() (the DB clock is the single source of truth) so a lane's staleness is
# never derived from a client wall clock; honest-NULL when the lane has never
# published (generated_utc NULL). Only the three lanes with a Postgres publish
# heartbeat appear (live/static/historic); MAINTENANCE + REPLAY have no DB
# heartbeat and are deliberately absent (see DataHealth docstring).
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

# Per-feed freshness — SAME source as build_provenance (gold.feed_freshness_current),
# so the live lane's feed detail is one fetch and never disagrees with provenance.
_DATA_HEALTH_FEEDS_SQL = named_query(
    "data_health.feeds",
    """
    SELECT endpoint_key, status, completed_age_seconds
    FROM gold.feed_freshness_current
    WHERE provider_id = :provider_id
    ORDER BY endpoint_key
    """
)

# The historic tier is the citizen-facing 'rollup' lane; live/static keep their
# names. Order is the fixed presentation order (live, static, rollup).
_DATA_HEALTH_TIER_LABELS: dict[str, str] = {
    "live": "live",
    "static": "static",
    "historic": "rollup",
}
_DATA_HEALTH_LANE_ORDER = ("live", "static", "rollup")


def _data_health_gate(row: dict) -> DataHealthGate | None:
    """Build the lane's gate block, or None when the lane carries NO gate telemetry.

    A row predating migration 0078 (or a tier published with the gate disabled) has
    every gate_* column NULL — the gate outcome is honestly UNKNOWN, so the block is
    omitted entirely rather than emitted as a fabricated all-null/pass shape.
    """
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
    """Build status/data_health.json — per-lane publish freshness + last gate outcome.

    Reads core.snapshot_publish_state for all three tiers (live/static/historic; the
    historic tier is surfaced as the 'rollup' lane) with age_s computed server-side
    off now(). A tier with no row is honestly ABSENT from lanes (never a fabricated
    zero-age lane). Feeds mirror build_provenance's per-feed freshness.
    """
    params = {"provider_id": provider_id}

    rows_by_tier: dict[str, dict] = {}
    for r in conn.execute(_DATA_HEALTH_LANES_SQL, params).mappings():
        rows_by_tier[str(r["tier"])] = dict(r)

    lanes: list[LaneHealth] = []
    for tier, label in _DATA_HEALTH_TIER_LABELS.items():
        row = rows_by_tier.get(tier)
        if row is None:
            # No publish-state row for this tier yet — the lane has never published.
            # Omit it: build_data_health never fabricates a zero-age lane. The web
            # renders a lane it does not receive as honest not-applicable.
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
    # Stable presentation order (live, static, rollup).
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
