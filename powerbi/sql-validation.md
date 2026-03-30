# SQL Validation Guide

## Purpose

These queries let a reviewer reproduce dashboard KPIs directly from the current
Gold layer in Neon Postgres.

Source file:

- `powerbi/sql-validation.sql`

## How to use

Run the queries against the current reporting database after `build-gold-marts`
has succeeded.

Recommended usage:

1. validate latest network KPI cards
2. validate freshness cards
3. validate delay coverage before trusting delay visuals
4. validate route activity and stop activity visuals

## Query list

- `01_network_kpis_latest`
  - reproduces latest active vehicles, routes running, average delay, and
    delayed trips count
- `02_freshness_latest`
  - reproduces latest vehicle and trip feed timestamps and capture ages
- `03_delay_coverage_latest_snapshot`
  - checks whether the latest trip snapshot actually has usable delay values
- `04_top_routes_by_active_vehicles_latest`
  - supports the Page 1 and Page 2 route activity visuals
- `05_worst_routes_latest_when_delay_exists`
  - supports the route delay ranking, but only when delay data exists
- `06_busiest_stops_last_24h`
  - supports the stop activity page
- `07_latest_vehicle_map_extract`
  - provides a sample map extract for the latest vehicle snapshot
- `08_on_time_percentage_latest_supported_rows`
  - calculates on-time percentage only across trips with non-null delay values

## Important validation rule

Run `03_delay_coverage_latest_snapshot` before approving any delay-heavy visual.

If `pct_with_non_null_delay = 0`, then:

- average delay should be blank
- delayed trips count may still be zero
- on-time percentage should be blank
- worst-route-by-delay visuals should be blank or explicitly labeled as using
  the latest available delay data rather than the exact latest snapshot

## Delay distribution validation

Run this to characterize the delay distribution before configuring outlier
thresholds in Power BI measures:

```sql
-- Coverage
SELECT
    count(*) AS total_rows,
    count(delay_seconds) AS non_null_delay,
    round(100.0 * count(delay_seconds) / NULLIF(count(*), 0), 1) AS pct_non_null
FROM gold.fact_trip_delay_snapshot
WHERE provider_id = 'stm';

-- Distribution percentiles
SELECT
    min(delay_seconds) AS min_delay,
    percentile_cont(0.05) WITHIN GROUP (ORDER BY delay_seconds) AS p5,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY delay_seconds) AS p25,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY delay_seconds) AS p50,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY delay_seconds) AS p75,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY delay_seconds) AS p95,
    max(delay_seconds) AS max_delay
FROM gold.fact_trip_delay_snapshot
WHERE provider_id = 'stm'
  AND delay_seconds IS NOT NULL;

-- Outlier counts
SELECT
    count(*) FILTER (WHERE abs(delay_seconds) > 1800) AS gt_30min,
    count(*) FILTER (WHERE abs(delay_seconds) > 3600) AS gt_1hr,
    count(*) FILTER (WHERE abs(delay_seconds) > 7200) AS gt_2hr
FROM gold.fact_trip_delay_snapshot
WHERE provider_id = 'stm'
  AND delay_seconds IS NOT NULL;
```

**Observed baseline (2026-03-27, 1.1M rows, STM):**
- 87.6% non-null coverage, p50=0s, p75=35s, p95=316s
- 3,512 rows abs > 1 hour (0.36%) — route 777 artifacts with 2 stop_time_updates
- Extreme values up to ~10 hours are stale GTFS-RT entries, not pipeline errors
- Use `avg_delay_seconds_capped` in warm rollup tables for operational KPIs

## Warm rollup validation

After `build-warm-rollups stm` runs, validate with:

```sql
-- Coverage: confirm periods exist
SELECT
    rollup_kind,
    count(*) AS period_count,
    min(period_start_utc) AS earliest_period,
    max(period_start_utc) AS latest_period
FROM gold.warm_rollup_periods
WHERE provider_id = 'stm'
GROUP BY rollup_kind
ORDER BY rollup_kind;

-- Vehicle summary: sample a recent 5-minute window
SELECT
    period_start_utc,
    route_id,
    vehicle_count,
    observation_count,
    snapshot_count,
    built_at_utc
FROM gold.vehicle_summary_5m
WHERE provider_id = 'stm'
ORDER BY period_start_utc DESC, vehicle_count DESC
LIMIT 20;

-- Delay summary: check capped vs raw avg and outlier counts
SELECT
    period_start_utc,
    route_id,
    observation_count,
    delay_observation_count,
    avg_delay_seconds,
    avg_delay_seconds_capped,
    outlier_count
FROM gold.trip_delay_summary_5m
WHERE provider_id = 'stm'
  AND outlier_count > 0
ORDER BY outlier_count DESC
LIMIT 10;
```

## Current Gold-layer conclusion

The current Gold layer is strong enough to validate:

- active vehicles
- routes currently running
- top routes by live vehicles
- busiest stops by vehicle activity
- feed timestamps and freshness age
- average delay, delayed trips count, and on-time percentage (STM now
  includes non-null `delay_seconds` in the latest trip snapshot)

It is not yet strong enough to validate:

- stop-level delay
- stop-level reliability
