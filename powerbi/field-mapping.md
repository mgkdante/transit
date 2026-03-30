# Power BI Field Mapping

## Production model (V1 — DirectQuery)

Connection mode: **DirectQuery**. All 15 tables query Neon live on every page
interaction. No Import refresh is configured.

### KPI views (primary network-total source)

| Gold table | Power BI name |
|-----------|--------------|
| `gold.kpi_active_vehicles_latest` | `KpiActiveVehicles` |
| `gold.kpi_routes_with_live_vehicles_latest` | `KpiRoutesRunning` |
| `gold.kpi_avg_trip_delay_latest` | `KpiAvgDelay` |
| `gold.kpi_max_trip_delay_latest` | `KpiMaxDelay` |
| `gold.kpi_delayed_trip_count_latest` | `KpiDelayedTrips` |

### Latest-serving tables (route-aware KPIs and live map)

| Gold table | Power BI name |
|-----------|--------------|
| `gold.latest_vehicle_snapshot` | `LatestVehicle` |
| `gold.latest_trip_delay_snapshot` | `LatestTripDelay` |

### Dimensions, facts, rollups

| Gold table | Power BI name | Role |
|-----------|--------------|------|
| `gold.dim_route` | `DimRoute` | Route slicer, route_short_name labels |
| `gold.dim_stop` | `DimStop` | Stop slicer, stop map |
| `gold.dim_date` | `DimDate` | Date slicer |
| `gold.dim_direction` | `DimDirection` | Direction slicer (route-dependent) |
| `gold.fact_vehicle_snapshot` | `FactVehicleSnapshot` | Stop Activity page |
| `gold.fact_trip_delay_snapshot` | `FactTripDelaySnapshot` | Route Performance detail |
| `gold.vehicle_summary_5m` | `VehicleSummary5m` | Historical vehicle trend |
| `gold.trip_delay_summary_5m` | `TripDelaySummary5m` | Historical delay trend |

**DimDirection relationship:** `DimDirection[route_id] → DimRoute[route_id]`
(Single cross-filter). This makes the Direction slicer route-dependent — selecting
a bus number filters the direction labels automatically. The surrogate key
`route_direction_key` planned in the spec was not used; the route_id relationship
achieves the same result.

## Page 1: Network Overview (built)

| Visual | Source | DAX measure | Notes |
| --- | --- | --- | --- |
| Active Vehicles card | `KpiActiveVehicles` | `Active Vehicles (Latest)` | `SUM([active_vehicle_count])` |
| Routes Currently Running card | `KpiRoutesRunning` | `Routes Currently Running (Latest)` | `SUM([routes_with_live_vehicles])` |
| Average Delay card | `KpiAvgDelay` | `Average Delay Seconds (Latest)` | `SUM([avg_delay_seconds])` |
| Delayed Trips card | `KpiDelayedTrips` | `Delayed Trips Count (Latest)` | `SUM([delayed_trip_count])` |
| Active Vehicles by Route bar | `LatestVehicle` + `DimRoute` | `Route Active Vehicles` | `COUNTROWS(LatestVehicle)` — NOT the KPI measure |
| Live Vehicle Map | `LatestVehicle` | — | Azure Maps visual; lat/lon bounding box filter: lat 45.3–45.7, lon -74.1 to -73.4 |
| Feed Status table | `LatestVehicle`, `LatestTripDelay` | `Latest Vehicle Feed Timestamp ET`, `Latest Trip Feed Timestamp ET`, `Vehicle Freshness Age Seconds`, `Trip Freshness Age Seconds` | ET via DAX -4/24 |
| Slicers | `DimDate`, `DimRoute`, `DimDirection` | — | Direction slicer depends on Bus Number slicer via DimDirection→DimRoute relationship |

## Page 2: Route Performance (built)

| Visual | Source | DAX measure | Notes |
| --- | --- | --- | --- |
| Route ranking table | `DimRoute` + `LatestVehicle` + `LatestTripDelay` | `Route Active Vehicles`, `Route Delayed Trips`, `Route Avg Delay Seconds` | One row per route; delay columns may be blank |
| Active Vehicles by Route bar | `LatestVehicle` + `DimRoute` | `Route Active Vehicles` | `COUNTROWS(LatestVehicle)` |
| Route Activity Trend line | `VehicleSummary5m` | `Avg Delay Seconds (5m Rollup)` | Warm rollup — 90-day history at 5-min grain |
| Delayed Route bar (top routes by delay) | `LatestTripDelay` + `DimRoute` | `Route Avg Delay Seconds` | `CALCULATE(AVERAGE(...), delay_seconds <> BLANK())` |
| Slicers | `DimRoute`, `DimDirection` | — | No date slicer (DirectQuery + DimDate join not practical for rollups) |

## Page 3: Stop Activity (built)

| Visual | Source | DAX measure | Notes |
| --- | --- | --- | --- |
| Top stops by observations table | `DimStop` + `FactVehicleSnapshot` | `Vehicle Observations` | `COUNTROWS(FactVehicleSnapshot)`; requires DimStop[stop_id] → FactVehicleSnapshot[stop_id] relationship |
| Busiest stops bar | `DimStop` + `FactVehicleSnapshot` | `Vehicle Observations` | Top N filter |
| Stop map | `DimStop` + `FactVehicleSnapshot` | `Vehicle Observations` for bubble size | Azure Maps visual |
| Stop detail table | `DimStop` | — | Static descriptive columns: stop_name, stop_code, parent_station |

## Page 4: Live Ops / Freshness (built)

| Visual | Source | DAX measure | Notes |
| --- | --- | --- | --- |
| Vehicle feed timestamp card | `LatestVehicle` | `Latest Vehicle Feed Timestamp ET` | `MAX([feed_timestamp_utc]) - (4/24)` — EDT offset |
| Trip feed timestamp card | `LatestTripDelay` | `Latest Trip Feed Timestamp ET` | Same pattern |
| Vehicle freshness age card | `LatestVehicle` | `Vehicle Freshness Age Seconds` | `DATEDIFF(MAX([feed_timestamp_utc]), NOW(), SECOND)` |
| Trip freshness age card | `LatestTripDelay` | `Trip Freshness Age Seconds` | Same pattern |
| Latest route activity table | `DimRoute` + `LatestVehicle` | `Route Active Vehicles` | One row per route |
| Delayed trips table | `LatestTripDelay` + `DimRoute` | — | Raw trip_id, delay_seconds, feed_timestamp_utc |
| Operating model text box | — | — | Static annotation: near-real-time, 30s cadence |

## Page 5: Historical Trends

**Not built as a separate page in V1.** Trend content (90-day rollup trend line) was
folded into the Route Performance page (Page 2). Dedicated Historical Trends page
is deferred to a future slice.

## KPI support summary

Supported cleanly now:

- active vehicles
- routes currently running
- top routes by live vehicle count
- busiest stops by observed vehicle activity
- latest feed timestamp
- freshness age

Supported with caveats:

- average delay
- delayed trips count
- on-time percentage
- worst route right now

Not supported cleanly from current Gold without backend expansion:

- stop-level delay
- stop reliability by delay
- station delay heatmaps

Minimum workaround without backend changes:

- keep stop page activity-oriented
- for delay visuals, either:
  - show blank when delay coverage is zero
  - or explicitly label a rolling-window fallback based on the latest non-null
    delay observations
