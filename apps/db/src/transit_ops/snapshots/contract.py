from __future__ import annotations

import re
from datetime import date as date_type
from datetime import timedelta
from enum import StrEnum
from typing import Literal, Self

from pydantic import BaseModel, Field, field_validator, model_validator

PAYLOAD_SCHEMA_VERSION = 1

# Methodology tokens describe metric meaning; every top-level family requires one.
PAYLOAD_METHODOLOGY: dict[str, str] = {
    "manifest": "manifest-1",
    "live_vehicles": "live-2",
    "live_trips": "live-2",
    "live_alerts": "alerts-2",
    "live_network": "live-2",
    "live_stop_departures": "live-2",
    "live_data_health": "live-2",
    "static_routes_index": "static-1",
    "static_stops_index": "static-1",
    "static_route": "static-1",
    "static_stop": "static-1",
    "static_labels": "static-1",
    "static_basemap": "static-1",
    "historic_network_trend": "reliability-2",
    "historic_route_reliability": "reliability-2",
    "historic_stop_reliability": "reliability-2",
    "historic_hotspots": "reliability-2",
    "historic_hotspots_day": "reliability-2",
    "historic_repeat_offenders": "reliability-2",
    "historic_repeat_offenders_day": "reliability-2",
    "historic_receipt": "receipt-1",
    "historic_receipts_index": "receipt-1",
    "historic_route_reliability_index": "reliability-2",
    "historic_alert_history": "alerts-2",
    "historic_alert_archive_page": "alerts-2",
    "historic_alert_archive_index": "alerts-2",
    "historic_collection_index": "history-1",
    "historic_entity_directory_index": "history-1",
    "historic_network_history_partition": "history-1",
    "historic_line_history_partition": "history-1",
    "historic_stop_history_partition": "history-1",
    "historic_availability_index": "history-1",
    "provenance": "provenance-1",
}


class PayloadEnvelope(BaseModel):
    # Add only defaulted optional fields so previously published payloads keep validating.
    schema_version: int = PAYLOAD_SCHEMA_VERSION
    methodology_version: str | None = None
    publish_generation_id: str | None = None


class Status(StrEnum):
    early = "early"
    on_time = "on_time"
    late = "late"
    severe = "severe"
    unknown = "unknown"


class Severity(StrEnum):
    critical = "critical"
    high = "high"
    watch = "watch"


class Occupancy(StrEnum):
    empty = "empty"
    many_seats = "many_seats"
    few_seats = "few_seats"
    standing = "standing"
    full = "full"


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
    # reported_utc is vehicle report time; updated_utc is uniform snapshot capture time.
    reported_utc: str | None = None


class VehiclesFile(PayloadEnvelope):
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


class TripsFile(PayloadEnvelope):
    generated_utc: str
    trips: dict[str, Trip]


class StopDeparture(BaseModel):
    route: str | None = None
    trip: str | None = None
    eta_utc: str
    delay_min: int | None = None


class StopDeparturesFile(PayloadEnvelope):
    # Absent stops have no live predictions; departures are chronological, capped per route.
    generated_utc: str
    stops: dict[str, list[StopDeparture]] = Field(default_factory=dict)


class AlertActivePeriod(BaseModel):
    # UTC active-period bounds may be absent for open windows.
    start_utc: str | None = None
    end_utc: str | None = None


class Alert(BaseModel):
    id: str
    severity: Severity
    header_key: str
    # English text is absent unless explicitly supplied upstream.
    header_text: str = ""
    description: str | None = None
    header_text_en: str | None = None
    description_en: str | None = None
    routes: list[str] = Field(default_factory=list)
    stops: list[str] = Field(default_factory=list)
    start_utc: str | None = None
    end_utc: str | None = None
    # cause/effect/severity_level preserve upstream values separately from bucketed severity.
    cause: str | None = None
    effect: str | None = None
    severity_level: str | None = None
    # Scalar start/end represent the first active period; active_periods contains all windows.
    url: str | None = None
    url_en: str | None = None
    active_periods: list[AlertActivePeriod] = Field(default_factory=list)


class AlertsFile(PayloadEnvelope):
    generated_utc: str
    alerts: list[Alert]


class StatusDist(BaseModel):
    on_time: int = 0
    late: int = 0
    severe: int = 0
    early: int = 0
    unknown: int = 0


class OccupancyMix(BaseModel):
    empty: float = 0.0
    many_seats: float = 0.0
    few_seats: float = 0.0
    standing: float = 0.0
    full: float = 0.0


class DelayBucket(BaseModel):
    # Signed-minute bins are left-inclusive/right-exclusive; NULL bounds are unbounded.
    lo_min: int | None = None
    hi_min: int | None = None
    count: int = 0


class NonRespondingRoute(BaseModel):
    # Counts represent silent scheduled trips per route, not vehicle identities.
    route_id: str
    count: int


class NetworkFile(PayloadEnvelope):
    generated_utc: str
    vehicles_in_service: int
    # Absent denominators and telemetry remain None rather than observed zero.
    on_time_pct: int | None
    status_dist: StatusDist
    delay_p50_min: int | None
    delay_p90_min: int | None
    occupancy_mix: OccupancyMix | None = None
    non_responding: int
    feed_freshness_s: int | None
    coverage_pct: int | None
    # Histograms include zero-count bins when observations exist; absent observations yield None.
    delay_histogram: list[DelayBucket] | None = None
    non_responding_by_route: list[NonRespondingRoute] | None = None


class ManifestLiveFiles(BaseModel):
    vehicles: str = "live/vehicles.json"
    trips: str = "live/trips.json"
    alerts: str = "live/alerts.json"
    network: str = "live/network.json"
    stop_departures: str = "live/stop_departures.json"
    data_health: str = "status/data_health.json"
    ttl_s: int = 30
    generated_utc: str


# A missing per-entity file means no data for that entity.
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
    alerts_index: str = Field(default="historic/alerts/index.json")
    history_index: str = "historic/history/index.json"
    provenance: str = Field(default="provenance.json")
    receipts_index: str = Field(
        default="historic/receipts/index.json",
        description="discovery index of published receipt dates" + _404_EMPTY,
    )
    route_reliability_prefix: str = Field(
        default="historic/route_reliability/",
        description="fetch {route_reliability_prefix}{route_id}.json" + _404_EMPTY,
    )
    route_reliability_index: str = Field(
        default="historic/route_reliability/index.json",
        description="discovery index of routes with a published reliability file" + _404_EMPTY,
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


class Capability(StrEnum):
    # Unavailable means no supporting feed; not_applicable means the surface does not apply.
    enabled = "enabled"
    partial = "partial"
    unavailable = "unavailable"
    not_applicable = "not_applicable"


class ProviderCapabilities(BaseModel):
    # Capability fields align with surfaces; None means unknown capability.
    live_map: Capability | None = None
    network_health: Capability | None = None
    lookups: Capability | None = None
    reliability: Capability | None = None
    accountability: Capability | None = None
    data_trust: Capability | None = None


class Manifest(PayloadEnvelope):
    provider: str
    display_name: str
    short_name: str | None = None
    city: str | None = None
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
    capabilities: ProviderCapabilities | None = None


class RouteIndexEntry(BaseModel):
    id: str
    short: str
    long: str | None = None
    color: str | None = None
    type: int
    reliability: bool = Field(
        default=False,
        description=(
            "True when historic/route_reliability/{id}.json is published for "
            "this route (route has weekly/monthly reliability history); the "
            "client skips fetching it when False."
        ),
    )


class RoutesIndex(PayloadEnvelope):
    generated_utc: str
    routes: list[RouteIndexEntry]


class StopIndexEntry(BaseModel):
    id: str
    code: str | None = None
    name: str
    lat: float
    lon: float
    # Mode uses the highest-priority served route; routes is a capped naturally sorted list.
    mode: str | None = Field(
        default=None,
        description=(
            "highest-priority GTFS mode serving this stop: metro|tram|rail|bus|ferry; "
            "null when no route linkage"
        ),
    )
    routes: list[str] = Field(
        default_factory=list,
        description="up to 5 route ids serving this stop, in route natural-sort order",
    )


class StopsIndex(PayloadEnvelope):
    generated_utc: str
    stops: list[StopIndexEntry]


class RouteStop(BaseModel):
    id: str
    seq: int
    name: str | None = None


class RouteDirection(BaseModel):
    dir: int
    headsign: str | None = None
    shape: dict | None = None
    stops: list[RouteStop] = Field(default_factory=list)


class ServicePeriod(BaseModel):
    shift: str
    window: str | None = None
    headway_min: float | None = None


class RouteFile(PayloadEnvelope):
    generated_utc: str
    id: str
    long: str | None = None
    type: int | None = None
    directions: list[RouteDirection] = Field(default_factory=list)
    service_periods: list[ServicePeriod] = Field(default_factory=list)
    first_departure: str | None = None
    last_departure: str | None = None


class ScheduledRoute(BaseModel):
    route: str
    headsign: str | None = None
    times: list[str] = Field(default_factory=list)


class StopFile(PayloadEnvelope):
    generated_utc: str
    id: str
    code: str | None = None
    name: str
    lat: float
    lon: float
    wheelchair: bool = False
    routes_served: list[str] = Field(default_factory=list)
    scheduled: list[ScheduledRoute] = Field(default_factory=list)


class LabelsFile(PayloadEnvelope):
    generated_utc: str
    labels: dict[str, str]


class TrendPoint(BaseModel):
    # Dates are local bucket starts; percentiles and distinct vehicles are absent on coarse grains.
    date: str
    otp_pct: int | None = None
    avg_delay_min: float | None = None
    p90_min: float | None = None
    vehicles: int | None = None
    cancellation_rate: float | None = None
    occupancy_mix: OccupancyMix | None = None
    # Completeness compares counts, capped at 100; it does not match trip identities.
    service_completeness_rate: float | None = None
    # This observation_count covers OTP; cancellation and occupancy have separate denominators.
    observation_count: int | None = None
    wilson_lo: float | None = None
    wilson_hi: float | None = None


class NetworkShift(BaseModel):
    grain: str
    otp_pct: int | None = None
    avg_delay_min: float | None = None
    severe_pct: float | None = None
    # Wilson bounds cover on-time/known counts; severe percentages use their own base.
    observation_count: int | None = None
    wilson_lo: float | None = None
    wilson_hi: float | None = None


class NetworkTrend(PayloadEnvelope):
    generated_utc: str
    series: list[TrendPoint] = Field(default_factory=list)
    weekly: list[TrendPoint] = Field(default_factory=list)
    monthly: list[TrendPoint] = Field(default_factory=list)
    by_shift: list[NetworkShift] = Field(default_factory=list)
    by_daytype: list[NetworkShift] = Field(default_factory=list)


class RouteDelayHistogramBin(BaseModel):
    # Signed-second bins are left-inclusive/right-exclusive with an unbounded final bin.
    lo_sec: int | None = None
    hi_sec: int | None = None
    count: int = 0


class ReliabilityPeriod(BaseModel):
    grain: str
    date: str | None = None
    otp_pct: int | None = None
    avg_delay_min: float | None = None
    p50_min: float | None = None
    p90_min: float | None = None
    severe_pct: float | None = None
    observation_count: int | None = None
    wilson_lo: float | None = None
    wilson_hi: float | None = None
    on_time: int | None = None
    delay_histogram: list[RouteDelayHistogramBin] | None = None
    # Prior windows give descriptive differences; feed observations need not be independent.
    prior_observation_count: int | None = None
    prior_otp_pct: int | None = None
    prior_on_time: int | None = None


class CancellationPeriod(BaseModel):
    # Cancellation counts distinct RT-reported trip-days, excluding never-reported scheduled trips.
    grain: str = "day"
    date: str | None = None
    cancellation_rate_pct: float | None = None
    canceled_trip_days: int | None = None
    total_trip_days: int | None = None
    scheduled_trip_days: int | None = None
    delivered_trip_days: int | None = None
    silent_trip_days: int | None = None
    service_completeness_pct: float | None = None


class HeadwayPeriod(BaseModel):
    shift: str
    direction_id: int | None = None
    day_type: str | None = None
    scheduled_min: float | None = None
    observed_min: float | None = None
    # Windowed excess wait uses pooled second moments; scalar rows retain a typical-gap proxy.
    excess_wait_min: float | None = None
    cov: float | None = None
    bunched_pct: float | None = None
    # Each window independently selects its busiest direction; scalar rows omit prior-window fields.
    observation_count: int | None = None
    prior_observation_count: int | None = None
    prior_observed_min: float | None = None


class ServiceSpanPeriod(BaseModel):
    # Dates follow GTFS service days; overnight terminal observations can pass calendar midnight.
    date: str | None = None
    first_trip_utc: str | None = None
    last_trip_utc: str | None = None
    service_span_min: int | None = None
    first_trip_delay_min: float | None = None
    last_trip_delay_min: float | None = None
    trip_count: int | None = None


class SkippedStopPeriod(BaseModel):
    date: str | None = None
    skipped_stop_rate_pct: float | None = None
    skipped_stop_count: int | None = None
    stop_time_update_count: int | None = None


class CrowdingDelayCell(BaseModel):
    # Crowding delay is co-observed; typical p50 is a weighted mean of daily medians.
    band: str
    avg_delay_min: float | None = None
    p50_min: float | None = None
    observation_count: int | None = None
    day_count: int | None = None


class CrosstabCell(BaseModel):
    shift: str
    day_type: str
    otp_pct: float | None = None
    avg_delay_min: float | None = None
    severe_pct: float | None = None
    observation_count: int | None = None


class RouteHabits(BaseModel):
    scale: str
    # Heatmap values normalize to this route own worst cell; absent cells remain None.
    matrix: list[list[float | None]] = Field(default_factory=list)


class WeakStop(BaseModel):
    id: str
    name: str | None = None
    avg_delay_min: float | None = None
    # Weak-stop Wilson bounds cover not-severe share; MIN_N=30 filters tiny samples.
    observation_count: int | None = None
    severe_pct: float | None = None
    wilson_lo: float | None = None
    wilson_hi: float | None = None


class RouteDayOfWeek(BaseModel):
    day_of_week_iso: int
    avg_delay_min: float | None = None
    severe_pct: float | None = None
    observation_count: int | None = None


class OccupancyByGrain(BaseModel):
    grain: str
    mix: OccupancyMix | None = None


class OccupancyByDow(BaseModel):
    day_of_week_iso: int
    mix: OccupancyMix | None = None
    # Occupancy n counts band-bearing observations, not distinct trips.
    n: int | None = None


class OccupancyByHour(BaseModel):
    hour_of_day_local: int
    mix: OccupancyMix | None = None
    # Occupancy n counts band-bearing observations for this local hour.
    n: int | None = None


class ReliabilityByGrain(BaseModel):
    # Windows end at the newest closed spine day; date is the window start.
    grain: str
    date: str | None = None
    by_shift: list[ReliabilityPeriod] = Field(default_factory=list)
    by_daytype: list[ReliabilityPeriod] = Field(default_factory=list)
    day_of_week: list[RouteDayOfWeek] = Field(default_factory=list)
    by_shift_daytype: list[CrosstabCell] = Field(default_factory=list)


class RouteHabitsByGrain(BaseModel):
    # Each heatmap normalizes within its own window; suppress cells below MIN_N.
    grain: str
    date: str | None = None
    habits: RouteHabits | None = None
    cells_observed: int = 0
    cells_suppressed: int = 0


class HeadwayByGrain(BaseModel):
    # Headway has its own anchor and busiest direction per window; scheduled_min is static.
    grain: str
    date: str | None = None
    headway: list[HeadwayPeriod] = Field(default_factory=list)


class WeakStopGrain(BaseModel):
    # Stops rank before truncation by not-severe Wilson lower bound with MIN_N=30.
    grain: str
    date: str | None = None
    stops: list[WeakStop] = Field(default_factory=list)


ROUTE_RELIABILITY_BYTE_CEILING = 92160


class RouteReliability(PayloadEnvelope):
    generated_utc: str
    id: str
    name: str | None = None
    periods: list[ReliabilityPeriod] = Field(default_factory=list)
    headway: list[HeadwayPeriod] = Field(default_factory=list)
    habits: RouteHabits | None = None
    day_of_week: list[RouteDayOfWeek] = Field(default_factory=list)
    weak_stops: list[WeakStop] = Field(default_factory=list)
    cancellations: list[CancellationPeriod] = Field(default_factory=list)
    occupancy_mix: OccupancyMix | None = None
    service_spans: list[ServiceSpanPeriod] = Field(default_factory=list)
    skipped_stops: list[SkippedStopPeriod] = Field(default_factory=list)
    delay_by_crowding: list[CrowdingDelayCell] = Field(default_factory=list)
    by_shift_daytype: list[CrosstabCell] = Field(default_factory=list)
    occupancy_by_grain: list[OccupancyByGrain] = Field(default_factory=list)
    occupancy_by_dow: list[OccupancyByDow] = Field(default_factory=list)
    occupancy_by_hour: list[OccupancyByHour] = Field(default_factory=list)
    periods_by_grain: list[ReliabilityByGrain] = Field(default_factory=list)
    habits_by_grain: list[RouteHabitsByGrain] = Field(default_factory=list)
    headway_by_grain: list[HeadwayByGrain] = Field(default_factory=list)
    weak_stops_by_grain: list[WeakStopGrain] = Field(default_factory=list)


class StopReliabilityPeriod(BaseModel):
    grain: str
    otp_pct: int | None = None
    avg_delay_min: float | None = None
    p50_min: float | None = None
    p90_min: float | None = None
    severe_pct: float | None = None
    # Stop Wilson bounds cover not-severe share; route bounds cover actual on-time share.
    observation_count: int | None = None
    wilson_lo: float | None = None
    wilson_hi: float | None = None


class StopByRoute(BaseModel):
    route: str
    avg_delay_min: float | None = None


class StopDailyPoint(BaseModel):
    # Daily stop counts pool across routes; missing days stay absent.
    date: str
    observation_count: int
    severe_count: int
    severe_pct: float | None = None
    avg_delay_min: float | None = None


class StopReliability(PayloadEnvelope):
    generated_utc: str
    id: str
    name: str | None = None
    periods: list[StopReliabilityPeriod] = Field(default_factory=list)
    # Stop heatmaps use severe-relative scaling, distinct from route problem scores.
    habits: RouteHabits | None = None
    day_of_week: list[RouteDayOfWeek] = Field(default_factory=list)
    by_route: list[StopByRoute] = Field(default_factory=list)
    occupancy_mix: OccupancyMix | None = None
    daily: list[StopDailyPoint] = Field(default_factory=list)


class Hotspot(BaseModel):
    rank: int
    type: str
    id: str
    name: str | None = None
    severity: str | None = None
    otp_delta_pts: float | None = None


class HotspotEntry(BaseModel):
    # Rank restarts per kind; Wilson bounds cover not-severe share.
    # issue_count stays reserved because ISO-week recurrence does not match trailing windows.
    rank: int | None = None
    type: str
    id: str
    name: str | None = None
    severity: str | None = None
    otp_delta_pts: float | None = None
    observation_count: int | None = None
    severe_count: int | None = None
    severe_pct: float | None = None
    wilson_lo: float | None = None
    wilson_hi: float | None = None
    issue_count: int | None = None
    avg_delay_min: float | None = None


class HotspotGrain(BaseModel):
    # Shift grain is peak-only over the trailing week; totals are counted before per-kind caps.
    grain: str
    date: str | None = None
    window_end: str | None = None
    entries: list[HotspotEntry] = Field(default_factory=list)
    tray: list[HotspotEntry] = Field(default_factory=list)
    total_ranked_routes: int | None = None
    total_ranked_stops: int | None = None
    tray_total: int | None = None


HOTSPOTS_BYTE_CEILING = 262144


class Hotspots(PayloadEnvelope):
    generated_utc: str
    hotspots: list[Hotspot] = Field(default_factory=list)
    by_grain: list[HotspotGrain] = Field(default_factory=list)


class Offender(BaseModel):
    type: str
    id: str
    route: str | None = None
    route_name: str | None = None
    # Recurrence counts severe days; immutable history uses 14 closed local dates.
    recurrence: str | None = None
    recurrence_days: int | None = None
    window_days: int | None = None
    avg_delay_min: float | None = None
    severity: str | None = None


class RepeatOffenderEntry(BaseModel):
    # Trip/vehicle ranks restart per kind; recurrence is evidence, not the rank key.
    rank: int | None = None
    type: str
    id: str
    route: str | None = None
    route_name: str | None = None
    severity: str | None = None
    observation_count: int | None = None
    severe_count: int | None = None
    severe_pct: float | None = None
    wilson_lo: float | None = None
    wilson_hi: float | None = None
    recurrence_days: int | None = None
    observed_days: int | None = None
    window_days: int | None = None
    avg_delay_min: float | None = None


class RepeatOffenderGrain(BaseModel):
    # Recurrence windows are week/month; sub-MIN_N tray entries must still recur on two days.
    grain: str
    window_days: int | None = None
    entries: list[RepeatOffenderEntry] = Field(default_factory=list)
    tray: list[RepeatOffenderEntry] = Field(default_factory=list)
    total_ranked_trips: int | None = None
    total_ranked_vehicles: int | None = None
    tray_total: int | None = None


REPEAT_OFFENDERS_BYTE_CEILING = 262144


class RepeatOffenders(PayloadEnvelope):
    generated_utc: str
    offenders: list[Offender] = Field(default_factory=list)
    by_grain: list[RepeatOffenderGrain] = Field(default_factory=list)


class ReceiptWorstRoute(BaseModel):
    id: str
    name: str | None = None
    otp_delta_pts: float | None = None


class ReceiptWorstStop(BaseModel):
    id: str
    name: str | None = None
    avg_delay_min: float | None = None


class ReceiptShiftCut(BaseModel):
    shift: str
    observation_count: int | None = None
    severe_count: int | None = None
    severe_pct: float | None = None
    avg_delay_min: float | None = None


class ReceiptNotReportedRoute(BaseModel):
    # Not-reported routes were scheduled with zero RT observations, distinct from explicit
    # cancellations.
    id: str
    name: str | None = None
    scheduled_trip_days: int | None = None


class ReceiptServiceStates(BaseModel):
    # Sum route count comparisons only where the schedule is known.
    scheduled_trip_days: int | None = None
    delivered_trip_days: int | None = None
    cancelled_trip_days: int | None = None
    silent_trip_days: int | None = None
    not_reported_route_count: int | None = None
    service_completeness_pct: float | None = None
    not_reported_routes: list[ReceiptNotReportedRoute] = Field(default_factory=list)


class Receipt(PayloadEnvelope):
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
    by_shift: list[ReceiptShiftCut] = Field(default_factory=list)
    service_states: ReceiptServiceStates | None = None


# Count not-reported routes before applying the display cap.
NOT_REPORTED_ROUTES_CAP = 50

RECEIPT_BYTE_CEILING = 65536


class AlertHistoryEntry(BaseModel):
    id: str
    severity: str | None = None
    header_text: str | None = None
    header_text_en: str | None = None
    # Raw descriptions retain locale absence; the web owns fallback and HTML scrubbing.
    description: str | None = None
    description_en: str | None = None
    routes: list[str] = Field(default_factory=list)
    stops: list[str] = Field(default_factory=list)
    start_utc: str | None = None
    end_utc: str | None = None
    duration_min: float | None = None
    impact_passages: int | None = None
    # Scalar start/end represent the first window; active_periods contains every window.
    cause: str | None = None
    effect: str | None = None
    severity_level: str | None = None
    url: str | None = None
    active_periods: list[AlertActivePeriod] = Field(default_factory=list)


class AlertBreakdownBucket(BaseModel):
    key: str
    count: int = 0
    median_duration_min: float | None = None


class AlertBreakdown(BaseModel):
    by_cause: list[AlertBreakdownBucket] = Field(default_factory=list)
    by_effect: list[AlertBreakdownBucket] = Field(default_factory=list)
    by_severity: list[AlertBreakdownBucket] = Field(default_factory=list)


ALERT_HISTORY_BYTE_CEILING = 524288

# Pack pages by count and exact compact UTF-8 size; the gate shares these limits.
ALERT_ARCHIVE_PAGE_ENTRY_CAP = 250
ALERT_ARCHIVE_PAGE_BYTE_CEILING = 524288


class AlertHistory(PayloadEnvelope):
    generated_utc: str
    alerts: list[AlertHistoryEntry] = Field(default_factory=list)
    breakdown: AlertBreakdown | None = None
    # Window bounds are local dates; total_in_window is the distinct count before capping.
    window_start: str | None = None
    window_end: str | None = None
    total_in_window: int | None = None
    truncated: bool | None = None


class AlertArchiveEntry(AlertHistoryEntry):
    first_seen_utc: str
    last_seen_utc: str


class AlertArchivePage(PayloadEnvelope):
    generated_utc: str
    month: str
    page: int = Field(ge=1)
    alerts: list[AlertArchiveEntry] = Field(
        min_length=1,
        max_length=ALERT_ARCHIVE_PAGE_ENTRY_CAP,
    )


class AlertArchivePageRef(BaseModel):
    path: str
    page: int = Field(ge=1)
    count: int = Field(ge=1, le=ALERT_ARCHIVE_PAGE_ENTRY_CAP)
    byte_size: int = Field(ge=1)
    sha256: str
    coverage_start: str
    coverage_end: str


class AlertArchiveMonth(BaseModel):
    month: str
    total_alerts: int = Field(ge=1)
    pages: list[AlertArchivePageRef]


class AlertArchiveIndex(PayloadEnvelope):
    generated_utc: str
    collection_generation_id: str
    first_available_date: str | None
    last_available_date: str | None
    total_alerts: int = Field(ge=0)
    months: list[AlertArchiveMonth]


class HistorySelectionMode(StrEnum):
    range = "range"
    date = "date"


class HistoryMetricAggregation(StrEnum):
    additive = "additive"
    daily_only = "daily_only"
    current_only = "current_only"


class HistoryMetricName(StrEnum):
    delay = "delay"
    delay_percentiles = "delay_percentiles"
    vehicles = "vehicles"
    cancellation = "cancellation"
    occupancy = "occupancy"
    service_span = "service_span"
    skipped_stops = "skipped_stops"


class HistoricCoverageGap(BaseModel):
    start_date: str
    end_date: str
    reason: str | None = None


class HistoricPartitionRef(BaseModel):
    path: str
    coverage_start: str
    coverage_end: str
    count: int | None = Field(default=None, ge=0)
    sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    byte_size: int | None = Field(default=None, ge=1)


class HistoricMetricCoverage(BaseModel):
    metric: HistoryMetricName
    aggregation: HistoryMetricAggregation
    first_available_date: str | None = None
    last_available_date: str | None = None
    gaps: list[HistoricCoverageGap] = Field(default_factory=list)


class HistoricCollectionIndex(PayloadEnvelope):
    generated_utc: str
    family: str
    selection_mode: HistorySelectionMode
    entity_id: str | None = None
    collection_generation_id: str | None = None
    first_available_date: str | None = None
    last_available_date: str | None = None
    available_dates: list[str] = Field(default_factory=list)
    gaps: list[HistoricCoverageGap] = Field(default_factory=list)
    partitions: list[HistoricPartitionRef] = Field(default_factory=list)
    metrics: list[HistoricMetricCoverage] = Field(default_factory=list)


class HistoricFamilyAvailability(BaseModel):
    family: str
    selection_mode: HistorySelectionMode
    index_path: str
    collection_generation_id: str | None = None
    first_available_date: str | None = None
    last_available_date: str | None = None
    gaps: list[HistoricCoverageGap] = Field(default_factory=list)
    metrics: list[HistoricMetricCoverage] = Field(default_factory=list)


class HistoricEntityIndexRef(BaseModel):
    entity_id: str = Field(min_length=1)
    encoded_id: str = Field(min_length=2, pattern=r"^(?:[0-9a-f]{2})+$")
    index_path: str = Field(min_length=1)
    collection_generation_id: str = Field(min_length=1)
    first_available_date: str | None = None
    last_available_date: str | None = None

    @model_validator(mode="after")
    def validate_encoded_identity(self) -> Self:
        if self.encoded_id != self.entity_id.encode("utf-8").hex():
            raise ValueError("encoded_id must be the lowercase UTF-8 hex of entity_id")
        return self


class HistoricEntityDirectoryIndex(PayloadEnvelope):
    generated_utc: str
    family: Literal["lines", "stops"]
    selection_mode: Literal[HistorySelectionMode.range]
    collection_generation_id: str = Field(min_length=1)
    first_available_date: str | None = None
    last_available_date: str | None = None
    entities: list[HistoricEntityIndexRef] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_entity_paths(self) -> Self:
        for entity in self.entities:
            prefix = f"historic/history/{self.family}/{entity.encoded_id}"
            legacy = f"{prefix}/index.json"
            versioned = re.fullmatch(
                rf"{re.escape(prefix)}/generations/[0-9a-f]{{64}}/index\.json",
                entity.index_path,
            )
            if entity.index_path != legacy and versioned is None:
                raise ValueError(
                    "entity index_path must be the legacy stable path or an exact-payload "
                    "generation path"
                )
        return self


class HistoricDelayMetric(BaseModel):
    observation_count: int = Field(ge=1)
    in_clamp_observation_count: int | None = Field(default=None, ge=1)
    on_time_count: int | None = Field(default=None, ge=0)
    severe_count: int | None = Field(default=None, ge=0)
    sum_delay_seconds: int | None = None

    @model_validator(mode="after")
    def validate_denominators(self) -> Self:
        for name in ("in_clamp_observation_count", "on_time_count", "severe_count"):
            value = getattr(self, name)
            if value is not None and value > self.observation_count:
                raise ValueError(f"{name} cannot exceed observation_count")
        in_clamp = self.in_clamp_observation_count or 0
        for name in ("on_time_count", "severe_count"):
            value = getattr(self, name)
            if value is not None and value > in_clamp:
                raise ValueError(f"{name} cannot exceed in_clamp_observation_count")
        if (
            self.on_time_count is not None
            and self.severe_count is not None
            and self.on_time_count + self.severe_count > in_clamp
        ):
            raise ValueError(
                "on_time_count plus severe_count cannot exceed in_clamp_observation_count"
            )
        if self.sum_delay_seconds is not None and self.in_clamp_observation_count is None:
            raise ValueError("sum_delay_seconds requires in_clamp_observation_count")
        if self.sum_delay_seconds is not None and abs(self.sum_delay_seconds) > 3600 * in_clamp:
            raise ValueError("sum_delay_seconds exceeds the capped in-clamp population")
        return self


class HistoricDelayPercentiles(BaseModel):
    observation_count: int = Field(ge=1)
    p50_delay_seconds: float | None = None
    p90_delay_seconds: float | None = None

    @model_validator(mode="after")
    def require_percentile_value(self) -> Self:
        if self.p50_delay_seconds is None and self.p90_delay_seconds is None:
            raise ValueError("at least one delay percentile is required")
        for name in ("p50_delay_seconds", "p90_delay_seconds"):
            value = getattr(self, name)
            if value is not None and not -3600 <= value <= 3600:
                raise ValueError(f"{name} must be within the capped delay range")
        if (
            self.p50_delay_seconds is not None
            and self.p90_delay_seconds is not None
            and self.p50_delay_seconds > self.p90_delay_seconds
        ):
            raise ValueError("p50_delay_seconds cannot exceed p90_delay_seconds")
        return self


class HistoricCancellationMetric(BaseModel):
    canceled_trip_days: int = Field(ge=0)
    total_trip_days: int = Field(ge=0)
    scheduled_trip_days: int | None = Field(default=None, ge=0)
    delivered_trip_days: int | None = Field(default=None, ge=0)
    silent_trip_days: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_denominator(self) -> Self:
        if self.canceled_trip_days > self.total_trip_days:
            raise ValueError("canceled_trip_days cannot exceed total_trip_days")
        if self.total_trip_days == 0 and not (
            self.scheduled_trip_days is not None and self.scheduled_trip_days > 0
        ):
            raise ValueError("cancellation requires a positive observed or scheduled denominator")
        if self.scheduled_trip_days is None and (
            self.delivered_trip_days is not None or self.silent_trip_days is not None
        ):
            raise ValueError("delivered and silent counts require scheduled_trip_days")
        if (
            self.silent_trip_days is not None
            and self.scheduled_trip_days is not None
            and self.silent_trip_days > self.scheduled_trip_days
        ):
            raise ValueError("silent_trip_days cannot exceed scheduled_trip_days")
        delivered_cap = self.total_trip_days - self.canceled_trip_days
        if self.delivered_trip_days is not None and self.delivered_trip_days > delivered_cap:
            raise ValueError("delivered_trip_days cannot exceed total minus canceled trip-days")
        return self


class HistoricOccupancyMetric(BaseModel):
    empty: int = Field(ge=0)
    many_seats: int = Field(ge=0)
    few_seats: int = Field(ge=0)
    standing: int = Field(ge=0)
    full: int = Field(ge=0)

    @model_validator(mode="after")
    def require_telemetry(self) -> Self:
        if self.empty + self.many_seats + self.few_seats + self.standing + self.full == 0:
            raise ValueError("occupancy requires at least one telemetry observation")
        return self


class HistoricServiceSpanMetric(BaseModel):
    trip_count: int = Field(ge=1)
    first_trip_utc: str | None = None
    last_trip_utc: str | None = None
    first_trip_delay_seconds: int | None = None
    last_trip_delay_seconds: int | None = None


class HistoricSkippedStopMetric(BaseModel):
    skipped_stop_count: int = Field(ge=0)
    stop_time_update_count: int = Field(ge=1)

    @model_validator(mode="after")
    def validate_counts(self) -> Self:
        if self.skipped_stop_count > self.stop_time_update_count:
            raise ValueError("skipped_stop_count cannot exceed stop_time_update_count")
        return self


def _validate_iso_date(value: str) -> str:
    try:
        parsed = date_type.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("date must use valid YYYY-MM-DD format") from exc
    if parsed.isoformat() != value:
        raise ValueError("date must use canonical YYYY-MM-DD format")
    return value


class HistoricHotspotGrain(HotspotGrain):
    grain: Literal["day", "week", "month", "shift"]


class HistoricHotspotsDay(Hotspots):
    date: str
    by_grain: list[HistoricHotspotGrain] = Field(default_factory=list)

    @field_validator("date")
    @classmethod
    def validate_date(cls, value: str) -> str:
        return _validate_iso_date(value)

    @model_validator(mode="after")
    def validate_grain_identity(self) -> Self:
        order = ("day", "week", "month", "shift")
        positions = [order.index(grain.grain) for grain in self.by_grain]
        if positions != sorted(set(positions)):
            raise ValueError("historical hotspot grains must be unique and in canonical order")

        end = date_type.fromisoformat(self.date)
        window_days = {"day": 1, "week": 7, "month": 30}
        for grain in self.by_grain:
            if grain.grain == "shift":
                if grain.date is not None or grain.window_end is not None:
                    raise ValueError("historical hotspot shift endpoints must be null")
                continue
            expected_start = (end - timedelta(days=window_days[grain.grain] - 1)).isoformat()
            if grain.date != expected_start or grain.window_end != self.date:
                raise ValueError(
                    f"historical hotspot {grain.grain} endpoints must anchor to payload date"
                )
        return self


class HistoricRepeatOffenderGrain(RepeatOffenderGrain):
    grain: Literal["week", "month"]
    date: str
    window_end: str

    @field_validator("date", "window_end")
    @classmethod
    def validate_dates(cls, value: str) -> str:
        return _validate_iso_date(value)

    @model_validator(mode="after")
    def validate_window(self) -> Self:
        start = date_type.fromisoformat(self.date)
        end = date_type.fromisoformat(self.window_end)
        if start > end:
            raise ValueError("historical repeat-offender window start cannot follow its end")
        inclusive_days = (end - start).days + 1
        expected_days = 7 if self.grain == "week" else 30
        if inclusive_days != expected_days:
            raise ValueError(f"historical {self.grain} endpoints must span {expected_days} days")
        if self.window_days is not None and self.window_days != expected_days:
            raise ValueError(f"historical {self.grain} window_days must equal {expected_days}")
        return self


class HistoricRepeatOffendersDay(RepeatOffenders):
    date: str
    by_grain: list[HistoricRepeatOffenderGrain] = Field(default_factory=list)

    @field_validator("date")
    @classmethod
    def validate_date(cls, value: str) -> str:
        return _validate_iso_date(value)

    @model_validator(mode="after")
    def validate_grain_anchors(self) -> Self:
        order = ("week", "month")
        positions = [order.index(grain.grain) for grain in self.by_grain]
        if positions != sorted(set(positions)):
            raise ValueError(
                "historical repeat-offender grains must be unique and in canonical order"
            )
        if any(grain.window_end != self.date for grain in self.by_grain):
            raise ValueError("historical repeat-offender grain window_end must equal payload date")
        return self


class _HistoryDay(BaseModel):
    date: str

    @field_validator("date")
    @classmethod
    def validate_date(cls, value: str) -> str:
        return _validate_iso_date(value)

    @model_validator(mode="after")
    def require_real_metric(self) -> Self:
        if not any(
            getattr(self, name) is not None for name in type(self).model_fields if name != "date"
        ):
            raise ValueError("history day requires at least one real metric")
        return self


class NetworkHistoryDay(_HistoryDay):
    delay: HistoricDelayMetric | None = None
    delay_percentiles: HistoricDelayPercentiles | None = None
    cancellation: HistoricCancellationMetric | None = None
    occupancy: HistoricOccupancyMetric | None = None
    vehicles: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_vehicle_sample(self) -> Self:
        if (
            self.vehicles is not None
            and self.delay_percentiles is not None
            and self.vehicles > self.delay_percentiles.observation_count
        ):
            raise ValueError("vehicles cannot exceed delay percentile observations")
        return self


class LineHistoryDay(_HistoryDay):
    delay: HistoricDelayMetric | None = None
    delay_percentiles: HistoricDelayPercentiles | None = None
    cancellation: HistoricCancellationMetric | None = None
    occupancy: HistoricOccupancyMetric | None = None
    service_span: HistoricServiceSpanMetric | None = None
    skipped_stops: HistoricSkippedStopMetric | None = None


class StopHistoryDay(_HistoryDay):
    delay: HistoricDelayMetric | None = None
    delay_percentiles: HistoricDelayPercentiles | None = None
    occupancy: HistoricOccupancyMetric | None = None


class _HistoryPartition(PayloadEnvelope):
    generated_utc: str
    month: str

    @field_validator("month")
    @classmethod
    def validate_month(cls, value: str) -> str:
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", value):
            raise ValueError("month must use valid YYYY-MM format")
        return value

    @model_validator(mode="after")
    def validate_days(self) -> Self:
        days = self.days
        dates = [day.date for day in days]
        if dates != sorted(dates) or len(dates) != len(set(dates)):
            raise ValueError("partition days must be strictly ascending and unique")
        if any(day_date[:7] != self.month for day_date in dates):
            raise ValueError("partition day must belong to partition month")
        return self


class NetworkHistoryPartition(_HistoryPartition):
    days: list[NetworkHistoryDay] = Field(min_length=1)


class LineHistoryPartition(_HistoryPartition):
    entity_id: str = Field(min_length=1)
    days: list[LineHistoryDay] = Field(min_length=1)


class StopHistoryPartition(_HistoryPartition):
    entity_id: str = Field(min_length=1)
    days: list[StopHistoryDay] = Field(min_length=1)


class HistoricAvailabilityIndex(PayloadEnvelope):
    generated_utc: str
    families: list[HistoricFamilyAvailability] = Field(default_factory=list)


class ProvenanceSource(BaseModel):
    feed: str
    chain: str | None = None
    last_loaded_utc: str | None = None


class ProvenanceFreshness(BaseModel):
    feed: str
    status: str | None = None
    age_s: int | None = None


class ProvenanceConformance(BaseModel):
    status: str
    unknown_members: list[str] = Field(default_factory=list)
    extra_row_count: int = 0


class Provenance(PayloadEnvelope):
    generated_utc: str
    sources: list[ProvenanceSource] = Field(default_factory=list)
    freshness: list[ProvenanceFreshness] = Field(default_factory=list)
    retention: dict[str, int] = Field(default_factory=dict)
    methodology: dict = Field(default_factory=dict)  # type: ignore[type-arg]
    gaps: list[str] = Field(default_factory=list)
    conformance: ProvenanceConformance | None = None


DATA_HEALTH_BYTE_CEILING = 16384


class DataHealthGate(BaseModel):
    # Gate state is absent when disabled, skipped, or unavailable on older publications.
    checks_run: int | None = None
    errors: int | None = None
    warnings: int | None = None
    verdict: str | None = None
    generated_utc: str | None = None


class LaneHealth(BaseModel):
    # rollup maps the historic tier; freshness uses data timestamps and the database clock.
    lane: str
    last_publish_utc: str | None = None
    age_s: int | None = None
    files_written: int | None = None
    files_skipped: int | None = None
    files_total: int | None = None
    gate: DataHealthGate | None = None


class DataHealthFeed(BaseModel):
    feed: str
    status: str | None = None
    age_s: int | None = None


class DataHealth(PayloadEnvelope):
    """status/data_health.json — per-lane publish freshness + last gate outcome.

    Published on the LIVE lane every cycle (tiny, un-hash-gated like the rest of
    live) so a citizen /status page can show, in one fetch, how fresh each publish
    lane is and whether its last value-gate pass errored or warned.

    lanes carries EXACTLY the three lanes that have a Postgres publish heartbeat:
    the live / static / historic (labelled 'rollup') rows of
    core.snapshot_publish_state. MAINTENANCE and REPLAY are DELIBERATELY ABSENT:
    those pipeline stages run only in GitHub Actions and write NO DB heartbeat, so
    this payload has nothing honest to say about them. Fabricating a lane row for
    them would be dishonest; adding a real heartbeat write for those stages is
    OUT OF S11 SCOPE (flagged for a future slice). The web renders MAINTENANCE /
    REPLAY as honest not-applicable rows from static copy, not from this payload.

    Each lane's gate block is honest-NULL when that lane predates migration 0078
    or was published with the gate disabled (the gate outcome is UNKNOWN, never
    assumed pass). age_s is computed server-side off the DB clock.
    """

    generated_utc: str
    lanes: list[LaneHealth] = Field(default_factory=list)
    feeds: list[DataHealthFeed] = Field(default_factory=list)


class BasemapFile(PayloadEnvelope):
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


class ReceiptAvailability(BaseModel):
    # Availability covers published dates only; schedule-known and telemetry-present are
    # independent.
    date: str
    has_data: bool
    has_schedule: bool = False
    publish_generation_id: str | None = None


class ReceiptsIndex(PayloadEnvelope):
    dates: list[str] = Field(
        default_factory=list,
        description=(
            "Exact ascending dates whose receipts were built and published from retained "
            "accountability rows in the current publication."
        ),
    )
    generated_utc: str
    collection_generation_id: str | None = None
    available: list[ReceiptAvailability] = Field(default_factory=list)


class RouteReliabilityIndex(PayloadEnvelope):
    route_ids: list[str] = Field(
        default_factory=list,
        description=(
            "Route ids with a published per-route reliability file in THIS run, "
            "ascending; fetch {route_reliability_prefix}{route_id}.json. The "
            "always-current daily set (the static routes_index `reliability` flag "
            "can lag this); a route absent here has no published reliability file."
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
    "historic_hotspots_day": HistoricHotspotsDay,
    "historic_repeat_offenders": RepeatOffenders,
    "historic_repeat_offenders_day": HistoricRepeatOffendersDay,
    "historic_receipt": Receipt,
    "historic_receipts_index": ReceiptsIndex,
    "historic_route_reliability_index": RouteReliabilityIndex,
    "historic_alert_history": AlertHistory,
    "historic_alert_archive_page": AlertArchivePage,
    "historic_alert_archive_index": AlertArchiveIndex,
    "historic_collection_index": HistoricCollectionIndex,
    "historic_entity_directory_index": HistoricEntityDirectoryIndex,
    "historic_network_history_partition": NetworkHistoryPartition,
    "historic_line_history_partition": LineHistoryPartition,
    "historic_stop_history_partition": StopHistoryPartition,
    "historic_availability_index": HistoricAvailabilityIndex,
    "provenance": Provenance,
    "live_data_health": DataHealth,
}


def export_schemas() -> dict[str, dict]:
    return {name: model.model_json_schema() for name, model in TOP_LEVEL_MODELS.items()}
