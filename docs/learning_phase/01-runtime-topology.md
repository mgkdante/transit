# 01 — Runtime Topology

This document maps every running process, scheduled trigger, storage endpoint,
and retention boundary in the transit-ops pipeline. Everything here is
repo-specific — no generic explanations.

---

## Process inventory

| Process | Runtime | Entry point | Cadence | Where it runs |
|---------|---------|-------------|---------|---------------|
| Realtime worker | Docker container | `python -m transit_ops.cli run-realtime-worker stm` | Every 30 s (start-to-start) | Railway (`transit-ops` / `production` / `realtime-worker`) |
| Static pipeline | GitHub Actions | `.github/workflows/daily-static-pipeline.yml` | Daily at 06:00 UTC (02:00 ET in EDT) | GitHub-hosted runner |
| Warm rollups | GitHub Actions | `.github/workflows/daily-warm-rollups.yml` | Daily at 07:00 UTC (03:00 ET in EDT) | GitHub-hosted runner |
| Manual commands | Local shell | `uv run python -m transit_ops.cli <command> stm` | On-demand | Developer machine |

The Railway worker is the only continuously running process. The two GitHub
Actions workflows are scheduled batch jobs. Everything else is manual.

---

## External dependencies

| Dependency | Endpoint / Location | Auth | Used by |
|------------|-------------------|------|---------|
| STM static GTFS | Public URL from `config/providers/stm.yaml` (`static_schedule` feed) | None | `ingest-static` |
| STM RT trip_updates | `https://api.stm.info/pub/od/gtfs-rt/ic/v2/tripUpdates` | `apiKey` header via `STM_API_KEY` | `capture-realtime stm trip_updates` |
| STM RT vehicle_positions | `https://api.stm.info/pub/od/gtfs-rt/ic/v2/vehiclePositions` | `apiKey` header via `STM_API_KEY` | `capture-realtime stm vehicle_positions` |
| Cloudflare R2 | Bucket `transit-raw` at `eccfb9bedd87d413eaf4cac6ae2285d3.r2.cloudflarestorage.com` | `BRONZE_S3_ACCESS_KEY` / `BRONZE_S3_SECRET_KEY` | All Bronze ingestion and reads |
| Neon Postgres | `NEON_DATABASE_URL` | Connection string | All Silver, Gold, metadata operations |

STM realtime requests pin TLS 1.2 via a custom SSL context in
`src/transit_ops/ingestion/realtime_gtfs.py`.

---

## Data flow

```text
                    STM GTFS Static ZIP                  STM GTFS-RT Protobuf (x2 endpoints)
                           |                                         |
                     [ingest-static]                          [capture-realtime]
                           |                                         |
                           v                                         v
                  Cloudflare R2 (Bronze)                    Cloudflare R2 (Bronze)
                  raw.ingestion_runs                        raw.ingestion_runs
                  raw.ingestion_objects                     raw.ingestion_objects
                  core.dataset_versions                     raw.realtime_snapshot_index
                           |
                   [hash gate: compare checksum to
                    core.dataset_versions.content_hash]
                    unchanged → skip Silver + Gold
                    changed   ↓
                   [load-static-silver]                     [load-realtime-silver]
                           |                                         |
                           v                                         v
                  silver.routes                             silver.trip_updates
                  silver.trips                              silver.trip_update_stop_time_updates
                  silver.stops                              silver.vehicle_positions
                  silver.stop_times                                   |
                  silver.calendar                                     |
                  silver.calendar_dates                               |
                           |                                         |
                  [refresh-gold-static]                     [refresh-gold-realtime]
                           |                                         |
                           v                                         v
                  gold.dim_route                            gold.fact_vehicle_snapshot (upsert)
                  gold.dim_stop                             gold.fact_trip_delay_snapshot (upsert)
                  gold.dim_date                             gold.latest_vehicle_snapshot (replace)
                                                            gold.latest_trip_delay_snapshot (replace)
                                                                     |
                                                            [prune-silver-storage]
                                                            [prune-gold-storage]
                                                                     |
                                                            (every cycle, inline)

                  [build-warm-rollups]  (daily, 07:00 UTC)
                           |
                           v
                  gold.vehicle_summary_5m
                  gold.trip_delay_summary_5m
                  gold.warm_rollup_periods
                           |
                  [prune-warm-rollup-storage]
                           |
                           v
                      Power BI (downstream)
```

---

## Retention cascade

Retention is staggered so downstream consumers are always gone before upstream
objects become eligible for deletion.

```text
Timeline (days from capture):

Day 0        Day 2        Day 7        Day 30       Day 90
  |            |            |            |            |
  |-- Silver --|            |            |            |
  |            |            |            |            |
  |-- Gold facts --|        |            |            |
  |            |            |            |            |
  |--------- Bronze RT ----|            |            |
  |            |            |            |            |
  |------------------ Bronze static ----|            |
  |            |            |            |            |
  |-------------------------------- Warm rollups ----|
```

| Layer | Setting | Default | Enforced by | When |
|-------|---------|---------|-------------|------|
| Silver realtime | `SILVER_REALTIME_RETENTION_DAYS` | 2 | `prune_silver_storage()` | Every realtime cycle |
| Silver static | `STATIC_DATASET_RETENTION_COUNT` | 1 | `prune_static_silver_datasets()` | Every Silver static load (when feed changed) |

**Kill-switch:** `PIPELINE_PAUSED=true` makes the worker idle — it sleeps each poll interval without touching STM, Neon, or R2. Flip via `scripts/pause-pipeline.sh` / `scripts/resume-pipeline.sh`.
| Gold facts | `GOLD_FACT_RETENTION_DAYS` | 2 | `prune_gold_storage()` | Every realtime cycle |
| Bronze realtime | `BRONZE_REALTIME_RETENTION_DAYS` | 7 | `prune_bronze_storage()` | Manual / GH Actions |
| Bronze static | `BRONZE_STATIC_RETENTION_DAYS` | 30 | `prune_bronze_storage()` | Manual / GH Actions |
| Warm rollups | `GOLD_WARM_ROLLUP_RETENTION_DAYS` | 90 | `prune_warm_rollup_storage()` | Daily GH Actions |

**Safety rules:**
- Bronze realtime objects are only eligible when no Silver rows reference the
  snapshot AND it is not the latest snapshot for its endpoint
- Bronze static objects are only eligible when no `core.dataset_versions` row
  references the ingestion run

---

## Timing dependency chain

**Why warm rollups run at 07:00 (one hour after static at 06:00):**
- Gold fact tables retain only 2 days (`GOLD_FACT_RETENTION_DAYS=2`)
- Warm rollups read from Gold facts to build 5-minute aggregates
- If rollups do not run within 2 days, the source fact rows are pruned and the
  rollup periods are permanently lost
- Running at 07:00 ensures the static pipeline (06:00) has finished refreshing
  dimensions before the rollup build starts
- Running daily (every 24h) is well within the 2-day fact retention window

**Why the realtime worker runs pruning inline:**
- Silver and Gold fact pruning happen at the end of every realtime cycle
  (inside `run_realtime_cycle()` in `orchestration.py`)
- This keeps the hot tables bounded without needing a separate scheduled job
- Bronze pruning is NOT inline — it is too expensive and touches R2 objects

---

## Environment variable catalog

All variables are defined in `src/transit_ops/settings.py` as fields on the
`Settings` Pydantic model.

| Variable | Default | Secret | Consumed by |
|----------|---------|--------|-------------|
| `APP_ENV` | `"local"` | No | Logging, diagnostics |
| `LOG_LEVEL` | `"INFO"` | No | `configure_logging()` |
| `NEON_DATABASE_URL` | None | **Yes** | All DB operations |
| `PROVIDER_TIMEZONE` | `"America/Toronto"` | No | Gold date key conversion |
| `STM_PROVIDER_ID` | `"stm"` | No | CLI and seed commands |
| `STM_API_KEY` | None | **Yes** | Realtime GTFS-RT capture |
| `STM_STATIC_GTFS_URL` | None | No | Override for static feed URL |
| `STM_RT_TRIP_UPDATES_URL` | None | No | Override for trip_updates URL |
| `STM_RT_VEHICLE_POSITIONS_URL` | None | No | Override for vehicle_positions URL |
| `BRONZE_STORAGE_BACKEND` | `"s3"` | No | Storage abstraction dispatch |
| `BRONZE_LOCAL_ROOT` | `"./data/bronze"` | No | Local storage mode only |
| `BRONZE_S3_ENDPOINT` | R2 account endpoint | No | S3-compatible client |
| `BRONZE_S3_BUCKET` | `"transit-raw"` | No | S3-compatible client |
| `BRONZE_S3_ACCESS_KEY` | None | **Yes** | S3 auth |
| `BRONZE_S3_SECRET_KEY` | None | **Yes** | S3 auth |
| `BRONZE_S3_REGION` | `"auto"` | No | S3 signing region |
| `PIPELINE_PAUSED` | `false` | No | Worker loop kill-switch (true = idle, no cycles) |
| `REALTIME_POLL_SECONDS` | 300 (prod: 30) | No | Worker loop cadence |
| `REALTIME_STARTUP_DELAY_SECONDS` | 0 | No | Worker startup delay |
| `STATIC_DATASET_RETENTION_COUNT` | 1 | No | Silver static pruning |
| `SILVER_REALTIME_RETENTION_DAYS` | 2 | No | Silver realtime pruning |
| `GOLD_FACT_RETENTION_DAYS` | 2 | No | Gold fact pruning |
| `BRONZE_REALTIME_RETENTION_DAYS` | 7 | No | Bronze RT pruning |
| `BRONZE_STATIC_RETENTION_DAYS` | 30 | No | Bronze static pruning |
| `GOLD_WARM_ROLLUP_RETENTION_DAYS` | 90 | No | Warm rollup pruning |

**Railway production overrides:** `REALTIME_POLL_SECONDS=30`,
`BRONZE_STORAGE_BACKEND=s3`, `APP_ENV=production`, `LOG_LEVEL=INFO`.

---

*Cross-references: [02-python-ownership](02-python-ownership.md) for which
modules consume these settings, [04-schema-usage-map](04-schema-usage-map.md)
for the tables each process touches.*
