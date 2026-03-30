-- Power BI SQL validation queries against the current Gold layer.
-- These are meant to reproduce dashboard KPIs directly in Neon Postgres.

-- 01_network_kpis_latest
WITH active_vehicles AS (
    SELECT
        provider_id,
        realtime_snapshot_id,
        feed_timestamp_utc,
        captured_at_utc,
        active_vehicle_count
    FROM gold.kpi_active_vehicles_latest
    WHERE provider_id = 'stm'
),
routes_running AS (
    SELECT
        provider_id,
        realtime_snapshot_id,
        routes_with_live_vehicles
    FROM gold.kpi_routes_with_live_vehicles_latest
    WHERE provider_id = 'stm'
),
avg_delay AS (
    SELECT
        provider_id,
        realtime_snapshot_id,
        avg_delay_seconds
    FROM gold.kpi_avg_trip_delay_latest
    WHERE provider_id = 'stm'
),
delayed_trips AS (
    SELECT
        provider_id,
        realtime_snapshot_id,
        delayed_trip_count
    FROM gold.kpi_delayed_trip_count_latest
    WHERE provider_id = 'stm'
)
SELECT
    a.provider_id,
    a.realtime_snapshot_id AS vehicle_snapshot_id,
    a.feed_timestamp_utc AS vehicle_feed_timestamp_utc,
    a.captured_at_utc AS vehicle_captured_at_utc,
    a.active_vehicle_count,
    r.routes_with_live_vehicles,
    d.avg_delay_seconds,
    t.delayed_trip_count
FROM active_vehicles a
LEFT JOIN routes_running r
    ON r.provider_id = a.provider_id
LEFT JOIN avg_delay d
    ON d.provider_id = a.provider_id
LEFT JOIN delayed_trips t
    ON t.provider_id = a.provider_id;

-- 02_freshness_latest
WITH latest_vehicle AS (
    SELECT
        max(feed_timestamp_utc) AS latest_vehicle_feed_timestamp_utc,
        max(captured_at_utc) AS latest_vehicle_captured_at_utc
    FROM gold.fact_vehicle_snapshot
    WHERE provider_id = 'stm'
),
latest_trip AS (
    SELECT
        max(feed_timestamp_utc) AS latest_trip_feed_timestamp_utc,
        max(captured_at_utc) AS latest_trip_captured_at_utc
    FROM gold.fact_trip_delay_snapshot
    WHERE provider_id = 'stm'
)
SELECT
    latest_vehicle_feed_timestamp_utc,
    latest_vehicle_captured_at_utc,
    round(extract(epoch FROM (now() - latest_vehicle_captured_at_utc))) AS vehicle_capture_age_seconds,
    latest_trip_feed_timestamp_utc,
    latest_trip_captured_at_utc,
    round(extract(epoch FROM (now() - latest_trip_captured_at_utc))) AS trip_capture_age_seconds
FROM latest_vehicle, latest_trip;

-- 03_delay_coverage_latest_snapshot
WITH latest AS (
    SELECT max(realtime_snapshot_id) AS realtime_snapshot_id
    FROM gold.fact_trip_delay_snapshot
    WHERE provider_id = 'stm'
)
SELECT
    count(*) AS trip_rows,
    count(*) FILTER (WHERE delay_seconds IS NOT NULL) AS trip_rows_with_delay,
    count(*) FILTER (WHERE delay_seconds > 0) AS delayed_trip_rows,
    round(
        100.0 * count(*) FILTER (WHERE delay_seconds IS NOT NULL) / NULLIF(count(*), 0),
        2
    ) AS pct_with_non_null_delay
FROM gold.fact_trip_delay_snapshot f
JOIN latest l
    ON l.realtime_snapshot_id = f.realtime_snapshot_id
WHERE f.provider_id = 'stm';

-- 04_top_routes_by_active_vehicles_latest
WITH latest AS (
    SELECT max(realtime_snapshot_id) AS realtime_snapshot_id
    FROM gold.fact_vehicle_snapshot
    WHERE provider_id = 'stm'
)
SELECT
    f.route_id,
    r.route_short_name,
    r.route_long_name,
    count(*) AS active_vehicle_count
FROM gold.fact_vehicle_snapshot f
LEFT JOIN gold.dim_route r
    ON r.provider_id = f.provider_id
   AND r.route_id = f.route_id
JOIN latest l
    ON l.realtime_snapshot_id = f.realtime_snapshot_id
WHERE f.provider_id = 'stm'
  AND f.route_id IS NOT NULL
GROUP BY f.route_id, r.route_short_name, r.route_long_name
ORDER BY active_vehicle_count DESC, r.route_short_name NULLS LAST, f.route_id
LIMIT 10;

-- 05_worst_routes_latest_when_delay_exists
WITH latest AS (
    SELECT max(realtime_snapshot_id) AS realtime_snapshot_id
    FROM gold.fact_trip_delay_snapshot
    WHERE provider_id = 'stm'
)
SELECT
    f.route_id,
    r.route_short_name,
    r.route_long_name,
    count(*) AS trip_count,
    round(avg(f.delay_seconds) FILTER (WHERE f.delay_seconds IS NOT NULL), 2) AS avg_delay_seconds,
    max(f.delay_seconds) AS max_delay_seconds
FROM gold.fact_trip_delay_snapshot f
LEFT JOIN gold.dim_route r
    ON r.provider_id = f.provider_id
   AND r.route_id = f.route_id
JOIN latest l
    ON l.realtime_snapshot_id = f.realtime_snapshot_id
WHERE f.provider_id = 'stm'
GROUP BY f.route_id, r.route_short_name, r.route_long_name
HAVING count(*) FILTER (WHERE f.delay_seconds IS NOT NULL) > 0
ORDER BY avg_delay_seconds DESC NULLS LAST, trip_count DESC
LIMIT 10;

-- 06_busiest_stops_last_24h
SELECT
    f.stop_id,
    s.stop_name,
    count(*) AS vehicle_rows_last_24h
FROM gold.fact_vehicle_snapshot f
LEFT JOIN gold.dim_stop s
    ON s.provider_id = f.provider_id
   AND s.stop_id = f.stop_id
WHERE f.provider_id = 'stm'
  AND f.stop_id IS NOT NULL
  AND f.feed_timestamp_utc >= now() - interval '24 hours'
GROUP BY f.stop_id, s.stop_name
ORDER BY vehicle_rows_last_24h DESC, f.stop_id
LIMIT 10;

-- 07_latest_vehicle_map_extract
WITH latest AS (
    SELECT max(realtime_snapshot_id) AS realtime_snapshot_id
    FROM gold.fact_vehicle_snapshot
    WHERE provider_id = 'stm'
)
SELECT
    f.vehicle_id,
    f.route_id,
    r.route_short_name,
    f.stop_id,
    s.stop_name,
    f.latitude,
    f.longitude,
    f.current_status,
    f.feed_timestamp_utc
FROM gold.fact_vehicle_snapshot f
LEFT JOIN gold.dim_route r
    ON r.provider_id = f.provider_id
   AND r.route_id = f.route_id
LEFT JOIN gold.dim_stop s
    ON s.provider_id = f.provider_id
   AND s.stop_id = f.stop_id
JOIN latest l
    ON l.realtime_snapshot_id = f.realtime_snapshot_id
WHERE f.provider_id = 'stm'
ORDER BY f.route_id NULLS LAST, f.vehicle_id
LIMIT 100;

-- 08_on_time_percentage_latest_supported_rows
WITH latest AS (
    SELECT max(realtime_snapshot_id) AS realtime_snapshot_id
    FROM gold.fact_trip_delay_snapshot
    WHERE provider_id = 'stm'
)
SELECT
    count(*) FILTER (WHERE delay_seconds IS NOT NULL) AS trips_with_delay_data,
    count(*) FILTER (WHERE delay_seconds IS NOT NULL AND delay_seconds <= 300) AS on_time_trips,
    round(
        100.0 * count(*) FILTER (WHERE delay_seconds IS NOT NULL AND delay_seconds <= 300)
        / NULLIF(count(*) FILTER (WHERE delay_seconds IS NOT NULL), 0),
        2
    ) AS on_time_percentage
FROM gold.fact_trip_delay_snapshot f
JOIN latest l
    ON l.realtime_snapshot_id = f.realtime_snapshot_id
WHERE f.provider_id = 'stm';
