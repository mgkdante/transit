# Power BI V1 Dashboard Design

**Date:** 2026-03-29
**Project:** STM GTFS/GTFS-RT Analytics Pipeline
**Scope:** V1 Operations Dashboard — Power BI Desktop, free tier, guided build

---

## Context

The pipeline is production-ready. Gold-layer tables are populated and healthy. The remaining gap is the `.pbix` file. This spec defines the exact build plan for Power BI Desktop, incorporating two design decisions made during brainstorming:

1. **Direction slicer** uses real headsign strings from `silver.trips` via a `DimDirection` helper table — not raw `direction_id` integers.
2. **UTC timestamps** are converted to Eastern Time (America/New_York, DST-aware) in Power Query. `snapshot_local_date` is already ET and used as-is.

---

## Approach

Free Power BI Desktop + interactive guided build.

- No Power BI Pro, Premium, or REST API required
- Import mode for all tables (2-day bounded facts + 90-day warm rollups)
- PostgreSQL connector to Neon
- Build order prioritizes visible value: Page 1 → Page 4 → Page 2 → Page 3

---

## Model Tables (8)

| Power BI Name | Source | Notes |
|---|---|---|
| `DimRoute` | `gold.dim_route` | Standard import |
| `DimStop` | `gold.dim_stop` | Standard import |
| `DimDate` | `gold.dim_date` | Standard import |
| `DimDirection` | `gold.dim_direction` | Route-aware — one row per route+direction with real headsign |
| `FactVehicleSnapshot` | `gold.fact_vehicle_snapshot` | 2-day hot window |
| `FactTripDelaySnapshot` | `gold.fact_trip_delay_snapshot` | 2-day hot window |
| `VehicleSummary5m` | `gold.vehicle_summary_5m` | 90-day warm rollup |
| `TripDelaySummary5m` | `gold.trip_delay_summary_5m` | 90-day warm rollup |

### DimDirection

Source: `gold.dim_direction` — populated during the daily static Gold refresh from `silver.trips`.
One row per `(provider_id, route_id, direction_id)`. `direction_label` is the most common
`trip_headsign` for that route+direction (e.g. `"Terminus Radisson"`, `"Est"`).

**Relationship via surrogate key (Power Query):**
- Add computed column `route_direction_key = [route_id] & "_" & Text.From([direction_id])` to both `DimDirection` and `FactTripDelaySnapshot`
- Relate `DimDirection[route_direction_key]` → `FactTripDelaySnapshot[route_direction_key]`
- Single-column relationship, no composite key needed in Power BI

---

## Relationships

| From | To | Direction |
|---|---|---|
| `DimRoute[route_id]` | `FactVehicleSnapshot[route_id]` | Single |
| `DimRoute[route_id]` | `FactTripDelaySnapshot[route_id]` | Single |
| `DimStop[stop_id]` | `FactVehicleSnapshot[stop_id]` | Single |
| `DimDate[date_key]` | `FactVehicleSnapshot[snapshot_date_key]` | Single |
| `DimDate[date_key]` | `FactTripDelaySnapshot[snapshot_date_key]` | Single |

---

## Timezone Handling

| Column | Status | Action |
|---|---|---|
| `snapshot_local_date` | Already ET (America/Toronto) | Use as-is |
| `feed_timestamp_utc` | UTC | Convert in Power Query |
| `captured_at_utc` | UTC | Convert in Power Query |
| `period_start_utc` | UTC | Convert in Power Query |

**Power Query M pattern (DST-aware):**
```m
DateTimeZone.ToLocal(DateTime.AddZone([feed_timestamp_utc], 0))
```
Or explicitly:
```m
DateTimeZone.ConvertTimeZone(
    DateTime.AddZone([feed_timestamp_utc], 0),
    "UTC",
    "Eastern Standard Time"
)
```

---

## Slicers (consistent across all pages)

| Slicer | Source | Notes |
|---|---|---|
| Date | `DimDate[service_date]` | Already ET |
| Route | `DimRoute[route_short_name]` | The number shown on the bus (e.g., "139", "24") — use short name everywhere in visuals; use long name in tooltips only |
| Direction | `DimDirection[direction_label]` | Real STM headsign strings from `silver.trips.trip_headsign` |

Freshness KPI cards ignore all slicers (use global `ALL()` measures).

---

## Pages

### Page 1 — Network Overview *(build first)*

**Visuals:**
1. KPI cards: Active Vehicles (Latest), Routes Currently Running (Latest), Average Delay Seconds (Latest) *(blank-aware)*, Freshness Age Minutes
2. Clustered bar: Top routes by `Active Vehicles (Latest)` — axis: `DimRoute[route_short_name]`, Top N filter
3. Map: `FactVehicleSnapshot[latitude/longitude]` — category: `DimRoute[route_short_name]`, tooltips: vehicle_id, current_status, feed_timestamp_et
4. Feed status table: Latest Vehicle/Trip Feed Timestamp, Vehicle/Trip Freshness Age Seconds

### Page 2 — Route Performance *(build third)*

**Visuals:**
1. Route ranking table: route_short_name, route_long_name, Active Vehicles, Delayed Trips Count, Avg Delay *(blank-aware)*
2. Clustered bar: Active Vehicles by route
3. Trend line: Vehicle Observations over time — use `VehicleSummary5m` not raw facts for > 2-day windows
4. Top-N delay: Route Average Delay Seconds (Latest) — goes blank when delay coverage = 0

### Page 3 — Stop Activity *(build fourth)*

**Visuals:**
1. Top stops table: stop_name, stop_id, Vehicle Observations, latest feed timestamp
2. Busiest stops bar: Top N by Vehicle Observations
3. Stop map: `DimStop[stop_lat/stop_lon]`, sized by Vehicle Observations
4. Stop detail table: stop_name, stop_code, parent_station, platform_code, wheelchair_boarding

*Stop-level delay is not modeled in current Gold — this page is activity-only.*

### Page 4 — Live Ops / Freshness *(build second)*

**Visuals:**
1. KPI cards: Latest Vehicle Feed Timestamp (ET), Latest Trip Feed Timestamp (ET), Vehicle Freshness Age Seconds, Trip Freshness Age Seconds
2. Latest route activity table: route_short_name, Active Vehicles (Latest)
3. Text block: "Static schedule is batch refreshed daily. Realtime data is near-real-time and typically refreshes within one polling interval (~30s) plus processing time."
4. Optional delayed trips table: trip_id, delay_seconds, feed_timestamp_et — only when delay coverage > 0

---

## DAX Measures

All measures are defined in `powerbi/dax-measures.md`. Create a dedicated empty `Measures` table to house them.

Build order:
1. Helper measures (`Latest Vehicle Snapshot Id`, `Latest Trip Snapshot Id`, `On-Time Threshold Seconds`, `Vehicle Observations`)
2. Network KPI measures
3. Route-level measures
4. Freshness measures
5. Warm rollup measures

---

## Known Caveats

- `delay_seconds` is now non-null in the latest STM trip snapshot — delay KPI cards are expected to show real values.
- `On-Time Percentage (Latest)` returns blank only if `Trips With Delay Data (Latest) = 0` — this should no longer be the normal state.
- The `avg_delay_seconds_capped` column in warm rollups excludes abs > 3600s outliers (stale GTFS-RT feed artifacts). Use it for operational KPI cards; raw `avg_delay_seconds` is available for anomaly investigation only.
- Stop-level delay is not in current Gold. Page 3 shows activity only.
- V1 is STM-only — direct route/stop joins are acceptable.

---

## Validation

After building each page, validate numbers using `powerbi/sql-validation.sql`:

| Query | Validates |
|---|---|
| `01_network_kpis_latest` | Page 1 KPI cards |
| `02_freshness_latest` | Page 4 freshness cards |
| `03_delay_coverage_latest_snapshot` | Confirms delay blank is expected |
| `04_top_routes_by_active_vehicles_latest` | Page 1 + Page 2 route bars |
| `06_busiest_stops_last_24h` | Page 3 stop activity |

Data validation via Neon MCP runs before opening Power BI Desktop.

---

## Build Prerequisites

- [ ] Power BI Desktop installed (free download from Microsoft)
- [ ] Neon connection details ready: hostname, port (5432), database name, username, password (from `.env` or Railway vars — **not** the full `DATABASE_URL` string; Power BI PostgreSQL connector takes fields separately)
- [ ] Power BI PostgreSQL connector requires the `npgsql` driver — Power BI Desktop ships it built-in, no separate install needed
- [ ] Data validation queries pass (run via Neon MCP or psql)
