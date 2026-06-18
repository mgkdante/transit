from __future__ import annotations
from enum import Enum
from pydantic import BaseModel, Field

class Status(str, Enum):
    early = "early"; on_time = "on_time"; late = "late"; severe = "severe"; unknown = "unknown"

class Severity(str, Enum):
    critical = "critical"; high = "high"; watch = "watch"

class Occupancy(str, Enum):
    empty = "empty"; many_seats = "many_seats"; few_seats = "few_seats"; standing = "standing"; full = "full"

class Vehicle(BaseModel):
    id: str
    route: str | None = None
    trip: str | None = None
    lat: float
    lon: float
    bearing: int | None = None
    speed_kmh: int | None = None
    status: Status
    delay_min: int | None = None
    occupancy: Occupancy | None = None
    next_stop: str | None = None
    updated_utc: str

class VehiclesFile(BaseModel):
    generated_utc: str
    vehicles: list[Vehicle]

class StopEta(BaseModel):
    stop: str
    eta_utc: str
    delay_min: int | None = None

class Trip(BaseModel):
    route: str | None = None
    status: Status
    delay_min: int | None = None
    stops: list[StopEta] = Field(default_factory=list)

class TripsFile(BaseModel):
    generated_utc: str
    trips: dict[str, Trip]

class StopDeparture(BaseModel):
    route: str | None = None
    trip: str | None = None
    eta_utc: str
    delay_min: int | None = None

class StopDeparturesFile(BaseModel):
    # stop_id -> chronological next departures, <=2 per route. An absent stop_id
    # means "no live predictions" (client falls back to the static schedule;
    # metro is structurally absent — STM publishes no metro realtime).
    generated_utc: str
    stops: dict[str, list[StopDeparture]] = Field(default_factory=dict)

class Alert(BaseModel):
    id: str
    severity: Severity
    header_key: str
    # slice-9.1.1s additive bilingual text. header_text is the readable header
    # (today an alias of header_key's value); EN fields are honest-NULL unless
    # STM publishes an explicit English variant.
    header_text: str = ""
    description: str | None = None
    header_text_en: str | None = None
    description_en: str | None = None
    routes: list[str] = Field(default_factory=list)
    stops: list[str] = Field(default_factory=list)
    start_utc: str | None = None
    end_utc: str | None = None

class AlertsFile(BaseModel):
    generated_utc: str
    alerts: list[Alert]

class StatusDist(BaseModel):
    on_time: int = 0; late: int = 0; severe: int = 0; early: int = 0; unknown: int = 0

class OccupancyMix(BaseModel):
    empty: float = 0.0; many_seats: float = 0.0; few_seats: float = 0.0; standing: float = 0.0; full: float = 0.0

class NetworkFile(BaseModel):
    generated_utc: str
    vehicles_in_service: int
    # Honesty: these KPIs are None (not a fabricated 0) when their denominator
    # is empty — e.g. during a feed blackout the UI must render "no data", not
    # a misleading "0% on time". on_time_pct is None with no known-status
    # vehicles; coverage_pct is None with no live fleet; the delay percentiles
    # are None with no delay observations; feed_freshness_s is None when no
    # completed run exists (freshness genuinely unknown, not "0s = fresh");
    # occupancy_mix is None with no occupancy telemetry (slice-9.1.1y), not an
    # all-zero mix indistinguishable from a real all-empty fleet.
    on_time_pct: int | None
    status_dist: StatusDist
    delay_p50_min: int | None
    delay_p90_min: int | None
    occupancy_mix: OccupancyMix | None = None
    non_responding: int
    feed_freshness_s: int | None
    coverage_pct: int | None

class ManifestLiveFiles(BaseModel):
    vehicles: str = "live/vehicles.json"
    trips: str = "live/trips.json"
    alerts: str = "live/alerts.json"
    network: str = "live/network.json"
    stop_departures: str = "live/stop_departures.json"
    ttl_s: int = 30
    generated_utc: str

# 404-as-empty contract note shared by every per-entity static/historic pointer:
# a 404 means "no data for this entity" (render an empty state), not a fetch error.
_404_EMPTY = "; HTTP 404 means no data for this entity — render empty state, not an error"

class ManifestStaticFiles(BaseModel):
    routes_index: str = Field(default="static/routes_index.json")
    stops_index: str = Field(default="static/stops_index.json")
    basemap: str | None = Field(
        default=None,
        description="static/basemap.json pointer; null until SNAPSHOT_BASEMAP_PMTILES_URL is set",
    )
    routes_prefix: str = Field(
        default="static/routes/",
        description="fetch {routes_prefix}{route_id}.json" + _404_EMPTY,
    )
    stops_prefix: str = Field(
        default="static/stops/",
        description="fetch {stops_prefix}{stop_id}.json" + _404_EMPTY,
    )
    ttl_s: int = 86400
    generated_utc: str | None = Field(
        default=None,
        description="DATA time of the current static dataset; null = static tier never published",
    )

class ManifestHistoricFiles(BaseModel):
    network_trend: str = Field(default="historic/network_trend.json")
    hotspots: str = Field(default="historic/hotspots.json")
    repeat_offenders: str = Field(default="historic/repeat_offenders.json")
    alert_history: str = Field(default="historic/alert_history.json")
    provenance: str = Field(default="provenance.json")
    receipts_index: str = Field(
        default="historic/receipts/index.json",
        description="discovery index of published receipt dates" + _404_EMPTY,
    )
    route_reliability_prefix: str = Field(
        default="historic/route_reliability/",
        description="fetch {route_reliability_prefix}{route_id}.json" + _404_EMPTY,
    )
    stop_reliability_prefix: str = Field(
        default="historic/stop_reliability/",
        description="fetch {stop_reliability_prefix}{stop_id}.json" + _404_EMPTY,
    )
    receipts_prefix: str = Field(
        default="historic/receipts/",
        description="fetch {receipts_prefix}{date}.json (dates from receipts_index)" + _404_EMPTY,
    )
    ttl_s: int = 86400
    generated_utc: str | None = Field(
        default=None,
        description="DATA time of the current historic build; null = historic tier never published",
    )

class ManifestFiles(BaseModel):
    live: ManifestLiveFiles
    static: ManifestStaticFiles = Field(default_factory=ManifestStaticFiles)
    historic: ManifestHistoricFiles = Field(default_factory=ManifestHistoricFiles)

class Manifest(BaseModel):
    provider: str
    display_name: str
    tz: str = "America/Toronto"
    bbox: list[float]
    default_lang: str = "fr"
    attribution: str
    basemap: str | None = Field(
        default=None,
        description="absolute URL of the basemap pointer; null until a PMTiles archive is hosted",
    )
    dataset_version: str
    labels: dict[str, str]
    files: ManifestFiles
    surfaces: list[str]


# ---------------------------------------------------------------------------
# STATIC tier models (Phase 2) — §8 STATIC shapes, field names ARE the contract
# ---------------------------------------------------------------------------

class RouteIndexEntry(BaseModel):
    id: str
    short: str
    long: str | None = None
    color: str | None = None
    type: int

class RoutesIndex(BaseModel):
    generated_utc: str
    routes: list[RouteIndexEntry]

class StopIndexEntry(BaseModel):
    id: str
    code: str | None = None
    name: str
    lat: float
    lon: float
    # Additive (slice stops-index-mode-routes): optional so already-published
    # snapshots lacking these keys still validate. mode = highest-priority GTFS
    # mode serving the stop, null when no route linkage; routes = up to 5 route
    # ids serving the stop (route natural-sort order), for search mode + chips.
    mode: str | None = Field(
        default=None,
        description="highest-priority GTFS mode serving this stop: metro|tram|rail|bus|ferry; null when no route linkage",
    )
    routes: list[str] = Field(
        default_factory=list,
        description="up to 5 route ids serving this stop, in route natural-sort order",
    )

class StopsIndex(BaseModel):
    generated_utc: str
    stops: list[StopIndexEntry]

class RouteStop(BaseModel):
    id: str
    seq: int
    name: str | None = None

class RouteDirection(BaseModel):
    dir: int
    headsign: str | None = None
    shape: dict | None = None          # GeoJSON LineString {"type":"LineString","coordinates":[...]}
    stops: list[RouteStop] = Field(default_factory=list)

class ServicePeriod(BaseModel):
    shift: str                         # "am_peak"|"pm_peak"|"midday"|"evening"|"night"|"weekend"
    window: str | None = None          # e.g. "06:00–09:00"
    headway_min: float | None = None

class RouteFile(BaseModel):
    generated_utc: str
    id: str
    long: str | None = None
    directions: list[RouteDirection] = Field(default_factory=list)
    service_periods: list[ServicePeriod] = Field(default_factory=list)
    first_departure: str | None = None
    last_departure: str | None = None

class ScheduledRoute(BaseModel):
    route: str
    headsign: str | None = None
    times: list[str] = Field(default_factory=list)

class StopFile(BaseModel):
    generated_utc: str
    id: str
    code: str | None = None
    name: str
    lat: float
    lon: float
    wheelchair: bool = False
    routes_served: list[str] = Field(default_factory=list)
    scheduled: list[ScheduledRoute] = Field(default_factory=list)

class LabelsFile(BaseModel):
    generated_utc: str
    labels: dict[str, str]


# ---------------------------------------------------------------------------
# HISTORIC tier models (Phase 3) — §8 HISTORIC shapes
# ---------------------------------------------------------------------------

class TrendPoint(BaseModel):
    date: str
    otp_pct: int | None = None
    avg_delay_min: float | None = None
    p90_min: float | None = None
    vehicles: int | None = None
    # Tier-1 additive: network-wide cancellation rate (canceled / RT-reported
    # trip-days, %) and crowding band-shares for the day. Both None when their
    # source rollups have no data for the date.
    cancellation_rate: float | None = None
    occupancy_mix: OccupancyMix | None = None

class NetworkTrend(BaseModel):
    generated_utc: str
    series: list[TrendPoint] = Field(default_factory=list)

class ReliabilityPeriod(BaseModel):
    grain: str
    date: str | None = None
    otp_pct: int | None = None
    avg_delay_min: float | None = None
    p50_min: float | None = None
    p90_min: float | None = None
    severe_pct: float | None = None

class CancellationPeriod(BaseModel):
    # Per-route cancellation over one closed local day (or a derived grain).
    # cancellation_rate_pct = 100 * canceled_trip_days / total_trip_days, where a
    # trip-day is a distinct (trip_id, start_date) seen in the RT feed; the rate
    # is "canceled among RT-reported trips", NOT schedule-complete. None (not 0)
    # when total_trip_days=0. Counts are carried so weekly/monthly can SUM-derive.
    grain: str = "day"
    date: str | None = None
    cancellation_rate_pct: float | None = None
    canceled_trip_days: int | None = None
    total_trip_days: int | None = None

class HeadwayPeriod(BaseModel):
    shift: str
    scheduled_min: float | None = None
    observed_min: float | None = None
    excess_wait_min: float | None = None
    # Tier-2 regularity (busiest-direction rows only): cov = stddev/mean of the
    # observed trip-start gaps (None when fewer than 2 gaps); bunched_pct = % of
    # gaps under half the shift median headway (None when no gaps).
    cov: float | None = None
    bunched_pct: float | None = None

class ServiceSpanPeriod(BaseModel):
    # Per-route service span over one closed local day. "trip start" = first
    # realtime observation of a trip (not the scheduled departure); first/last
    # delay = that trip's first-observation schedule deviation (minutes).
    # service_day_kind is derived from the date by consumers (weekday/weekend).
    date: str | None = None
    first_trip_utc: str | None = None
    last_trip_utc: str | None = None
    service_span_min: int | None = None
    first_trip_delay_min: float | None = None
    last_trip_delay_min: float | None = None
    trip_count: int | None = None

class SkippedStopPeriod(BaseModel):
    # Per-route skipped-stop rate over one closed local day. rate_pct = skipped /
    # all observed stop-time updates (GTFS-RT SKIPPED=1); None when none observed.
    # RAMP-IN: history accrues forward only from the date this metric shipped.
    date: str | None = None
    skipped_stop_rate_pct: float | None = None
    skipped_stop_count: int | None = None
    stop_time_update_count: int | None = None

class RouteHabits(BaseModel):
    scale: str
    # Per-route relative-problem heatmap: each cell is a fraction of the route's
    # worst (dow,hour) cell in [0,1] (1.0 = worst hour), or null where the route
    # had no observations for that cell (slice-9.1.1x).
    matrix: list[list[float | None]] = Field(default_factory=list)

class WeakStop(BaseModel):
    id: str
    name: str | None = None
    median_delay_min: float | None = None

class RouteDayOfWeek(BaseModel):
    # Per-route weekday seasonality from gold.route_delay_day_of_week (ISO 1=Mon..7=Sun).
    # trip_count is intentionally omitted — the gold column is an hourly-distinct-sum
    # upper-bound proxy, not distinct trips per weekday.
    day_of_week_iso: int
    avg_delay_min: float | None = None
    severe_pct: float | None = None
    observation_count: int | None = None

class RouteReliability(BaseModel):
    generated_utc: str
    id: str
    name: str | None = None
    periods: list[ReliabilityPeriod] = Field(default_factory=list)
    headway: list[HeadwayPeriod] = Field(default_factory=list)
    habits: RouteHabits | None = None
    day_of_week: list[RouteDayOfWeek] = Field(default_factory=list)
    weak_stops: list[WeakStop] = Field(default_factory=list)
    # Tier-1 additive: per-day cancellation history + trailing-window crowding
    # band-shares. cancellations defaults empty, occupancy_mix None when absent.
    cancellations: list[CancellationPeriod] = Field(default_factory=list)
    occupancy_mix: OccupancyMix | None = None
    # Tier-2 additive: per-day service-span / first-last punctuality history.
    service_spans: list[ServiceSpanPeriod] = Field(default_factory=list)
    # Tier-2 additive: per-day skipped-stop rate history (ramp-in, no backfill).
    skipped_stops: list[SkippedStopPeriod] = Field(default_factory=list)

class StopReliabilityPeriod(BaseModel):
    grain: str
    otp_pct: int | None = None
    median_delay_min: float | None = None
    p50_min: float | None = None
    p90_min: float | None = None
    severe_pct: float | None = None

class StopByRoute(BaseModel):
    route: str
    median_delay_min: float | None = None

class StopReliability(BaseModel):
    generated_utc: str
    id: str
    name: str | None = None
    periods: list[StopReliabilityPeriod] = Field(default_factory=list)
    # Per-stop 7x24 (dow x hour) heatmap, reusing the RouteHabits shape but on a
    # DISTINCT scale ('severe_relative'): each cell is the stop's severe-delay count
    # relative to its own worst cell — NOT the route repeat-problem score, so a
    # shared legend can't conflate the two.
    habits: RouteHabits | None = None
    by_route: list[StopByRoute] = Field(default_factory=list)

class Hotspot(BaseModel):
    rank: int
    type: str
    id: str
    name: str | None = None
    severity: str | None = None
    otp_delta_pts: float | None = None

class Hotspots(BaseModel):
    generated_utc: str
    hotspots: list[Hotspot] = Field(default_factory=list)

class Offender(BaseModel):
    type: str
    id: str
    route: str | None = None
    # Offenders are 'trip'/'vehicle' entities with no display name of their
    # own — the route context carries the resolved name instead.
    route_name: str | None = None
    recurrence: str | None = None
    avg_delay_min: float | None = None

class RepeatOffenders(BaseModel):
    generated_utc: str
    offenders: list[Offender] = Field(default_factory=list)

class ReceiptWorstRoute(BaseModel):
    id: str
    name: str | None = None
    otp_delta_pts: float | None = None

class ReceiptWorstStop(BaseModel):
    id: str
    name: str | None = None
    median_delay_min: float | None = None

class Receipt(BaseModel):
    generated_utc: str
    date: str
    vehicles: int | None = None
    otp_pct: int | None = None
    avg_delay_min: float | None = None
    severe_pct: float | None = None
    worst_route: ReceiptWorstRoute | None = None
    worst_stop: ReceiptWorstStop | None = None
    affected_routes: int | None = None
    affected_stops: int | None = None
    alerts: int | None = None
    rider_impact_score: float | None = None

class AlertHistoryEntry(BaseModel):
    id: str
    severity: str | None = None
    # slice-9.1.1s additive bilingual header. EN surfaced via MAX() in the
    # builder; honest-NULL when STM published no English variant.
    header_text: str | None = None
    header_text_en: str | None = None
    routes: list[str] = Field(default_factory=list)
    stops: list[str] = Field(default_factory=list)
    start_utc: str | None = None
    end_utc: str | None = None
    duration_min: float | None = None
    impact_passages: int | None = None

class AlertBreakdownBucket(BaseModel):
    # One cause/effect/severity value with its distinct-alert count + median
    # duration (minutes). key is the decoded label, or "unknown" when STM omits it.
    key: str
    count: int = 0
    median_duration_min: float | None = None

class AlertBreakdown(BaseModel):
    # Tier-2 additive: distinct-alert distribution over the alert-history window.
    # cause/effect are frequently NULL on STM (→ mostly "unknown"); duration is
    # the high-confidence dimension.
    by_cause: list[AlertBreakdownBucket] = Field(default_factory=list)
    by_effect: list[AlertBreakdownBucket] = Field(default_factory=list)
    by_severity: list[AlertBreakdownBucket] = Field(default_factory=list)

class AlertHistory(BaseModel):
    generated_utc: str
    alerts: list[AlertHistoryEntry] = Field(default_factory=list)
    # Tier-2 additive: None when no alerts in the window.
    breakdown: AlertBreakdown | None = None

class ProvenanceSource(BaseModel):
    feed: str
    chain: str | None = None
    last_loaded_utc: str | None = None

class ProvenanceFreshness(BaseModel):
    feed: str
    status: str | None = None
    age_s: int | None = None

class Provenance(BaseModel):
    generated_utc: str
    sources: list[ProvenanceSource] = Field(default_factory=list)
    freshness: list[ProvenanceFreshness] = Field(default_factory=list)
    retention: dict[str, int] = Field(default_factory=dict)
    methodology: dict = Field(default_factory=dict)  # type: ignore[type-arg]
    gaps: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Basemap pointer + receipts discovery index (slice-9.1.1r)
# ---------------------------------------------------------------------------

class BasemapFile(BaseModel):
    """static/basemap.json — a settings-driven pointer to the hosted PMTiles archive.

    Published only when SNAPSHOT_BASEMAP_PMTILES_URL is configured; until then
    Manifest.basemap is null and no basemap.json object exists.
    """
    format: str = "pmtiles"
    url: str
    style_url: str | None = None
    attribution: str
    min_zoom: int = 0
    max_zoom: int = 15
    generated_utc: str

class ReceiptsIndex(BaseModel):
    dates: list[str] = Field(
        default_factory=list,
        description=(
            "ISO dates with a published receipt in the trailing 30-day build "
            "window, ascending; fetch {receipts_prefix}{date}.json; dates absent "
            "here either never had data (404 -> empty state) or are older "
            "archived receipts"
        ),
    )
    generated_utc: str


TOP_LEVEL_MODELS: dict[str, type[BaseModel]] = {
    "manifest": Manifest,
    "live_vehicles": VehiclesFile,
    "live_trips": TripsFile,
    "live_alerts": AlertsFile,
    "live_network": NetworkFile,
    "live_stop_departures": StopDeparturesFile,
    "static_routes_index": RoutesIndex,
    "static_stops_index": StopsIndex,
    "static_route": RouteFile,
    "static_stop": StopFile,
    "static_labels": LabelsFile,
    "static_basemap": BasemapFile,
    "historic_network_trend": NetworkTrend,
    "historic_route_reliability": RouteReliability,
    "historic_stop_reliability": StopReliability,
    "historic_hotspots": Hotspots,
    "historic_repeat_offenders": RepeatOffenders,
    "historic_receipt": Receipt,
    "historic_receipts_index": ReceiptsIndex,
    "historic_alert_history": AlertHistory,
    "provenance": Provenance,
}


def export_schemas() -> dict[str, dict]:
    return {name: model.model_json_schema() for name, model in TOP_LEVEL_MODELS.items()}
