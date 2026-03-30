# Current Status

Last updated: 2026-03-30

---

## What is complete

### Pipeline infrastructure

- **Bronze ingestion** — STM static GTFS ZIP and GTFS-RT protobuf snapshots captured to Cloudflare R2 with full ingestion lineage in Neon (`raw.ingestion_runs`, `raw.ingestion_objects`, `raw.realtime_snapshot_index`)
- **Silver normalization** — Static GTFS loaded into 6 canonical tables (`routes`, `stops`, `trips`, `stop_times`, `calendar`, `calendar_dates`). Realtime GTFS-RT loaded into 3 tables (`trip_updates`, `trip_update_stop_time_updates`, `vehicle_positions`)
- **Gold layer** — Dimensions (`dim_route`, `dim_stop`, `dim_date`, `dim_direction`), fact snapshots (`fact_vehicle_snapshot`, `fact_trip_delay_snapshot`), latest-serving tables (`latest_vehicle_snapshot`, `latest_trip_delay_snapshot`), 5 KPI views
- **Warm rollups** — `vehicle_summary_5m` and `trip_delay_summary_5m` aggregated at 5-minute grain, retained 90 days

### Retention and lifecycle

- Silver realtime pruned every 30s cycle (2-day retention)
- Gold facts pruned every 30s cycle (2-day retention)
- Bronze retention commands implemented with dry-run and safety guards (7d RT / 30d static)
- Warm rollup retention implemented (90-day)

### Orchestration

- Realtime worker running continuously on Railway at 30s cadence
- Daily static pipeline on GitHub Actions (06:00 UTC)
- Daily warm rollup build on GitHub Actions (07:00 UTC)
- Endpoint failure isolation in the realtime cycle
- Start-to-start cadence with overrun detection

### Business logic

- `delay_seconds` fallback chain: primary from GTFS-RT top-level delay, fallback derived from stop_time_updates vs static stop_times schedule
- `vehicle_id` LATERAL JOIN fallback: recovered from `silver.vehicle_positions` within ±10 minutes when TripUpdate lacks it
- `avg_delay_seconds_capped` (|delay| ≤ 3600s) in warm rollups with `outlier_count` for transparency

### Cadence validated

- 30s production cadence proven with sufficient headroom (~21–23s sleep per cycle)
- Cycle duration stable at 6.5–8.5s in production
- STM quota usage ~57.6%/day per endpoint (well within 10,000/day limit)

### Power BI dashboard

- V1 operations dashboard built and published to Power BI Service
- **Connection mode:** DirectQuery — every page load queries Neon live; no scheduled refresh required
- **15 tables imported:** 5 KPI views, 2 latest-serving tables (`latest_vehicle_snapshot`, `latest_trip_delay_snapshot`), 8 Gold dimensions, facts, and rollup tables
- **4 pages:** Network Overview, Route Performance, Stop Activity, Live Ops / Freshness
- **15 DAX measures** in a dedicated `_Measures` table (Import mode table, all others DirectQuery)
- Mobile layout built for all 4 pages
- Azure Maps visual used for vehicle map (bypasses tenant org restriction)
- Direction slicer (`DimDirection`) linked to Bus Number slicer via `DimDirection[route_id] → DimRoute[route_id]`
- Timestamps display in ET via DAX `-4/24` offset on `feed_timestamp_utc`

### Documentation

- `docs/architecture.md` — system architecture reference
- `docs/realtime-worker-hosting.md` — Railway deployment and operations
- `docs/learning_phase/` — 9-document internalization pack covering runtime, ownership, schema, business logic, guided reading, SQL drills, Power BI consumption rules
- `powerbi/` — dashboard spec, field mapping, DAX measures, SQL validation queries

---

## What is not yet implemented

### Public case study

A portfolio write-up under `transit.yesid.dev` is deferred. The dashboard now exists to show, but the portfolio site itself needs updating first (scheduled 2026-04-03).

### Power BI public embed

"Publish to web" public embed requires the portfolio site to be updated before sharing. Pending.

### Database-level ET timezone columns

KPI views expose `feed_timestamp_utc` only. A `AT TIME ZONE 'America/Toronto'` column (`feed_timestamp_et`) was designed (migration `0010`) but deferred. Current display uses a DAX `-4/24` workaround, which does not auto-adjust for DST.

### Neon Data API exposure

No public or authenticated API endpoint over the Gold layer. Intentionally deferred.

### Alerting

No operational alerting when the pipeline fails or goes stale. Railway logs are the current visibility mechanism.

---

## Current production state (as of 2026-03-30)

| Component | Status |
|-----------|--------|
| Railway realtime worker | Running at 30s cadence |
| GitHub Actions static pipeline | Running daily 06:00 UTC |
| GitHub Actions warm rollups | Running daily 07:00 UTC |
| Bronze (R2) | Active — capturing every 30s |
| Silver (Neon) | Active — pruned to 2-day window |
| Gold facts (Neon) | Active — pruned to 2-day window |
| Gold latest tables | Active — replaced every 30s |
| Gold warm rollups | Active — 90-day retention |
| Power BI dashboard | **Live in Power BI Service (DirectQuery)** |
| Public embed / portfolio site | Pending (2026-04-03) |
