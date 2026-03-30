# DAX Measure Plan

## Modeling notes

- The production model uses **DirectQuery**. All tables query Neon live.
- All 15 DAX measures live in a dedicated `_Measures` table (Import mode — measures only).
- **Network KPI cards** use the 5 KPI views (`KpiActiveVehicles` etc.) — they return a
  single pre-aggregated network-total row. Use `SUM()` to pull the scalar value.
- **Per-route visuals** use `LatestVehicle` and `LatestTripDelay` directly with
  `COUNTROWS()` — these respect the DimRoute row filter context.
- **Do not mix these two patterns** in the same visual. KPI view measures return the
  network total regardless of slicer context.

## Network KPI measures (use KPI views)

These read from the pre-aggregated KPI views. Each view returns a single row
(network total). Use `SUM()` to extract the scalar. These measures are correct
for network-level KPI cards only — they ignore row filter context.

```DAX
Active Vehicles (Latest) =
SUM(KpiActiveVehicles[active_vehicle_count])
```

```DAX
Routes Currently Running (Latest) =
SUM(KpiRoutesRunning[routes_with_live_vehicles])
```

```DAX
Average Delay Seconds (Latest) =
SUM(KpiAvgDelay[avg_delay_seconds])
```

```DAX
Delayed Trips Count (Latest) =
SUM(KpiDelayedTrips[delayed_trip_count])
```

## Route-level measures (use latest tables)

These read from `LatestVehicle` / `LatestTripDelay` and respect DimRoute filter
context. Use these for any visual that groups or filters by route.

```DAX
Route Active Vehicles =
COUNTROWS(LatestVehicle)
```

```DAX
Route Delayed Trips =
COUNTROWS(FILTER(LatestTripDelay, LatestTripDelay[delay_seconds] > 0))
```

```DAX
Route Avg Delay Seconds =
CALCULATE(
    AVERAGE(LatestTripDelay[delay_seconds]),
    LatestTripDelay[delay_seconds] <> BLANK()
)
```

```DAX
On-Time Percentage (Latest) =
VAR total = COUNTROWS(LatestTripDelay)
VAR delayed = COUNTROWS(FILTER(LatestTripDelay, LatestTripDelay[delay_seconds] > 300))
RETURN IF(total = 0, BLANK(), DIVIDE(total - delayed, total) * 100)
```

## Stop-level activity measures

```DAX
Vehicle Observations =
COUNTROWS(FactVehicleSnapshot)
```

Requires `DimStop[stop_id] → FactVehicleSnapshot[stop_id]` relationship.

## Freshness measures (use latest tables)

These read directly from `LatestVehicle` and `LatestTripDelay` — no snapshot ID
filtering needed because these tables contain only the latest snapshot.

```DAX
Latest Vehicle Feed Timestamp ET =
MAX(LatestVehicle[feed_timestamp_utc]) - (4/24)
```

```DAX
Latest Trip Feed Timestamp ET =
MAX(LatestTripDelay[feed_timestamp_utc]) - (4/24)
```

```DAX
Vehicle Freshness Age Seconds =
DATEDIFF(MAX(LatestVehicle[feed_timestamp_utc]), NOW(), SECOND)
```

```DAX
Trip Freshness Age Seconds =
DATEDIFF(MAX(LatestTripDelay[feed_timestamp_utc]), NOW(), SECOND)
```

**Note:** The `-4/24` offset is a fixed EDT offset. It is off by one hour during
EST (November–March). A proper DST-aware fix requires `AT TIME ZONE` in the
database layer (deferred to a future slice).

## Warm rollup measures (historical trend pages)

These measures use `gold.vehicle_summary_5m` and `gold.trip_delay_summary_5m` for
historical trend visuals. Import these tables as `VehicleSummary5m` and
`TripDelaySummary5m`. They cover the last 90 days at 5-minute grain.

Use warm rollup tables instead of raw fact tables for trend charts — scanning
2 days of raw facts is fine; scanning 90 days of raw facts in Import mode is not.

```DAX
Avg Vehicle Count (5m Rollup) =
AVERAGE(VehicleSummary5m[vehicle_count])
```

```DAX
Avg Delay Seconds (5m Rollup) =
AVERAGE(TripDelaySummary5m[avg_delay_seconds_capped])
```

This uses `avg_delay_seconds_capped` (abs delay ≤ 3600s). This is intentional:
trips reporting delays greater than 1 hour are feed artifacts (stale GTFS-RT
entries with minimal stop_time_updates), not operational events. The raw
`avg_delay_seconds` column is preserved for anomaly investigation.

```DAX
Delay Outlier Count =
SUM(TripDelaySummary5m[outlier_count])
```

Use `[Delay Outlier Count]` in a subtitle or tooltip on delay trend visuals:
"N anomalous readings excluded from average." This makes outlier-awareness
explicit without re-scanning raw rows.

```DAX
Delayed Trip Ratio (5m Rollup) =
DIVIDE(
    SUM(TripDelaySummary5m[delayed_trip_count]),
    SUM(TripDelaySummary5m[trip_count]),
    BLANK()
)
```

## Delay outlier guidance

**Observed production distribution (2026-03-27, 1.1M rows, STM):**
- 87.6% of rows have non-null `delay_seconds`
- p50 = 0s, p75 = 35s, p95 = 316s — normal operational range
- 3,512 rows with abs > 1 hour (0.36% of rows with delay data)
- Extreme values (up to ~10 hours) are concentrated on a small number of routes
  with only 2 `stop_time_update_count` — characteristic of stale GTFS-RT feed
  entries referencing an already-completed or unstarted trip

**What extreme delays mean:** The GTFS-RT protobuf includes a delay field on
`TripUpdate` entities. When a trip has minimal stop-time context (2 updates),
the reported delay can be a stale value from the previous schedule version.
This is a known characteristic of real-world GTFS-RT feeds, not a computation
error in the pipeline.

**How the pipeline handles it:**
- `gold.fact_trip_delay_snapshot` stores raw `delay_seconds` as-is — raw truth
- `gold.trip_delay_summary_5m` adds `avg_delay_seconds_capped` (abs ≤ 3600)
  and `outlier_count` (abs > 3600) for safe Power BI consumption
- Power BI Import mode should use `avg_delay_seconds_capped` for operational
  KPI cards and `avg_delay_seconds` for anomaly investigation only

## KPI caveats

- `Average Delay Seconds (Latest)` is now expected to show real values — STM trip
  snapshot includes non-null `delay_seconds`.
- `On-Time Percentage (Latest)` should return blank only when
  `[Trips With Delay Data (Latest)] = 0` — this should no longer be the normal state.
- `delay_seconds = NULL` means unknown — display blank/dash, never zero.
- `delay_seconds = 0` means exactly on time. `delay_seconds < 0` means early.
- Stop-level delay measures are intentionally omitted because the current Gold
  layer does not expose a stop-level delay fact.

## Recommended visual behavior

- Keep delay KPI cards blank-aware: if `[Trips With Delay Data (Latest)] = 0`,
  show blank with subtitle "No delay data in latest snapshot"
- Keep route and stop activity visuals visible even when delay visuals are blank
- Keep freshness cards always visible
- Use `avg_delay_seconds_capped` (not raw) for warm rollup trend charts
