# 03 — Command Traces

End-to-end execution trace for 7 CLI commands. For each: CLI entry → function
chain → tables touched → R2 objects touched → write behavior → risk level.

All commands use the form:
```
uv run python -m transit_ops.cli <command> stm [options]
```

---

## 1. `run-static-pipeline stm`

**When:** Daily at 06:00 UTC via `.github/workflows/daily-static-pipeline.yml`

### Execution trace

```text
cli.py: run_static_pipeline()
  └─ orchestration.py: run_static_pipeline(provider_id="stm")
      │
      ├─ Step 1 (always): ingest_static_feed(provider_id)
      │   ├─ ingestion/static_gtfs.py: ingest_static_feed()
      │   │   ├─ ingestion/common.py: get_feed_endpoint_id() — query core.feed_endpoints
      │   │   ├─ ingestion/common.py: insert_ingestion_run() — INSERT raw.ingestion_runs (status='running')
      │   │   ├─ ingestion/common.py: download_to_tempfile() — HTTP GET static GTFS ZIP
      │   │   ├─ ingestion/common.py: compute_sha256_hex() — hash the ZIP
      │   │   ├─ ingestion/storage.py: S3BronzeStorage.persist_temp_file() — PUT to R2
      │   │   ├─ INSERT raw.ingestion_objects — record R2 path + hash
      │   │   └─ ingestion/common.py: mark_ingestion_run_succeeded()
      │   └─ Returns: StaticIngestionResult (contains checksum_sha256)
      │
      ├─ Hash gate
      │   ├─ silver/static_gtfs.py: get_current_static_content_hash()
      │   │   └─ SELECT content_hash FROM core.dataset_versions
      │   │        WHERE provider_id=:pid AND dataset_kind='static_schedule'
      │   │          AND is_current=true ORDER BY loaded_at_utc DESC LIMIT 1
      │   ├─ Compare: StaticIngestionResult.checksum_sha256 vs current content_hash
      │   │
      │   ├─ [UNCHANGED] new_hash == current_hash
      │   │   └─ Return StaticPipelineResult(static_changed=False,
      │   │                                  skipped_reason="static_content_unchanged",
      │   │                                  silver_load=None, gold_build=None)
      │   │
      │   └─ [CHANGED or no existing version] new_hash != current_hash
      │       │
      │       ├─ Step 2: load_latest_static_to_silver(provider_id)
      │       │   ├─ silver/static_gtfs.py: load_latest_static_to_silver()
      │       │   │   ├─ Query raw.ingestion_objects for latest static ZIP path
      │       │   │   ├─ ingestion/storage.py: S3BronzeStorage.read_bytes() — GET from R2
      │       │   │   ├─ Extract ZIP, discover GTFS members
      │       │   │   ├─ Validate required members: routes, stops, trips, stop_times, calendar
      │       │   │   ├─ INSERT core.dataset_versions — creates new version, marks it current
      │       │   │   ├─ Parse each CSV member → chunked INSERT (CHUNK_SIZE=5,000):
      │       │   │   │   silver.routes, silver.stops, silver.trips,
      │       │   │   │   silver.stop_times, silver.calendar, silver.calendar_dates
      │       │   │   └─ prune_static_silver_datasets() — delete old dataset versions
      │       │   └─ Returns: StaticSilverLoadResult
      │       │
      │       └─ Step 3: refresh_gold_static(provider_id)
      │           ├─ gold/marts.py: refresh_gold_static()
      │           │   ├─ pg_advisory_xact_lock(:lock_key)
      │           │   ├─ _resolve_gold_build_context() — find current dataset_version_id
      │           │   ├─ DELETE + INSERT gold.dim_route (from silver.routes)
      │           │   ├─ DELETE + INSERT gold.dim_direction (from silver.trips)
      │           │   ├─ DELETE + INSERT gold.dim_stop (from silver.stops)
      │           │   └─ DELETE + INSERT gold.dim_date (from silver.calendar + calendar_dates)
      │           └─ Returns: GoldStaticRefreshResult
```

### Tables touched

| Table | Operation | When |
|-------|-----------|------|
| `core.feed_endpoints` | SELECT | Always |
| `raw.ingestion_runs` | INSERT, UPDATE | Always |
| `raw.ingestion_objects` | INSERT, SELECT | Always |
| `core.dataset_versions` | SELECT (hash check) | Always |
| `core.dataset_versions` | INSERT, UPDATE | Changed path only |
| `silver.routes` | INSERT (bulk) | Changed path only |
| `silver.stops` | INSERT (bulk) | Changed path only |
| `silver.trips` | INSERT (bulk) | Changed path only |
| `silver.stop_times` | INSERT (bulk), DELETE (old versions) | Changed path only |
| `silver.calendar` | INSERT (bulk), DELETE (old versions) | Changed path only |
| `silver.calendar_dates` | INSERT (bulk), DELETE (old versions) | Changed path only |
| `gold.dim_route` | DELETE + INSERT | Changed path only |
| `gold.dim_stop` | DELETE + INSERT | Changed path only |
| `gold.dim_date` | DELETE + INSERT | Changed path only |

### R2 objects

- **Write:** One static ZIP file to `stm/static/static_schedule/YYYY-MM-DD/<hash>.zip` (always)
- **Read:** Same ZIP read back during Silver load (changed path only)

### Behavior

- **Additive:** Bronze always; Silver + Gold dimensions only when feed changed
- **Destructive:** Old Silver dataset versions deleted, Gold dims replaced (changed path only)
- **Idempotent:** Unchanged hash → Silver/Gold skipped; no new `core.dataset_versions` row created
- **Risk:** Low — dimensions are small, replaced atomically in one transaction

---

## 2. `run-realtime-cycle stm`

**When:** Every 30s inside the realtime worker loop

### Execution trace

```text
cli.py: run_realtime_cycle()
  └─ orchestration.py: run_realtime_cycle(provider_id="stm")
      │
      ├─ For each endpoint in ("trip_updates", "vehicle_positions"):
      │   │
      │   ├─ Step A: capture_realtime_feed(provider_id, endpoint_key)
      │   │   ├─ ingestion/realtime_gtfs.py: capture_realtime_feed()
      │   │   │   ├─ TLS 1.2 SSL context creation
      │   │   │   ├─ HTTP GET from STM GTFS-RT endpoint
      │   │   │   ├─ Parse protobuf → extract entity_count, feed_timestamp
      │   │   │   ├─ Persist protobuf blob to R2
      │   │   │   ├─ INSERT raw.ingestion_runs
      │   │   │   ├─ INSERT raw.ingestion_objects
      │   │   │   └─ INSERT raw.realtime_snapshot_index
      │   │   └─ Returns: RealtimeIngestionResult
      │   │
      │   └─ Step B: load_latest_realtime_to_silver(provider_id, endpoint_key)
      │       ├─ silver/realtime_gtfs.py: load_latest_realtime_to_silver()
      │       │   ├─ find_latest_realtime_bronze_snapshot() — query realtime_snapshot_index
      │       │   ├─ S3BronzeStorage.read_bytes() — GET protobuf from R2
      │       │   ├─ Parse protobuf → normalize into flat rows
      │       │   ├─ trip_updates: INSERT silver.trip_updates + silver.trip_update_stop_time_updates
      │       │   │   (CHUNK_SIZE=10,000)
      │       │   └─ vehicle_positions: INSERT silver.vehicle_positions (CHUNK_SIZE=10,000)
      │       └─ Returns: RealtimeSilverLoadResult
      │
      ├─ Step C: refresh_gold_realtime(provider_id) — if at least one endpoint succeeded
      │   ├─ gold/marts.py: refresh_gold_realtime()
      │   │   ├─ pg_advisory_xact_lock(:lock_key)
      │   │   ├─ _resolve_gold_build_context()
      │   │   ├─ UPSERT gold.fact_vehicle_snapshot (latest snapshot)
      │   │   ├─ UPSERT gold.fact_trip_delay_snapshot (latest snapshot, with fallback chain)
      │   │   ├─ DELETE + INSERT gold.latest_vehicle_snapshot
      │   │   └─ DELETE + INSERT gold.latest_trip_delay_snapshot
      │   └─ Returns: GoldRealtimeRefreshResult
      │
      ├─ Step D: prune_silver_storage(provider_id)
      │   ├─ maintenance.py: prune_silver_storage()
      │   │   ├─ DELETE silver.trip_update_stop_time_updates WHERE captured_at < cutoff
      │   │   ├─ DELETE silver.trip_updates WHERE captured_at < cutoff
      │   │   └─ DELETE silver.vehicle_positions WHERE captured_at < cutoff
      │   └─ Returns: SilverStoragePruneResult
      │
      └─ Step E: prune_gold_storage(provider_id)
          ├─ maintenance.py: prune_gold_storage()
          │   ├─ DELETE gold.fact_trip_delay_snapshot WHERE captured_at < cutoff
          │   └─ DELETE gold.fact_vehicle_snapshot WHERE captured_at < cutoff
          └─ Returns: GoldStoragePruneResult
```

### Tables touched

| Table | Operation |
|-------|-----------|
| `core.feed_endpoints` | SELECT |
| `raw.ingestion_runs` | INSERT, UPDATE (x2 endpoints) |
| `raw.ingestion_objects` | INSERT (x2 endpoints), SELECT |
| `raw.realtime_snapshot_index` | INSERT (x2), SELECT |
| `silver.trip_updates` | INSERT (bulk), DELETE (pruning) |
| `silver.trip_update_stop_time_updates` | INSERT (bulk), DELETE (pruning) |
| `silver.vehicle_positions` | INSERT (bulk), DELETE (pruning) |
| `silver.stop_times` | SELECT (delay fallback) |
| `core.dataset_versions` | SELECT (for current version) |
| `gold.fact_vehicle_snapshot` | UPSERT, DELETE (pruning) |
| `gold.fact_trip_delay_snapshot` | UPSERT, DELETE (pruning) |
| `gold.latest_vehicle_snapshot` | DELETE + INSERT |
| `gold.latest_trip_delay_snapshot` | DELETE + INSERT |

### R2 objects

- **Write:** Two protobuf blobs (~50-100KB each)
- **Read:** Same two blobs read back during Silver load

### Behavior

- **Additive:** Bronze, Silver, Gold facts accumulate
- **Destructive:** Silver/Gold pruning deletes rows older than retention
- **Idempotent:** Gold upsert is safe to re-run; Silver dedup check prevents double-load
- **Bounded:** Silver 2d, Gold facts 2d retention enforced every cycle
- **Risk:** Low — this is the hot path, runs 2,880 times/day at 30s cadence

### Failure isolation

If one endpoint fails:
- The other endpoint still processes normally
- Gold refresh still runs (for whatever data is available)
- Cycle status = `partial_failure`
- The failed endpoint is logged with `error_message`

---

## 3. `run-realtime-worker stm`

**When:** Continuous on Railway (`transit-ops` / `production` / `realtime-worker`)

### Execution trace

```text
cli.py: run_realtime_worker()
  └─ orchestration.py: run_realtime_worker_loop(provider_id="stm")
      │
      ├─ Optional startup delay: sleep(REALTIME_STARTUP_DELAY_SECONDS)
      │
      └─ Infinite loop:
          ├─ [PAUSED] If PIPELINE_PAUSED=true:
          │   └─ log warning, sleep(REALTIME_POLL_SECONDS), continue  ← no cycle work
          │
          ├─ cycle_start = time.monotonic()
          ├─ run_realtime_cycle(provider_id)  ← same as trace #2 above
          ├─ cycle_duration = time.monotonic() - cycle_start
          ├─ sleep_time = max(0, REALTIME_POLL_SECONDS - cycle_duration)
          │   If cycle_duration > REALTIME_POLL_SECONDS: log warning (overrun)
          ├─ time.sleep(sleep_time)
          └─ (repeat)
```

### Behavior

- **Never crashes:** Exceptions within a cycle are caught and logged; the loop continues
- **Start-to-start cadence:** Sleep is computed to maintain consistent interval between cycle starts, not between cycle ends
- **Production cadence:** `REALTIME_POLL_SECONDS=30` on Railway
- **Typical cycle:** 6.5-8.5 seconds, leaving 21-23s sleep headroom
- **Kill-switch:** `PIPELINE_PAUSED=true` idles the loop — no STM/Neon/R2 calls, only sleeps

### Risk

- Medium — this is the only continuously running process
- If it dies, Railway restarts it automatically
- If it overruns, it logs a warning but does not skip cycles

---

## 4. `refresh-gold-static stm`

**When:** Called by `run-static-pipeline` (daily) or manually

### Execution trace

```text
cli.py: refresh_gold_static()
  └─ gold/marts.py: refresh_gold_static(provider_id="stm")
      ├─ pg_advisory_xact_lock(:lock_key)
      ├─ _resolve_gold_build_context()
      │   └─ SELECT core.dataset_versions WHERE is_current = true
      ├─ DELETE gold.dim_route WHERE provider_id = :provider_id
      ├─ INSERT gold.dim_route FROM silver.routes WHERE dataset_version_id = :current
      ├─ DELETE gold.dim_direction WHERE provider_id = :provider_id
      ├─ INSERT gold.dim_direction FROM silver.trips WHERE dataset_version_id = :current
      ├─ DELETE gold.dim_stop WHERE provider_id = :provider_id
      ├─ INSERT gold.dim_stop FROM silver.stops WHERE dataset_version_id = :current
      ├─ DELETE gold.dim_date WHERE provider_id = :provider_id
      └─ INSERT gold.dim_date FROM generate_series(calendar bounds)
```

### Tables touched

| Table | Operation |
|-------|-----------|
| `core.dataset_versions` | SELECT |
| `silver.routes` | SELECT |
| `silver.trips` | SELECT |
| `silver.stops` | SELECT |
| `silver.calendar` | SELECT |
| `silver.calendar_dates` | SELECT |
| `gold.dim_direction` | DELETE + INSERT |
| `gold.dim_route` | DELETE + INSERT |
| `gold.dim_stop` | DELETE + INSERT |
| `gold.dim_date` | DELETE + INSERT |

### R2 objects: None

### Behavior

- **Destructive:** Replaces all dim rows for the provider
- **Idempotent:** Safe to re-run — produces identical results
- **Risk:** Low — dimensions are small (~200 routes, ~9K stops, ~365 dates)
- Does NOT touch fact tables, latest tables, or warm rollups

---

## 5. `refresh-gold-realtime stm`

**When:** Called by `run-realtime-cycle` (every 30s) or manually

### Execution trace

```text
cli.py: refresh_gold_realtime()
  └─ gold/marts.py: refresh_gold_realtime(provider_id="stm")
      ├─ pg_advisory_xact_lock(:lock_key)
      ├─ _resolve_gold_build_context()
      │   ├─ Find current dataset_version_id
      │   └─ Find latest realtime_snapshot_id per endpoint
      │
      ├─ UPSERT gold.fact_vehicle_snapshot
      │   (from silver.vehicle_positions, latest snapshot only)
      │
      ├─ UPSERT gold.fact_trip_delay_snapshot
      │   (from silver.trip_updates, with stop_time_candidates CTE,
      │    trip_delay_fallback CTE, and vehicle_id LATERAL JOIN)
      │
      ├─ DELETE gold.latest_vehicle_snapshot WHERE provider_id
      ├─ INSERT gold.latest_vehicle_snapshot FROM fact WHERE snapshot = latest
      │
      ├─ DELETE gold.latest_trip_delay_snapshot WHERE provider_id
      └─ INSERT gold.latest_trip_delay_snapshot FROM fact WHERE snapshot = latest
```

### Tables touched

| Table | Operation |
|-------|-----------|
| `core.dataset_versions` | SELECT |
| `raw.realtime_snapshot_index` | SELECT |
| `silver.trip_updates` | SELECT |
| `silver.trip_update_stop_time_updates` | SELECT |
| `silver.vehicle_positions` | SELECT |
| `silver.stop_times` | SELECT (delay fallback) |
| `gold.fact_vehicle_snapshot` | UPSERT |
| `gold.fact_trip_delay_snapshot` | UPSERT |
| `gold.latest_vehicle_snapshot` | DELETE + INSERT |
| `gold.latest_trip_delay_snapshot` | DELETE + INSERT |

### R2 objects: None (reads from Silver, not Bronze)

### Behavior

- **Additive:** Appends to fact tables
- **Destructive:** Replaces latest tables
- **Idempotent:** Upsert on facts, full replace on latest — safe to re-run
- **Risk:** Low — this is the most frequently executed Gold operation

---

## 6. `build-warm-rollups stm`

**When:** Daily at 07:00 UTC via `.github/workflows/daily-warm-rollups.yml`

### Execution trace

```text
cli.py: build_warm_rollups()
  └─ gold/rollups.py: build_warm_rollups(provider_id="stm")
      │
      ├─ Find missing vehicle periods:
      │   SELECT DISTINCT DATE_BIN('5 min', captured_at_utc, ...)
      │   FROM gold.fact_vehicle_snapshot
      │   WHERE period NOT IN gold.warm_rollup_periods
      │
      ├─ For each missing vehicle period:
      │   ├─ UPSERT gold.vehicle_summary_5m (aggregated from fact)
      │   └─ UPSERT gold.warm_rollup_periods (mark period built)
      │
      ├─ Find missing trip delay periods:
      │   SELECT DISTINCT DATE_BIN('5 min', captured_at_utc, ...)
      │   FROM gold.fact_trip_delay_snapshot
      │   WHERE period NOT IN gold.warm_rollup_periods
      │
      └─ For each missing trip delay period:
          ├─ UPSERT gold.trip_delay_summary_5m (aggregated from fact)
          └─ UPSERT gold.warm_rollup_periods (mark period built)
```

### Tables touched

| Table | Operation |
|-------|-----------|
| `gold.fact_vehicle_snapshot` | SELECT (aggregate source) |
| `gold.fact_trip_delay_snapshot` | SELECT (aggregate source) |
| `gold.warm_rollup_periods` | SELECT + UPSERT |
| `gold.vehicle_summary_5m` | UPSERT |
| `gold.trip_delay_summary_5m` | UPSERT |

### R2 objects: None

### Behavior

- **Additive:** Only inserts/updates rollup rows for periods not yet built
- **Idempotent:** `warm_rollup_periods` tracking + ON CONFLICT upsert = safe to re-run
- **Bounded:** Optional `since_utc` parameter; reads from 2-day fact window
- **Risk:** Low — rollup tables are write-once per period

### Critical timing

Must run within `GOLD_FACT_RETENTION_DAYS` (2 days) of the data being captured.
If rollups do not run within 2 days, the source fact rows are pruned and those
periods are permanently lost. Running daily at 07:00 UTC is well within this window.

---

## 7. `prune-bronze-storage stm --dry-run`

**When:** Manual or via GH Actions (not inline in realtime cycle)

### Execution trace

```text
cli.py: prune_bronze_storage()
  └─ maintenance.py: prune_bronze_storage(provider_id="stm", dry_run=True)
      │
      ├─ Prune realtime Bronze:
      │   ├─ SELECT raw.ingestion_objects WHERE:
      │   │   - run_kind IN ('trip_updates', 'vehicle_positions')
      │   │   - captured_at < now() - BRONZE_REALTIME_RETENTION_DAYS (7d)
      │   │   - NOT the latest snapshot per endpoint (safety)
      │   │   - no Silver rows reference the snapshot (safety)
      │   ├─ dry_run=True: log eligible objects, do NOT delete
      │   └─ dry_run=False: S3BronzeStorage.delete_object() + DELETE raw.ingestion_objects
      │
      └─ Prune static Bronze:
          ├─ SELECT raw.ingestion_objects WHERE:
          │   - run_kind = 'static_schedule'
          │   - captured_at < now() - BRONZE_STATIC_RETENTION_DAYS (30d)
          │   - no core.dataset_versions row references the ingestion run (safety)
          ├─ dry_run=True: log eligible objects, do NOT delete
          └─ dry_run=False: S3BronzeStorage.delete_object() + DELETE raw.ingestion_objects
```

### Tables touched

| Table | Operation |
|-------|-----------|
| `raw.ingestion_runs` | SELECT |
| `raw.ingestion_objects` | SELECT, DELETE (if not dry-run) |
| `raw.realtime_snapshot_index` | SELECT (safety check) |
| `core.dataset_versions` | SELECT (safety check) |
| `core.feed_endpoints` | SELECT |
| Silver realtime tables | SELECT (reference check) |

### R2 objects

- **dry-run:** None (read-only)
- **not dry-run:** DELETE eligible objects from R2

### Behavior

- **Destructive:** Deletes R2 objects and metadata rows (when not dry-run)
- **Safety guards:** Never deletes the latest snapshot, never deletes objects with downstream references
- **Risk:** Medium — R2 deletes are irreversible. Always use `--dry-run` first.
- **Not inline:** Too expensive for 30s cadence. Run separately.

---

## Command risk summary

| Command | Additive | Destructive | Idempotent | Inline | Risk |
|---------|----------|-------------|------------|--------|------|
| `run-static-pipeline` | Bronze+Silver+Dims | Old Silver versions | Yes | GH Actions daily | Low |
| `run-realtime-cycle` | Bronze+Silver+Facts | Silver/Gold pruning | Yes | Worker loop | Low |
| `run-realtime-worker` | (wraps cycle) | (wraps cycle) | Yes | Railway continuous | Medium |
| `refresh-gold-static` | Dimensions | Replaces dims | Yes | Via static pipeline | Low |
| `refresh-gold-realtime` | Facts+Latest | Replaces latest | Yes | Via realtime cycle | Low |
| `build-warm-rollups` | Rollup rows | None | Yes | GH Actions daily | Low |
| `prune-bronze-storage` | None | R2 objects+metadata | Yes | Manual | Medium |

---

*Cross-references: [01-runtime-topology](01-runtime-topology.md) for when each
command runs, [02-python-ownership](02-python-ownership.md) for which modules
own each step, [04-schema-usage-map](04-schema-usage-map.md) for table details.*
