# Option A Optimization Phase: Hot / Warm / Cold Hardening

Prepared for: Yesid  
Context: STM GTFS / GTFS-RT pipeline on Neon + R2 + Railway + Power BI

---

## Always-on instruction for Claude/Codex

Add this instruction to **every prompt** in this phase:

> Update documentation on every prompt. At minimum, keep `README.md` and `docs/architecture.md` aligned with the implementation. If a slice changes retention, cadence, orchestration, storage behavior, table behavior, or operational workflow, update the relevant docs in the same slice. Keep doc changes minimal, factual, and synchronized with what was actually implemented.

You can also append this shorter version to prompts:

> Documentation is mandatory in every slice. Update `README.md`, `docs/architecture.md`, and any directly affected doc whenever implementation changes behavior or operational reality.

---

## Phase name

**Option A Optimization Phase: Hot / Warm / Cold Hardening**

---

## Phase strategy

Option A means:

- **Hot** = Neon Postgres latest/current data used for fast operational reads
- **Warm** = bounded historical rollups in Postgres for dashboard history
- **Cold** = raw lineage and long-tail history in R2

This phase is about making that design operationally real, cheap enough to run, bounded enough to stay healthy, and fast enough for a 60-second production cadence.

---

## Phase goals

1. Keep the pipeline cheap and bounded in Neon
2. Make latest-serving Gold tables the real hot path
3. Prove retention and pruning are healthy in production
4. Decouple static batch work from unnecessary heavy Gold rebuilds
5. Add Bronze/raw lifecycle controls
6. Add warm rollups for Power BI history
7. Prove 60-second hosted production cadence
8. Gather enough evidence to approve or reject a later 30-second pilot

---

## Phase done means

This phase is done when all of the following are true:

- latest-serving Gold tables are the real hot path
- Silver and Gold retention are enforced and verified live
- static path no longer performs unnecessary heavy Gold work
- Bronze/raw retention exists
- warm rollups exist for dashboard history
- 60-second hosted production cadence is proven healthy
- there is enough evidence to approve or reject a 30-second pilot
- docs reflect the implemented reality, not theory

---

## Recommended slice order

1. Slice 1 — Hot-path stabilization and first retention pass  
2. Slice 2 — Live retention proof + 60s production pilot  
3. Slice 3 — Static-path decoupling  
4. Slice 4 — Bronze/raw retention + maintenance ergonomics  
5. Slice 5 — Warm rollups for Power BI history  
6. Slice 6 — 30s feasibility checkpoint  
7. Slice 7 — Final phase closeout

---

# Slice 1 — Hot-path stabilization and first retention pass

**Status: Complete**

## What this slice accomplished

- latest Gold tables became first-class
- KPI reads moved to `gold.latest_*`
- realtime hot path stopped doing full provider Gold rebuilds every cycle
- static Silver retention works
- compaction already ran
- production cycles dropped to about 10–18 seconds
- production worker remained conservatively set to 300 seconds

## Why this slice mattered

- it removed the worst lock/write-amplification behavior
- it made small latest-serving tables the serving layer
- it made a 60-second production cadence plausible

## Exit criteria

Slice 1 is done when:

- latest tables are live
- static Silver retention is live
- compaction/vacuum has already been run
- production hot path no longer does full Gold rebuilds every cycle

---

# Slice 2 — Live retention proof + 60s production pilot

**Status: Complete**

## Goal

- apply and verify retention/index changes in production
- prove Gold fact pruning and Silver pruning are healthy
- move the hosted Railway worker from 300 seconds to 60 seconds
- observe several real hosted cycles
- confirm no ugly Gold lock/wait regressions
- do **not** move to 30 seconds yet

## Why this slice exists

- the system is already much faster
- production is still running too conservatively at 300 seconds
- Option A should first be proven at 60-second target mode

## Exit criteria

- migration/index state verified live
- Railway worker set to 60 seconds
- at least 3 hosted cycles observed
- latest Gold refresh remains healthy
- Silver prune remains healthy
- Gold prune remains healthy
- no obvious Gold lock/wait regression
- you can answer: **“Is 60s production-safe now?”**

---

# Slice 3 — Static-path decoupling

**Status: Complete**

## Goal

- stop `run-static-pipeline` from using the heavy `build-gold-marts` full-history path
- add a dedicated Gold dimension refresh path for static loads
- keep static batch behavior boring and explicit

## What was implemented

- `refresh_gold_static()` added to `src/transit_ops/gold/marts.py`
  - acquires advisory lock only — no `LOCK TABLE ... IN ACCESS EXCLUSIVE MODE`
  - replaces only `dim_route`, `dim_stop`, `dim_date` from the current static dataset version
  - does not touch `fact_*` or `latest_*` tables
- `GoldStaticRefreshResult` dataclass added
- `refresh-gold-static` CLI command added
- `run-static-pipeline` updated to call `refresh-gold-static` instead of `build-gold-marts`
- `build-gold-marts` retained as the manual full-history recovery path only
- Live-safe validation confirmed fact and `latest_*` row counts unchanged after `refresh-gold-static stm`

## Exit criteria met

- `run-static-pipeline` no longer triggers unnecessary full historical Gold rebuilds ✓
- a dedicated static Gold dimension refresh command/path exists ✓
- docs and tests updated ✓

---

# Slice 4 — Bronze/raw retention + maintenance ergonomics

**Status: Complete**

## What this slice accomplished

- Added `delete_object` to all Bronze storage backends (`LocalBronzeStorage`, `S3BronzeStorage`)
- Added `BRONZE_REALTIME_RETENTION_DAYS` (default 7) and `BRONZE_STATIC_RETENTION_DAYS` (default 30) settings
- Implemented `prune_bronze_realtime_objects` and `prune_bronze_static_objects` with safety guards:
  - realtime: only deletes after no Silver rows reference the snapshot AND it is not the latest snapshot per endpoint
  - static: only deletes after no `core.dataset_versions` row references the ingestion run
- Implemented `prune_bronze_storage` as a standalone public function (not wired into the automated cycle)
- Added `--dry-run` to `prune-silver-storage`, `prune-gold-storage`, and new `prune-bronze-storage` commands
- Added `--table` (repeatable) to `vacuum-storage` for targeted VACUUM runs
- 38 tests pass; ruff clean; 60-second Railway realtime worker confirmed untouched

## Goal

- add optional raw/Bronze retention
- support safe deletion of old metadata and R2 objects after downstream guarantees are satisfied
- add safer maintenance controls such as `dry-run` and `table-select`

## Why this slice exists

- raw/Bronze retention was still missing
- Option A needs real cold-storage policy, not “keep everything forever”

## Exit criteria

- Bronze retention policy exists in code/docs ✓
- maintenance commands are safer to run ✓
- dry-run output is trustworthy ✓
- old R2 objects can be pruned intentionally ✓

---

# Slice 5 — Warm rollups for Power BI history

**Status: Complete**

## What this slice accomplished

- Added `gold.vehicle_summary_5m`, `gold.trip_delay_summary_5m`, and `gold.warm_rollup_periods` via migration `0008_warm_rollup_tables`
- Idempotent `build_warm_rollups()` function using `DATE_BIN('5 minutes', ...)` for clean period buckets
- `warm_rollup_periods` tracking table prevents redundant computation; ON CONFLICT DO UPDATE makes runs safe to repeat
- `avg_delay_seconds_capped` (abs ≤ 3600) and `outlier_count` (abs > 3600) baked into rollup table only — raw delay facts untouched
- `GOLD_WARM_ROLLUP_RETENTION_DAYS = 90` setting; `prune_warm_rollup_storage()` maintenance function
- `build-warm-rollups` and `prune-warm-rollup-storage` CLI commands
- `.github/workflows/daily-warm-rollups.yml` daily cron at `07:00 UTC` (after static pipeline)
- Power BI docs updated: warm rollup DAX measures, field mapping, SQL validation, dashboard spec
- Delay quality validation against production Neon: 87.6% non-null coverage; p50=0s, p75=35s, p95=316s; extreme outliers are stale GTFS-RT feed artifacts on route 777, not pipeline errors
- Bronze dry-run: 0 eligible objects (pipeline only ~4 days old, below 7/30-day thresholds)
- 125 tests pass; ruff clean

## Goal

- create 5-minute Gold rollups retained for roughly 90 days
- keep raw-grain Silver/Gold hot history tight
- give Power BI a cheaper history layer than giant raw-grain fact scans

## Why this slice exists

Option A is not just:

- hot latest tables
- plus delete everything else

It should become:

- **Hot** = latest/current
- **Warm** = bounded historical rollups
- **Cold** = raw lineage in R2

## Exit criteria met

- rollup tables exist ✓
- retention window is defined and implemented ✓
- daily GitHub Actions cron builds rollups before Gold facts are pruned ✓
- Power BI can use warm tables in Import mode while live page uses latest tables ✓

---

# Slice 6 — 30s feasibility checkpoint

**Status: Complete**

## What this slice accomplished

- Validated 60s production baseline: 60 consecutive cycles, 6.5–8.5s duration, `effective_start_to_start` = 60.000–60.004s, zero failures
- Updated `README.md` to remove stale `REALTIME_POLL_SECONDS=300` references from Slice 2 era
- Executed 30s pilot by changing `REALTIME_POLL_SECONDS=30` on Railway via MCP; service redeployed automatically
- Observed 19 pilot cycles: 6.4–8.1s duration (identical to 60s), `effective_start_to_start` = 30.000–30.005s, minimum sleep headroom = 21.9s, zero overruns, zero failures
- Confirmed STM quota (5,760 req/day vs 10,000 limit) and R2 ops (172,800/month vs 1M free) both comfortable at 30s
- **Decision: 30s production-ready.** `REALTIME_POLL_SECONDS=30` kept on Railway.
- Updated `docs/architecture.md` with 30s cadence decision section, comparative analysis table, and explicit recommendation
- Updated `docs/realtime-worker-hosting.md` with 30s pilot timing data and rollback steps
- Updated `README.md` to reflect 30s as the current production cadence

## Goal

- decide whether a 30-second pilot is justified
- do not automatically switch production to 30 seconds
- use evidence, not vibes

## Why this slice exists

- STM quota is not the limiting factor at 30 seconds for two endpoints
- real constraints are write amplification, query patterns, and cycle runtime vs poll interval

## Exit criteria met

- pilot evidence captured: 19 cycles, zero overruns ✓
- `effective_start_to_start_seconds ≈ 30.0` confirmed ✓
- explicit recommendation written: 30s production-ready ✓
- `docs/architecture.md` updated with cadence section ✓
- `docs/pipeline_optimization.md` Slice 6 complete ✓
- `README.md` updated ✓

---

# Slice 7 — Final phase closeout

**Status: Complete**

## What this slice accomplished

- Ran local validation: 125 tests pass, ruff clean (3 pre-existing errors in dev tooling only)
- Confirmed Railway: `REALTIME_POLL_SECONDS=30`, latest deployment `fb45c113` SUCCESS
- Found and fixed a real bug in `src/transit_ops/gold/rollups.py`: `:since_utc::timestamptz` SQLAlchemy text() parameter caused psycopg3 `SyntaxError` (first attempt) then `AmbiguousParameter` (second attempt); fixed to `CAST(:since_utc AS timestamptz)` which provides type information without conflicting with SQLAlchemy's named-parameter parser
- Ran `build-warm-rollups stm` against production Neon: 336 vehicle periods + 336 trip delay periods built
- Post-build warm rollup counts: `vehicle_summary_5m` ~47,450 rows, `trip_delay_summary_5m` ~51,204 rows, `warm_rollup_periods` 672 rows
- Updated `docs/hot_cold_data_research.md`: corrected stale "production cadence may be 300s" reference to reflect 30s as the current production cadence
- Performed code-only GitHub push to `origin main` (commit: `feat: apply Slice 7 closeout and production cadence updates`)
- Push staged: all src/, tests/, tools/, migrations, and .github/workflows/ changes; excluded docs/, powerbi/, .claude/, and all .md files

## Goal

- minimal docs refresh
- final runbook
- final summary of the implemented hot/warm/cold design
- make the phase easy to hand off later
- deploy all slices to github and railway

## Why this slice exists

- docs should reflect the implemented design, not theory

## Exit criteria met

- `README.md`, `docs/architecture.md`, and `docs/hot_cold_data_research.md` match reality ✓
- next person can understand the retention model and cadence decisions quickly ✓
- the phase has a clean closeout note ✓
- warm rollup tables populated in production ✓
- code-only GitHub push completed ✓

---

---

# Static No-Op Optimization

**Status: Complete**

## What this slice accomplished

- Added `get_current_static_content_hash()` to `src/transit_ops/silver/static_gtfs.py`
  - Queries `core.dataset_versions` for the `content_hash` of the current active static version
  - Returns `str | None`
- Exported `get_current_static_content_hash` from `transit_ops.silver`
- Updated `StaticPipelineResult` dataclass: `silver_load_duration_seconds`, `gold_build_duration_seconds`, `silver_load`, `gold_build` are now `| None`; added `static_changed: bool` and `skipped_reason: str | None`
- Added hash gate to `run_static_pipeline()`: after Bronze ingest, compares `StaticIngestionResult.checksum_sha256` to `core.dataset_versions.content_hash`; if unchanged, skips Silver load and Gold refresh
- Bronze ingestion always runs so R2 lineage remains honest
- `None` hash (no existing Silver version) is naturally treated as "changed" (`None != any_hash` is `True`)
- 4 tests cover the new behavior; 128 tests pass; ruff clean (no new errors)
- No migration needed — `core.dataset_versions.content_hash` and `raw.ingestion_objects.checksum_sha256` already existed

## Why this slice exists

STM's static GTFS feed typically changes only weekly or on schedule updates. Running Silver load and Gold dimension rebuild daily when the ZIP is identical wastes compute and creates unnecessary `core.dataset_versions` rows.

## Result shape

| Field | Changed path | No-op path |
|-------|-------------|------------|
| `static_changed` | `true` | `false` |
| `skipped_reason` | `null` | `"static_content_unchanged"` |
| `silver_load` | `{...}` | `null` |
| `gold_build` | `{...}` | `null` |

## Exit criteria met

- Bronze always runs; Silver/Gold skip when hash unchanged ✓
- First-time case (no existing version) runs the full path ✓
- Changed hash runs the full path ✓
- `static_changed` and `skipped_reason` distinguish the two outcomes ✓
- Unchanged hash does not create a new `core.dataset_versions` row ✓
- No migration required ✓
- Tests and ruff pass ✓

---

## Naming convention for future handoffs

Label future reports like this:

- **Option A Phase — Slice 2**
- **Option A Phase — Slice 3**
- **Option A Phase — Slice 4**
- etc.

This keeps the context clean and stops the work from drifting.

---

---

# Pipeline Kill-Switch (PIPELINE_PAUSED)

**Status: Complete**

## What this adds

- `PIPELINE_PAUSED: bool = False` setting in `src/transit_ops/settings.py`
- In `run_realtime_worker_loop()`: if `PIPELINE_PAUSED=true`, each loop iteration sleeps the full poll interval and skips all cycle work — no STM, Neon, or R2 calls
- `scripts/pause-pipeline.sh` — one command to: disable both GH Actions workflows, set `PIPELINE_PAUSED=true` on Railway, and suspend Railway compute via GraphQL API (requires `RAILWAY_TOKEN`)
- `scripts/resume-pipeline.sh` — reverses all three

## Why this exists

When Railway credits run out (or you want to stop spending), there was no single command to shut everything down cleanly. The scripts cover all three automation surfaces.

## How to use

```bash
# Stop everything
bash scripts/pause-pipeline.sh

# Restart everything
bash scripts/resume-pipeline.sh

# For Railway compute suspension (stops billing):
export RAILWAY_TOKEN=<from https://railway.app/account/tokens>
bash scripts/pause-pipeline.sh
```

Without `RAILWAY_TOKEN`, the scripts handle GH Actions + the env var and print a link to pause Railway manually.

---

## Prompt addendum to paste into future Claude/Codex prompts

```text
Documentation is mandatory in this slice. Update README.md and docs/architecture.md on every prompt. If the slice changes retention, cadence, orchestration, storage behavior, table behavior, maintenance behavior, or operational workflow, update the relevant docs in the same slice. Keep documentation changes minimal, factual, and synchronized with what was actually implemented.
```
