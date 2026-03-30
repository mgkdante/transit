# 08 — Power BI Consumption Rules

Binding contract between the Gold layer and the Power BI model. Defines what
Power BI should import, how tables relate, what to avoid, and data caveats.

---

## 1. Production table map (V1 DirectQuery model)

Power BI connects to Neon in **DirectQuery mode**. All tables are queried live on
every page interaction. No scheduled Import refresh is required or configured.

Power BI reads only from `gold.*` tables. Never from `silver.*`, `raw.*`, or `core.*`.

### KPI views (DirectQuery)

| Gold table | Power BI model name | Role |
|-----------|-------------------|------|
| `gold.kpi_active_vehicles_latest` | `KpiActiveVehicles` | Network-total active vehicle count |
| `gold.kpi_routes_with_live_vehicles_latest` | `KpiRoutesRunning` | Network-total route count |
| `gold.kpi_avg_trip_delay_latest` | `KpiAvgDelay` | Network-average delay seconds |
| `gold.kpi_max_trip_delay_latest` | `KpiMaxDelay` | Network-max delay seconds |
| `gold.kpi_delayed_trip_count_latest` | `KpiDelayedTrips` | Network-total delayed trip count |

KPI views return a single row (network total). Use `SUM()` in DAX to pull the scalar value.
**Do not use KPI view measures for per-route visuals** — they ignore row context. Use
route-aware measures against `LatestVehicle` / `LatestTripDelay` instead.

### Latest-serving tables (DirectQuery)

| Gold table | Power BI model name | Role |
|-----------|-------------------|------|
| `gold.latest_vehicle_snapshot` | `LatestVehicle` | Live vehicle map, route-aware KPIs |
| `gold.latest_trip_delay_snapshot` | `LatestTripDelay` | Live delay KPIs, per-route breakdown |

### Dimension tables (DirectQuery)

| Gold table | Power BI model name |
|-----------|-------------------|
| `gold.dim_route` | `DimRoute` |
| `gold.dim_stop` | `DimStop` |
| `gold.dim_date` | `DimDate` |
| `gold.dim_direction` | `DimDirection` |

### Fact and rollup tables (DirectQuery)

| Gold table | Power BI model name | Role |
|-----------|-------------------|------|
| `gold.fact_vehicle_snapshot` | `FactVehicleSnapshot` | Stop Activity page (per-stop counts) |
| `gold.fact_trip_delay_snapshot` | `FactTripDelaySnapshot` | Route Performance trend line |
| `gold.vehicle_summary_5m` | `VehicleSummary5m` | Route Performance trend (5-min rollup) |
| `gold.trip_delay_summary_5m` | `TripDelaySummary5m` | Route Performance delay trend |

### Tables Power BI must NOT import

| Table | Why not |
|-------|---------|
| Any `silver.*` table | Internal normalization layer — schema may change without notice |
| Any `raw.*` table | Ingestion lineage — not for BI |
| Any `core.*` table | System config — not for BI |

---

## 2. Relationship keys (production model)

```text
DimRoute[route_id]
  ├─── FactVehicleSnapshot[route_id]       (Single filter direction)
  ├─── FactTripDelaySnapshot[route_id]     (Single filter direction)
  ├─── LatestVehicle[route_id]             (Single filter direction)
  ├─── LatestTripDelay[route_id]           (Single filter direction)
  ├─── VehicleSummary5m[route_id]          (Single filter direction)
  └─── TripDelaySummary5m[route_id]        (Single filter direction)

DimStop[stop_id]
  └─── FactVehicleSnapshot[stop_id]        (Single filter direction)

DimDate[date_key]
  ├─── FactVehicleSnapshot[snapshot_date_key]
  └─── FactTripDelaySnapshot[snapshot_date_key]

DimDirection[route_id]
  └─── DimRoute[route_id]                  (makes Direction slicer route-dependent)
```

**Surrogate key note:** The spec called for a `route_direction_key` surrogate
(`route_id + "_" + direction_id`). In the production model the relationship is
`DimDirection[route_id] → DimRoute[route_id]`, which achieves the same filtering
behavior through the existing route relationship without adding a computed column.

**Warm rollup note:** `VehicleSummary5m` and `TripDelaySummary5m` use
`period_start_utc` (timestamptz) for time axis, not `date_key`. Date slicers
do not filter these tables directly.

**Unrouted handling:** Warm rollup tables may use `'__unrouted__'` for NULL
`route_id`. Filter this value out in visuals.

---

## 3. Production DAX measures

**Network KPI cards** (use KPI views — single network-total row):

```dax
Active Vehicles (Latest) = SUM(KpiActiveVehicles[active_vehicle_count])
Routes Currently Running (Latest) = SUM(KpiRoutesRunning[routes_with_live_vehicles])
Average Delay Seconds (Latest) = SUM(KpiAvgDelay[avg_delay_seconds])
Delayed Trips Count (Latest) = SUM(KpiDelayedTrips[delayed_trip_count])
```

**Per-route visuals** (use latest tables — respect row filter context from DimRoute):

```dax
Route Active Vehicles = COUNTROWS(LatestVehicle)
Route Delayed Trips = COUNTROWS(FILTER(LatestTripDelay, LatestTripDelay[delay_seconds] > 0))
Route Avg Delay Seconds = CALCULATE(AVERAGE(LatestTripDelay[delay_seconds]), LatestTripDelay[delay_seconds] <> BLANK())
On-Time Percentage (Latest) =
VAR total = COUNTROWS(LatestTripDelay)
VAR delayed = COUNTROWS(FILTER(LatestTripDelay, LatestTripDelay[delay_seconds] > 300))
RETURN IF(total = 0, BLANK(), DIVIDE(total - delayed, total) * 100)
```

**Freshness** (use latest tables):

```dax
Latest Vehicle Feed Timestamp ET = MAX(LatestVehicle[feed_timestamp_utc]) - (4/24)
Latest Trip Feed Timestamp ET = MAX(LatestTripDelay[feed_timestamp_utc]) - (4/24)
Vehicle Freshness Age Seconds = DATEDIFF(MAX(LatestVehicle[feed_timestamp_utc]), NOW(), SECOND)
Trip Freshness Age Seconds = DATEDIFF(MAX(LatestTripDelay[feed_timestamp_utc]), NOW(), SECOND)
```

**Warm rollup**:

```dax
Avg Delay Seconds (5m Rollup) = AVERAGE(TripDelaySummary5m[avg_delay_seconds])
Vehicle Observations = COUNTROWS(FactVehicleSnapshot)
```

**Important:** KPI view measures (`SUM(KpiActiveVehicles[...])`) return the
network total regardless of slicer context. They are correct for network-level
cards but wrong for per-route bar charts or tables. Always use the route-aware
measures (`COUNTROWS(LatestVehicle)` etc.) for any visual that breaks down by route.

---

## 4. Hot vs. warm boundary rule

| Data need | Source | Max history | Granularity |
|-----------|--------|-------------|-------------|
| "What is happening right now?" | `latest_*` tables | 1 snapshot (~30s old) | Per-entity (vehicle, trip) |
| "What happened in the last 2 days?" | `fact_*` tables (if needed) | 2 days | Per-entity per-snapshot |
| "What are the trends over weeks/months?" | `*_summary_5m` warm rollups | 90 days | 5-minute per-route aggregate |

**Rule:** Power BI should use `latest_*` for live cards/maps and
`*_summary_5m` for trend charts. Do not import `fact_*` tables into Power BI —
they churn too fast and their retention is too short for meaningful history.

---

## 5. Delay data caveats

### NULLs

`delay_seconds` is NULL when the pipeline could not determine a delay from
any source. ~12.4% of trip delay facts are NULL.

**Power BI rules:**
- Display blank/dash for NULL delays — never show zero
- Show delay coverage as a data quality metric:
  ```dax
  Delay Coverage % =
  DIVIDE(
      COUNTROWS(FILTER(LatestTripDelaySnapshot, NOT(ISBLANK([delay_seconds])))),
      COUNTROWS(LatestTripDelaySnapshot),
      BLANK()
  )
  ```

### Capped vs raw delay

In warm rollups:
- `avg_delay_seconds` = raw average including all non-null values
- `avg_delay_seconds_capped` = average excluding |delay| > 3600s (1 hour)
- `outlier_count` = observations excluded from the capped average

**Power BI should use `avg_delay_seconds_capped` for trend charts.** The raw
average is distorted by extreme outliers (stale feed artifacts, typically
route 777). Show `outlier_count` as a footnote or tooltip.

```dax
Avg Delay (Capped) =
AVERAGE(TripDelaySummary5m[avg_delay_seconds_capped])

Outlier Count =
SUM(TripDelaySummary5m[outlier_count])
```

### Negative delays

Negative `delay_seconds` = vehicle/trip running ahead of schedule. This is
real data, not an error. Display it meaningfully:

```dax
Avg Delay Display =
VAR AvgDelay = [Avg Delay Seconds]
RETURN
IF(ISBLANK(AvgDelay), BLANK(),
   IF(AvgDelay < 0,
      FORMAT(ABS(AvgDelay), "#,0") & "s early",
      FORMAT(AvgDelay, "#,0") & "s late"
   )
)
```

---

## 6. Timezone handling

All `*_utc` columns are stored in UTC. KPI views expose only `feed_timestamp_utc`
and `captured_at_utc` — there are no pre-computed ET columns in the database.

| Column | Meaning |
|--------|---------|
| `feed_timestamp_utc` | When the STM feed was generated (UTC) |
| `captured_at_utc` | When our pipeline captured it (UTC) |
| `snapshot_date_key` | YYYYMMDD integer in `America/Toronto` timezone |
| `snapshot_local_date` | Date in `America/Toronto` timezone |

**Current ET workaround (production):** DAX applies a fixed `-4/24` day offset
to `feed_timestamp_utc` for display. This is correct for EDT but off by one
hour during EST (November–March).

```dax
Latest Vehicle Feed Timestamp ET = MAX(LatestVehicle[feed_timestamp_utc]) - (4/24)
```

A proper `AT TIME ZONE 'America/Toronto'` database-level fix is deferred to a
future slice.

**Power BI should use `snapshot_local_date` or `snapshot_date_key` for date
filtering** — these are already in ET and match what a Montreal operator calls "today."

---

## 7. Refresh cadence expectations

The production model uses **DirectQuery**. There is no scheduled Power BI refresh.
Every page load issues live queries to Neon.

| Pipeline event | Cadence | Power BI effect |
|---------------|---------|----------------|
| Realtime cycle | Every 30s | Next page load picks up new data automatically |
| Static dims | Daily 06:00 UTC | DimRoute / DimStop / DimDate / DimDirection update automatically |
| Warm rollups | Daily 07:00 UTC | VehicleSummary5m / TripDelaySummary5m update automatically |

**Freshness indicator:** The Live Ops page shows `feed_timestamp_utc` (offset
by `-4/24` for ET display) and freshness age in seconds. Staleness > 5 minutes
indicates the realtime worker is paused or failing.

---

## 8. Forbidden patterns

| Pattern | Why it is forbidden |
|---------|-------------------|
| Importing `silver.*` tables | Silver is an internal normalization layer; its schema may change without warning |
| Using KPI view measures for per-route visuals | KPI views return a single network-total row — they ignore row filter context. Use `COUNTROWS(LatestVehicle)` etc. instead. |
| Joining `latest_*` to `*_summary_5m` in one visual | Different grains (per-entity vs 5-min aggregate). Use separate pages/visuals. |
| Assuming `delay_seconds = 0` means "on time" | Zero is "exactly on time." NULL means "unknown." Treat them differently. |
| Filtering out `delay_seconds IS NULL` silently | Always show coverage metrics. Users should know when data is missing. |
| Importing `raw.ingestion_runs` for "health checks" | Use CLI `run-sql` or Neon dashboard for operational checks, not Power BI. |

---

*Cross-references: [04-schema-usage-map](04-schema-usage-map.md) for table
definitions, [05-business-logic-and-kpi-semantics](05-business-logic-and-kpi-semantics.md)
for delay semantics, `powerbi/dax-measures.md` for the full DAX measure library.*
