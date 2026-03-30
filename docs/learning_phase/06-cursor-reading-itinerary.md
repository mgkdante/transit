# 06 — Cursor Reading Itinerary

Guided apprenticeship walkthrough for reading the codebase in Cursor/VS Code.
~5-6 hours total. Each phase tells you what to open, what to read first, what to
skip, and a checkpoint question to answer before moving on.

---

## How to use this

1. Open the `transit` repo in Cursor
2. Follow phases A through I in order
3. For each file, read the specific functions/sections called out — do not read every line
4. Answer the checkpoint question before moving to the next phase
5. If a checkpoint question stumps you, re-read the referenced section

---

## Phase A — Orientation (30 min)

**Goal:** Understand what the project is, what data it processes, and how it is
configured.

### Open these files

1. **`pyproject.toml`** — Read the `[project]` section for name, version, dependencies.
   Note: `uv` manages the environment, `ruff` lints, `pytest` tests. No Flask/Django/FastAPI.

2. **`config/providers/stm.yaml`** — Read the entire file. This defines the only
   active provider: STM. Note the three feed endpoints (static_schedule,
   trip_updates, vehicle_positions), their URLs, auth types, and source formats.

3. **`src/transit_ops/core/models.py`** — Read the enums: `FeedKind`,
   `StorageBackend`, `AuthType`, `SourceFormat`. Then read the
   `ProviderManifest` Pydantic model and the `seed_*` helper functions.
   Skip the rest.

### What to ignore

- `README.md` — you will read this at the end
- `docs/` — the learning phase docs are for reference, not for this walkthrough
- `tests/` — you will not read tests during this walkthrough

### Checkpoint

> **Q:** What are the three `endpoint_key` values defined in `stm.yaml`, and what
> `source_format` does each use?

---

## Phase B — Settings and wiring (20 min)

**Goal:** Understand how configuration flows into the application.

### Open these files

1. **`src/transit_ops/settings.py`** — Read the entire file (~112 lines). Note:
   - `Settings` extends Pydantic `BaseSettings` with `model_config` for env prefix
   - `get_settings()` uses `@lru_cache` — one instance per process
   - `sqlalchemy_database_url` property builds the connection string
   - Every retention and cadence setting has a default value
   - `PIPELINE_PAUSED` (default `False`) is the kill-switch for the realtime worker
   - `display_dict()` is the standard serialization pattern

2. **`src/transit_ops/db/connection.py`** — Read `make_engine()` and
   `require_database_url()`. Note the pool settings. Skip `test_connection()`.

### Checkpoint

> **Q:** What is the default value of `REALTIME_POLL_SECONDS`? What value does
> production use, and where is that override set?

---

## Phase C — Bronze ingestion (45 min)

**Goal:** Understand how raw data enters the system.

### Open these files in order

1. **`src/transit_ops/ingestion/storage.py`** — Read in this order:
   - `BronzeStorage` base class (the 4 abstract methods)
   - `S3BronzeStorage.__init__` and `persist_temp_file()`
   - `get_bronze_storage()` factory function
   - Skip `LocalBronzeStorage` details and `_normalize_s3_endpoint`

2. **`src/transit_ops/ingestion/common.py`** — Read:
   - `insert_ingestion_run()` — creates the `raw.ingestion_runs` row
   - `mark_ingestion_run_succeeded()` / `mark_ingestion_run_failed()`
   - `build_bronze_object_storage_path()` — how R2 keys are constructed
   - `get_feed_endpoint_id()` — how endpoint config is resolved
   - Skip `download_to_tempfile()` internals and `project_root()`

3. **`src/transit_ops/ingestion/realtime_gtfs.py`** — Read:
   - `capture_realtime_feed()` — follow the flow: build config → download →
     parse protobuf → extract metadata → persist to R2 → record in DB
   - Note the TLS 1.2 SSL context (lines ~20-30)
   - Skip `build_realtime_ingestion_config()` details

4. **`src/transit_ops/ingestion/static_gtfs.py`** — Skim:
   - `ingest_static_feed()` — same pattern as realtime but with ZIP files
   - Note the `content_hash` dedup check
   - Skip CSV parsing details

### Checkpoint

> **Q:** When `capture_realtime_feed()` finishes successfully, exactly which 3
> tables have new rows? (Hint: think run, object, snapshot.)

---

## Phase D — Silver normalization (45 min)

**Goal:** Understand how Bronze blobs become queryable rows.

### Open these files in order

1. **`src/transit_ops/silver/realtime_gtfs.py`** — Read:
   - `load_latest_realtime_to_silver()` — the main entry point
   - `find_latest_realtime_bronze_snapshot()` — how it finds the Bronze blob to load
   - `normalize_trip_updates()` — follow the protobuf → flat dict transformation
   - Note `CHUNK_SIZE = 10_000` and the chunked `executemany()` pattern
   - Note the snapshot dedup check (if Silver rows already exist, skip)
   - Read the `TRIP_UPDATES_INSERT` SQL constant to see the target columns
   - Skim `normalize_vehicle_positions()` — same pattern

2. **`src/transit_ops/silver/static_gtfs.py`** — Read:
   - `load_latest_static_to_silver()` — follow the flow
   - `get_current_static_content_hash()` — queries `core.dataset_versions` for the
     current active hash; used by the orchestration hash gate to skip unchanged loads
   - `REQUIRED_STATIC_MEMBERS` and `REQUIRED_COLUMNS_BY_MEMBER` constants
   - `discover_gtfs_members()` — how it knows which CSV files are in the ZIP
   - Note `CHUNK_SIZE = 5_000`
   - `prune_static_silver_datasets()` — how old versions are cleaned up
   - Skip individual CSV parser functions

### Checkpoint

> **Q:** If the realtime worker runs a cycle and `silver.trip_updates` already
> has rows for the current `realtime_snapshot_id`, what happens? Why?

---

## Phase E — Gold layer (60 min) ⭐ Most important phase

**Goal:** Understand the heart of the pipeline — how Silver becomes Gold.

### Open this file

**`src/transit_ops/gold/marts.py`** — This is the most important file in the repo.

### Reading order within the file

1. **`_resolve_gold_build_context()`** (~line 100-150) — How the system finds:
   - The current `dataset_version_id` (for static lookups)
   - The latest `realtime_snapshot_id` per endpoint (trip_updates, vehicle_positions)
   - Read this first — it provides the context all other functions depend on

2. **`_vehicle_snapshot_statement()`** (~lines 243-328) — How vehicle positions
   become Gold facts. Note:
   - `timezone(:provider_timezone, ...)` for date key conversion
   - `latest_only` and `upsert` parameters control the SQL variant

3. **`_trip_delay_snapshot_statement()`** (lines 331-513) — **Read this carefully.**
   This is the core business logic. Follow the CTEs in order:
   - `stop_time_counts` — counts stop_time_updates per trip
   - `stop_time_candidates` — the delay fallback computation
   - `trip_delay_fallback` — picks the best candidate (rank=1)
   - Final SELECT with `COALESCE(tu.delay_seconds, tdf.derived_delay_seconds)`
   - The LATERAL JOIN for `vehicle_id` fallback (lines 490-507)

4. **`refresh_gold_realtime()`** (~line 600+) — The 30s hot-path function:
   - Advisory lock acquisition
   - Upsert facts for latest snapshot
   - Replace latest tables
   - This is what runs 2,880 times per day

5. **`refresh_gold_static()`** — The daily dimension refresh:
   - Advisory lock (different key from realtime)
   - Delete+insert dims only — does NOT touch facts or latest

6. **`build_gold_marts()`** — Manual recovery only:
   - `LOCK TABLE IN ACCESS EXCLUSIVE MODE` — heavy lock
   - Full-history rebuild from all Silver data
   - You should rarely (never?) need to run this in production

### What to skip

- The module-level SQL constants below the functions — they are generated by the
  `_*_statement()` functions you already read
- The result dataclass definitions — standard frozen dataclasses

### Checkpoint

> **Q:** In `_trip_delay_snapshot_statement()`, if `tu.delay_seconds` is NULL,
> `tu.start_date` is NULL, and the trip has stop_time_updates — does the fallback
> chain produce a derived delay? Why or why not?

---

## Phase F — Warm rollups (20 min)

**Goal:** Understand how 2-day facts become 90-day trends.

### Open this file

**`src/transit_ops/gold/rollups.py`** — Read the entire file (~286 lines).

### Reading order

1. `SELECT_MISSING_VEHICLE_PERIODS` — How it finds unbuilt 5-minute periods
   using `DATE_BIN` and `NOT IN (warm_rollup_periods)`
2. `UPSERT_VEHICLE_SUMMARY_5M` — The aggregation: COUNT DISTINCT vehicles,
   COUNT observations, COUNT DISTINCT snapshots
3. `UPSERT_TRIP_DELAY_SUMMARY_5M` — The delay aggregation. Note:
   - `avg_delay_seconds` (raw) vs `avg_delay_seconds_capped` (filtered)
   - `COALESCE(route_id, '__unrouted__')` for NULL route handling
4. `build_warm_rollups()` — The main function. Note the one-period-at-a-time loop
   and the `warm_rollup_periods` tracking upsert

### Checkpoint

> **Q:** If `build-warm-rollups` runs twice in the same day with the same data,
> how many new rollup rows are inserted the second time? Why?

---

## Phase G — Orchestration and maintenance (30 min)

**Goal:** Understand how individual steps are composed into pipelines.

### Open these files

1. **`src/transit_ops/orchestration.py`** — Read:
   - `run_realtime_cycle()` — the complete 30s cycle with endpoint isolation,
     Gold refresh, and inline pruning
   - `run_realtime_worker_loop()` — the infinite loop with cadence sleep; note the
     `PIPELINE_PAUSED` check at the top of each iteration (idles without doing any work)
   - `run_static_pipeline()` — the daily pipeline; note the **hash gate** between
     Bronze ingest and Silver load: if `checksum_sha256` matches the current
     `core.dataset_versions.content_hash`, Silver and Gold are skipped and
     `static_changed=False` is returned
   - Note the timing telemetry (`time.monotonic()` around each step)
   - Note `RealtimeCycleResult.status` logic: `succeeded` / `partial_failure` / `failed`

2. **`src/transit_ops/maintenance.py`** — Read:
   - The table tuples at the top: `STATIC_SILVER_TABLES`, `REALTIME_SILVER_TABLES`,
     `GOLD_FACT_TABLES`, `VACUUM_TABLES`
   - `prune_silver_storage()` — note the safety check: never delete the latest
     snapshot's rows
   - `prune_gold_storage()` — simpler, just age-based DELETE
   - `prune_bronze_storage()` — note the two safety guards (no downstream refs,
     not the latest snapshot)
   - Skip `vacuum_storage()` details

### Checkpoint

> **Q:** If `capture_realtime_feed("stm", "trip_updates")` throws an exception,
> does `refresh_gold_realtime()` still run? Under what condition?

---

## Phase H — CLI and deployment (15 min)

**Goal:** Understand how everything is exposed to operators.

### Open these files

1. **`scripts/pause-pipeline.sh`** and **`scripts/resume-pipeline.sh`** — Skim both.
   These are the operational kill-switch: they disable/enable GH Actions workflows,
   flip `PIPELINE_PAUSED` on Railway, and suspend/redeploy the Railway service via
   GraphQL API. One command to stop everything; one to restart.

2. **`src/transit_ops/cli.py`** — Skim, do not read every command:
   - Note the Typer app structure
   - Look at `seed_core` — this is how providers and feed endpoints get into the DB
   - Look at any one pipeline command (e.g., `run_realtime_cycle`) — note it is a
     thin wrapper: parse args → call service function → print JSON
   - Note: `cli.py` imports from every other package; nothing imports from `cli.py`

2. **`.github/workflows/daily-static-pipeline.yml`** — Skim:
   - Cron schedule (`06:00 UTC`)
   - Steps: checkout → setup Python → install deps → run command
   - Note: secrets are injected via GitHub Actions environment

3. **`.github/workflows/daily-warm-rollups.yml`** — Same pattern, `07:00 UTC`

### Checkpoint

> **Q:** What does every CLI command print to stdout? What format? Why?

---

## Phase I — Power BI handoff (20 min)

**Goal:** Understand what Gold layer objects Power BI will consume.

### Open these files

1. **`powerbi/field-mapping.md`** — Read the Gold table → Power BI model mapping
2. **`powerbi/dax-measures.md`** — Skim the DAX measure definitions
3. **`powerbi/dashboard-spec.md`** — Read the 4-page dashboard layout

### What to understand

- Power BI imports `latest_*` tables for live operational reads (small, fast)
- Power BI imports warm rollup tables for historical trends (Import mode)
- Power BI does NOT import Silver tables or raw fact tables
- The hot/warm boundary is at 2 days — facts are operational, rollups are historical

### Checkpoint

> **Q:** Why does Power BI not import `gold.fact_vehicle_snapshot` directly for
> historical analysis?

---

## Checkpoint answers (for self-checking)

<details>
<summary>Phase A</summary>

`static_schedule` → `gtfs_schedule_zip`; `trip_updates` → `gtfs_rt_trip_updates`;
`vehicle_positions` → `gtfs_rt_vehicle_positions`
</details>

<details>
<summary>Phase B</summary>

Default is 300 seconds. Production uses 30 seconds, set via Railway environment
variable `REALTIME_POLL_SECONDS=30`.
</details>

<details>
<summary>Phase C</summary>

`raw.ingestion_runs`, `raw.ingestion_objects`, `raw.realtime_snapshot_index`
</details>

<details>
<summary>Phase D</summary>

The load is skipped — the dedup check sees existing rows for that
`realtime_snapshot_id` and returns early. This prevents double-loading if the
same snapshot is processed twice.
</details>

<details>
<summary>Phase E</summary>

No. The fallback chain requires `tu.start_date IS NOT NULL` (line 435:
`WHERE tu.start_date IS NOT NULL`). Without `start_date`, the scheduled arrival
time cannot be reconstructed, so the `stop_time_candidates` CTE produces no
rows, and `derived_delay_seconds` is NULL.
</details>

<details>
<summary>Phase F</summary>

Zero. The `SELECT_MISSING_*_PERIODS` queries exclude periods already in
`warm_rollup_periods`. Since all periods were marked as built during the first
run, the second run finds no missing periods and inserts nothing.
</details>

<details>
<summary>Phase G</summary>

Yes, if the vehicle_positions endpoint succeeded. `run_realtime_cycle()` isolates
endpoint failures — Gold refresh runs as long as `successful_endpoint_count > 0`.
The cycle status will be `partial_failure`.
</details>

<details>
<summary>Phase H</summary>

Every command prints `json.dumps(result.display_dict(), indent=2)` — the frozen
dataclass result serialized as JSON. This makes all output inspectable and
loggable, and keeps the CLI a thin wrapper with zero business logic.
</details>

<details>
<summary>Phase I</summary>

Because `fact_vehicle_snapshot` retains only 2 days (`GOLD_FACT_RETENTION_DAYS=2`).
Historical data beyond 2 days does not exist in the fact table — it has been
pruned. Warm rollups (`vehicle_summary_5m`) retain 90 days of 5-minute aggregates,
which is the proper source for historical Power BI analysis.
</details>

---

*Cross-references: [02-python-ownership](02-python-ownership.md) for module
responsibilities, [05-business-logic-and-kpi-semantics](05-business-logic-and-kpi-semantics.md)
for detailed delay fallback explanation.*
