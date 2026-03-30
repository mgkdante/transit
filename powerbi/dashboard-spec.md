# Dashboard V1 Spec

## Goal

Define a practical Power BI V1 that sits directly on the current Gold layer and
answers operational questions without rebuilding business logic downstream.

This spec assumes the report imports these Gold objects:

- `gold.dim_route`
- `gold.dim_stop`
- `gold.dim_date`
- `gold.fact_vehicle_snapshot`
- `gold.fact_trip_delay_snapshot`

The current KPI views can be used as QA references, but the report should favor
the fact tables for interactive visuals and slicers.

## Target audience

- transit operations managers
- route performance analysts
- service planning and PMO stakeholders
- portfolio reviewers evaluating data-engineering plus BI execution

## Business story

The dashboard should show that the project can:

- refresh static GTFS on a predictable daily batch
- ingest GTFS-RT on a near-real-time cadence
- normalize both feeds into analytics-ready Gold tables
- answer network, route, stop, and freshness questions without a custom app

The business story is not "live map product." It is "operational reporting
system from raw standards-based feeds to decision-ready BI."

## V1 model boundaries

Use the current Gold layer as-is.

Do not rebuild joins from Silver in Power BI.

Recommended model tables:

- `DimRoute` from `gold.dim_route`
- `DimStop` from `gold.dim_stop`
- `DimDate` from `gold.dim_date`
- `DimDirection` from `gold.dim_direction`
- `FactVehicleSnapshot` from `gold.fact_vehicle_snapshot` (hot — 2-day window)
- `FactTripDelaySnapshot` from `gold.fact_trip_delay_snapshot` (hot — 2-day window)
- `VehicleSummary5m` from `gold.vehicle_summary_5m` (warm — 90-day, 5-minute grain)
- `TripDelaySummary5m` from `gold.trip_delay_summary_5m` (warm — 90-day, 5-minute grain)

Hot fact tables are bounded at 2 days. Use them for operational KPI cards and
latest-snapshot visuals. Use warm rollup tables for historical trend charts.
Do not use raw fact tables for 90-day trend scans in Import mode.

`DimDirection` exposes one row per `(route_id, direction_id)` with `direction_label`
set to the most common `trip_headsign` (e.g. `"Terminus Radisson"`, `"Est"`). It
replaces raw `direction_id` integers in the direction slicer.

Recommended V1 relationships:

- `DimRoute[route_id]` -> `FactVehicleSnapshot[route_id]`
- `DimRoute[route_id]` -> `FactTripDelaySnapshot[route_id]`
- `DimStop[stop_id]` -> `FactVehicleSnapshot[stop_id]`
- `DimDate[date_key]` -> `FactVehicleSnapshot[snapshot_date_key]`
- `DimDate[date_key]` -> `FactTripDelaySnapshot[snapshot_date_key]`
- `DimDirection[route_direction_key]` -> `FactTripDelaySnapshot[route_direction_key]` (computed surrogate key)

V1 is STM-only, so direct route and stop joins are acceptable. If a second
provider is added later, the semantic model should move to composite business
keys or a provider-aware bridge.

## Freshness model

V1 must message freshness explicitly.

Static GTFS:

- daily batch refresh through GitHub Actions
- scheduled for `06:00 UTC` every day
- `06:00 UTC` equals `2:00 AM Eastern` while EDT is in effect
- GitHub cron is UTC-based, so EST season may require a schedule adjustment if
  the target local run time stays `2:00 AM Eastern`

Realtime GTFS-RT:

- near-real-time, not instant streaming
- hosted worker runs on Railway
- target cadence is one start-to-start cycle every `30` seconds
- actual dashboard freshness is polling interval plus capture/load/build time

Dashboard copy should explicitly say:

- "Static schedule is batch refreshed daily."
- "Realtime data is near-real-time and typically refreshes within roughly one
  polling interval plus processing time."

## Page 1: Network Overview

### Purpose

Give an at-a-glance view of current network activity plus the most important
freshness context.

### Visuals

1. KPI cards
   - Active Vehicles
   - Routes Currently Running
   - Average Delay
   - Freshness Age
2. Clustered bar chart
   - Top routes by active vehicles in the latest vehicle snapshot
3. Map
   - Latest vehicle positions
4. Small status table
   - latest vehicle feed timestamp
   - latest trip feed timestamp
   - latest capture timestamps

### Primary slicers

- `DimDate[service_date]` — snapshot local date (already ET)
- `DimRoute[route_short_name]` — bus number shown on vehicle (e.g. "139", "24")
- `DimDirection[direction_label]` — real STM headsign string (e.g. "Terminus Radisson")

### Interactions

- selecting a route filters the map and supporting visuals
- clicking a route bar cross-filters the KPI context where appropriate
- freshness cards should ignore route and stop slicers and stay global

### Caveats

- current latest STM trip-delay snapshot may have zero non-null `delay_seconds`
- when that happens, average delay should show blank or "No delay data" rather
  than implying zero delay

## Page 2: Route Performance

### Purpose

Show which routes are busiest, which routes are running most vehicles, and
where delay-based route comparisons are usable.

### Visuals

1. Route ranking table
   - route short name
   - route long name
   - active vehicles
   - delayed trips count
   - average delay
2. Clustered bar chart
   - active vehicles by route in latest snapshot
3. Trend visual
   - vehicle observations by route over selected date range
4. Top-N route delay visual
   - worst route right now, only when delay data exists

### Primary slicers

- route
- snapshot local date
- day name and weekend

### Interactions

- right-click drillthrough to a route detail state within the same page or a
  tooltip page
- route selection should cross-filter trend and ranking visuals

### Caveats

- "Worst route right now" is only clean when the latest trip snapshot has
  non-null `delay_seconds`
- minimum V1 workaround without backend changes:
  use a Top N route visual driven by delay measures and let it go blank when
  no delay data exists

## Page 3: Stop / Station Performance

### Purpose

Focus on stop activity and coverage, not stop-level delay, because the current
Gold layer does not yet include a stop-level delay fact.

### Visuals

1. Top stops table
   - stop name
   - stop id
   - vehicle observations
   - latest observed timestamp
2. Clustered bar chart
   - busiest stops in selected period
3. Map
   - stop locations for selected top stops
4. Detail table
   - stop attributes from `DimStop`

### Primary slicers

- snapshot local date
- route
- stop

### Interactions

- selecting a stop from the bar or table filters the map
- route slicer reduces the stop activity list to route-served stop events

### Caveats

- current Gold outputs support stop activity from `fact_vehicle_snapshot`
- they do not support clean stop-level delay or station reliability measures
- V1 should not present "worst stop by delay" as if it were already proven

## Page 4: Live Operations / Freshness

### Purpose

Make the data latency and pipeline operating model visible so users know what
"live" means in this report.

### Visuals

1. KPI cards
   - latest vehicle feed timestamp
   - latest trip feed timestamp
   - vehicle freshness age
   - trip freshness age
2. Text and status block
   - static GTFS refresh schedule
   - realtime cadence target
   - near-real-time versus streaming explanation
3. Latest route activity table
   - route
   - active vehicles
   - latest feed timestamp
4. Optional latest delayed trips table
   - only display when non-null delay data exists

### Primary slicers

- none by default for the freshness KPI strip
- optional route slicer for the activity table

### Interactions

- freshness cards should ignore route and stop slicers
- latest route activity table can cross-filter back to Page 2 through synced
  slicers or drillthrough

### Caveats

- static freshness is operationally known from the automation schedule, not
  currently modeled as a dedicated Gold fact
- present static freshness as report text, not as a fake real-time metric

## Metric definitions

- Active Vehicles:
  distinct vehicles in the latest vehicle snapshot within context
- Routes Currently Running:
  distinct routes in the latest vehicle snapshot within context
- Average Delay:
  average of non-null `delay_seconds` in the latest trip-delay snapshot
- Delayed Trips Count:
  trips in the latest trip-delay snapshot where `delay_seconds > 0`
- On-Time Percentage:
  share of latest-snapshot trips with non-null `delay_seconds` at or below the
  chosen on-time threshold
- Worst Route Right Now:
  route with the highest average delay in the latest trip-delay snapshot,
  only when delay data exists
- Busiest Stops:
  stops ranked by vehicle observation count over the selected time window
- Latest Feed Timestamp:
  latest captured or feed timestamp shown for vehicle and trip streams
- Freshness Age:
  current time minus latest captured timestamp

## Assumptions and caveats

- current live validation showed:
  - `gold.fact_vehicle_snapshot` coverage is strong
  - latest vehicle snapshot had 100% non-null `route_id`, `stop_id`, and
    latitude/longitude
  - latest trip-delay snapshot now has non-null `delay_seconds` — delay KPI
    cards are expected to show real values
- delay cards should still be blank-aware; show blank/dash for NULL values
  rather than zero
- current Gold layer is strong enough for:
  - network activity
  - route activity
  - stop activity
  - freshness
- current Gold layer is not yet strong enough for:
  - clean stop-level delay
  - robust on-time KPI without caveats when delay data is absent

## Recommended V1 deliverable boundary

This repo slice should stop at:

- dashboard spec
- field mapping
- DAX measure plan
- SQL validation queries
- portfolio notes

It should not create a fake `.pbix` or claim the dashboard is already authored.
