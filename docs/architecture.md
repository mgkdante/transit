# Architecture

## Overview

A provider-ready GTFS / GTFS-RT analytics pipeline using STM (Société de transport de Montréal)
as the V1 data source. Raw feeds are captured to Cloudflare R2, normalized into Neon Postgres,
and surfaced through a Power BI operations dashboard.

**Stack:** Python 3.12 · Neon Postgres · Cloudflare R2 · Railway · GitHub Actions · Power BI

---

## Data flow

```text
STM GTFS static ZIP     ──► Bronze (Cloudflare R2)  ──► Silver (Neon)  ──► Gold dims   ──► Power BI
STM GTFS-RT protobuf    ──► Bronze (Cloudflare R2)  ──► Silver (Neon)  ──► Gold facts  ──► Power BI
                                                                         ──► Warm rollups ──► Power BI
```

**Bronze** = raw files in R2 + ingestion lineage in Neon
**Silver** = canonical normalized GTFS / GTFS-RT tables in Neon
**Gold** = BI-ready dimensions, facts, latest-serving tables, KPI views, warm rollups

---

## Database schemas

| Schema | Role |
|--------|------|
| `core` | Provider registry, feed endpoint catalog, dataset version tracking |
| `raw` | Ingestion run records, Bronze object metadata, realtime snapshot index |
| `silver` | Normalized GTFS static and GTFS-RT tables (canonical grain) |
| `gold` | BI-ready dimensions, fact snapshots, latest-serving tables, KPI views, warm rollups |
| `ops` | Reserved for operational monitoring (empty in V1) |

---

## Bronze layer

### Purpose

Durable raw archive of every feed capture. Bronze is the lineage anchor — if Silver
or Gold data ever needs to be rebuilt, the source is here.

### Storage

- **Production backend:** Cloudflare R2 via S3-compatible API (`BRONZE_STORAGE_BACKEND=s3`)
- **Local backend:** File system under `BRONZE_LOCAL_ROOT` (development / testing only)
- **Auth:** SigV4 signing, `auto` region for R2, path-style addressing

### Object key pattern

```
Static:   provider_id/endpoint_key/ingested_at_utc=YYYY-MM-DD/YYYYMMDDTHHMMSSffffffZ__<checksum12>__<filename>
Realtime: provider_id/endpoint_key/captured_at_utc=YYYY-MM-DD/YYYYMMDDTHHMMSSffffffZ__<checksum12>__<endpoint_key>.pb
```

Keys are human-readable, deterministic, provider-scoped, and safe to inspect in the R2 console.

### Metadata tables

- `raw.ingestion_runs` — one row per capture attempt (status: pending/running/succeeded/failed)
- `raw.ingestion_objects` — one row per persisted R2 object (path, checksum, byte size)
- `raw.realtime_snapshot_index` — one row per realtime capture (snapshot_id, entity_count, feed_timestamp)

### Retention

| Feed type | Setting | Default | Enforcement |
|-----------|---------|---------|-------------|
| Realtime | `BRONZE_REALTIME_RETENTION_DAYS` | 7 | `prune-bronze-storage` (manual / GH Actions) |
| Static | `BRONZE_STATIC_RETENTION_DAYS` | 30 | `prune-bronze-storage` (manual / GH Actions) |

**Safety rules for deletion:**
- Realtime: object must be older than cutoff AND no Silver rows reference the snapshot AND it is not the latest snapshot for its endpoint
- Static: object must be older than cutoff AND no `core.dataset_versions` row references the ingestion run
- R2 object is deleted first; Neon metadata is only cleaned up if R2 deletion succeeded

---

## Silver layer

### Purpose

Canonical relational representation of GTFS and GTFS-RT data. Silver is the processing
layer — not a consumption layer. Power BI does not read Silver directly.

### Static GTFS tables (from `silver/static_gtfs.py`)

| Table | Key | Source |
|-------|-----|--------|
| `silver.routes` | `(dataset_version_id, route_id)` | `routes.txt` |
| `silver.stops` | `(dataset_version_id, stop_id)` | `stops.txt` |
| `silver.trips` | `(dataset_version_id, trip_id)` | `trips.txt` |
| `silver.stop_times` | `(dataset_version_id, trip_id, stop_sequence)` | `stop_times.txt` |
| `silver.calendar` | `(dataset_version_id, service_id)` | `calendar.txt` |
| `silver.calendar_dates` | `(dataset_version_id, service_id, service_date)` | `calendar_dates.txt` |

Dataset versioning: each static load creates a `core.dataset_versions` row. All Silver
static rows carry `dataset_version_id`. The current version is marked `is_current = true`.

**Retention:** `STATIC_DATASET_RETENTION_COUNT = 1` (keep only the current version).

### Realtime GTFS-RT tables (from `silver/realtime_gtfs.py`)

| Table | Key | Source |
|-------|-----|--------|
| `silver.trip_updates` | `(realtime_snapshot_id, entity_index)` | TripUpdate entities |
| `silver.trip_update_stop_time_updates` | `(realtime_snapshot_id, trip_update_entity_index, stop_time_update_index)` | StopTimeUpdate sub-entities |
| `silver.vehicle_positions` | `(realtime_snapshot_id, entity_index)` | VehiclePosition entities |

Every Silver realtime row carries `realtime_snapshot_id` → `raw.realtime_snapshot_index`
→ `raw.ingestion_runs` → `raw.ingestion_objects`. Full lineage to the original protobuf blob.

**Retention:** `SILVER_REALTIME_RETENTION_DAYS = 2`. Pruned inline at the end of every realtime cycle.

---

## Gold layer

### Purpose

BI-ready serving layer. Dimensions for lookups, fact snapshots for history, latest-serving
tables for live operational reads, KPI views for convenience, and warm rollups for 90-day trends.

### Dimensions (refreshed daily)

| Table | Grain | Source | Rows |
|-------|-------|--------|------|
| `gold.dim_route` | `(provider_id, route_id)` | `silver.routes` | ~200 |
| `gold.dim_stop` | `(provider_id, stop_id)` | `silver.stops` | ~9,000 |
| `gold.dim_date` | `(provider_id, service_date)` | `silver.calendar` + `silver.calendar_dates` | ~365 |
| `gold.dim_direction` | `(provider_id, route_id, direction_id)` | `silver.trips` | ~2× route count |

`dim_date` is generated via `generate_series` across the full service date range. Includes
YYYYMMDD `date_key`, day-of-week, weekend flag, and calendar exception flags.

`dim_direction` holds one row per unique `(route_id, direction_id)` combination, with
`direction_label` set to the most common `trip_headsign` for that route+direction
(e.g. `"Terminus Radisson"`, `"Est"`). Used as a Power BI slicer with real destination
strings instead of raw 0/1 integers.

### Fact snapshots (hot, 2-day retention)

| Table | Grain | Retention |
|-------|-------|-----------|
| `gold.fact_vehicle_snapshot` | `(provider_id, realtime_snapshot_id, entity_index)` | `GOLD_FACT_RETENTION_DAYS = 2` |
| `gold.fact_trip_delay_snapshot` | `(provider_id, realtime_snapshot_id, entity_index)` | `GOLD_FACT_RETENTION_DAYS = 2` |

`fact_trip_delay_snapshot.delay_seconds` uses a two-source fallback:
1. **Primary:** `silver.trip_updates.delay_seconds` (top-level GTFS-RT delay, ~87.6% present)
2. **Fallback:** Derived from `silver.trip_update_stop_time_updates` vs `silver.stop_times` schedule

`fact_trip_delay_snapshot.vehicle_id` uses a LATERAL JOIN fallback when the TripUpdate lacks it:
searches `silver.vehicle_positions` on matching `trip_id` within ±10 minutes of `feed_timestamp_utc`.

### Latest-serving tables (hot, operational)

| Table | Contents | Role |
|-------|----------|------|
| `gold.latest_vehicle_snapshot` | One snapshot's worth of vehicle positions | Primary source for live dashboard KPIs |
| `gold.latest_trip_delay_snapshot` | One snapshot's worth of trip delay state | Primary source for live dashboard KPIs |

Replaced (DELETE + INSERT) on every realtime cycle. Always contains exactly the latest snapshot.

### KPI views

All five views read from `gold.latest_*` tables, not from fact tables.

| View | Output |
|------|--------|
| `gold.kpi_active_vehicles_latest` | `active_vehicle_count` |
| `gold.kpi_routes_with_live_vehicles_latest` | `routes_with_live_vehicles` |
| `gold.kpi_avg_trip_delay_latest` | `avg_delay_seconds` |
| `gold.kpi_max_trip_delay_latest` | `max_delay_seconds` |
| `gold.kpi_delayed_trip_count_latest` | `delayed_trip_count` |

### Warm rollups (warm, 90-day retention)

| Table | Grain | Retention |
|-------|-------|-----------|
| `gold.vehicle_summary_5m` | `(provider_id, period_start_utc, route_id)` | `GOLD_WARM_ROLLUP_RETENTION_DAYS = 90` |
| `gold.trip_delay_summary_5m` | `(provider_id, period_start_utc, route_id)` | 90 days |
| `gold.warm_rollup_periods` | `(provider_id, rollup_kind, period_start_utc)` | 90 days |

Period boundary: `DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01')` — clean
5-minute buckets aligned to UTC midnight.

`trip_delay_summary_5m` carries two delay averages:
- `avg_delay_seconds` — raw average including all non-null values
- `avg_delay_seconds_capped` — average excluding |delay| > 3600s (Power BI KPI column)
- `outlier_count` — rows excluded from the capped average

`build-warm-rollups` is idempotent: `warm_rollup_periods` tracks which periods are built;
already-built periods are skipped. Must run at least every 2 days to capture data before
Gold facts are pruned.

### Hot / Warm / Cold summary

| Layer | Tables | Retention | Power BI use |
|-------|--------|-----------|-------------|
| **Hot** | `latest_*`, `fact_*`, Silver realtime | 2 days | Live KPI cards, current snapshot |
| **Warm** | `*_summary_5m` | 90 days | Trend charts, historical analysis |
| **Cold** | Bronze R2 objects | 7d RT / 30d static | Raw lineage, not imported into Power BI |

---

## Gold refresh paths

Three explicitly separated refresh paths prevent lock contention between daily static work
and continuous realtime work:

| Path | Command | Lock | Scope | When |
|------|---------|------|-------|------|
| Full rebuild | `build-gold-marts` | `LOCK TABLE ACCESS EXCLUSIVE` | All Gold tables, full history | Manual recovery only |
| Static dims | `refresh-gold-static` | Advisory lock | `dim_route`, `dim_stop`, `dim_date`, `dim_direction` | Daily, after static Silver load |
| Realtime upsert | `refresh-gold-realtime` | Advisory lock | Latest snapshot → facts + latest tables | Every 30s, inline in realtime cycle |

`refresh-gold-realtime` and `refresh-gold-static` use different advisory lock keys and
neither acquires a table lock. The 30s realtime worker and the daily static GH Actions job
cannot block each other.

---

## Orchestration

### Realtime cycle (`run-realtime-cycle`)

Every 30 seconds:
1. `capture_realtime_feed` for `trip_updates` → Bronze R2 + raw metadata
2. `capture_realtime_feed` for `vehicle_positions` → Bronze R2 + raw metadata
3. `load_latest_realtime_to_silver` for each endpoint → Silver tables
4. `refresh_gold_realtime` → fact upsert + latest replace
5. `prune_silver_storage` → DELETE Silver rows older than 2 days
6. `prune_gold_storage` → DELETE Gold fact rows older than 2 days

Endpoint failure isolation: if `trip_updates` fails but `vehicle_positions` succeeds,
Gold refresh still runs. Cycle status = `partial_failure`.

### Static pipeline (`run-static-pipeline`)

Daily at 06:00 UTC via GitHub Actions:
1. `ingest_static_feed` → Bronze R2 + raw metadata (always runs)
2. Hash gate: compare `checksum_sha256` from step 1 to `core.dataset_versions.content_hash` for the current active version
   - **Unchanged:** skip steps 3–4; return `static_changed=false`, `skipped_reason="static_content_unchanged"`
   - **Changed (or no existing version):** proceed to steps 3–4
3. `load_latest_static_to_silver` → Silver static tables + dataset version
4. `refresh_gold_static` → replace dim_route, dim_stop, dim_date, dim_direction

### Warm rollups (`build-warm-rollups`)

Daily at 07:00 UTC via GitHub Actions (after static pipeline):
- Builds 5-minute rollup rows for all periods not yet in `warm_rollup_periods`
- Must run within 2 days of capture before facts are pruned

### Worker loop (`run-realtime-worker`)

Runs continuously on Railway. Calls `run_realtime_cycle` in an infinite loop with
start-to-start cadence: `sleep = max(0, REALTIME_POLL_SECONDS - cycle_duration)`.

If `PIPELINE_PAUSED=true`, the loop skips all cycle work and sleeps each interval instead —
no STM, Neon, or R2 calls. Use `scripts/pause-pipeline.sh` / `scripts/resume-pipeline.sh`
to flip this together with GH Actions and Railway compute suspension.

---

## Production cadence

| Setting | Value | Notes |
|---------|-------|-------|
| `REALTIME_POLL_SECONDS` | 30 | Start-to-start interval. Cycle duration is ~6.5–8.5s, leaving ~21–23s sleep headroom. |
| STM quota utilization | ~57.6%/day per endpoint | Well within the 10,000 req/day limit |
| Dashboard freshness | ~15–18s end-to-end | Polling interval + capture + Silver load + Gold refresh |

30 seconds aligns with the GTFS-RT specification recommendation and was validated with
sufficient headroom before being set as the production cadence.

---

## Provider abstraction

The pipeline is STM-first but provider-ready within GTFS / GTFS-RT:

- Provider metadata lives in `config/providers/*.yaml` (one file per provider)
- `core.providers` and `core.feed_endpoints` are the database registry
- All tables carry `provider_id` as a first-class column
- The abstraction boundary is strictly inside GTFS / GTFS-RT — not a generic transit API

V1 has one active provider: `stm`. A second GTFS provider could be added by adding
a validated YAML manifest without changing any Python code.

---

## Freshness model

The system is near-real-time operational reporting, not streaming:

- Static GTFS is a predictable daily batch (06:00 UTC)
- Realtime GTFS-RT is repeated snapshot capture (every 30s)
- Dashboard freshness = polling interval + capture + Silver load + Gold refresh
- No websocket, no event streaming, no dispatch-grade telemetry

---

## Deployment

| Component | Platform | Trigger |
|-----------|----------|---------|
| Realtime worker | Railway (`transit-ops` / `production` / `realtime-worker`) | Always-on Docker container |
| Static pipeline | GitHub Actions (`.github/workflows/daily-static-pipeline.yml`) | Cron 06:00 UTC daily |
| Warm rollups | GitHub Actions (`.github/workflows/daily-warm-rollups.yml`) | Cron 07:00 UTC daily |

Required secrets (Railway + GitHub Actions):
- `NEON_DATABASE_URL`
- `STM_API_KEY` (realtime only)
- `BRONZE_S3_ACCESS_KEY`
- `BRONZE_S3_SECRET_KEY`

Detailed hosting notes: `docs/realtime-worker-hosting.md`

---

## Power BI

Power BI connects to Neon in DirectQuery mode and reads only from `gold.*` tables.
No Silver, raw, or core tables are imported.

| Use case | Gold source |
|----------|------------|
| Live operational KPIs | `gold.kpi_*_latest` views + `gold.latest_*` tables |
| Route / stop / direction dimensions | `gold.dim_*` tables |
| Historical trends | `gold.*_summary_5m` warm rollups |
| Freshness timestamp | `captured_at_utc` on any latest table |

The V1 dashboard is built and published to Power BI Service. It imports 15 tables
(5 KPI views, 2 latest-serving tables, 8 Gold dimensions, facts, and rollup tables)
and exposes four pages: Network Overview, Route Performance, Stop Activity, and
Live Ops / Freshness. A `.pbix` file is not checked into the repository. The
semantic design is documented under `powerbi/` (field mapping, DAX measures,
dashboard spec, SQL validation queries).

**Connection mode:** DirectQuery. Every page load queries Neon live. No scheduled
Import refresh required.

**Timestamps:** KPI views expose `feed_timestamp_utc` and `captured_at_utc` as UTC.
Power BI applies a DAX `-4/24` offset for ET display. A proper `AT TIME ZONE`
database-level fix is deferred to a future slice.

---

## Deferred

- `.pbix` file checked into the repository
- Database-level ET timezone columns in KPI views (`AT TIME ZONE 'America/Toronto'`)
- Power BI "Publish to web" public embed (pending portfolio site update)
- Neon Data API exposure
- Public case study write-up under `transit.yesid.dev`
- Operational alerting and notifications
