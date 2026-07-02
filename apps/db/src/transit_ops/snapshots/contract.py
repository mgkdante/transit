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
    # Additive GTFS-RT / i3 passthroughs. cause/effect are the upstream raw values
    # (the GTFS-RT Alert.Cause / Alert.Effect enum NAME for GTFS-RT feeds, e.g.
    # "CONSTRUCTION"/"DETOUR"; a provider string for STM's i3). severity_level is
    # the raw upstream severity, distinct from the bucketed `severity` enum above.
    # Honest-NULL when the feed omits them. (url is not yet carried upstream.)
    cause: str | None = None
    effect: str | None = None
    severity_level: str | None = None

class AlertsFile(BaseModel):
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

class Manifest(BaseModel):
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

class NetworkTrend(BaseModel):
    generated_utc: str
    series: list[TrendPoint] = Field(default_factory=list)
    # Additive-optional WEEK + MONTH grain trend series: the SAME daily sources
    # (gold.route_delay_hourly OTP/avg, route_cancellation_daily,
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
    grain: str = "day"
    date: str | None = None
    cancellation_rate_pct: float | None = None
    canceled_trip_days: int | None = None
    total_trip_days: int | None = None

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
    # ReliabilityByGrain). DISTINCT lineage from the scalar `habits` (which reads the
    # whole-history route_habit_score mart): this recomposes the composite score from the
    # spine windowed by date, with a documented rebaseline on the avg term (the spine's
    # in-clamp pooled mean vs the mart's obs-weighted avg-of-averages) — the severe base
    # is byte-identical. Each window NORMALIZES to its OWN worst cell, so a 1.0 in 'day'
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
# many bytes (model_dump_json, UTF-8 — the exact bytes the publisher writes). 80 KiB
# clears the measured worst case (clean ~79.2 KB with weak_stops_by_grain at the N=15
# cap, ~2.7 KB margin) while still CATCHING a windowed-histogram regression (the F1
# variant lands ~96.9 KB). A CI test asserts BOTH (clean fits, F1 breaches). Bumped
# 65536 -> 81920 in DB-PR-3 (pre-PR-3 clean ~63.4 KB, F1 ~81.0 KB — within 1 KB of the
# old ceiling). The ~2.7 KB clean margin is thin: re-anchor on a real busiest-route
# measurement before adding to the §4 payload. Exported so the web can share it.
ROUTE_RELIABILITY_BYTE_CEILING = 81920

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
    avg_delay_min: float | None = None

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

class ProvenanceConformance(BaseModel):
    # GTFS feed-conformance for the provider's latest static load, mirroring the
    # DB-only /health check_feed_conformance signal so the UI can render a
    # "data quality" badge. status='out_of_norm' when the feed shipped members
    # this pipeline does not natively model (captured verbatim, never dropped).
    status: str  # 'conformant' | 'out_of_norm'
    unknown_members: list[str] = Field(default_factory=list)
    extra_row_count: int = 0


class Provenance(BaseModel):
    generated_utc: str
    sources: list[ProvenanceSource] = Field(default_factory=list)
    freshness: list[ProvenanceFreshness] = Field(default_factory=list)
    retention: dict[str, int] = Field(default_factory=dict)
    methodology: dict = Field(default_factory=dict)  # type: ignore[type-arg]
    gaps: list[str] = Field(default_factory=list)
    conformance: ProvenanceConformance | None = None


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

class RouteReliabilityIndex(BaseModel):
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
}


def export_schemas() -> dict[str, dict]:
    return {name: model.model_json_schema() for name, model in TOP_LEVEL_MODELS.items()}
