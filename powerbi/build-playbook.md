# Power BI Build Playbook

## Purpose

This playbook turns the existing Power BI handoff pack into a practical report
authoring sequence for Power BI Desktop.

Use it with:

- `powerbi/dashboard-spec.md`
- `powerbi/field-mapping.md`
- `powerbi/dax-measures.md`
- `powerbi/sql-validation.sql`

The goal is to build a clean V1 report directly on top of the current Gold
layer without inventing extra backend work.

## Build boundary

Build the report on these Gold tables only:

- `gold.dim_route` as `DimRoute`
- `gold.dim_stop` as `DimStop`
- `gold.dim_date` as `DimDate`
- `gold.dim_direction` as `DimDirection`
- `gold.fact_vehicle_snapshot` as `FactVehicleSnapshot`
- `gold.fact_trip_delay_snapshot` as `FactTripDelaySnapshot`

Do not rebuild the model from Silver tables inside Power BI.

## Before opening Power BI

1. Make sure the latest Gold layer exists.
   Run `uv run python -m transit_ops.cli build-gold-marts stm` if you need a fresh rebuild.
2. Validate delay coverage before you commit to delay-heavy visuals.
   Use `powerbi/sql-validation.sql` query `03_delay_coverage_latest_snapshot`.
3. Expect route, stop, map, and freshness visuals to be stronger than delay
   visuals whenever STM omits trip-level `delay_seconds` in the latest snapshot.

## Recommended import setup

Use the PostgreSQL connector and import mode for V1.

Rename tables in the semantic model like this:

- `gold.dim_route` -> `DimRoute`
- `gold.dim_stop` -> `DimStop`
- `gold.dim_date` -> `DimDate`
- `gold.dim_direction` -> `DimDirection`
- `gold.fact_vehicle_snapshot` -> `FactVehicleSnapshot`
- `gold.fact_trip_delay_snapshot` -> `FactTripDelaySnapshot`

**Power Query — surrogate key (required for DimDirection relationship):**

After importing, add a computed column to both `DimDirection` and `FactTripDelaySnapshot`
in Power Query (Transform Data):

```m
route_direction_key = [route_id] & "_" & Text.From([direction_id])
```

This produces a single-column key like `"10_0"` that Power BI can use as a
relationship key. Power BI does not natively support composite-key relationships.

**Power Query — UTC to Eastern Time conversion:**

For `feed_timestamp_utc`, `captured_at_utc`, and `period_start_utc` columns, add
a custom column per table:

```m
DateTimeZone.ConvertTimeZone(
    DateTime.AddZone([feed_timestamp_utc], 0),
    "UTC",
    "Eastern Standard Time"
)
```

Name pattern: `feed_timestamp_et`, `captured_at_et`, `period_start_et`.

`snapshot_local_date` is already in `America/Toronto` time — do NOT convert it
again.

Hide low-value technical columns unless you need them for QA:

- `provider_id`
- `dataset_version_id`
- `entity_index`
- `entity_id`

Keep these fields visible because they are useful in visuals and drilldowns:

- route fields:
  `route_id`, `route_short_name`, `route_long_name`, `route_type`
- stop fields:
  `stop_id`, `stop_name`, `stop_code`, `stop_lat`, `stop_lon`
- date fields:
  `date_key`, `service_date`, `day_name`, `month_name`, `is_weekend`
- vehicle fact fields:
  `realtime_snapshot_id`, `snapshot_local_date`, `feed_timestamp_utc`,
  `captured_at_utc`, `vehicle_id`, `route_id`, `stop_id`, `latitude`,
  `longitude`, `current_status`
- trip delay fact fields:
  `realtime_snapshot_id`, `snapshot_local_date`, `feed_timestamp_utc`,
  `captured_at_utc`, `trip_id`, `route_id`, `direction_id`,
  `delay_seconds`, `stop_time_update_count`

## Relationships

Create these single-direction relationships:

1. `DimRoute[route_id]` -> `FactVehicleSnapshot[route_id]`
2. `DimRoute[route_id]` -> `FactTripDelaySnapshot[route_id]`
3. `DimStop[stop_id]` -> `FactVehicleSnapshot[stop_id]`
4. `DimDate[date_key]` -> `FactVehicleSnapshot[snapshot_date_key]`
5. `DimDate[date_key]` -> `FactTripDelaySnapshot[snapshot_date_key]`
6. `DimDirection[route_direction_key]` -> `FactTripDelaySnapshot[route_direction_key]` (surrogate key — add in Power Query first)

V1 is STM-only, so direct joins are acceptable. If you later add more
providers, move to provider-aware keys or bridge tables before treating this as
multi-provider safe.

## Measures to create first

Create the measures from `powerbi/dax-measures.md` in this order:

1. Helper measures
   - `Latest Vehicle Snapshot Id`
   - `Latest Trip Snapshot Id`
   - `On-Time Threshold Seconds`
   - `Vehicle Observations`
2. Network KPI measures
   - `Active Vehicles (Latest)`
   - `Routes Currently Running (Latest)`
   - `Trips With Delay Data (Latest)`
   - `Average Delay Seconds (Latest)`
   - `Delayed Trips Count (Latest)`
   - `On-Time Trips Count (Latest)`
   - `On-Time Percentage (Latest)`
3. Route measures
   - `Route Average Delay Seconds (Latest)`
   - `Route Delayed Trips Count (Latest)`
4. Freshness measures
   - `Latest Vehicle Feed Timestamp UTC`
   - `Latest Vehicle Capture Timestamp UTC`
   - `Latest Trip Feed Timestamp UTC`
   - `Latest Trip Capture Timestamp UTC`
   - `Latest Feed Timestamp UTC`
   - `Vehicle Freshness Age Seconds`
   - `Trip Freshness Age Seconds`
   - `Freshness Age Minutes`

If you want a clean authoring flow, place all measures in a dedicated empty
table named `Measures`.

## Page build order

Build the report in this order so you get visible value early.

### Page 1: Network Overview

Build this page first.

Visuals:

1. KPI cards
   - `Active Vehicles (Latest)`
   - `Routes Currently Running (Latest)`
   - `Average Delay Seconds (Latest)`
   - `Freshness Age Minutes`
2. Clustered bar chart
   - axis: `DimRoute[route_short_name]`
   - values: `Active Vehicles (Latest)`
   - visual filter: Top N routes by `Active Vehicles (Latest)`
3. Map
   - latitude: `FactVehicleSnapshot[latitude]`
   - longitude: `FactVehicleSnapshot[longitude]`
   - legend or category: `DimRoute[route_short_name]`
   - tooltips:
     `FactVehicleSnapshot[vehicle_id]`,
     `FactVehicleSnapshot[route_id]`,
     `FactVehicleSnapshot[current_status]`,
     `FactVehicleSnapshot[feed_timestamp_utc]`
4. Feed status table
   - measures:
     `Latest Vehicle Feed Timestamp UTC`,
     `Latest Trip Feed Timestamp UTC`,
     `Vehicle Freshness Age Seconds`,
     `Trip Freshness Age Seconds`

Slicers:

- `DimDate[service_date]` or `DimDate[date_key]`
- `DimRoute[route_short_name]`
- `DimDirection[direction_label]`

Important behavior:

- freshness cards should ignore route and stop filters
- delay card should be allowed to go blank when latest delay coverage is zero

### Page 2: Route Performance

Use this page for route ranking and route-level drilldown.

Visuals:

1. Route ranking table
   - rows:
     `DimRoute[route_short_name]`,
     `DimRoute[route_long_name]`
   - values:
     `Active Vehicles (Latest)`,
     `Route Delayed Trips Count (Latest)`,
     `Route Average Delay Seconds (Latest)`
2. Clustered bar chart
   - axis: `DimRoute[route_short_name]`
   - values: `Active Vehicles (Latest)`
3. Trend chart
   - axis: `DimDate[service_date]`
   - legend: `DimRoute[route_short_name]`
   - values: `Vehicle Observations`
4. Top-N delay visual
   - axis: `DimRoute[route_short_name]`
   - values: `Route Average Delay Seconds (Latest)`
   - filter to Top 1 or Top 5 as needed

Slicers:

- `DimRoute[route_short_name]`
- `DimDate[day_name]`
- `DimDate[is_weekend]`
- `DimDirection[direction_label]`

Important behavior:

- treat delay ranking as optional or blank-aware
- do not fake a worst route if no delay rows are populated in the latest trip snapshot

### Page 3: Stop / Station Performance

Keep this page activity-oriented, not delay-oriented.

Visuals:

1. Top stops table
   - rows:
     `DimStop[stop_name]`,
     `DimStop[stop_id]`
   - values:
     `Vehicle Observations`,
     `Latest Vehicle Feed Timestamp UTC`
2. Busiest stops bar chart
   - axis: `DimStop[stop_name]`
   - values: `Vehicle Observations`
   - filter to Top N
3. Stop map
   - latitude: `DimStop[stop_lat]`
   - longitude: `DimStop[stop_lon]`
   - size:
     `Vehicle Observations`
4. Stop detail table
   - fields:
     `DimStop[stop_name]`,
     `DimStop[stop_code]`,
     `DimStop[parent_station]`,
     `DimStop[platform_code]`,
     `DimStop[wheelchair_boarding]`

Slicers:

- `DimDate[service_date]`
- `DimRoute[route_short_name]`
- `DimStop[stop_name]`

Important behavior:

- do not label anything here as stop delay or stop reliability yet
- the current Gold layer supports stop activity much better than stop delay

### Page 4: Live Operations / Freshness

Use this page to explain what "live" means in this portfolio project.

Visuals:

1. KPI cards
   - `Latest Vehicle Feed Timestamp UTC`
   - `Latest Trip Feed Timestamp UTC`
   - `Vehicle Freshness Age Seconds`
   - `Trip Freshness Age Seconds`
2. Latest route activity table
   - rows:
     `DimRoute[route_short_name]`
   - values:
     `Active Vehicles (Latest)`
3. Optional delayed trips table
   - rows:
     `FactTripDelaySnapshot[trip_id]`
   - values:
     `FactTripDelaySnapshot[delay_seconds]`,
     `FactTripDelaySnapshot[feed_timestamp_utc]`
   - only keep this page element if delay coverage is non-zero
4. Text block
   - "Static schedule is batch refreshed daily."
   - "Realtime data is near-real-time and typically refreshes within roughly one polling interval plus processing time."
   - "Worker target cadence: 30 seconds."

Important behavior:

- keep freshness cards global
- this page should explain the operating model, not pretend the report is a dispatch console

## Report polish checklist

- Use synced slicers for route and date across pages.
- Keep titles business-facing, not table-facing.
- Add subtitles where delay visuals can go blank.
- Prefer route short name in visuals and route long name in tooltips.
- Use conditional formatting carefully; blank delay measures should stay blank.
- Keep the live map and busiest-stop map visually simple. This is an
  operations dashboard, not a consumer trip-planning app.

## Validation workflow

After building the report:

1. Run `01_network_kpis_latest` from `powerbi/sql-validation.sql`.
   Compare the SQL outputs to:
   - Active Vehicles card
   - Routes Currently Running card
   - Average Delay card
   - Delayed Trips card if you add one
2. Run `02_freshness_latest`.
   Compare to the freshness cards.
3. Run `03_delay_coverage_latest_snapshot`.
   If `pct_with_non_null_delay = 0`, keep delay visuals blank-aware.
4. Run `04_top_routes_by_active_vehicles_latest`.
   Compare to the Page 1 and Page 2 route visuals.
5. Run `06_busiest_stops_last_24h`.
   Compare to the stop-activity visuals.

## Known V1 caveats

- `delay_seconds` is now non-null in the STM trip snapshot — delay KPI cards are expected to show real values.
- `On-Time Percentage (Latest)` returns blank only when `Trips With Delay Data (Latest) = 0` — this should no longer be the normal state.
- Stop-level delay is not modeled yet in Gold.
- Direct route and stop joins are acceptable only because V1 is STM-only.
- Route short name (e.g. `"139"`, `"24"`) is the bus number shown on the vehicle — use it everywhere in visuals; route long name is for tooltips only.

## Fastest path to a presentable V1

If you want the quickest portfolio-ready report:

1. Build Page 1 and Page 4 first.
2. Add Page 2 once route ranking and activity visuals are stable.
3. Add Page 3 as a stop activity page, not a delay page.
4. Validate the numbers with the SQL pack before taking screenshots.

That gives you a report that is honest, demonstrable, and aligned with the
current app state instead of overpromising beyond the proven Gold layer.
