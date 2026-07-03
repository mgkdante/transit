# GC2 §C7 — observed-universe-to-service-day fix · OPERATOR DEPLOY RUNBOOK

> Slice **P5.3e · Truth & fitness**. Fixes the GC2 scheduled-universe denominator
> mismatch (spec §C7, evidence [math-pipeline] §5b). Code change is a **query-only**
> rewrite of the cancellation observed universe — **NO migration**, no schema change.
> Every prod step below is **OPERATOR-RUN**; this document is a written runbook, not an
> executed procedure.

## What changed (code)

- `apps/db/src/transit_ops/gold/rollups.py` — `UPSERT_ROUTE_CANCELLATION_DAILY`, the
  `trip_day` CTE: the observed universe is now filtered to the **service day**
  (`start_date = :local_date`) over a **2-day capture window**
  (`snapshot_date_key IN {D, D+1}`) instead of `snapshot_date_key = :date_key` (capture
  day D only). This makes the numerator (`obs.total`) share ONE universe with the
  scheduled denominator (`route_scheduled_trips_daily`, service-day D). Both date keys
  are on the sargable `(provider_id, snapshot_date_key)` index (a 2-key `IN`) — no
  un-sargable-scan regression. This copies the service-span / headway builders'
  established precedent (`rollups.py` `UPSERT_ROUTE_SERVICE_SPAN_DAILY`, the 2-day window
  + `start_date` filter), re-grained to build day D rather than D-1.
- `apps/db/src/transit_ops/snapshots/builders/historic/route_reliability.py` —
  `_ROUTE_CANCELLATION_DAILY_SQL` comment updated: the "capture-day vs service-day
  overnight spillover" cause of `delivered > scheduled` is eliminated at the source; the
  `LEAST(100.0, …)` clamp stays (remaining over-delivery is real added/unscheduled
  service only). The read query is otherwise unchanged.

**Effect on data:** `silent_trip_days` stops under-counting and `delivered_trip_days` /
read-time `service_completeness_pct` stop over-counting on overnight / cross-midnight
(24 h night-network) routes. RT `cancellation_rate_pct` is UNAFFECTED (numerator and
denominator both from `trip_day`, self-consistent). `route_scheduled_trips_daily` and the
STO calendar_dates-only service resolution are untouched.

`service_day_offset` for `route_cancellation_daily` stays **0** (ROW date == service day
D). The D+1 tail's relevant portion is the pre-dawn overnight window, which is always
closed by the time the daily job runs (well after dawn) — identical steady-state
semantics to the normal build path, whose freshest built day is `today-1` with its tail
on `today`. No offset change is required or made.

---

## (a) Deploy the code — OPERATOR-RUN

1. Merge the P5.3e **db** PR (commit `fix(db): P5.3e·GC2 — observed universe filtered to
   service day (matches scheduled denominator)`) to `main`.
2. Deploy the pipeline image to the VM the same way as any prior db change (the
   turborepo `apps/db` image; `COMPOSE_PROJECT_NAME=transit` pinned per the deploy
   runbook). No migration runs — `alembic upgrade head` is a no-op for this change
   (head stays 0078).
3. Confirm the worker picks up the new code:
   - `ssh transita1` then `cd /opt/transit/apps/db`
   - `docker compose exec <db-service> uv run python -c "import transit_ops.gold.rollups as r; print('cancellation query loaded')"`
   The daily **Warm Rollups** job will now BUILD new closed days with the corrected
   universe automatically; existing rows built before this deploy are still WRONG until
   step (b) rebuilds them (the watermark shields them from the normal build path).

---

## (b) Targeted rebuild of the affected rollup rows — OPERATOR-RUN · data job, NO migration

The append-only daily rollups are watermark-shielded, so a present-but-wrong closed day
is never recomputed by the normal build. Use the purpose-built repair command — the same
`rebuild-warm-rollups` pattern prior rollup repairs used (deletes the affected ROW(s) +
their `warm_rollup_periods` watermark(s), then re-runs the builder over exactly that
window).

Rebuild ONLY the affected kind for the **live retention window** (last N closed days;
`GOLD_FACT_RETENTION_DAYS`, typically 14 — older days have pruned facts and the command
refuses them). Both providers with a schedule (STM, STO) must be rebuilt.

1. **Dry-run first** (prints affected row + watermark counts per kind, mutates nothing):
   ```
   docker compose exec <db-service> uv run python -m transit_ops.cli rebuild-warm-rollups stm \
       --from <today-13> --to <today-1> --kinds route_cancellation_daily --dry-run
   ```
   - `--from`/`--to` are **ROW dates** (the dates visible as wrong in serving), inclusive.
   - `--to` MUST be `≤ today-1` (the command's per-kind open-day guard enforces this; a
     more-recent `--to` would rebuild the still-open capture day and is rejected).
   - `route_scheduled_trips_daily` does NOT need rebuilding (unchanged), so scope to
     `route_cancellation_daily` only. If you rebuild `--kinds` all, the command already
     builds scheduled before cancellation (production order) — either is safe.
2. **Execute** (drop `--dry-run`; without `--yes` it shows the per-kind counts and
   prompts before the destructive delete):
   ```
   docker compose exec <db-service> uv run python -m transit_ops.cli rebuild-warm-rollups stm \
       --from <today-13> --to <today-1> --kinds route_cancellation_daily
   ```
3. Repeat for STO:
   ```
   docker compose exec <db-service> uv run python -m transit_ops.cli rebuild-warm-rollups sto \
       --from <today-13> --to <today-1> --kinds route_cancellation_daily
   ```
4. **Refresh the derived reporting marts** (the command prints this advisory): the
   DELETE+UPSERT marts that read the cancellation spine (route reliability, network
   trend) are refreshed only by a full build — run:
   ```
   docker compose exec <db-service> uv run python -m transit_ops.cli build-warm-rollups stm
   docker compose exec <db-service> uv run python -m transit_ops.cli build-warm-rollups sto
   ```
   then publish snapshots the usual way so `/v1` and the web app pick up the corrected
   `service_completeness_pct` / `silent_trip_days` / `delivered_trip_days`.

---

## (b') Night / cross-midnight route before-and-after eyeball — OPERATOR-RUN

Pick a known 24 h / overnight route (e.g. an STM night-network line — a `3xx`/`N` bus that
runs cross-midnight). Capture a row BEFORE the rebuild and AFTER, and confirm the skew
closed. Run against prod (read-only SELECT):

```
-- BEFORE (run this right after deploy, BEFORE step (b)) and AFTER (re-run post-rebuild):
SELECT provider_local_date,
       scheduled_trip_days,
       delivered_trip_days,
       silent_trip_days,
       ROUND(100.0 * delivered_trip_days / NULLIF(scheduled_trip_days,0), 1) AS completeness_pct
FROM gold.route_cancellation_daily
WHERE provider_id = 'stm'
  AND route_id = '<NIGHT_ROUTE_ID>'       -- e.g. an STM night line
  AND provider_local_date >= CURRENT_DATE - 7
ORDER BY provider_local_date DESC;
```

Expected shift AFTER the rebuild on an overnight route: `delivered_trip_days` DROPS (the
D-1 overnight tail that was wrongly folded into day D is removed), `silent_trip_days`
RISES toward its honest value (`GREATEST(scheduled − delivered_incl_canceled, 0)`), and
`completeness_pct` DROPS from an inflated (near-100 / clamped) value to a truthful one.
Daytime-only routes should be UNCHANGED (their trips have no D+1 tail; `start_date`
already equals the capture day). If a daytime route moves, STOP and investigate.

---

## (c) GC2 backfill prod check — OPERATOR-RUN · 5 min, read-only

Confirm the GC2 **calendar_dates-only** backfill (which was a DATA backfill, invisible to
code review — it populated the RESERVED headway columns added by 0069 and finalized under
0073) actually ran. The three reserved columns
(`scheduled_median_headway_min`, `scheduled_p10_headway_min`, `scheduled_p90_headway_min`)
are always NULL in v1 and are filled ONLY by the GC2 data backfill. A non-zero populated
count settles it:

```
SELECT
    count(*)                                                        AS total_rows,
    count(scheduled_median_headway_min)                             AS median_populated,
    count(scheduled_p10_headway_min)                               AS p10_populated,
    count(scheduled_p90_headway_min)                               AS p90_populated
FROM gold.schedule_version_service_summary;
```

- **PASS:** `*_populated > 0` (and, for a fully-backfilled edition, close to `total_rows`
  for routes that have timed stop_times) — the backfill ran.
- **FAIL / not-yet-run:** all three `*_populated = 0` while `total_rows > 0` — the reserved
  columns are still v1-empty; the calendar_dates-only backfill has NOT run for the current
  editions. Escalate (this is a GC2 backfill gap, tracked separately — it is NOT produced
  or fixed by the P5.3e code change; this check only VERIFIES it).

Optionally break down by provider to confirm STO (calendar_dates-only) specifically:

```
SELECT provider_id,
       count(*) AS rows,
       count(scheduled_median_headway_min) AS median_populated
FROM gold.schedule_version_service_summary
GROUP BY provider_id
ORDER BY provider_id;
```

---

## Rollback

Query-only change, no migration — rollback = redeploy the prior image. Row data written by
step (b) is a corrected recompute of the SAME closed days; re-running `rebuild-warm-rollups`
on the prior code restores the old (wrong-but-known) values. No schema or watermark
structure changed.
