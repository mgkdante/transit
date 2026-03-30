-- ==========================================================================
-- 07 — Query Drills
--
-- 13 runnable SQL drills against live Neon Postgres.
-- Run via: uv run python -m transit_ops.cli run-sql stm < drill.sql
-- Or connect directly to Neon via psql / DBeaver / any SQL client.
--
-- Organized progressively from basic discovery to capstone reproduction.
-- ==========================================================================

-- ==========================================================================
-- Drill 1: Schema discovery
-- What schemas and tables exist?
-- ==========================================================================

SELECT
    table_schema,
    table_name,
    table_type
FROM information_schema.tables
WHERE table_schema IN ('core', 'raw', 'silver', 'gold', 'ops')
ORDER BY table_schema, table_name;


-- ==========================================================================
-- Drill 2: Provider and feed inventory
-- Who is feeding data into the system?
-- ==========================================================================

SELECT
    p.provider_id,
    p.display_name,
    p.timezone,
    p.is_active,
    fe.feed_endpoint_id,
    fe.endpoint_key,
    fe.feed_kind,
    fe.source_format,
    fe.is_enabled
FROM core.providers AS p
LEFT JOIN core.feed_endpoints AS fe
    ON fe.provider_id = p.provider_id
ORDER BY p.provider_id, fe.endpoint_key;


-- ==========================================================================
-- Drill 3: Ingestion run health
-- How many successful vs failed captures in the last 24h?
-- ==========================================================================

SELECT
    ir.run_kind,
    ir.status,
    count(*) AS run_count,
    min(ir.started_at_utc) AS earliest,
    max(ir.started_at_utc) AS latest
FROM raw.ingestion_runs AS ir
WHERE ir.provider_id = 'stm'
  AND ir.started_at_utc >= now() - interval '24 hours'
GROUP BY ir.run_kind, ir.status
ORDER BY ir.run_kind, ir.status;


-- ==========================================================================
-- Drill 4: Latest realtime snapshot IDs
-- What are the most recent captures per endpoint?
-- ==========================================================================

SELECT
    rsi.feed_endpoint_id,
    fe.endpoint_key,
    rsi.realtime_snapshot_id,
    rsi.feed_timestamp_utc,
    rsi.captured_at_utc,
    rsi.entity_count,
    age(now(), rsi.captured_at_utc) AS age
FROM raw.realtime_snapshot_index AS rsi
INNER JOIN core.feed_endpoints AS fe
    ON fe.feed_endpoint_id = rsi.feed_endpoint_id
WHERE rsi.provider_id = 'stm'
ORDER BY rsi.captured_at_utc DESC
LIMIT 10;


-- ==========================================================================
-- Drill 5: Silver row counts by snapshot
-- How many rows did the last few snapshots produce?
-- ==========================================================================

-- Trip updates
SELECT
    tu.realtime_snapshot_id,
    count(*) AS trip_update_rows,
    count(tu.delay_seconds) AS with_delay,
    count(*) - count(tu.delay_seconds) AS without_delay
FROM silver.trip_updates AS tu
WHERE tu.provider_id = 'stm'
  AND tu.captured_at_utc >= now() - interval '1 hour'
GROUP BY tu.realtime_snapshot_id
ORDER BY tu.realtime_snapshot_id DESC
LIMIT 5;

-- Vehicle positions
SELECT
    vp.realtime_snapshot_id,
    count(*) AS vehicle_position_rows,
    count(DISTINCT vp.vehicle_id) AS distinct_vehicles,
    count(DISTINCT vp.route_id) AS distinct_routes
FROM silver.vehicle_positions AS vp
WHERE vp.provider_id = 'stm'
  AND vp.captured_at_utc >= now() - interval '1 hour'
GROUP BY vp.realtime_snapshot_id
ORDER BY vp.realtime_snapshot_id DESC
LIMIT 5;


-- ==========================================================================
-- Drill 6: Gold fact freshness
-- How fresh are the Gold fact tables?
-- ==========================================================================

SELECT 'fact_vehicle_snapshot' AS table_name,
    count(*) AS total_rows,
    max(captured_at_utc) AS latest_captured,
    min(captured_at_utc) AS earliest_captured,
    age(now(), max(captured_at_utc)) AS staleness
FROM gold.fact_vehicle_snapshot
WHERE provider_id = 'stm'

UNION ALL

SELECT 'fact_trip_delay_snapshot',
    count(*),
    max(captured_at_utc),
    min(captured_at_utc),
    age(now(), max(captured_at_utc))
FROM gold.fact_trip_delay_snapshot
WHERE provider_id = 'stm'

UNION ALL

SELECT 'latest_vehicle_snapshot',
    count(*),
    max(captured_at_utc),
    min(captured_at_utc),
    age(now(), max(captured_at_utc))
FROM gold.latest_vehicle_snapshot
WHERE provider_id = 'stm'

UNION ALL

SELECT 'latest_trip_delay_snapshot',
    count(*),
    max(captured_at_utc),
    min(captured_at_utc),
    age(now(), max(captured_at_utc))
FROM gold.latest_trip_delay_snapshot
WHERE provider_id = 'stm';


-- ==========================================================================
-- Drill 7: delay_seconds coverage (CRITICAL)
-- What percentage of trip delay facts have non-null delay?
-- ==========================================================================

SELECT
    count(*) AS total_rows,
    count(delay_seconds) AS with_delay,
    count(*) - count(delay_seconds) AS without_delay,
    round(
        100.0 * count(delay_seconds) / nullif(count(*), 0),
        1
    ) AS delay_coverage_pct,
    round(avg(delay_seconds)::numeric, 1) AS avg_delay_s,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY delay_seconds) AS p50_delay_s,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY delay_seconds) AS p75_delay_s,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY delay_seconds) AS p95_delay_s,
    max(delay_seconds) AS max_delay_s,
    min(delay_seconds) AS min_delay_s
FROM gold.fact_trip_delay_snapshot
WHERE provider_id = 'stm';


-- ==========================================================================
-- Drill 8: vehicle_id fallback effectiveness
-- How many trip delay facts got their vehicle_id from the LATERAL JOIN?
-- ==========================================================================

-- Approach: compare Silver trip_updates.vehicle_id (may be NULL) against
-- Gold fact_trip_delay_snapshot.vehicle_id (may have been filled by LATERAL)
SELECT
    count(*) AS total_trip_delay_facts,
    count(f.vehicle_id) AS with_vehicle_id,
    count(tu.vehicle_id) AS silver_had_vehicle_id,
    count(f.vehicle_id) - count(tu.vehicle_id) AS recovered_by_lateral,
    round(
        100.0 * (count(f.vehicle_id) - count(tu.vehicle_id))
        / nullif(count(*) - count(tu.vehicle_id), 0),
        1
    ) AS lateral_recovery_pct
FROM gold.fact_trip_delay_snapshot AS f
INNER JOIN silver.trip_updates AS tu
    ON tu.provider_id = f.provider_id
   AND tu.realtime_snapshot_id = f.realtime_snapshot_id
   AND tu.entity_index = f.entity_index
WHERE f.provider_id = 'stm'
  AND f.captured_at_utc >= now() - interval '2 hours';


-- ==========================================================================
-- Drill 9: Reproduce KPI views manually
-- Verify the KPI views match hand-computed results
-- ==========================================================================

-- Active vehicles (should match gold.kpi_active_vehicles_latest)
SELECT
    count(*) AS manual_active_vehicles
FROM gold.latest_vehicle_snapshot
WHERE provider_id = 'stm';

SELECT active_vehicle_count
FROM gold.kpi_active_vehicles_latest
WHERE provider_id = 'stm';

-- Avg delay (should match gold.kpi_avg_trip_delay_latest)
SELECT
    round(avg(delay_seconds) FILTER (WHERE delay_seconds IS NOT NULL)::numeric, 2)
        AS manual_avg_delay
FROM gold.latest_trip_delay_snapshot
WHERE provider_id = 'stm';

SELECT avg_delay_seconds
FROM gold.kpi_avg_trip_delay_latest
WHERE provider_id = 'stm';


-- ==========================================================================
-- Drill 10: Warm rollup completeness
-- Are all 5-minute periods covered? Any gaps?
-- ==========================================================================

SELECT
    rollup_kind,
    count(*) AS periods_built,
    min(period_start_utc) AS earliest_period,
    max(period_start_utc) AS latest_period,
    max(built_at_utc) AS last_built_at
FROM gold.warm_rollup_periods
WHERE provider_id = 'stm'
GROUP BY rollup_kind;

-- Check for gaps: periods in facts that are NOT in rollups
SELECT
    DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01') AS period_start_utc,
    count(*) AS fact_rows
FROM gold.fact_vehicle_snapshot
WHERE provider_id = 'stm'
  AND DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01') NOT IN (
      SELECT period_start_utc
      FROM gold.warm_rollup_periods
      WHERE provider_id = 'stm'
        AND rollup_kind = 'vehicle_summary_5m'
  )
GROUP BY 1
ORDER BY 1
LIMIT 20;


-- ==========================================================================
-- Drill 11: Warm rollup sample — 24h of a route
-- What does a day of vehicle activity look like for route 24?
-- ==========================================================================

SELECT
    period_start_utc,
    vehicle_count,
    observation_count,
    snapshot_count
FROM gold.vehicle_summary_5m
WHERE provider_id = 'stm'
  AND route_id = '24'
  AND period_start_utc >= now() - interval '24 hours'
ORDER BY period_start_utc;

-- Same route, delay summary
SELECT
    period_start_utc,
    trip_count,
    delay_observation_count,
    avg_delay_seconds_capped,
    delayed_trip_count,
    outlier_count
FROM gold.trip_delay_summary_5m
WHERE provider_id = 'stm'
  AND route_id = '24'
  AND period_start_utc >= now() - interval '24 hours'
ORDER BY period_start_utc;


-- ==========================================================================
-- Drill 12: Retention validation
-- Are Silver and Gold pruning working correctly?
-- ==========================================================================

-- Silver realtime: should have no rows older than SILVER_REALTIME_RETENTION_DAYS (2)
SELECT
    'silver.trip_updates' AS table_name,
    count(*) AS old_rows
FROM silver.trip_updates
WHERE provider_id = 'stm'
  AND captured_at_utc < now() - interval '2 days'

UNION ALL

SELECT
    'silver.vehicle_positions',
    count(*)
FROM silver.vehicle_positions
WHERE provider_id = 'stm'
  AND captured_at_utc < now() - interval '2 days'

UNION ALL

-- Gold facts: should have no rows older than GOLD_FACT_RETENTION_DAYS (2)
SELECT
    'gold.fact_vehicle_snapshot',
    count(*)
FROM gold.fact_vehicle_snapshot
WHERE provider_id = 'stm'
  AND captured_at_utc < now() - interval '2 days'

UNION ALL

SELECT
    'gold.fact_trip_delay_snapshot',
    count(*)
FROM gold.fact_trip_delay_snapshot
WHERE provider_id = 'stm'
  AND captured_at_utc < now() - interval '2 days';

-- Expected: 0 for all. If not zero, pruning may be behind.


-- ==========================================================================
-- Drill 13 (CAPSTONE): Derived delay calculation reproduction
-- Manually reproduce the delay fallback for a specific trip
-- ==========================================================================

-- Step 1: Find a trip where tu.delay_seconds IS NULL but Gold has a delay
WITH sample AS (
    SELECT
        f.realtime_snapshot_id,
        f.entity_index,
        f.trip_id,
        f.route_id,
        f.delay_seconds AS gold_delay,
        tu.delay_seconds AS silver_delay
    FROM gold.fact_trip_delay_snapshot AS f
    INNER JOIN silver.trip_updates AS tu
        ON tu.provider_id = f.provider_id
       AND tu.realtime_snapshot_id = f.realtime_snapshot_id
       AND tu.entity_index = f.entity_index
    WHERE f.provider_id = 'stm'
      AND f.delay_seconds IS NOT NULL
      AND tu.delay_seconds IS NULL
      AND f.captured_at_utc >= now() - interval '2 hours'
    LIMIT 1
)
SELECT * FROM sample;

-- Step 2: For that trip, look at the stop_time_updates
-- (Replace :snapshot_id, :entity_index, :trip_id with values from Step 1)
/*
SELECT
    stu.stop_sequence,
    stu.stop_id,
    stu.arrival_time_utc,
    stu.departure_time_utc,
    stu.arrival_delay_seconds
FROM silver.trip_update_stop_time_updates AS stu
WHERE stu.provider_id = 'stm'
  AND stu.realtime_snapshot_id = :snapshot_id
  AND stu.trip_update_entity_index = :entity_index
ORDER BY stu.stop_sequence;
*/

-- Step 3: Compare against static stop_times
-- (Replace :trip_id, :dataset_version_id with actual values)
/*
SELECT
    st.stop_sequence,
    st.stop_id,
    st.arrival_time,
    st.departure_time
FROM silver.stop_times AS st
WHERE st.provider_id = 'stm'
  AND st.dataset_version_id = (
      SELECT dataset_version_id
      FROM core.dataset_versions
      WHERE provider_id = 'stm' AND is_current = true
      LIMIT 1
  )
  AND st.trip_id = :trip_id
ORDER BY st.stop_sequence;
*/

-- The derived delay = realtime arrival time - scheduled arrival time (in seconds).
-- This is what _trip_delay_snapshot_statement() computes in the stop_time_candidates CTE.
