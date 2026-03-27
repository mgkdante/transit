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

## Goal

- add optional raw/Bronze retention
- support safe deletion of old metadata and R2 objects after downstream guarantees are satisfied
- add safer maintenance controls such as `dry-run` and `table-select`

## Why this slice exists

- raw/Bronze retention is still missing
- Option A needs real cold-storage policy, not “keep everything forever”

## Exit criteria

- Bronze retention policy exists in code/docs
- maintenance commands are safer to run
- dry-run output is trustworthy
- old R2 objects can be pruned intentionally

---

# Slice 5 — Warm rollups for Power BI history

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

## Exit criteria

- rollup tables exist
- retention window is defined and implemented
- worker/maintenance updates rollups on a bounded schedule
- Power BI can use warm tables in Import mode while live page uses latest tables

---

# Slice 6 — 30s feasibility checkpoint

## Goal

- decide whether a 30-second pilot is justified
- do not automatically switch production to 30 seconds
- use evidence, not vibes

## Why this slice exists

- STM quota is not the limiting factor at 30 seconds for two endpoints
- real constraints are write amplification, query patterns, and cycle runtime vs poll interval

## Exit criteria

Either:

- approve a bounded 30-second pilot with explicit monitoring

or

- reject it for now and document the blocker

---

# Slice 7 — Final phase closeout

## Goal

- minimal docs refresh
- final runbook
- final summary of the implemented hot/warm/cold design
- make the phase easy to hand off later

## Why this slice exists

- docs should reflect the implemented design, not theory

## Exit criteria

- `README.md`, `docs/architecture.md`, and `docs/hot_cold_data_research.md` match reality
- next person can understand the retention model and cadence decisions quickly
- the phase has a clean closeout note

---

## Naming convention for future handoffs

Label future reports like this:

- **Option A Phase — Slice 2**
- **Option A Phase — Slice 3**
- **Option A Phase — Slice 4**
- etc.

This keeps the context clean and stops the work from drifting.

---

## Prompt addendum to paste into future Claude/Codex prompts

```text
Documentation is mandatory in this slice. Update README.md and docs/architecture.md on every prompt. If the slice changes retention, cadence, orchestration, storage behavior, table behavior, maintenance behavior, or operational workflow, update the relevant docs in the same slice. Keep documentation changes minimal, factual, and synchronized with what was actually implemented.
```
