"""The /v1 DB->UI contract: these Pydantic models are the single source of truth.

export_schemas() emits one JSON Schema per model; scripts/export_snapshot_schemas.py
writes them to snapshots/schemas/ and tests/test_snapshots_schema_export.py byte-gates
them, so the on-disk schemas cannot drift from these models. The web app mirrors
those schemas (apps/web/.../v1/schemas/json/, gated by
tests/test_v1_contract_web_mirror_sync.py) and hand-writes the Zod validators.

Growth rule: add fields OPTIONAL-with-default only -- never add a required field or
flip optional->required, so older clients never break on a republish. Honest NULL:
a missing value serializes as explicit JSON null, never coerced to 0.

Full doctrine + the add-a-field / add-an-entity playbooks live in Notion ->
Architecture -> "/v1 Contract Doctrine".
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field

# GC2 H4 — in-band accountability stamps on every top-level payload root.
# schema_version = the CONTRACT shape generation (bumped on breaking-ish shape moves;
# additive-optional field growth does NOT bump it — the growth rule keeps old clients
# valid). methodology_version is a per-payload-FAMILY string (see PAYLOAD_METHODOLOGY
# below) so a rebaseline in one family (e.g. the pooled-avg move) is visible in-band
# without touching unrelated families. publish_generation_id = the deterministic
# dataset_version+generated_utc composite the publisher stamps once per run (DECISIONS
# #17), so a citizen can tie any file back to the exact publish that emitted it.
PAYLOAD_SCHEMA_VERSION = 1

# Per-payload-family methodology version map (DECISIONS #14). Families group the
# top-level models by the metric doctrine that governs them; bump a family's string
# when a rebaseline lands in that family (the S7-B methodology-note discipline, now
# in-band). Keys are TOP_LEVEL_MODELS keys; every top-level model MUST have a family
# entry (test_snapshots_contract asserts coverage) so a new payload can't ship
# unversioned. Values are opaque tokens, compared for equality only.
PAYLOAD_METHODOLOGY: dict[str, str] = {
    "manifest": "manifest-1",
    "live_vehicles": "live-1",
    "live_trips": "live-1",
    "live_alerts": "alerts-1",
    "live_network": "live-1",
    "live_stop_departures": "live-1",
    "live_data_health": "live-1",
    "static_routes_index": "static-1",
    "static_stops_index": "static-1",
    "static_route": "static-1",
    "static_stop": "static-1",
    "static_labels": "static-1",
    "static_basemap": "static-1",
    "historic_network_trend": "reliability-1",
    "historic_route_reliability": "reliability-1",
    "historic_stop_reliability": "reliability-1",
    "historic_hotspots": "reliability-1",
    "historic_repeat_offenders": "reliability-1",
    "historic_receipt": "receipt-1",
    "historic_receipts_index": "receipt-1",
    "historic_route_reliability_index": "reliability-1",
    "historic_alert_history": "alerts-1",
    "provenance": "provenance-1",
}


class PayloadEnvelope(BaseModel):
    # Additive-optional-with-default so already-published snapshots (which lack these
    # keys) still validate under the growth rule — never make these required. Mixed
    # into every TOP_LEVEL_MODELS root (and ONLY those roots; nested/embedded models
    # do NOT carry the envelope). Stamped by the publisher (publish.py _stamp_envelope).
    schema_version: int = PAYLOAD_SCHEMA_VERSION
    methodology_version: str | None = None
    publish_generation_id: str | None = None


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
    # Each vehicle's OWN GTFS-RT report time (VehiclePosition.timestamp, surfaced as
    # gold.position_timestamp_utc) — distinct from updated_utc, which is the UNIFORM
    # snapshot capture time. Optional: a producer may omit the per-vehicle timestamp,
    # and the gold left-join may be null, so consumers fall back to updated_utc. The
    # web keys honest per-bus fix age / freeze + forward-projection off this.
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
    # stop_id -> chronological next departures, <=2 per route. An absent stop_id
    # means "no live predictions" (client falls back to the static schedule;
    # metro is structurally absent — STM publishes no metro realtime).
    generated_utc: str
    stops: dict[str, list[StopDeparture]] = Field(default_factory=dict)

class AlertActivePeriod(BaseModel):
    # S15 additive: one active window of an alert. GTFS-RT alerts carry a LIST of
    # windows; the old path truncated to the first. Either bound may be null (an
    # open-ended window omits one). ISO-8601 UTC strings. Shared by the live Alert
    # and the historic AlertHistoryEntry.
    start_utc: str | None = None
    end_utc: str | None = None

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
    # Additive GTFS-RT / i3 passthroughs. cause/effect are the upstream raw values
    # (the GTFS-RT Alert.Cause / Alert.Effect enum NAME for GTFS-RT feeds, e.g.
    # "CONSTRUCTION"/"DETOUR"; a provider string for STM's i3). severity_level is
    # the raw upstream severity, distinct from the bucketed `severity` enum above.
    # Honest-NULL when the feed omits them.
    cause: str | None = None
    effect: str | None = None
    severity_level: str | None = None
    # S15 additive. url / url_en close the former "(url is not yet carried
    # upstream)" note — the citizen-facing link (fr / explicit-en), honest-NULL
    # where the feed omits it (STM's i3 carries no url key). active_periods lists
    # ALL windows the alert declares (multi-period visible on live too);
    # start_utc / end_utc above stay the primary window[0].
    url: str | None = None
    url_en: str | None = None
    active_periods: list[AlertActivePeriod] = Field(default_factory=list)

class AlertsFile(PayloadEnvelope):
    generated_utc: str
    alerts: list[Alert]

class StatusDist(BaseModel):
    on_time: int = 0; late: int = 0; severe: int = 0; early: int = 0; unknown: int = 0

class OccupancyMix(BaseModel):
    empty: float = 0.0; many_seats: float = 0.0; few_seats: float = 0.0; standing: float = 0.0; full: float = 0.0

class DelayBucket(BaseModel):
    # One fixed bin of the network delay distribution. lo_min is the inclusive
    # lower edge in (signed, rounded) minutes; null = unbounded below. hi_min is
    # the exclusive upper edge; null = unbounded above. A value d lands here when
    # (lo_min is None or lo_min <= d) and (hi_min is None or d < hi_min).
    lo_min: int | None = None
    hi_min: int | None = None
    count: int = 0

class NonRespondingRoute(BaseModel):
    # Scheduled trips running NOW with no live vehicle (silent service), per
    # route. Silent trips have no vehicle id by definition, so count is a
    # per-ROUTE silent-trip tally, not a vehicle list. SUM(count) over the list
    # equals the scalar non_responding total.
    route_id: str
    count: int

class NetworkFile(PayloadEnvelope):
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
    # slice-9.5 additive live-tier fields (optional-with-default; existing
    # NetworkFile shape unchanged). delay_histogram is the distribution of the
    # SAME trip-level signed-minute delays that power delay_p50_min/delay_p90_min:
    # None only when there are zero delay observations (the p50/p90 guard); when
    # there ARE observations all 8 fixed buckets are emitted (zeros included) so
    # the UI can draw the full shape. non_responding_by_route is the per-route
    # breakdown of `non_responding` (SUM(count) == non_responding); None when
    # there are no non-responding routes, so the UI stands down (never an empty
    # list, never a fabricated 0-row).
    delay_histogram: list[DelayBucket] | None = None
    non_responding_by_route: list[NonRespondingRoute] | None = None

class ManifestLiveFiles(BaseModel):
    vehicles: str = "live/vehicles.json"
    trips: str = "live/trips.json"
    alerts: str = "live/alerts.json"
    network: str = "live/network.json"
    stop_departures: str = "live/stop_departures.json"
    # S11 additive-optional pointer to the per-lane data-health payload (published
    # on the live lane every cycle). Default-valued so an already-published manifest
    # stays FIELD-IDENTICAL under the growth rule; the adapter resolves it
    # manifest-first like every other live file.
    data_health: str = "status/data_health.json"
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

class Capability(str, Enum):
    # GC2 H4 — per-surface capability honesty. 'enabled' = the surface is fully served;
    # 'partial' = served but incomplete (e.g. a feed subset); 'unavailable' = the
    # provider's feed simply does not carry it (honest absence, NOT an error);
    # 'not_applicable' = the surface does not apply to this provider at all.
    enabled = "enabled"; partial = "partial"; unavailable = "unavailable"; not_applicable = "not_applicable"

class ProviderCapabilities(BaseModel):
    # GC2 H4 (DECISIONS #15) — MINIMAL v1 per-provider capability block, ONE field per
    # entry in Manifest.surfaces, aligned 1:1 (same names, same order — a contract test
    # asserts the field set == the _SURFACES list). The web already reads the manifest
    # first to gate surface fetches, so capability lives beside `surfaces`. Sourced from
    # real provider config, never hardcoded 'enabled' — publishing a surface 'enabled'
    # for a provider whose feed does not carry it would violate the honest-absence
    # doctrine (OC Transpo has no alerts, STS is static+alerts only). Additive-optional
    # so pre-H4 manifests still validate; each field None means "capability unknown".
    live_map: Capability | None = None
    network_health: Capability | None = None
    lookups: Capability | None = None
    reliability: Capability | None = None
    accountability: Capability | None = None
    data_trust: Capability | None = None

class Manifest(PayloadEnvelope):
    provider: str
    display_name: str
    # Copy identity (additive, optional): snappy brand for chips/SEO ("STM") +
    # primary place name for SEO/copy ("Montréal"). None when the provider config
    # omits them; the UI falls back to display_name.
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
    # GC2 H4 (DECISIONS #15): per-surface capability honesty, aligned 1:1 with
    # `surfaces` above. Additive-optional — None on pre-H4 manifests.
    capabilities: ProviderCapabilities | None = None


# ---------------------------------------------------------------------------
# STATIC tier models (Phase 2) — §8 STATIC shapes, field names ARE the contract
# ---------------------------------------------------------------------------

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
    shape: dict | None = None          # GeoJSON LineString {"type":"LineString","coordinates":[...]}
    stops: list[RouteStop] = Field(default_factory=list)

class ServicePeriod(BaseModel):
    shift: str                         # "am_peak"|"pm_peak"|"midday"|"evening"|"night"|"weekend"
    window: str | None = None          # e.g. "06:00–09:00"
    headway_min: float | None = None

class RouteFile(PayloadEnvelope):
    generated_utc: str
    id: str
    long: str | None = None
    # Additive-optional (default None) so snapshots published before this field
    # still validate. GTFS route_type integer (0=tram,1=metro,3=bus,...) for this
    # route, sourced from gold.dim_route. Self-describes the route's mode so the
    # detail surface can infer "metro has no realtime" without cross-referencing
    # routes_index. Mirrors RouteIndexEntry.type.
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


# ---------------------------------------------------------------------------
# HISTORIC tier models (Phase 3) — §8 HISTORIC shapes
# ---------------------------------------------------------------------------

class TrendPoint(BaseModel):
    # One trend observation at a single bucket. date is the bucket-start LOCAL
    # date: the day itself for the daily `series`, the ISO week-start (Monday)
    # for `weekly` points, and the month-start (1st) for `monthly` points.
    # otp_pct / avg_delay_min / cancellation_rate / occupancy_mix are honestly
    # re-aggregatable to week/month (observation-weighted over the same daily
    # sources). p90_min / vehicles come from the ~14-day raw fact window only,
    # which is NOT additively composable across a week/month — so they are
    # always None on weekly/monthly points (present only on recent daily ones).
    date: str
    otp_pct: int | None = None
    avg_delay_min: float | None = None
    p90_min: float | None = None
    vehicles: int | None = None
    # Tier-1 additive: network-wide cancellation rate (canceled / RT-reported
    # trip-days, %) and crowding band-shares for the bucket. Both None when their
    # source rollups have no data for the bucket.
    cancellation_rate: float | None = None
    occupancy_mix: OccupancyMix | None = None
    # Network service-completeness (GC2 H1, additive-optional; plumbing now, display
    # is S9's call). service_completeness_rate = 100 * Σdelivered / Σscheduled across
    # the bucket's routes — the honest "share of scheduled service actually delivered".
    # cancellation_rate above KEEPS its old RT-reported denominator (NOT redefined);
    # this is a DIFFERENT, scheduled-aware denominator. None when the scheduled
    # universe is unknown for every route in the bucket (pre-0073 history).
    service_completeness_rate: float | None = None
    # Chart Doctrine honesty fields (slice-S3, additive-optional). observation_count
    # is the OTP/avg denominator for THIS bucket ONLY — cancellation_rate and
    # occupancy_mix have their own different denominators, do not reuse this n for
    # them. wilson_lo/wilson_hi are the 95% Wilson bounds (PERCENT) of the OTP
    # (k=on_time, n=known_obs). None on buckets without known-delay observations.
    observation_count: int | None = None
    wilson_lo: float | None = None
    wilson_hi: float | None = None

class NetworkShift(BaseModel):
    # Network-wide reliability for one time-of-day shift or weekday/weekend
    # day-type grain, aggregated across ALL of the provider's routes from
    # gold.route_delay_spine (a REAL on_time/known OTP from the stored on-time
    # counts — NOT the severe-delay proxy used for stops). grain is the canonical
    # shift token
    # (am_peak|midday|pm_peak|evening|night) or day-type token (weekday|weekend).
    # Honest-NULL: every metric is None (never a fabricated 0) when the grain has
    # no known-delay observations across the network for the window.
    grain: str
    otp_pct: int | None = None
    avg_delay_min: float | None = None
    severe_pct: float | None = None
    # Chart Doctrine honesty fields (slice-S3, additive-optional). observation_count
    # is the OTP/Wilson denominator (otp_known = on_time-known rows) — SMALLER than
    # the severe/avg base, so do NOT divide severe_pct by it. wilson_lo/wilson_hi are
    # the 95% Wilson bounds (PERCENT) of the REAL on_time OTP (k=on_time, n=otp_known).
    observation_count: int | None = None
    wilson_lo: float | None = None
    wilson_hi: float | None = None

class NetworkTrend(PayloadEnvelope):
    generated_utc: str
    series: list[TrendPoint] = Field(default_factory=list)
    # Additive-optional WEEK + MONTH grain trend series: the SAME daily sources
    # (gold.route_delay_spine OTP + pooled avg, route_cancellation_daily,
    # route_occupancy_band_daily) re-aggregated into ISO-week / calendar-month
    # buckets, observation-weighted exactly like `series`. Each TrendPoint.date
    # is the bucket-start local date (Monday for weekly, the 1st for monthly).
    # p90_min/vehicles stay None on these grains (the raw fact window is ~14d
    # only — not additively composable to a week/month). Both default empty so
    # already-published snapshots lacking these keys still validate.
    weekly: list[TrendPoint] = Field(default_factory=list)
    monthly: list[TrendPoint] = Field(default_factory=list)
    # Additive-optional network-wide reliability by time-of-day shift and by
    # weekday/weekend day-type, aggregated across all routes. Both default empty
    # so already-published snapshots lacking these keys still validate; the
    # NetworkShift rows keep honest-NULL semantics (None, never 0, on zero-obs).
    by_shift: list[NetworkShift] = Field(default_factory=list)
    by_daytype: list[NetworkShift] = Field(default_factory=list)

class RouteDelayHistogramBin(BaseModel):
    # One bin of the per-route signed-delay distribution (the §01 distribution chart).
    # Edges are in SECONDS — the spine's native 21-edge resolution, sub-minute near 0
    # — left-closed / right-open: a delay d lands here when
    # (lo_sec is None or lo_sec <= d) and (hi_sec is None or d < hi_sec). The final bin
    # has hi_sec=None (the [3600s, +inf) overflow). count is ABSOLUTE (never a share) so
    # the distribution bar takes an absolute zero-based domain per the Chart Doctrine.
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
    # Chart Doctrine honesty fields (slice-S3, additive-optional). observation_count
    # is this period's OTP/avg denominator (known-delay observations) — the n behind
    # otp_pct. wilson_lo/wilson_hi are the 95% Wilson score interval (z=1.96, PERCENT
    # 0..100) of the REAL on_time OTP (k=on_time, n=known_obs); rank on wilson_lo so a
    # tiny-n fluke can't out-rank a high-volume bad actor. None (never 0) when the
    # denominator is absent.
    observation_count: int | None = None
    wilson_lo: float | None = None
    wilson_hi: float | None = None
    # S7-B evidence (additive-optional, from gold.route_delay_spine). on_time is the OTP
    # numerator (known on-time observations) behind otp_pct — the InsightCard verdict's
    # "<on_time> of <observation_count> known arrivals on time". delay_histogram is this
    # period's signed-delay distribution (the §01 distribution chart): None when there
    # are no in-window delay observations (honest absence), else all 21 bins (zeros
    # included) so the UI draws the full shape. Both None on the daily grain (the
    # public_route_reliability_daily carve-out carries neither).
    on_time: int | None = None
    delay_histogram: list[RouteDelayHistogramBin] | None = None
    # S7-B windowable (additive-optional): the SAME metric over the immediately PRIOR
    # comparable window (e.g. the week before this week), so the web can render a
    # period-over-period delta + gate its significance. prior_observation_count is the
    # prior window's KNOWN-delay denominator (matching observation_count, NOT total obs)
    # so a two-proportion z-test (this vs prior) is valid; prior_otp_pct is the prior
    # window's REAL on_time/known OTP. Both None on the first window (no prior) or when
    # the period is not windowed (the scalar whole-history periods never carry them).
    prior_observation_count: int | None = None
    prior_otp_pct: int | None = None
    # prior_on_time is the prior window's EXACT on-time numerator (matching on_time for
    # the CURRENT window), so the web two-proportion delta pools real counts instead of
    # reconstructing the prior numerator from the integer-rounded prior_otp_pct (which
    # leaves a ±0.5pt rounding band the consumer had to suppress conservatively). None
    # whenever prior_otp_pct is None (no prior window / not a windowed period).
    prior_on_time: int | None = None

class CancellationPeriod(BaseModel):
    # Per-route cancellation over one closed local day (or a derived grain).
    # cancellation_rate_pct = 100 * canceled_trip_days / total_trip_days, where a
    # trip-day is a distinct (trip_id, start_date) seen in the RT feed; the rate
    # is "canceled among RT-reported trips", NOT schedule-complete. None (not 0)
    # when total_trip_days=0. Counts are carried so weekly/monthly can SUM-derive.
    # NOTE (GC2 H1): cancellation_rate_pct / total_trip_days / canceled_trip_days
    # KEEP these exact RT-observed semantics — they are NOT redefined by the
    # scheduled-universe fields below. total_trip_days remains the RT-observed
    # denominator; the honest scheduled-complete readout is service_completeness_pct.
    grain: str = "day"
    date: str | None = None
    cancellation_rate_pct: float | None = None
    canceled_trip_days: int | None = None
    total_trip_days: int | None = None
    # Scheduled-universe split (GC2 H1, additive-optional — None on pre-0073 history
    # and on editions with no silver schedule; None means UNKNOWN, never 0).
    # scheduled_trip_days = distinct scheduled trip-days active that date after
    #   resolving calendar ∩ calendar_dates (exception_type 1/2) against the current
    #   GTFS edition — the honest denominator RT never saw.
    # delivered_trip_days = total_trip_days - canceled_trip_days (RT-observed, run).
    # silent_trip_days    = max(scheduled - total_observed, 0): scheduled trips that
    #   never appeared in ANY realtime poll (clamped at 0 — over-delivery is hidden).
    # service_completeness_pct = 100 * delivered / scheduled (read-time; the NEW honest
    #   completeness metric, None when scheduled unknown). Display is S9/S13's call.
    scheduled_trip_days: int | None = None
    delivered_trip_days: int | None = None
    silent_trip_days: int | None = None
    service_completeness_pct: float | None = None

class HeadwayPeriod(BaseModel):
    # shift is the BARE time-of-day token (am_peak|midday|pm_peak|evening|night) —
    # the S7-B Pattern-A cleanup of the old packed `{shift}_dir{N}_weekend` string.
    shift: str
    # Per-direction / weekday-weekend sibling rows carry these typed fields instead
    # of encoding them in `shift`: direction_id is the GTFS direction (0/1, None on
    # the busiest-direction headline rows); day_type is weekday|weekend (None on the
    # headline rows). Both default None so already-published snapshots still validate.
    direction_id: int | None = None
    day_type: str | None = None
    scheduled_min: float | None = None
    observed_min: float | None = None
    # excess_wait_min is GRAIN-DEPENDENT by source (FIX-1):
    #  • WINDOWED rows (headway_by_grain, built from gold.route_headway_shift_daily, which
    #    carries the additive moment sums) = true passenger-weighted Excess Wait Time,
    #    EWT = max(0, AWT − scheduled/2) where AWT = Σgap²/(2·Σgap) is the wait a random
    #    rider actually expects (bunching-aware: long gaps catch more riders). Clamped at 0.
    #  • SCALAR whole-history rows (build_route_reliability, off gold.route_headway_by_shift,
    #    which has NO moment sums) = the older typical-gap PROXY max(0, observed − scheduled),
    #    a full-headway gap difference with no variance term. Migrate that table to retire the
    #    proxy. Both honest-None when scheduled or the gap sample is absent.
    excess_wait_min: float | None = None
    # Tier-2 regularity (busiest-direction rows only): cov = stddev/mean of the
    # observed trip-start gaps (None when fewer than 2 gaps); bunched_pct = % of
    # gaps under half the shift median headway (None when no gaps).
    cov: float | None = None
    bunched_pct: float | None = None
    # S7-B windowable §2 (additive-optional; None on scalar whole-history rows + the first
    # window with no prior). observation_count = the window's in-clamp gap sample n (the
    # CoV/median denominator, so a delta is interpretable); prior_observation_count +
    # prior_observed_min are the SAME shift over the immediately-prior equal-length window,
    # so the web renders a period-over-period delta on the wait + gates its significance by n.
    observation_count: int | None = None
    prior_observation_count: int | None = None
    prior_observed_min: float | None = None

class ServiceSpanPeriod(BaseModel):
    # Per-route service span over one GTFS SERVICE DAY (start_date), NOT the calendar capture
    # day (FIX-2) — so an overnight trip stays on its own service day instead of faking a ~00:00
    # first departure on the next calendar day. "trip start" = first realtime observation of a
    # trip (not the scheduled departure). first_trip_delay = the FIRST trip's first-observation
    # deviation; last_trip_delay = the LAST trip's LATEST (terminal) observation deviation
    # (minutes) — the old build read the last trip's first obs (~0). date is the service day;
    # service_day_kind is derived from it by consumers (weekday/weekend). NOTE: because a service
    # day can run past local midnight, last_trip_utc may fall on the next calendar day (the web
    # renders it on a >24h service-day clock).
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

class CrowdingDelayCell(BaseModel):
    # Per-route delay×crowding, TRULY co-observed (FIX-3): each delay observation carries its OWN
    # occupancy band (the vehicle's occupancy_status, matched onto the delay fact by the vpm
    # LATERAL), so a band's avg/p50 is its REAL delay distribution over a trailing 30d window —
    # the full/standing tail is no longer censored by a day's dominant band (the old design). band
    # uses the same vocabulary as OccupancyMix / route_occupancy_band_daily (empty/many_seats/
    # few_seats/standing/full; codes 3 and 4 fold to standing). Cells are observation-weighted;
    # each field is None when its input is absent. p50_min is a best-effort observation-weighted
    # mean of the contributing daily band p50s (an approximation — daily percentiles are not
    # exactly additively composable). The web labels this "typical" (not "median") because it is a
    # mean of daily medians, not a pooled percentile. RAMP-IN: co-observation accrues forward only
    # from the deploy (occupancy_status is forward-filled), so bands are sparse / empty until the
    # rollup fills.
    band: str
    avg_delay_min: float | None = None
    p50_min: float | None = None
    observation_count: int | None = None
    day_count: int | None = None

class CrosstabCell(BaseModel):
    # Tier-3 2D delay crosstab cell derived from gold.route_delay_spine: the
    # per-route reliability for ONE (shift, day_type) intersection, regrouped from
    # the same spine rows as the 1D by_shift / by_daytype grains (so the cells
    # reconcile with those marginals). shift uses the canonical time-of-day token
    # (am_peak|midday|pm_peak|evening|night); day_type is weekday|weekend. The web
    # reshapes a 5-shift x 2-day_type grid and shows a no-data MESSAGE per absent
    # cell, so the list is SPARSE — only cells with observations are emitted.
    # Honest-NULL: every metric is None (never a fabricated 0) when its input is
    # absent. otp_pct is a REAL on_time/known OTP (the table carries an
    # on_time_observation_count).
    shift: str
    day_type: str
    otp_pct: float | None = None
    avg_delay_min: float | None = None
    severe_pct: float | None = None
    observation_count: int | None = None

class RouteHabits(BaseModel):
    scale: str
    # Per-route relative-problem heatmap: each cell is a fraction of the route's
    # worst (dow,hour) cell in [0,1] (1.0 = worst hour), or null where the route
    # had no observations for that cell (slice-9.1.1x).
    matrix: list[list[float | None]] = Field(default_factory=list)

class WeakStop(BaseModel):
    id: str
    name: str | None = None
    avg_delay_min: float | None = None
    # S7-B windowable §4 (DB-PR-3) — additive-optional, populated ONLY in weak_stops_by_grain;
    # the scalar whole-history weak_stops[] leaves them None (a Pydantic null, within budget at
    # the N=15 cap). observation_count = in-clamp delay n in the window. severe_pct = the severe-
    # delay (>300s) share. wilson_lo/wilson_hi = the 95% Wilson interval of the NOT-SEVERE rate
    # (k = obs - severe), PERCENT [0,100] — the SAME confidence channel build_stop_reliability
    # already uses for stops (historic.py:1884/1903). A LOW wilson_lo = chronically severe =
    # "worst"; a tiny-n fluke is gated out by the MIN_N=30 floor in the recompose, NOT by Wilson
    # alone (a 4-of-4-severe stop pins the not-severe lower bound at 0.0%, n-independent).
    observation_count: int | None = None
    severe_pct: float | None = None
    wilson_lo: float | None = None
    wilson_hi: float | None = None

class RouteDayOfWeek(BaseModel):
    # Per-route weekday seasonality from gold.route_delay_spine, GROUP BY ISO dow
    # (1=Mon..7=Sun). trip_count is intentionally omitted (no additive distinct-trip
    # count at the spine's hour grain).
    day_of_week_iso: int
    avg_delay_min: float | None = None
    severe_pct: float | None = None
    observation_count: int | None = None

class OccupancyByGrain(BaseModel):
    # S7: grain-aware crowding band-shares for the §04 surface. grain is one of
    # 'day' (most recent closed local day), 'week' (trailing 7d), 'month' (trailing
    # 30d — reconciles with the scalar occupancy_mix). mix is None when the window
    # has no band-bearing telemetry (honest absence, never a fabricated all-zero
    # mix), the same rule as occupancy_mix.
    grain: str
    mix: OccupancyMix | None = None

class OccupancyByDow(BaseModel):
    # S7: crowding band-shares grouped by ISO weekday (1=Mon..7=Sun) over the same
    # trailing-30d window as occupancy_mix, for the §04 weekday/weekend split. mix
    # is None when a weekday has data-days but no band telemetry. Only weekdays with
    # data-days are emitted (sparse).
    day_of_week_iso: int
    mix: OccupancyMix | None = None
    # n is the total band-bearing observation count summed over this ISO weekday's
    # trailing-30d days (the share denominator already computed-and-discarded in
    # _occupancy_mix_from_bands). Lets the web fold a TRIP-WEIGHTED weekday/weekend mix
    # instead of a count-blind unweighted mean. Mirrors RouteDayOfWeek.observation_count;
    # it is the sum of the 5 band counts, NOT a distinct-trip count. n=0 (not None) on a
    # weekday with data-days but zero band telemetry (where mix is None).
    n: int | None = None

class OccupancyByHour(BaseModel):
    # GC2 H3: crowding band-shares grouped by LOCAL hour-of-day (0..23) over the same
    # trailing-30d window as occupancy_mix, for the §04 time-of-day (rush-hour vs
    # midday) split. Sourced from gold.route_occupancy_band_hourly (migration 0074) —
    # a pure additive companion to occupancy_by_dow/occupancy_by_grain, all three
    # reduce the SAME fact rows (daily == Σ hourly). mix is None when an hour has
    # data-days but no band telemetry; only hours with data-days are emitted (sparse).
    hour_of_day_local: int
    mix: OccupancyMix | None = None
    # n = the total band-bearing observation count summed over this local hour's
    # trailing-30d days (the share denominator). n=0 (not None) on an hour with
    # data-days but zero band telemetry (where mix is None). Mirrors OccupancyByDow.n;
    # it is the sum of the 5 band counts, NOT a distinct-trip count.
    n: int | None = None

class ReliabilityByGrain(BaseModel):
    # S7-B windowable §1: the per-route delay breakdowns (by_shift / by_daytype /
    # day_of_week / 2D crosstab) recomputed over ONE time window, so the "When to ride"
    # section answers Today / This week / This month (not just whole-history). grain is
    # 'day' | 'week' | 'month'; the window is TRAILING-N-days anchored on the route's
    # newest closed day (day = anchor; week = anchor-6..anchor; month = anchor-29..anchor),
    # matching the web's windowByGrain so the mapper is a pure .find(grain) pass-through.
    # An arbitrary date-range is NOT emitted here (it stays a §0/§3 daily-array feature).
    # date is the window START (ISO). Element types are PRESERVED (RouteDayOfWeek /
    # CrosstabCell), not coerced to ReliabilityPeriod. Honest absence: a grain with no
    # spine rows in its window is omitted from the list, never a fabricated empty bucket.
    grain: str
    date: str | None = None
    by_shift: list[ReliabilityPeriod] = Field(default_factory=list)
    by_daytype: list[ReliabilityPeriod] = Field(default_factory=list)
    day_of_week: list[RouteDayOfWeek] = Field(default_factory=list)
    by_shift_daytype: list[CrosstabCell] = Field(default_factory=list)

class RouteHabitsByGrain(BaseModel):
    # S7-B windowable §1 heatmap: the 7x24 repeat-problem matrix recomposed from
    # gold.route_delay_spine over ONE trailing window (same grains/windows as
    # ReliabilityByGrain). SAME lineage as the scalar `habits` post-S14: BOTH read the ONE
    # reconciled repeat_problem_score (gold/reader ROUTE_HABIT_SPINE_SQL / gold/reader/
    # score.py) off the spine — this one windowed by the trailing grain, the scalar over an
    # all-time window (the dropped route_habit_score mart's whole-history aggregate). Each
    # window NORMALIZES to its OWN worst cell, so a 1.0 in 'day'
    # and a 1.0 in 'month' are different absolute magnitudes (relative-to-route scale, per
    # the Chart Doctrine). Per-cell MIN_N: a (dow,hour) cell with < 30 known-delay
    # observations in the window is dropped (counted in cells_suppressed); when NO cell
    # clears the floor, habits is None (the web shows one "not enough observations" chip,
    # never a sea of grey cells). date is the window START (ISO).
    grain: str
    date: str | None = None
    habits: RouteHabits | None = None
    cells_observed: int = 0
    cells_suppressed: int = 0

class HeadwayByGrain(BaseModel):
    # S7-B windowable §2 ("The wait" follows the grain rail): per-shift scheduled-vs-observed
    # headway + excess wait + CoV/%bunched recomposed over ONE trailing window off
    # gold.route_headway_shift_daily. grain = 'day'|'week'|'month'; the window is TRAILING-N-days
    # anchored on the route's newest closed HEADWAY day (its OWN anchor, distinct from the
    # delay-spine anchor) — day=anchor; week=anchor-6..anchor; month=anchor-29..anchor — matching
    # the web windowByGrain so the mapper is a pure .find(grain) pass-through. date = window START.
    # Element type PRESERVED (HeadwayPeriod). Honest absence: a grain with no in-clamp gap rows is
    # OMITTED; cov/bunched_pct stay None under the n>=2 / no-gaps guards. Each window publishes the
    # BUSIEST DIRECTION ONLY (~5 shift rows) via the per-window argmax (SUM(trip_count) DESC,
    # direction_id ASC) — DELIBERATELY replacing the legacy global-14d argmax, so the headline
    # direction can differ per grain for near-balanced routes (correct windowed semantics).
    # scheduled_min is the STATIC timetable constant (does NOT window); observed_min is CDF-interp
    # over the summed gap histogram (a documented rebaseline vs the legacy percentile_cont median);
    # cov is recomposed SAMPLE sd (Bessel n-1, byte-identical to the legacy stddev_samp) from pooled
    # moments; bunched_pct is the summed-histogram mass below 0.5*windowed_median. The clamp
    # 0<gap<240 + the n>=2 guard are byte-identical to route_headway_by_shift. excess_wait_min here
    # is the TRUE passenger-weighted Excess Wait Time (FIX-1): max(0, AWT - scheduled/2), AWT =
    # sum(gap^2)/(2*sum(gap)) from the pooled moments — a half-headway, bunching-aware quantity, so
    # it reads SMALLER than (and is not comparable to) the scalar whole-history gap proxy.
    grain: str
    date: str | None = None
    headway: list[HeadwayPeriod] = Field(default_factory=list)

class WeakStopGrain(BaseModel):
    # S7-B windowable §4 ("Where it's worst" follows the grain rail): the worst-N stops on this
    # route recomposed over ONE trailing window off gold.stop_delay_spine. grain='day'|'week'|'month';
    # window anchored on the route's newest closed STOP-DELAY day (its OWN anchor, distinct from the
    # delay-spine + headway anchors) — day=anchor; week=anchor-6..anchor; month=anchor-29..anchor.
    # date = window START (ISO). stops are RANKED by the not-severe Wilson LOWER bound ASC (a low LB
    # = chronically severe; a tiny-n fluke can't out-rank a high-n chronic offender), MIN_N=30 hard
    # floor (a stop with < 30 in-window obs is OMITTED, never avg=0), truncated to the stored cap
    # (15). avg_delay_min is the displayed lollipop magnitude (a documented rebaseline vs the legacy
    # triple-rounded weekly avg). A grain with no qualifying stop is OMITTED entirely (honest
    # absence). The web's selectable Top-10/25/All re-truncates over what is served; "All" = all 15
    # stored, never all stops in the window.
    grain: str
    date: str | None = None
    stops: list[WeakStop] = Field(default_factory=list)

# S7-B payload guard: the published route_reliability/{id}.json must stay under this
# many bytes (model_dump_json, UTF-8 — the exact bytes the publisher writes). 90 KiB
# clears the measured worst case (clean ~83.7 KB with weak_stops_by_grain at the N=15
# cap AND the GC2 H1 scheduled/delivered/silent/completeness cancellation fields on 30
# periods, ~8.4 KB margin) while still CATCHING a windowed-histogram regression (the F1
# variant lands ~101.4 KB). A CI test asserts BOTH (clean fits, F1 breaches). History:
# 65536 -> 81920 in DB-PR-3; 81920 -> 92160 in GC2 H1 (the 4 additive-optional
# cancellation fields legitimately push the clean worst case from ~79.2 KB to ~83.7 KB,
# consuming the old ~2.7 KB margin — re-anchored on the measured value). Exported so the
# web can share it.
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
    # Tier-1 additive: per-day cancellation history + trailing-window crowding
    # band-shares. cancellations defaults empty, occupancy_mix None when absent.
    cancellations: list[CancellationPeriod] = Field(default_factory=list)
    occupancy_mix: OccupancyMix | None = None
    # Tier-2 additive: per-day service-span / first-last punctuality history.
    service_spans: list[ServiceSpanPeriod] = Field(default_factory=list)
    # Tier-2 additive: per-day skipped-stop rate history (ramp-in, no backfill).
    skipped_stops: list[SkippedStopPeriod] = Field(default_factory=list)
    # Track-B additive: per-band delay×crowding correlation over a trailing 30d
    # window (each route×day attributed to its dominant occupancy band). Empty
    # when the route has no occupancy telemetry in the window.
    delay_by_crowding: list[CrowdingDelayCell] = Field(default_factory=list)
    # Tier-3 additive: 2D shift x day_type delay crosstab derived from
    # gold.route_delay_spine. SPARSE — only (shift, day_type) cells with
    # observations are emitted; the web reshapes a 5x2 grid and shows a no-data
    # MESSAGE per absent cell. Defaults empty so already-published snapshots
    # lacking this key still validate. Purely additive.
    by_shift_daytype: list[CrosstabCell] = Field(default_factory=list)
    # S7 additive: crowding band-shares re-grouped for the grain-aware §04 surface.
    # occupancy_by_grain = the mix at day/week/month windows (month reconciles with
    # occupancy_mix); occupancy_by_dow = the mix per ISO weekday (weekday/weekend
    # split). Both reuse the same route_occupancy_band_daily source as occupancy_mix;
    # honest-None per bucket with no band telemetry. Default empty so already-
    # published snapshots lacking these keys still validate.
    occupancy_by_grain: list[OccupancyByGrain] = Field(default_factory=list)
    occupancy_by_dow: list[OccupancyByDow] = Field(default_factory=list)
    # GC2 H3 additive-optional: crowding band-shares re-grouped by LOCAL hour-of-day
    # for the §04 time-of-day (rush-hour vs midday) surface. Reads
    # gold.route_occupancy_band_hourly (daily == Σ hourly); honest-None per hour with
    # no band telemetry. Default empty so already-published snapshots lacking this key
    # still validate.
    occupancy_by_hour: list[OccupancyByHour] = Field(default_factory=list)
    # S7-B windowable §1 (additive-optional): the When-to-ride breakdowns + heatmap
    # recomputed per time window (day/week/month) off gold.route_delay_spine, so §1
    # follows the grain rail like §0/§3. The scalar `periods`/`habits`/`day_of_week`/
    # `by_shift_daytype` above STAY the whole-history representation (back-compat); these
    # are the windowed companions. Default empty so already-published snapshots validate.
    periods_by_grain: list[ReliabilityByGrain] = Field(default_factory=list)
    habits_by_grain: list[RouteHabitsByGrain] = Field(default_factory=list)
    # S7-B windowable §2 (additive-optional): per-shift headway recomputed per time window
    # (day/week/month) off gold.route_headway_shift_daily, so §2 follows the grain rail. The
    # scalar `headway` above STAYS whole-history (back-compat — still reads route_headway_by_shift
    # until the 0066 fast-follow re-points it). Default empty so already-published snapshots validate.
    headway_by_grain: list[HeadwayByGrain] = Field(default_factory=list)
    # S7-B windowable §4 (additive-optional): worst-N stops per day/week/month off
    # gold.stop_delay_spine, ranked by the not-severe Wilson lower bound (the
    # build_stop_reliability house pattern). The scalar `weak_stops` above STAYS
    # whole-history (back-compat — reads stop_delay_weekly until the 0067 fast-follow).
    # Default empty so already-published snapshots validate.
    weak_stops_by_grain: list[WeakStopGrain] = Field(default_factory=list)

class StopReliabilityPeriod(BaseModel):
    grain: str
    otp_pct: int | None = None
    avg_delay_min: float | None = None
    p50_min: float | None = None
    p90_min: float | None = None
    severe_pct: float | None = None
    # Chart Doctrine honesty fields (slice-S3, additive-optional). observation_count
    # is the stop's delay-observation denominator. CAVEAT: stop otp_pct is the
    # SEVERE-delay proxy (_otp_pct_severe_proxy), so wilson_lo/wilson_hi bound the
    # NOT-SEVERE proportion (k=obs-severe, n=obs) in PERCENT — NOT a real on_time OTP.
    # Do NOT rank stops and routes on one Wilson scale. None when the denominator is
    # absent (e.g. the day grain carries percentiles only, no observation_count).
    observation_count: int | None = None
    wilson_lo: float | None = None
    wilson_hi: float | None = None

class StopByRoute(BaseModel):
    route: str
    avg_delay_min: float | None = None

class StopDailyPoint(BaseModel):
    # One closed provider-local day for a stop, SUMMED across all of the stop's
    # routes (the whole-stop view — same all-routes rollup as periods/by_route).
    # SERVE-THE-COUNTS contract: observation_count + severe_count are the exact
    # additive ingredients, so the web can pool an ARBITRARY date range by summing
    # counts and recompute severe_pct + a Wilson interval client-side ($lib/v1/stats)
    # with zero fabricated re-aggregation. severe_pct / avg_delay_min are the
    # per-day convenience readouts derived from those same ingredients.
    # CAVEAT (stop OTP severe-proxy): a stop has no scheduled on-time definition,
    # so severe_pct is the SEVERE(>300s)-delay share among delay observations —
    # NOT a real on-time percentage. Do not compare it to route on_time_pct.
    # Honest-NULL: severe_pct / avg_delay_min are None when observation_count is 0
    # (a zero-observation day is absent from the series, never emitted as a 0-row).
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
    # Per-stop 7x24 (dow x hour) heatmap, reusing the RouteHabits shape but on a
    # DISTINCT scale ('severe_relative'): each cell is the stop's severe-delay count
    # relative to its own worst cell — NOT the route repeat-problem score, so a
    # shared legend can't conflate the two.
    habits: RouteHabits | None = None
    # Per-stop weekday seasonality (ISO 1=Mon..7=Sun), computed on the fly from
    # gold.stop_delay_hourly. Reuses the RouteDayOfWeek shape for route parity; here
    # observation_count is the summed hourly observation count for the weekday and
    # avg_delay_min is the observation-weighted COALESCE(arrival, departure) delay.
    day_of_week: list[RouteDayOfWeek] = Field(default_factory=list)
    by_route: list[StopByRoute] = Field(default_factory=list)
    # Trailing-30d crowding band-shares for the stop, summed from the append-only
    # gold.stop_occupancy_band_daily reduction (GTFS-RT OccupancyStatus attributed
    # to this stop). Additive-optional: null when no occupancy telemetry was
    # attributed to the stop — an all-zero mix is indistinguishable from a real
    # all-empty fleet, so absence surfaces as None, never a fabricated split.
    occupancy_mix: OccupancyMix | None = None
    # S8 additive-optional: per-day delay history over the trailing ~90 CLOSED
    # provider-local days, SUMMED across the stop's routes, off gold.stop_delay_spine
    # via the reader window kernel. SERVE-THE-COUNTS — each point carries the exact
    # observation_count + severe_count so the web pools an arbitrary sub-range by
    # summing counts and recomputes severe_pct + a Wilson interval client-side, with
    # NO fabricated re-aggregation. Zero-observation days are ABSENT (never zero-
    # filled). severe_pct is the stop SEVERE-delay proxy (no scheduled-OTP concept
    # exists at a stop), not a real on-time rate. Default empty so already-published
    # snapshots lacking this key still validate.
    daily: list[StopDailyPoint] = Field(default_factory=list)

class Hotspot(BaseModel):
    rank: int
    type: str
    id: str
    name: str | None = None
    severity: str | None = None
    otp_delta_pts: float | None = None

class HotspotEntry(BaseModel):
    # S12 evidence-rich per-entry shape for the re-granulated by_grain ladders.
    # Distinct from the minimal scalar Hotspot (kept byte-identical for parity): an
    # entry carries the FULL confidence channel so the citizen sees WHY it ranks and
    # the web can pool/whisker it honestly. rank = 1-based position WITHIN this grain
    # ladder AND WITHIN this entry's OWN kind (WEB2): route and stop are ranked on
    # SEPARATE ladders, so rank RESTARTS per kind (a route rank=1 and a stop rank=1
    # co-exist in the same grain's entries[]) — NOT sequential across kinds, and a
    # display-N truncation never rescales it (the selectWeakStops invariant); a
    # sub-MIN_N tray entry carries rank=None. type = 'route'|'stop' discriminator (the
    # web filters entries[] by type into per-kind tabs losslessly).
    # RANKING (WEB1/WEB2): entries are ordered by the NOT-SEVERE Wilson LOWER bound ASC
    # on the SEVERE-delay proxy, ranked PER KIND (route on_time is available but NOT
    # used for ranking, to keep the severe-rate metric identical across kinds; it drives
    # the display otp_delta_pts instead). wilson_lo/wilson_hi = the 95% interval of that
    # not-severe rate, PERCENT [0,100]. observation_count = in-clamp delay n in the
    # window; severe_count = the >300s count; severe_pct = severe/obs. issue_count is
    # RESERVED — stays None (S14 resolution, 2026-07-02): NOT wired. by_grain entries are
    # TRAILING-window (GrainWindows day/week/month anchored on the newest closed day), but
    # the recurrence mart gold.repeated_problem_route_stop is ISO-WEEK grain — joining an
    # ISO-week issue_count onto a trailing-window entry is a dishonest window mismatch. The
    # canonical severe-count channel for a windowed entry is severe_count itself (same
    # trailing window, same spine); the ISO-week mart remains ONLY the scalar hotspots-board
    # feed. Kept reserved (never a fabricated 0) rather than populated with a mismatched join.
    # otp_delta_pts = the entity OTP minus
    # a SAME-METRIC network baseline for the SAME window (honest-None when either side
    # is unknown, or when no per-window baseline exists). avg_delay_min = the pooled
    # in-clamp mean (a documented rebaseline vs the mart's triple-rounded avg).
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
    # S12 one re-granulated worst-N ladder for ONE grain, mirroring WeakStopGrain.
    # grain='day'|'week'|'month' anchored on the network's newest CLOSED day per spine
    # (day=anchor; week=anchor-6..anchor; month=anchor-29..anchor); the 4th 'shift'
    # grain is PEAK-ONLY — it buckets over the am+pm peak (rush-hour) periods of the
    # trailing week only (route via the kernel hour->shift CASE over route_delay_spine
    # scoped to the peak shifts; stop via gold.stop_delay_shift_daily filtered to the
    # peak shifts) and carries date=None (shift is a within-window cut, not a trailing
    # date window). date = window START (ISO) for the date grains, None for 'shift';
    # window_end = the window END (ISO), None for 'shift'. entries = the FULL Wilson-
    # ranked set of entities clearing MIN_N in this window — a MIXED route+stop array
    # (type discriminates), ranked PER KIND (route and stop each on their own ladder,
    # rank restarting per kind) THEN truncated to the per-kind stored cap so a smaller
    # display-N never rescales; per-kind order is preserved in the array.
    # total_ranked_routes / total_ranked_stops = the PRE-truncation ranked counts per
    # kind (the honest shown/total denominators — a display-N cap slices these). tray =
    # the UN-ranked entities with obs<MIN_N (rank=None) — the "ALL per city" honest tail
    # (DECISIONS DB2), a union across kinds sorted by severe_pct DESC then capped for the
    # byte budget; tray_total = the PRE-cap tray count. A grain with no qualifying entity
    # is OMITTED entirely (honest absence).
    grain: str
    date: str | None = None
    window_end: str | None = None
    entries: list[HotspotEntry] = Field(default_factory=list)
    tray: list[HotspotEntry] = Field(default_factory=list)
    # WEB2 per-kind pre-truncation ranked counts (additive-optional; None on a pre-fix
    # payload). total_ranked_routes / total_ranked_stops are the honest shown/total
    # denominators the web reads per kind — the count of entities clearing MIN_N for
    # that kind in this window BEFORE the per-kind display cap sliced entries[].
    total_ranked_routes: int | None = None
    total_ranked_stops: int | None = None
    # FIX-6 tray honesty (additive-optional; None on a pre-fix payload): the PRE-cap
    # union tray count, so the web can show tray shown/total honestly.
    tray_total: int | None = None

# S12 payload guard: the published historic/hotspots.json must stay under this many
# bytes (model_dump_json, UTF-8 — the exact bytes the publisher writes). LADDER: the
# scalar hotspots[] top-20 (byte-identical, ~2-3 KB) PLUS the by_grain ladders =
# {day, week, month, shift}, each carrying a MIXED route+stop entries[] ranked PER KIND
# at the stored caps below:
#   * entries -> _HOTSPOTS_BY_GRAIN_CAP = 50 ranked entries per (grain, KIND) — so up to
#                100 entries per grain (50 route + 50 stop) in the mixed array,
#   * tray    -> _HOTSPOTS_TRAY_CAP     = 60 un-ranked tray entries per grain TOTAL
#                (the cross-kind union, sorted severe_pct DESC then capped).
# Worst case = the scalar top-20 PLUS 4 grains (day/week/month + shift) x (100 ranked +
# 60 tray) entries per grain, every ~13 evidence field set + a wide accented name. That
# synthetic worst case measures ~179.5 KB (see test_hotspots_full_payload_under_byte_ceiling
# for the exact number). 262144 (256 KiB) clears it with ~1.46x headroom while STILL
# catching a runaway (an un-capped all-per-city tray on the STM stop universe of thousands
# of stops x 4 grains measures ~2.78 MB — see test_hotspots_uncapped_tray_breaches_ceiling).
# If a real-DB probe ever exceeds this ceiling the tray degrades to a documented count-only
# (DECISIONS DB2): drop tray entries, keep tray_total, and record the honest degradation
# here. Exported so the web can share the constant. History: introduced at S12 (256 KiB;
# worst-case ~102 KB at the old merged 30-cap); re-measured at the WEB2 per-kind 50-cap
# (worst-case ~179.5 KB — still 1.46x under the ceiling, no tray-tightening needed).
HOTSPOTS_BYTE_CEILING = 262144

class Hotspots(PayloadEnvelope):
    generated_utc: str
    hotspots: list[Hotspot] = Field(default_factory=list)
    # S12 additive-optional: the re-granulated evidence-rich worst-N ladders. Default
    # empty so already-published hotspots.json (scalar-only) still validates under the
    # additive-optional growth rule; the scalar hotspots[] above stays BYTE-IDENTICAL.
    # Ordered day, week, month, shift per the grain rail; each HotspotGrain interleaves
    # route+stop entries ranked on the one cross-kind severe-rate Wilson LB (WEB1).
    by_grain: list[HotspotGrain] = Field(default_factory=list)

class Offender(BaseModel):
    type: str
    id: str
    route: str | None = None
    # Offenders are 'trip'/'vehicle' entities with no display name of their
    # own — the route context carries the resolved name instead.
    route_name: str | None = None
    # recurrence = the legacy pre-formatted "N/14d" string (KEPT byte-identical for
    # parity). S14 ADDITIVE structured twins so the web stops parsing that string and
    # stops re-deriving severity client-side: recurrence_days = the N (distinct severe
    # days), window_days = the mart's fixed 14-day window (the M), severity = the mart's
    # published severity_label. All optional/None on a legacy payload (additive-optional
    # growth rule); populated straight from the columns the scalar mart query already
    # selects, so the scalar list's order + legacy fields stay byte-stable.
    recurrence: str | None = None
    recurrence_days: int | None = None
    window_days: int | None = None
    avg_delay_min: float | None = None
    severity: str | None = None

class RepeatOffenderEntry(BaseModel):
    # S14 evidence-rich per-entry shape for the re-granulated by_grain recurrence ladders,
    # mirroring HotspotEntry. Distinct from the minimal scalar Offender (kept byte-identical
    # for parity): an entry carries the FULL confidence channel so the citizen sees WHY it
    # ranks and the web can pool/whisker it honestly. rank = 1-based position WITHIN this
    # grain ladder AND WITHIN this entry's OWN kind: trip and vehicle are ranked on SEPARATE
    # ladders, so rank RESTARTS per kind (a trip rank=1 and a vehicle rank=1 co-exist in one
    # grain's entries[]) — NOT sequential across kinds, and a display-N truncation never
    # rescales it; a sub-MIN_N tray entry carries rank=None. type = 'trip'|'vehicle'
    # discriminator (the web filters entries[] by type into per-kind tabs losslessly).
    # RANKING: entries are ordered by the NOT-severe Wilson LOWER bound ASC on the SEVERE-
    # delay proxy (the S12 canonical ranking, MIN_N_RATE=30 observation floor) — the SAME
    # metric across kinds so a trip and a vehicle share one comparable scale. wilson_lo/
    # wilson_hi = the 95% interval of that not-severe rate, PERCENT [0,100]. observation_count
    # = the in-clamp delay n in the window; severe_count = the >300s count; severe_pct =
    # severe/obs. recurrence_days = COUNT(DISTINCT date WHERE the entity was severe that day)
    # in the window — EVIDENCE ("late-prone on N of observed_days days"), NOT the rank key;
    # observed_days = COUNT(DISTINCT date the entity was observed at all). window_days = the
    # trailing window length. avg_delay_min = the pooled in-clamp mean (Σsum_delay/Σobs/60,
    # honest-None on a zero denominator). severity = the SAME declared vocabulary the scalar
    # mart uses (recurrence>=10 OR avg>600 critical; >=5 high; else watch — S14 D4), computed
    # on the entry's OWN window; absent -> honest-absence neutral, never recomputed by the web.
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
    # S14 one re-granulated repeat-offender ladder for ONE grain, mirroring HotspotGrain.
    # grain = 'week'|'month' ONLY — a repeat offender is UNDEFINED on a single day (you
    # cannot "repeat" within one day), so a 'day' grain would be alarmist noise, not signal;
    # the trailing week/month windows are the smallest honest recurrence horizons. Windows
    # are anchored on the spine's newest CLOSED provider_local_date (week = anchor-6..anchor,
    # month = anchor-29..anchor). window_days = the trailing window length. entries = the FULL
    # Wilson-ranked set of entities clearing MIN_N in this window — a MIXED trip+vehicle array
    # (type discriminates), ranked PER KIND (trip and vehicle each on their own ladder, rank
    # restarting per kind) THEN truncated to the per-kind stored cap so a smaller display-N
    # never rescales; per-kind order is preserved in the array. total_ranked_trips /
    # total_ranked_vehicles = the PRE-truncation ranked counts per kind (the honest shown/total
    # denominators). tray = the sub-MIN_N entities that STILL recurred (recurrence_days>=2),
    # rank=None — the honest "not enough observations to rank, but repeatedly late" tail, a
    # union across kinds sorted by severe_pct DESC then capped for the byte budget; tray_total
    # = the PRE-cap tray count. A grain with no qualifying entity (no spine rows in its window)
    # is OMITTED entirely (honest absence).
    grain: str
    window_days: int | None = None
    entries: list[RepeatOffenderEntry] = Field(default_factory=list)
    tray: list[RepeatOffenderEntry] = Field(default_factory=list)
    total_ranked_trips: int | None = None
    total_ranked_vehicles: int | None = None
    tray_total: int | None = None

# S14 payload guard: the published historic/repeat_offenders.json must stay under this many
# bytes (model_dump_json, UTF-8 — the exact bytes the publisher writes). LADDER: the scalar
# offenders[] top-50 (byte-identical, ~5-8 KB with the additive structured fields) PLUS the
# by_grain ladders = {week, month}, each carrying a MIXED trip+vehicle entries[] ranked PER
# KIND at the caps below (mirroring the S12 hotspots cap sizing):
#   * entries -> _OFFENDERS_BY_GRAIN_CAP = 50 ranked entries per (grain, KIND) — so up to
#                100 entries per grain (50 trip + 50 vehicle) in the mixed array,
#   * tray    -> _OFFENDERS_TRAY_CAP     = 60 un-ranked tray entries per grain TOTAL.
# Worst case = the scalar top-50 PLUS 2 grains (week/month) x (100 ranked + 60 tray) entries,
# each ~12 evidence field set + an accented route name. That is roughly HALF the S12 hotspots
# worst case (2 grains vs 4), which measured ~179.5 KB under the same 256 KiB ceiling — so the
# same 262144 (256 KiB) ceiling clears this with ample headroom while still catching a runaway
# (an un-capped all-entity tray on the STM trip/vehicle universe x 2 grains). If a real-DB
# probe ever exceeds this ceiling the tray degrades to a documented count-only (drop tray
# entries, keep tray_total). Exported so the web can share the constant. Introduced at S14.
REPEAT_OFFENDERS_BYTE_CEILING = 262144

class RepeatOffenders(PayloadEnvelope):
    generated_utc: str
    offenders: list[Offender] = Field(default_factory=list)
    # S14 additive-optional: the re-granulated evidence-rich recurrence ladders. Default
    # empty so already-published repeat_offenders.json (scalar-only) still validates under
    # the additive-optional growth rule; the scalar offenders[] above stays BYTE-IDENTICAL
    # (save the additive structured twins on each Offender, which default None). Ordered
    # week, month per the grain rail; each grain interleaves trip+vehicle entries ranked on
    # the one per-kind severe-rate Wilson LB.
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
    # S13 time-of-day cut of the receipt's day: the network-wide delay/severe reading
    # for ONE canonical shift (am_peak|midday|pm_peak|evening|night), summed across all
    # route-attributed observations off gold.route_delay_spine at its hour grain. shift
    # is the bare shift token (the canonical SHIFT_BOUNDS order). observation_count is
    # the in-window known-delay denominator; severe_count the >300s count; severe_pct =
    # severe/obs. avg_delay_min is the POOLED ghost-excluded mean (Σ sum_delay_seconds /
    # Σ in-clamp histogram bins) — IDENTICAL methodology to the day-level avg_delay_min
    # scalar, so a shift cut and the day scalar reconcile. Honest-NULL (None, never 0)
    # when a shift has no in-clamp observations. A shift with zero observations is
    # OMITTED from by_shift entirely (honest absence).
    shift: str
    observation_count: int | None = None
    severe_count: int | None = None
    severe_pct: float | None = None
    avg_delay_min: float | None = None

class ReceiptNotReportedRoute(BaseModel):
    # S13 one route that was SCHEDULED that day but produced ZERO realtime observations
    # (total_trip_days=0 AND scheduled_trip_days>0) — distinct from a route with
    # canceled_trip_days>0 (explicitly cancelled in the RT feed). scheduled_trip_days is
    # the honest scheduled denominator RT never saw. id is never a sentinel; name is the
    # resolved display name (honest-None when unresolved).
    id: str
    name: str | None = None
    scheduled_trip_days: int | None = None

class ReceiptServiceStates(BaseModel):
    # S13 the receipt day's scheduled→delivered→cancelled→silent service-state split,
    # summed network-wide off gold.route_cancellation_daily (GC2 scheduled universe).
    # scheduled_trip_days = Σ scheduled trip-days (the honest denominator); delivered =
    # Σ delivered FILTER(scheduled known); cancelled = Σ canceled_trip_days; silent = Σ
    # silent FILTER(scheduled known). service_completeness_pct = LEAST(100, 100 *
    # Σdelivered / Σscheduled) — the ONE completeness number for the receipt (DECISIONS
    # DB1); None (never a fabricated 0/100) when Σscheduled is NULL or 0 (pre-0073
    # history / no schedule edition). not_reported_route_count is the PRE-cap total count
    # of not-reported routes that day (the honest shown/total denominator — a mass-outage
    # day reads count=200, list=top 50); not_reported_routes is that list capped at
    # NOT_REPORTED_ROUTES_CAP (top by scheduled_trip_days DESC). All counts honest-NULL
    # (None) when the scheduled universe is unknown, never a fabricated 0.
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
    # S13 additive-optional re-granulation. All default empty/None so an already-published
    # receipt (scalar-only) stays FIELD-IDENTICAL (a republished pre-S13 receipt gains only the additive keys) under the additive-optional growth
    # rule — the scalar fields above are UNTOUCHED. by_shift = the day's time-of-day cuts
    # (ordered by the canonical shift order; a shift with no observations is omitted).
    # service_states = the day's scheduled→delivered→cancelled→silent split + the
    # not-reported-routes list + the ONE service_completeness_pct (DECISIONS DB1: the web
    # heroes completeness from service_states, no duplicate top-level scalar).
    by_shift: list[ReceiptShiftCut] = Field(default_factory=list)
    service_states: ReceiptServiceStates | None = None

# S13 NOT-reported route list cap: the top-N routes (by scheduled_trip_days DESC) that
# were scheduled yet produced ZERO realtime observations on the receipt day. The list is
# capped so a mass-outage day (STM ~200 routes) cannot bloat a single receipt file;
# ReceiptServiceStates.not_reported_route_count carries the honest PRE-cap total so the
# web renders "showing 50 of 200". Mirrors the HotspotGrain per-kind cap feel.
NOT_REPORTED_ROUTES_CAP = 50

# S13 payload guard: a published historic/receipts/{date}.json must stay under this many
# bytes (model_dump_json, UTF-8 — the exact bytes the publisher writes). LADDER: the
# scalar receipt (~1 KB) PLUS by_shift (≤5 shift cuts) PLUS service_states with a full
# NOT_REPORTED_ROUTES_CAP list, each a {id, wide-accented name, scheduled count}. A
# synthetic worst case (5 shift cuts + 50 not-reported routes with wide names) measures
# well under 64 KiB (see test_receipt_full_payload_under_byte_ceiling for the exact
# number). 65536 (64 KiB) clears it with generous headroom while STILL catching a runaway
# (an un-capped all-route not-reported list on a whole-network-dark day). Exported so the
# web can share the constant. History: introduced at S13.
RECEIPT_BYTE_CEILING = 65536

class AlertHistoryEntry(BaseModel):
    id: str
    severity: str | None = None
    # slice-9.1.1s additive bilingual header. EN surfaced via MAX() in the
    # builder; honest-NULL when STM published no English variant.
    header_text: str | None = None
    header_text_en: str | None = None
    # Raw source descriptions. EN stays honest-NULL when STM omitted it; the
    # shared web resolver owns locale fallback, legacy cleanup, and HTML scrub.
    description: str | None = None
    description_en: str | None = None
    routes: list[str] = Field(default_factory=list)
    stops: list[str] = Field(default_factory=list)
    start_utc: str | None = None
    end_utc: str | None = None
    duration_min: float | None = None
    impact_passages: int | None = None
    # S15 additive. cause/effect/severity_level are the raw upstream values the
    # source view already carries (closing the entry-vs-breakdown gap); url is the
    # citizen-facing link (post-0077 alerts only, honest-NULL before). start_utc /
    # end_utc above stay the primary window[0]; active_periods lists ALL windows
    # (a 1-element list = the scalar pair for pre-0077 history).
    cause: str | None = None
    effect: str | None = None
    severity_level: str | None = None
    url: str | None = None
    active_periods: list[AlertActivePeriod] = Field(default_factory=list)

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

# S15 payload guard: a published historic/alert_history.json must stay under this
# many bytes (model_dump_json, UTF-8). The window serves the full retention span
# (SILVER_I3_CLOSED_RETENTION_DAYS) newest-first, LIMIT 500 entries; each entry is
# a header + bilingual text + route/stop id lists + cause/effect/url + an
# active_periods list. 524288 (512 KiB) clears a realistic 500-row bilingual
# payload (~369 KiB) with
# generous headroom while catching a runaway (e.g. a window that stopped
# clamping). Exported so the web can share the constant. History: introduced at
# S15 (there was NO ceiling before). The gate + a real-DB probe assert it.
ALERT_HISTORY_BYTE_CEILING = 524288

class AlertHistory(PayloadEnvelope):
    generated_utc: str
    alerts: list[AlertHistoryEntry] = Field(default_factory=list)
    # Tier-2 additive: None when no alerts in the window.
    breakdown: AlertBreakdown | None = None
    # S15 additive window disclosure. window_start / window_end are the served
    # span (ISO dates, the full honest retention window). total_in_window is the
    # PRE-cap distinct-alert count; truncated is True when total_in_window exceeds
    # the emitted alerts[] (the LIMIT fired). All honest-NULL on old payloads
    # built before S15 (the web derives the span from entries then).
    window_start: str | None = None
    window_end: str | None = None
    total_in_window: int | None = None
    truncated: bool | None = None

class ProvenanceSource(BaseModel):
    feed: str
    chain: str | None = None
    last_loaded_utc: str | None = None

class ProvenanceFreshness(BaseModel):
    feed: str
    status: str | None = None
    age_s: int | None = None

class ProvenanceConformance(BaseModel):
    # GTFS feed-conformance for the provider's latest static load, mirroring the
    # DB-only /health check_feed_conformance signal so the UI can render a
    # "data quality" badge. status='out_of_norm' when the feed shipped members
    # this pipeline does not natively model (captured verbatim, never dropped).
    status: str  # 'conformant' | 'out_of_norm'
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


# ---------------------------------------------------------------------------
# Citizen data-health payload (S11) — status/data_health.json
# ---------------------------------------------------------------------------
# The live lane serves a tiny per-publish-lane freshness + last-gate-outcome
# summary so /status can render "how healthy is the pipeline right now" from ONE
# fetch, without scraping the CI gate artifact. 16384 (16 KiB) clears the three
# lanes + a handful of feed rows with generous headroom. Exported so the web can
# share the constant; the gate + a real-DB probe assert it.
DATA_HEALTH_BYTE_CEILING = 16384


class DataHealthGate(BaseModel):
    # Last VALUE-GATE outcome for the lane, persisted per tier on
    # core.snapshot_publish_state (migration 0078). Counts + verdict only — the
    # full results[] stays a CI artifact (cli.py --report-dir). Every field is
    # honest-NULL when the lane predates 0078, was published with the gate
    # disabled, or (static) took the dataset-level SKIP that never ran the gate.
    checks_run: int | None = None
    errors: int | None = None
    warnings: int | None = None
    verdict: str | None = None  # 'pass' | 'warn' | 'fail'
    generated_utc: str | None = None


class LaneHealth(BaseModel):
    # One publish lane's last-completed-publish health. lane is the persisted tier
    # name mapped to a citizen label: 'live'/'static'/'rollup' (rollup == the
    # historic tier row). last_publish_utc is the row's generated_utc (DATA time,
    # honest-NULL when the lane has never published); age_s is now() - that stamp,
    # computed SERVER-SIDE off the DB clock (the single source of truth), honest-NULL
    # when last_publish_utc is NULL. file counts mirror snapshot_publish_state.
    lane: str  # 'live' | 'static' | 'rollup'
    last_publish_utc: str | None = None
    age_s: int | None = None
    files_written: int | None = None
    files_skipped: int | None = None
    files_total: int | None = None
    gate: DataHealthGate | None = None


class DataHealthFeed(BaseModel):
    # Per-feed freshness, mirroring ProvenanceFreshness so the live lane's feed
    # detail is one fetch (gold.feed_freshness_current, same source as provenance).
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


# ---------------------------------------------------------------------------
# Basemap pointer + receipts discovery index (slice-9.1.1r)
# ---------------------------------------------------------------------------

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
    # S13 per-date availability metadata for the S8 DateRangePicker (DECISIONS DB3). A
    # date appears in ReceiptsIndex.available IFF it has a published receipt this run
    # (the SAME set as `dates`). The picker greys out any calendar date NOT in the index
    # (a fully-dark scheduled day has no CAD row → no receipt → correctly absent). Within
    # published dates:
    #   has_data     = the receipt carries real reliability telemetry (affected routes/
    #                  stops OR any network delay obs) vs an alerts-only shell (honest-
    #                  NULL reliability inputs) the picker styles distinctly.
    #   has_schedule = the day's scheduled universe is known (service_states present with
    #                  a non-NULL scheduled_trip_days) — distinguishes "schedule known,
    #                  no telemetry" from "empty" so the picker gives an honest reason.
    # publish_generation_id is set from the SAME run stamp as the index envelope; in a
    # single-run publish it is REDUNDANT with the index's own envelope id — carried for
    # forward-compat if receipts ever become multi-generation-merged.
    date: str
    has_data: bool
    has_schedule: bool = False
    publish_generation_id: str | None = None

class ReceiptsIndex(PayloadEnvelope):
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
    # S13 additive-optional per-date availability metadata (DECISIONS DB3). Default empty
    # so an already-published index (dates-only) stays FIELD-IDENTICAL (a republished pre-S13 receipt gains only the additive keys); `dates`
    # above stays UNTOUCHED. One ReceiptAvailability per published date (available[].date
    # is a subset of dates), letting the S8 picker distinguish a rich receipt from an
    # alerts-only shell and a schedule-known day from an empty one with honest reasons.
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
    "historic_repeat_offenders": RepeatOffenders,
    "historic_receipt": Receipt,
    "historic_receipts_index": ReceiptsIndex,
    "historic_route_reliability_index": RouteReliabilityIndex,
    "historic_alert_history": AlertHistory,
    "provenance": Provenance,
    "live_data_health": DataHealth,
}


def export_schemas() -> dict[str, dict]:
    return {name: model.model_json_schema() for name, model in TOP_LEVEL_MODELS.items()}
