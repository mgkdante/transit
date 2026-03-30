# 04 — Schema & Usage Map

Only the tables that matter for understanding the product. For each table:
purpose, grain, primary key, retention, downstream consumers, hot/warm/cold
role, and why it exists. Every schema and table name is real.

---

## Schemas

| Schema | Role |
|--------|------|
| `core` | Provider metadata and dataset version tracking |
| `raw` | Ingestion lineage — runs, objects, realtime snapshot index |
| `silver` | Normalized GTFS and GTFS-RT tables (canonical grain) |
| `gold` | BI-ready dimensions, facts, latest-serving tables, KPI views, warm rollups |
| `ops` | Reserved (empty in V1) |

---

## Core tables

### `core.providers`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Registry of transit agencies that feed data into the system |
| **Grain** | One row per provider |
| **PK** | `provider_id` (text, e.g. `'stm'`) |
| **Key columns** | `display_name`, `timezone`, `is_active` |
| **Retention** | Permanent |
| **Downstream** | Every other table references `provider_id` back to this |
| **Role** | Config / reference — not hot, warm, or cold |
| **Why it exists** | The entire pipeline is provider-scoped. This table makes provider identity explicit and lets the system stay multi-provider-ready without hardcoding STM. |
| **Migration** | `0001_initial_foundation` |

### `core.feed_endpoints`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Catalog of data feeds per provider (static schedule, trip_updates, vehicle_positions) |
| **Grain** | One row per provider + endpoint_key combination |
| **PK** | `feed_endpoint_id` (bigint identity) |
| **Key columns** | `provider_id`, `endpoint_key`, `feed_kind`, `source_format`, `source_url`, `auth_type`, `is_enabled` |
| **Unique constraint** | `(provider_id, endpoint_key)` |
| **Retention** | Permanent |
| **Downstream** | `raw.ingestion_runs`, `raw.realtime_snapshot_index`, `core.dataset_versions` |
| **Role** | Config / reference |
| **Why it exists** | Each provider can have multiple feeds (STM has 3). The ingestion layer uses this table to resolve endpoint URLs and auth configuration. Seeded by `cli.py` `seed-core` command from `config/providers/stm.yaml`. |
| **Migration** | `0001_initial_foundation` |

### `core.dataset_versions`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Tracks each static GTFS dataset that has been loaded into Silver |
| **Grain** | One row per provider + feed_endpoint + content hash |
| **PK** | `dataset_version_id` (bigint identity) |
| **Key columns** | `provider_id`, `source_ingestion_run_id`, `content_hash`, `is_current`, `loaded_at_utc` |
| **Retention** | Permanent (pruned indirectly by `prune_static_silver_datasets()` which marks old versions non-current) |
| **Downstream** | All Silver static tables use `dataset_version_id` as part of their PK. Gold dimensions reference `dataset_version_id`. `_resolve_gold_build_context()` uses this to find the current static dataset. |
| **Role** | Lineage / reference |
| **Why it exists** | Static GTFS feeds change periodically (STM ~monthly). The system must know which version of routes/stops/trips is "current" vs historical. `content_hash` prevents re-loading identical ZIPs. `is_current` flags the active dataset. |
| **Migration** | `0001_initial_foundation` |

---

## Raw tables

### `raw.ingestion_runs`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Audit trail of every Bronze ingestion attempt |
| **Grain** | One row per ingestion attempt (static or realtime) |
| **PK** | `ingestion_run_id` (bigint identity) |
| **Key columns** | `provider_id`, `feed_endpoint_id`, `run_kind`, `status` (pending/running/succeeded/failed), `feed_timestamp_utc`, `entity_count`, `error_message` |
| **Retention** | Permanent (Bronze objects are pruned, but the metadata row stays) |
| **Downstream** | `raw.ingestion_objects`, `raw.realtime_snapshot_index`, `core.dataset_versions` (via `source_ingestion_run_id`) |
| **Role** | Cold lineage |
| **Why it exists** | Every piece of data in the system traces back to an ingestion run. This is the root of the lineage chain: run → object → snapshot → Silver → Gold. If something looks wrong in Gold, you can trace it back to the exact HTTP request that captured it. |
| **Migration** | `0001_initial_foundation` |

### `raw.ingestion_objects`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Registry of every file persisted to Bronze storage (R2 or local) |
| **Grain** | One row per stored object (ZIP file or protobuf blob) |
| **PK** | `ingestion_object_id` (bigint identity) |
| **Key columns** | `ingestion_run_id`, `storage_backend` (local/s3), `storage_path`, `checksum_sha256`, `byte_size` |
| **Unique constraint** | `(storage_backend, storage_path)` |
| **Retention** | Rows survive until `prune_bronze_storage()` deletes both the R2 object and this metadata row |
| **Downstream** | `raw.realtime_snapshot_index` (via `ingestion_object_id`), `core.dataset_versions` (via `source_ingestion_object_id`) |
| **Role** | Cold lineage |
| **Why it exists** | Connects a logical ingestion run to the physical file in R2. `storage_path` is the R2 key (e.g., `stm/realtime/trip_updates/2026-03-27/...`). Bronze pruning uses this table to find and delete old R2 objects safely. |
| **Migration** | `0001_initial_foundation` |

### `raw.realtime_snapshot_index`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Fast lookup index for realtime GTFS-RT snapshots |
| **Grain** | One row per realtime capture (one per endpoint per cycle) |
| **PK** | `realtime_snapshot_id` (bigint identity) |
| **Key columns** | `ingestion_run_id`, `provider_id`, `feed_endpoint_id`, `feed_timestamp_utc`, `entity_count`, `captured_at_utc` |
| **Unique constraint** | `(ingestion_run_id)` — one snapshot per run |
| **Retention** | Permanent (the snapshot metadata survives even after Silver rows and Bronze objects are pruned) |
| **Downstream** | All Silver realtime tables use `realtime_snapshot_id` as part of their PK. All Gold fact tables and latest tables FK to this. `_resolve_gold_build_context()` finds the latest snapshot IDs from this table. Silver/Bronze pruning join through this table to determine what is safe to delete. |
| **Role** | Hot reference (constantly queried to find latest snapshots) |
| **Why it exists** | This is the bridge between raw ingestion and Silver/Gold layers. `realtime_snapshot_id` is the most-joined foreign key in the system. Every Silver realtime row, every Gold fact row, and every Gold latest row points back here. Without this table, there is no way to know which capture a given Silver or Gold row came from. |
| **Migration** | `0001_initial_foundation` |

---

## Silver static tables

All Silver static tables share these traits:
- **PK includes** `dataset_version_id` — rows are version-scoped
- **Retention** controlled by `STATIC_DATASET_RETENTION_COUNT` (default 1) via `prune_static_silver_datasets()`
- **Role** = Hot during Gold dimension refresh, otherwise cold
- **Loaded by** `silver/static_gtfs.py` → `load_latest_static_to_silver()`
- **Migration** `0002_silver_static_tables`

### `silver.routes`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Normalized GTFS `routes.txt` |
| **Grain** | `(dataset_version_id, route_id)` |
| **Key columns** | `route_short_name`, `route_long_name`, `route_type`, `route_color` |
| **Downstream** | `gold.dim_route` reads from this during `refresh_gold_static()` |
| **Why it exists** | Source for the route dimension. STM has ~200 bus routes + métro lines. |

### `silver.stops`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Normalized GTFS `stops.txt` |
| **Grain** | `(dataset_version_id, stop_id)` |
| **Key columns** | `stop_name`, `stop_lat`, `stop_lon`, `parent_station`, `location_type` |
| **Downstream** | `gold.dim_stop` reads from this during `refresh_gold_static()` |
| **Why it exists** | Source for the stop dimension. STM has ~9,000 stops. |

### `silver.trips`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Normalized GTFS `trips.txt` |
| **Grain** | `(dataset_version_id, trip_id)` |
| **Key columns** | `route_id`, `service_id`, `direction_id`, `trip_headsign` |
| **Downstream** | `silver.stop_times` FKs here. Gold delay fallback chain uses `trip_id` to find matching stop_times. |
| **Why it exists** | Links trip_id → route_id for static schedule lookups and delay fallback computation. |

### `silver.stop_times`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Normalized GTFS `stop_times.txt` — the largest Silver static table |
| **Grain** | `(dataset_version_id, trip_id, stop_sequence)` |
| **Key columns** | `stop_id`, `arrival_time`, `departure_time` (text, HH:MM:SS format including >24h) |
| **Downstream** | Gold delay fallback chain: `_trip_delay_snapshot_statement()` compares `stop_time_updates.arrival_time_utc` against `stop_times.arrival_time` to derive delay when `tu.delay_seconds` is NULL. |
| **Why it exists** | **Critical for delay fallback.** Without static scheduled arrival times, the system cannot compute derived delay for trips that lack a top-level `delay_seconds` in GTFS-RT. STM has ~2M stop_times per dataset version. |

### `silver.calendar`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Normalized GTFS `calendar.txt` — weekly service patterns |
| **Grain** | `(dataset_version_id, service_id)` |
| **Key columns** | `monday`..`sunday` (booleans), `start_date`, `end_date` |
| **Downstream** | `gold.dim_date` generation uses `calendar` + `calendar_dates` to determine the date range via `generate_series` across their bounds. |
| **Why it exists** | Defines the service date range for the date dimension. |

### `silver.calendar_dates`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Normalized GTFS `calendar_dates.txt` — service exceptions |
| **Grain** | `(dataset_version_id, service_id, service_date)` |
| **Key columns** | `exception_type` (1=added, 2=removed) |
| **Downstream** | `gold.dim_date` uses this for `has_calendar_exception`, `is_service_added`, `is_service_removed` flags. |
| **Why it exists** | Holidays and special service days. Feeds into the date dimension. |

---

## Silver realtime tables

All Silver realtime tables share these traits:
- **PK includes** `realtime_snapshot_id` — rows are snapshot-scoped
- **Retention** controlled by `SILVER_REALTIME_RETENTION_DAYS` (default 2) via `prune_silver_storage()`
- **Role** = Hot (read every 30s during Gold refresh, pruned every cycle)
- **Loaded by** `silver/realtime_gtfs.py` → `load_latest_realtime_to_silver()`
- **Migration** `0003_silver_realtime_tables`

### `silver.trip_updates`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Normalized GTFS-RT TripUpdate entities |
| **Grain** | `(realtime_snapshot_id, entity_index)` |
| **Key columns** | `trip_id`, `route_id`, `vehicle_id`, `delay_seconds`, `feed_timestamp_utc`, `captured_at_utc` |
| **Downstream** | `gold.fact_trip_delay_snapshot` via `_trip_delay_snapshot_statement()`. The `delay_seconds` column is the primary source for trip delay. |
| **Why it exists** | Primary delay signal. Each row is one trip's delay status at one point in time. `delay_seconds` may be NULL — that triggers the fallback chain. |

### `silver.trip_update_stop_time_updates`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Normalized GTFS-RT StopTimeUpdate sub-entities within TripUpdates |
| **Grain** | `(realtime_snapshot_id, trip_update_entity_index, stop_time_update_index)` |
| **Key columns** | `stop_sequence`, `stop_id`, `arrival_delay_seconds`, `arrival_time_utc`, `departure_delay_seconds`, `departure_time_utc` |
| **Downstream** | Gold delay fallback chain: when `tu.delay_seconds` IS NULL, the `stop_time_candidates` CTE in `_trip_delay_snapshot_statement()` joins `stop_time_updates.arrival_time_utc` against `silver.stop_times.arrival_time` to compute a derived delay. |
| **Why it exists** | **Critical for delay fallback.** Individual stop-level arrival predictions let the pipeline derive per-trip delay when the feed-level delay field is absent. This is common with STM feeds. |

### `silver.vehicle_positions`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Normalized GTFS-RT VehiclePosition entities |
| **Grain** | `(realtime_snapshot_id, entity_index)` |
| **Key columns** | `vehicle_id`, `trip_id`, `route_id`, `latitude`, `longitude`, `speed`, `bearing`, `current_status`, `feed_timestamp_utc`, `captured_at_utc` |
| **Downstream** | `gold.fact_vehicle_snapshot` via `_vehicle_snapshot_statement()`. Also used by the `vehicle_id` LATERAL JOIN fallback in `_trip_delay_snapshot_statement()` when `tu.vehicle_id` is NULL. |
| **Why it exists** | Two purposes: (1) direct source for vehicle snapshot facts, (2) vehicle_id fallback for trip delay facts. The LATERAL JOIN searches this table within a ±10-minute window of the trip update's `feed_timestamp_utc` matching on `trip_id`. |

---

## Gold dimension tables

All Gold dimensions share these traits:
- **Refreshed by** `refresh_gold_static()` (daily via GH Actions static pipeline)
- **Strategy** delete+reinsert from current Silver dataset version
- **Retention** effectively permanent (replaced on each static load, not pruned by age)
- **Role** = Reference — small, read-only dimension tables
- **Migrations** `0004_gold_marts_and_kpi_views` (route, stop, date), `0009_gold_dim_direction` (direction)

### `gold.dim_direction`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Direction dimension for Power BI slicer with real STM headsign strings |
| **Grain** | `(provider_id, route_id, direction_id)` |
| **Key columns** | `direction_id` (0 or 1), `direction_label` (most common `trip_headsign` for that route+direction, e.g. `"Terminus Radisson"`) |
| **Why it exists** | `direction_id` is a raw integer in all fact tables. This dimension resolves it to a human-readable label per route for use as a Power BI slicer. Power BI relates via a `route_direction_key` surrogate (`route_id + "_" + direction_id`). ~2× route count rows for STM. |
| **Source** | `silver.trips` — `DISTINCT ON (provider_id, route_id, direction_id)` ordered by `trip_headsign` |

### `gold.dim_route`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Route dimension for Power BI |
| **Grain** | `(provider_id, route_id)` |
| **Key columns** | `route_short_name`, `route_long_name`, `route_type`, `route_color`, `dataset_version_id` |
| **Why it exists** | Power BI joins fact tables to this for route display names and route-level filtering. ~200 rows for STM. |

### `gold.dim_stop`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Stop dimension for Power BI |
| **Grain** | `(provider_id, stop_id)` |
| **Key columns** | `stop_name`, `stop_lat`, `stop_lon`, `parent_station`, `location_type` |
| **Why it exists** | Power BI uses this for stop-level reporting and map visuals. ~9,000 rows for STM. |

### `gold.dim_date`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Date dimension generated from Silver calendar data |
| **Grain** | `(provider_id, service_date)` |
| **Key columns** | `date_key` (YYYYMMDD integer), `day_of_week_iso`, `day_name`, `is_weekend`, `has_calendar_exception`, `is_service_added`, `is_service_removed` |
| **Why it exists** | Standard BI date dimension. `date_key` is the join key used by fact tables' `snapshot_date_key`. Generated via `generate_series` across the min/max bounds of `silver.calendar` and `silver.calendar_dates`. Includes service exception flags from `calendar_dates`. |

---

## Gold fact tables

Both Gold fact tables share these traits:
- **Refreshed by** `refresh_gold_realtime()` every 30s (upsert from latest snapshot)
- **Retention** controlled by `GOLD_FACT_RETENTION_DAYS` (default 2) via `prune_gold_storage()`
- **Role** = **Hot** — bounded recent history for operational reads
- **Migration** `0004_gold_marts_and_kpi_views`

### `gold.fact_vehicle_snapshot`

| Aspect | Detail |
|--------|--------|
| **Purpose** | One row per vehicle per realtime snapshot — positional state |
| **Grain** | `(provider_id, realtime_snapshot_id, entity_index)` |
| **Key columns** | `snapshot_date_key`, `snapshot_local_date`, `feed_timestamp_utc`, `captured_at_utc`, `vehicle_id`, `trip_id`, `route_id`, `stop_id`, `latitude`, `longitude`, `speed`, `bearing`, `current_status` |
| **Downstream** | `gold.latest_vehicle_snapshot` (replaced each cycle), `gold.vehicle_summary_5m` (warm rollups), KPI views |
| **Why it exists** | Accumulates ~2 days of vehicle position history. Each 30s cycle adds one snapshot's worth of rows (~1,000-1,500 for STM). Used by warm rollups to aggregate vehicle counts before facts are pruned. |

### `gold.fact_trip_delay_snapshot`

| Aspect | Detail |
|--------|--------|
| **Purpose** | One row per trip per realtime snapshot — delay state |
| **Grain** | `(provider_id, realtime_snapshot_id, entity_index)` |
| **Key columns** | `snapshot_date_key`, `snapshot_local_date`, `feed_timestamp_utc`, `captured_at_utc`, `trip_id`, `route_id`, `vehicle_id`, `delay_seconds`, `stop_time_update_count`, `direction_id`, `start_date` |
| **Downstream** | `gold.latest_trip_delay_snapshot` (replaced each cycle), `gold.trip_delay_summary_5m` (warm rollups), KPI views |
| **Why it exists** | Accumulates ~2 days of trip delay history. The `delay_seconds` column contains either the primary GTFS-RT delay or the fallback-derived delay. `vehicle_id` may come from the LATERAL JOIN fallback. `stop_time_update_count` tracks how many stop-level predictions existed. Used by warm rollups to aggregate delay before facts are pruned. |

**Important null semantics for `delay_seconds`:** NULL means the pipeline could not determine delay at all — neither from `tu.delay_seconds` nor from the stop_time_candidates fallback chain. This happens when the trip has no stop_time_updates and no top-level delay. Production coverage is ~87.6% non-null.

---

## Gold latest-serving tables

Both latest tables share these traits:
- **Refreshed by** `refresh_gold_realtime()` every 30s (full replace from latest snapshot only)
- **Strategy** `DELETE WHERE provider_id = :provider_id` then `INSERT ... SELECT` from facts WHERE `realtime_snapshot_id = :latest_id`
- **Retention** effectively zero-history — always contains only the latest snapshot
- **Role** = **Hot path** — these are the primary serving tables for live operational reads
- **Migration** `0006_gold_latest_tables_and_retention_indexes`

### `gold.latest_vehicle_snapshot`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Current vehicle positions for live operational dashboard |
| **Grain** | Same as `fact_vehicle_snapshot` but only the latest snapshot |
| **Schema** | Identical columns to `fact_vehicle_snapshot` |
| **Typical size** | ~1,000-1,500 rows for STM (one snapshot's worth) |
| **Why it exists** | Power BI's live operations page reads from here, not from `fact_vehicle_snapshot`. This keeps live queries scanning a tiny table instead of the full 2-day fact table. KPI views also read from here. |

### `gold.latest_trip_delay_snapshot`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Current trip delay state for live operational dashboard |
| **Grain** | Same as `fact_trip_delay_snapshot` but only the latest snapshot |
| **Schema** | Identical columns to `fact_trip_delay_snapshot` |
| **Typical size** | ~800-1,200 rows for STM (one snapshot's worth) |
| **Why it exists** | Power BI's live operations page reads from here. KPI views read from here (migrated in `0006` from scanning the full fact table). |

---

## Gold KPI views

All 5 KPI views share these traits:
- Read from `gold.latest_*` tables (not fact tables — migrated in `0006`)
- No retention to manage — they are views
- Role = **Hot path** — convenience aggregations over the latest tables
- **Migration** `0004_gold_marts_and_kpi_views` (created), `0005_gold_kpi_views_null_safe` (NULL handling), `0006_gold_latest_tables_and_retention_indexes` (migrated to latest tables)

| View | Source | Output column | What it computes |
|------|--------|---------------|-----------------|
| `gold.kpi_active_vehicles_latest` | `latest_vehicle_snapshot` | `active_vehicle_count` | COUNT of all vehicles in the latest snapshot |
| `gold.kpi_routes_with_live_vehicles_latest` | `latest_vehicle_snapshot` | `routes_with_live_vehicles` | COUNT DISTINCT of `route_id` WHERE route_id IS NOT NULL |
| `gold.kpi_avg_trip_delay_latest` | `latest_trip_delay_snapshot` | `avg_delay_seconds` | AVG of `delay_seconds` FILTER (WHERE NOT NULL), rounded to 2 decimals |
| `gold.kpi_max_trip_delay_latest` | `latest_trip_delay_snapshot` | `max_delay_seconds` | MAX of `delay_seconds` |
| `gold.kpi_delayed_trip_count_latest` | `latest_trip_delay_snapshot` | `delayed_trip_count` | COUNT FILTER (WHERE `delay_seconds > 0`) |

All views also return `provider_id`, `realtime_snapshot_id`, `feed_timestamp_utc`, and `captured_at_utc` for freshness tracking.

---

## Gold warm rollup tables

All warm rollup tables share these traits:
- **Built by** `build_warm_rollups()` via daily GH Actions at 07:00 UTC
- **Retention** controlled by `GOLD_WARM_ROLLUP_RETENTION_DAYS` (default 90) via `prune_warm_rollup_storage()`
- **Role** = **Warm** — bounded historical aggregates for Power BI trend dashboards
- **Migration** `0008_warm_rollup_tables`

### `gold.vehicle_summary_5m`

| Aspect | Detail |
|--------|--------|
| **Purpose** | 5-minute vehicle activity rollups |
| **Grain** | `(provider_id, period_start_utc, route_id)` |
| **Key columns** | `vehicle_count` (distinct vehicles), `observation_count` (total rows), `snapshot_count` (distinct snapshots), `built_at_utc` |
| **Source** | `gold.fact_vehicle_snapshot` grouped by `DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01')` |
| **ON CONFLICT** | Upsert — rebuilds if re-run |
| **Typical scale** | ~47,000 rows after a few days of 30s operation |
| **Why it exists** | Power BI Import mode historical trend page. Vehicle counts per route over time at 5-minute granularity. Cannot scan raw facts — they are pruned after 2 days. |

### `gold.trip_delay_summary_5m`

| Aspect | Detail |
|--------|--------|
| **Purpose** | 5-minute trip delay rollups |
| **Grain** | `(provider_id, period_start_utc, route_id)` |
| **Key columns** | `trip_count`, `observation_count`, `delay_observation_count`, `avg_delay_seconds` (raw), `avg_delay_seconds_capped` (|delay| <= 3600 only), `max_delay_seconds`, `min_delay_seconds`, `delayed_trip_count` (delay > 0), `outlier_count` (|delay| > 3600), `built_at_utc` |
| **Source** | `gold.fact_trip_delay_snapshot` grouped by `DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01')` |
| **ON CONFLICT** | Upsert — rebuilds if re-run |
| **Typical scale** | ~51,000 rows after a few days of 30s operation |
| **Why it exists** | Power BI Import mode historical trend page. Delay statistics per route over time. `avg_delay_seconds_capped` filters out extreme outliers (stale GTFS-RT artifacts, typically route 777). `outlier_count` lets dashboards report how many observations were excluded. |

### `gold.warm_rollup_periods`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Idempotency tracker — records which 5-minute periods have been built |
| **Grain** | `(provider_id, rollup_kind, period_start_utc)` |
| **Key columns** | `rollup_kind` ('vehicle_summary_5m' or 'trip_delay_summary_5m'), `built_at_utc` |
| **ON CONFLICT** | Upsert — updates `built_at_utc` on re-run |
| **Typical scale** | ~672 rows (336 vehicle + 336 trip delay periods after a few days) |
| **Why it exists** | Prevents `build_warm_rollups()` from re-computing periods it has already built. The SELECT queries for missing periods use `NOT IN (SELECT period_start_utc FROM warm_rollup_periods WHERE ...)` to skip already-built periods. This makes daily rollup builds incremental — only new periods since last run are computed. |

---

## Table inventory by hot/warm/cold role

### Hot (queried every 30s, bounded)

| Table | Size class | Retention |
|-------|-----------|-----------|
| `gold.latest_vehicle_snapshot` | ~1,500 rows | Replaced each cycle |
| `gold.latest_trip_delay_snapshot` | ~1,200 rows | Replaced each cycle |
| `gold.fact_vehicle_snapshot` | ~2 days | `GOLD_FACT_RETENTION_DAYS=2` |
| `gold.fact_trip_delay_snapshot` | ~2 days | `GOLD_FACT_RETENTION_DAYS=2` |
| `silver.trip_updates` | ~2 days | `SILVER_REALTIME_RETENTION_DAYS=2` |
| `silver.trip_update_stop_time_updates` | ~2 days | `SILVER_REALTIME_RETENTION_DAYS=2` |
| `silver.vehicle_positions` | ~2 days | `SILVER_REALTIME_RETENTION_DAYS=2` |
| `raw.realtime_snapshot_index` | Growing | Permanent (small rows) |

### Warm (queried by Power BI Import, bounded)

| Table | Size class | Retention |
|-------|-----------|-----------|
| `gold.vehicle_summary_5m` | ~90 days | `GOLD_WARM_ROLLUP_RETENTION_DAYS=90` |
| `gold.trip_delay_summary_5m` | ~90 days | `GOLD_WARM_ROLLUP_RETENTION_DAYS=90` |
| `gold.warm_rollup_periods` | ~90 days | Pruned alongside rollup tables |

### Cold (reference / lineage, rarely queried)

| Table | Size class | Retention |
|-------|-----------|-----------|
| `core.providers` | ~1 row | Permanent |
| `core.feed_endpoints` | ~3 rows | Permanent |
| `core.dataset_versions` | Growing slowly | Permanent |
| `raw.ingestion_runs` | Growing | Permanent |
| `raw.ingestion_objects` | Growing | Pruned by Bronze retention (RT: 7d, static: 30d) |
| `gold.dim_direction` | ~2× route count | Replaced on static load |
| `gold.dim_route` | ~200 rows | Replaced on static load |
| `gold.dim_stop` | ~9,000 rows | Replaced on static load |
| `gold.dim_date` | ~365 rows | Replaced on static load |
| Silver static tables (6) | Varies | `STATIC_DATASET_RETENTION_COUNT=1` |

---

## Index summary

Key indexes that support the hot path (not exhaustive):

| Index | Table | Columns | Used by |
|-------|-------|---------|---------|
| `ix_realtime_snapshot_provider_endpoint_feed_ts` | `raw.realtime_snapshot_index` | `(provider_id, feed_endpoint_id, feed_timestamp_utc)` | Finding latest snapshot per endpoint |
| `ix_realtime_snapshot_provider_captured_at` | `raw.realtime_snapshot_index` | `(provider_id, captured_at_utc)` | Gold refresh, retention queries |
| `ix_silver_trip_updates_provider_trip` | `silver.trip_updates` | `(provider_id, trip_id)` | Gold delay computation |
| `ix_silver_vehicle_positions_provider_trip` | `silver.vehicle_positions` | `(provider_id, trip_id)` | Vehicle_id LATERAL JOIN fallback |
| `ix_gold_fact_vehicle_snapshot_provider_route` | `gold.fact_vehicle_snapshot` | `(provider_id, route_id)` | Warm rollup builds |
| `ix_gold_fact_trip_delay_snapshot_provider_route` | `gold.fact_trip_delay_snapshot` | `(provider_id, route_id)` | Warm rollup builds |

---

*Cross-references: [01-runtime-topology](01-runtime-topology.md) for retention settings,
[02-python-ownership](02-python-ownership.md) for which modules touch these tables,
[05-business-logic-and-kpi-semantics](05-business-logic-and-kpi-semantics.md) for
delay fallback and KPI computation details.*
