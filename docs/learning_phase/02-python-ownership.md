# 02 — Python Ownership Map

For each module: what it owns, what it does NOT own, what calls it, and when
it runs. Every path is relative to `src/transit_ops/`.

---

## Package tree

```text
src/transit_ops/
  __init__.py
  cli.py                          # Typer app, ~20 commands, zero business logic
  settings.py                     # Pydantic Settings, env vars, get_settings()
  logging.py                      # configure_logging() — format + level
  orchestration.py                # Pipeline composers: static, realtime cycle, worker loop
  maintenance.py                  # 5 prune/vacuum functions + SQL constants
  core/
    __init__.py
    models.py                     # Enums (FeedKind, StorageBackend, AuthType, SourceFormat),
                                  #   ProviderManifest Pydantic model, seed helpers
  providers/
    __init__.py
    registry.py                   # ProviderRegistry — loads config/providers/*.yaml
  db/
    __init__.py
    connection.py                 # make_engine(), test_connection(), require_database_url()
    migrations/
      env.py                      # Alembic env
      versions/
        0001_initial_foundation.py
        0002_silver_static_tables.py
        0003_silver_realtime_tables.py
        0004_gold_marts_and_kpi_views.py
        0005_gold_kpi_views_null_safe.py
        0006_gold_latest_tables_and_retention_indexes.py
        0007_gold_fact_retention_indexes.py
        0008_warm_rollup_tables.py
  ingestion/
    __init__.py                   # Re-exports: ingest_static_feed, capture_realtime_feed, etc.
    common.py                     # Shared helpers: download_to_tempfile, insert_ingestion_run,
                                  #   build_bronze_object_storage_path, utc_now, compute_sha256_hex
    storage.py                    # BronzeStorage base, LocalBronzeStorage, S3BronzeStorage,
                                  #   get_bronze_storage(), build_s3_client()
    static_gtfs.py                # ingest_static_feed(), build_static_ingestion_config()
    realtime_gtfs.py              # capture_realtime_feed(), extract_realtime_metadata(),
                                  #   build_realtime_ingestion_config(), TLS 1.2 SSL context
  silver/
    __init__.py                   # Re-exports: load_latest_static_to_silver,
                                  #   load_latest_realtime_to_silver, etc.
    static_gtfs.py                # load_latest_static_to_silver(), CSV parsing,
                                  #   CHUNK_SIZE=5_000, REQUIRED_STATIC_MEMBERS
    realtime_gtfs.py              # load_latest_realtime_to_silver(), protobuf normalization,
                                  #   CHUNK_SIZE=10_000, TRIP_UPDATES_INSERT, etc.
  gold/
    __init__.py                   # Re-exports: build_gold_marts, refresh_gold_realtime,
                                  #   refresh_gold_static, build_warm_rollups
    marts.py                      # Gold dimensions + facts: build_gold_marts (heavy),
                                  #   refresh_gold_realtime (upsert), refresh_gold_static (dims only),
                                  #   _trip_delay_snapshot_statement (delay + vehicle_id fallback)
    rollups.py                    # build_warm_rollups(), DATE_BIN('5 minutes'),
                                  #   warm_rollup_periods idempotency
```

---

## Module ownership details

### `settings.py`

| Aspect | Detail |
|--------|--------|
| **Owns** | All environment variable definitions, `Settings` Pydantic model, `get_settings()` with `@lru_cache`, `sqlalchemy_database_url` property, `redacted_database_url`, `display_dict()` |
| **Does NOT own** | Any database queries, any business logic, any file I/O |
| **Called by** | Every module that needs configuration — `cli.py`, `orchestration.py`, `maintenance.py`, all ingestion/silver/gold modules |
| **When** | At import time via `get_settings()` — cached for the process lifetime |

### `cli.py`

| Aspect | Detail |
|--------|--------|
| **Owns** | Typer app definition, all CLI command signatures, `_seed_provider()` / `_seed_feed_endpoints()` SQL for `seed-core`, `_alembic_config()` setup |
| **Does NOT own** | Any pipeline business logic — every command is a thin wrapper that calls a service function and prints `display_dict()` as JSON |
| **Called by** | Terminal / Dockerfile ENTRYPOINT / GitHub Actions |
| **When** | On every CLI invocation |

**Important pattern:** `cli.py` is the only module that imports from every other
package. Nothing imports from `cli.py`. It is a leaf in the dependency graph.

### `orchestration.py`

| Aspect | Detail |
|--------|--------|
| **Owns** | `run_static_pipeline()`, `run_realtime_cycle()`, `run_realtime_worker_loop()`, result dataclasses (`StaticPipelineResult`, `RealtimeCycleResult`, `RealtimeWorkerCycleTelemetry`), step timing/logging, cadence sleep calculation |
| **Does NOT own** | Individual Bronze/Silver/Gold operations — it calls them and times them |
| **Called by** | `cli.py` (three commands: `run-static-pipeline`, `run-realtime-cycle`, `run-realtime-worker`) |
| **When** | Static: daily via GH Actions. Realtime: every 30s via Railway worker. |

**Key behavior:** `run_realtime_cycle()` isolates endpoint failures — if
`trip_updates` capture fails but `vehicle_positions` succeeds, the Gold refresh
still runs for the successful endpoint. Status is `partial_failure`. The cycle
always attempts both endpoints.

**Key behavior:** `run_realtime_worker_loop()` computes
`sleep = max(0, REALTIME_POLL_SECONDS - cycle_duration)` for start-to-start
cadence. Logs a warning on overrun but never crashes. If `PIPELINE_PAUSED=true`,
each loop iteration sleeps the full poll interval and skips the cycle entirely.

### `maintenance.py`

| Aspect | Detail |
|--------|--------|
| **Owns** | `prune_silver_storage()`, `prune_gold_storage()`, `prune_bronze_storage()`, `prune_warm_rollup_storage()`, `vacuum_storage()`, all retention SQL constants, table tuples (`STATIC_SILVER_TABLES`, `REALTIME_SILVER_TABLES`, `GOLD_FACT_TABLES`, `VACUUM_TABLES`) |
| **Does NOT own** | `prune_static_silver_datasets()` (that lives in `silver/static_gtfs.py`), warm rollup period tracking |
| **Called by** | `orchestration.py` (Silver + Gold pruning in realtime cycle), `cli.py` (all prune/vacuum commands) |
| **When** | Silver/Gold pruning: every 30s (inline in realtime cycle). Bronze/warm: daily or manual. |

### `gold/marts.py`

| Aspect | Detail |
|--------|--------|
| **Owns** | All Gold table SQL statements as module-level `text()` constants, `_resolve_gold_build_context()`, `_trip_delay_snapshot_statement()` (delay fallback + vehicle_id LATERAL), `_vehicle_snapshot_statement()`, `build_gold_marts()`, `refresh_gold_realtime()`, `refresh_gold_static()`, advisory lock acquisition, dimension refresh |
| **Does NOT own** | Warm rollup logic (that is in `rollups.py`), retention/pruning logic |
| **Called by** | `orchestration.py` (via `refresh_gold_realtime`, `refresh_gold_static`), `cli.py` (via `build-gold-marts`, `refresh-gold-realtime`, `refresh-gold-static`) |
| **When** | `refresh_gold_realtime`: every 30s. `refresh_gold_static`: daily. `build_gold_marts`: manual recovery only. |

**This is the most important file in the repo.** The `_trip_delay_snapshot_statement()`
function (lines 331-513) contains the delay fallback chain and vehicle_id LATERAL
JOIN — the core business logic for the entire pipeline.

### `gold/rollups.py`

| Aspect | Detail |
|--------|--------|
| **Owns** | `build_warm_rollups()`, `SELECT_MISSING_*_PERIODS` queries, `UPSERT_*_SUMMARY_5M` statements, `UPSERT_WARM_ROLLUP_PERIOD`, `DELETE_OLD_*` retention statements, `WarmRollupBuildResult` |
| **Does NOT own** | Warm rollup pruning execution (called from `maintenance.py` which imports the DELETE constants) |
| **Called by** | `cli.py` (`build-warm-rollups` command) |
| **When** | Daily via GH Actions at 07:00 UTC |

### `ingestion/storage.py`

| Aspect | Detail |
|--------|--------|
| **Owns** | `BronzeStorage` base class, `LocalBronzeStorage`, `S3BronzeStorage`, `get_bronze_storage()` factory, `build_s3_client()`, S3 endpoint validation (`_normalize_s3_endpoint`, `_validate_s3_bucket_name`) |
| **Does NOT own** | Any knowledge of what files are being stored — it is a generic persist/read/delete abstraction |
| **Called by** | `ingestion/static_gtfs.py`, `ingestion/realtime_gtfs.py`, `silver/static_gtfs.py`, `silver/realtime_gtfs.py`, `maintenance.py` (Bronze pruning) |
| **When** | Every Bronze write (capture), every Silver read (load from Bronze), every Bronze delete (pruning) |

### `ingestion/static_gtfs.py`

| Aspect | Detail |
|--------|--------|
| **Owns** | `ingest_static_feed()`, `build_static_ingestion_config()`, `build_static_object_storage_path()`, `StaticIngestionConfig`, `StaticIngestionResult` |
| **Does NOT own** | Silver loading, Gold building, retention |
| **Called by** | `orchestration.py` (`run_static_pipeline`), `cli.py` (`ingest-static`) |
| **When** | Daily via GH Actions static pipeline |

### `ingestion/realtime_gtfs.py`

| Aspect | Detail |
|--------|--------|
| **Owns** | `capture_realtime_feed()`, `build_realtime_ingestion_config()`, `extract_realtime_metadata()`, TLS 1.2 SSL context, `RealtimeIngestionConfig`, `RealtimeIngestionResult`, `RealtimeMessageMetadata` |
| **Does NOT own** | Silver loading, Gold building, retention |
| **Called by** | `orchestration.py` (`run_realtime_cycle`), `cli.py` (`capture-realtime`) |
| **When** | Every 30s (twice per cycle — once per endpoint) |

### `silver/static_gtfs.py`

| Aspect | Detail |
|--------|--------|
| **Owns** | `load_latest_static_to_silver()`, `get_current_static_content_hash()`, CSV parsers for each GTFS member, `discover_gtfs_members()`, `validate_required_static_members()`, dataset version creation, `CHUNK_SIZE=5_000`, `REQUIRED_STATIC_MEMBERS`, `REQUIRED_COLUMNS_BY_MEMBER`, `prune_static_silver_datasets()` |
| **Does NOT own** | Bronze storage reads (delegates to `BronzeStorage.read_bytes()`) |
| **Called by** | `orchestration.py` (`run_static_pipeline`), `cli.py` (`load-static-silver`) |
| **When** | Daily via GH Actions static pipeline; `get_current_static_content_hash` is also called from `orchestration.py` hash gate before any Silver load |

### `silver/realtime_gtfs.py`

| Aspect | Detail |
|--------|--------|
| **Owns** | `load_latest_realtime_to_silver()`, `normalize_trip_updates()`, `normalize_vehicle_positions()`, `find_latest_realtime_bronze_snapshot()`, `CHUNK_SIZE=10_000`, all Silver realtime INSERT statements |
| **Does NOT own** | Bronze storage reads (delegates to `BronzeStorage.read_bytes()`) |
| **Called by** | `orchestration.py` (`run_realtime_cycle`), `cli.py` (`load-realtime-silver`) |
| **When** | Every 30s (twice per cycle — once per endpoint) |

### `ingestion/common.py`

| Aspect | Detail |
|--------|--------|
| **Owns** | `download_to_tempfile()`, `build_bronze_object_storage_path()`, `insert_ingestion_run()`, `mark_ingestion_run_succeeded()`, `mark_ingestion_run_failed()`, `insert_ingestion_object()`, `get_feed_endpoint_id()`, `utc_now()`, `compute_sha256_hex()`, `safe_filename()`, `project_root()` |
| **Does NOT own** | Any specific GTFS or GTFS-RT knowledge |
| **Called by** | `ingestion/static_gtfs.py`, `ingestion/realtime_gtfs.py`, `orchestration.py` (for `utc_now`) |

---

## Module dependency graph

```text
cli.py
  |
  +---> orchestration.py
  |       |
  |       +---> ingestion/ (static_gtfs, realtime_gtfs)
  |       |       +---> ingestion/common.py
  |       |       +---> ingestion/storage.py
  |       |
  |       +---> silver/ (static_gtfs, realtime_gtfs)
  |       |       +---> ingestion/storage.py (for Bronze reads)
  |       |
  |       +---> gold/marts.py
  |       +---> maintenance.py
  |
  +---> gold/ (marts, rollups)   [direct CLI commands]
  +---> maintenance.py           [direct CLI commands]
  +---> ingestion/               [direct CLI commands]
  +---> silver/                  [direct CLI commands]
  +---> providers/registry.py
  +---> settings.py
  +---> db/connection.py

All modules depend on:
  settings.py  -->  get_settings()
  db/connection.py  -->  make_engine()
```

---

## Recurring code patterns

**1. Frozen dataclass results with `display_dict()`**
Every service function returns a frozen dataclass that serializes to JSON via
`display_dict()`. The CLI prints `json.dumps(result.display_dict(), indent=2)`.
This keeps all results inspectable and loggable.

**2. Module-level `text()` SQL constants**
All SQL lives as named module-level constants (e.g., `INSERT_DIM_ROUTE`,
`DELETE_OLD_VEHICLE_POSITIONS`). SQL is never constructed inline. This makes
SQL searchable via grep and auditable in code review.

**3. Optional `Settings` / `Engine` injection**
Every public function accepts `settings: Settings | None = None` and
`engine: Engine | None = None`. This allows tests to inject dependencies while
production code uses `get_settings()` / `make_engine()` defaults.

**4. Explicit `engine.begin()` transaction blocks**
All database operations use `with engine.begin() as connection:` — never
autocommit. Transactions commit on block exit, roll back on exception.

**5. Batched inserts via chunking**
Silver loaders use `CHUNK_SIZE` (5,000 for static, 10,000 for realtime) with
`executemany()` for large INSERT batches.

**6. `_project_root()` helper**
Multiple modules define a local `_project_root()` that resolves
`Path(__file__).resolve().parents[2]` to find the repo root. This is used for
Alembic config, provider manifest loading, and Bronze local root resolution.

---

*Cross-references: [01-runtime-topology](01-runtime-topology.md) for when each
module runs, [06-cursor-reading-itinerary](06-cursor-reading-itinerary.md) for
the order to read these files.*
