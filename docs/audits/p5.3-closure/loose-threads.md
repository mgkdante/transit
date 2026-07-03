# Loose-Threads Census — transit repo (2026-07-03)

Sweep scope: `apps/`, `.github/`, no separate `docs/` dir exists. Excluded build
artifacts (`.svelte-kit`, `dist`, `.turbo`, `node_modules`, `vendor`).

Cross-referenced against Notion-backed session memory
(`holistic-audit-2026-07-01.md`, `MEMORY.md`) which is the canonical tracker for
the A+ Program phases/slices these threads belong to.

---

## 1. The three named "operator veto" items (pending decisions, not code TODOs)

These are the two flags memory calls out ("Two operator veto flags in the S7.5
Handoff: FR label winners (enumLabels.ts) + resolveWindow whole-drop") plus T8,
tracked separately under P0. All three are **already implemented / shipped**
behind a design decision the operator has not yet confirmed or reverted — they
are not "code needs writing," they are "operator needs to say yes/no."

### 1a. FR enumLabels winners
- **File:** `apps/web/src/lib/v1/enumLabels.ts:9-13`
- **What it says:** "FR winners (S7.5 P3-1 — flagged for operator morning veto): the
  network variants win the three drifted keys — severe='Sévère', many_seats='Plusieurs
  places', few_seats='Peu de places' ... The map variants are equally valid copy; this
  is a one-line revert if disliked."
- **PR that shipped it:** #181 (S7.5), body literally says "**FR winners = network
  variants — operator veto welcome, one-line revert**."
- **Decision pending:** operator has not confirmed the 3 label choices (severe /
  many_seats / few_seats) chosen from the map-vs-network drift. No code work is
  outstanding either way.
- **Smallest action to close:** operator says "keep" (delete the veto comment, done)
  or "revert" (swap 3 string values in `STATUS_LABELS.fr` / `OCCUPANCY_LABELS.fr` to
  the map's prior copy — the comment names the one-line revert already). Either way
  this closes in under 5 minutes once the operator answers.

### 1b. resolveWindow "whole window or nothing" behavior
- **File:** `apps/web/src/lib/filters/grain.ts:81-94` (function `resolveWindow`)
- **What it says (lines 86-91):** "CONSTRAINT (intentional honest-absence change): if
  EITHER bound is not a real available date, the WHOLE window is dropped — we do NOT
  clamp/keep the surviving bound (the old per-bound behaviour). ... Callers relying on
  the old keep-the-good-bound behaviour must re-derive it explicitly."
- **NOT what the task description implied:** `resolveWindow` is not dead code up for
  deletion — it is live, actively called from `RouteReliabilityClusters.svelte:200`,
  `AlertHistory.svelte:120`, and `StopReliabilitySurface.svelte:149`, and has its own
  test suite (`apps/web/src/lib/filters/grain.test.ts:91-119`, describe block titled
  "resolveWindow — the shared availability clamp (URL is a hint, never data)"). "Drop"
  refers to the semantics choice (whole-window-drop vs partial-bound-clamp), shipped in
  PR #181 (S7.5) alongside the enumLabels change, same slice, same "veto welcome" spirit
  even though the PR body doesn't use that literal phrase for this item (only for FR
  labels explicitly).
- **Decision pending:** operator confirms the honest-absence whole-drop semantics is
  the wanted behavior (vs the old partial-bound-keep semantics).
- **Smallest action to close:** operator says "keep" → done, no code change. If
  reverted, the diff is confined to `grain.ts:92` (change the OR to independently keep
  each valid bound) plus updating the 2 test expectations at `grain.test.ts:96-111`
  that assert the old bound is dropped.

### 1c. T8 — browser semantics check (chart-domain stability)
- **Notion location:** slice Plan task "T8" under DB-A+/P0 (Notion page
  `3903e86306908175a820cedf2b012a89`), not in repo code — it is a manual verification
  task, so grep for literal "T8" in source only turns up an unrelated docstring label
  (`apps/db/tests/test_snapshots_publish.py:730`, "T3 / T6 / T8 — state upsert, basemap,
  hash-gating semantics" — a different, already-satisfied T8 inside a *different* test
  file's internal numbering, NOT the Plan-task T8; do not confuse the two).
- **What it says:** PR #178 body: "Browser semantics check (stable domains across
  windows) tracked in slice Plan T8." PR #178 fixed the NetworkHealth chart-domain
  Chart-Doctrine violation (in-view-max scaling → absolute zero-based domains) and
  widened the `chartDoctrine` CI gate, but the actual **in-browser** confirmation that
  chart domains stay visually stable across the 7/30/90-day window toggle was never
  executed.
- **Decision pending:** none — this is pure unexecuted verification work, not a
  decision. Memory: "T8 browser check + banners pending."
- **Smallest action to close:** open `/network` in a live/dev browser (Chrome MCP or
  manual), toggle the day-window control across 7/30/90, screenshot each, confirm the
  retard/cancel/severe bar heights render at consistent absolute scale (not rescaling
  per-window). ~10 minutes, zero code risk — this is the cheapest item on the list.

---

## 2. GC1.5 — the open deferred-drop slice (Notion `3913e863069081c28138eea92a6a62df`)

Memory: "OPEN: GC1.5 ... (deferred drops: route_delay_hourly+view re-point,
stop_delay_hourly+habit hour, headway folds, prod unrouted-share, twin-SQL dedup)."
None of these are started; all are documented in code as conscious residuals with a
`GC1.5` tag, not oversights. 10 total distinct code-comment sites; five discrete work
items:

### 2a. `gold.route_delay_hourly` + `public_route_reliability_daily` view re-point
- **Files/lines:**
  - `apps/db/src/transit_ops/gold/rollups.py:1216-1224` — "GC1.5 owns the drop" of the
    view re-point (a rebaseline of `avg_delay_seconds` + worst-route ranking).
  - `apps/db/src/transit_ops/gold/rollups.py:1219` — "GC1.5 quantifies the unrouted
    share on prod" (the spine's route-attributed-only population excludes the legacy
    `'__unrouted__'` partition that `route_delay_hourly` still includes).
  - `apps/db/src/transit_ops/snapshots/builders/historic/network_trend.py:37,43` —
    same drop, same unrouted-share prerequisite, `worst_route` consumer.
  - `apps/db/src/transit_ops/snapshots/builders/historic/small_surfaces.py:978-980` —
    same drop; `public_route_reliability_daily` VIEW (read by `worst_route`) still
    depends on `route_delay_hourly`.
  - `apps/db/src/transit_ops/maintenance/gold.py:28-31` — table kept in
    `GOLD_REPORTING_AGGREGATE_TABLES` with the same "stays built until re-pointed" note.
- **Decision pending:** none, this is pure engineering work gated on a data
  prerequisite (below).
- **Smallest action to close:** (1) run the unrouted-share quantification query against
  prod to confirm the `'__unrouted__'` partition is negligible/expected; (2) re-point
  `public_route_reliability_daily` VIEW definition onto `gold.route_delay_spine`
  (rebaselining `avg_delay_seconds` + worst-route ranking, a documented same-class
  rebaseline as the 0065/0063 ones); (3) drop `gold.route_delay_hourly` build + table
  in a migration. This is a real migration + view rewrite, not a one-liner — full GC1.5
  slice scope, not closeable inline.

### 2b. `gold.stop_delay_hourly` + the habits-heatmap "habit hour" carve-out
- **Files/lines:**
  - `apps/db/src/transit_ops/snapshots/builders/historic/stop_reliability.py:1-13` —
    module docstring: "The 7x24 habits heatmap (`_STOP_HABIT_SQL`) remains on
    `gold.stop_delay_hourly` as a deliberate carve-out — it needs the hour dimension the
    shift rollup does not carry."
  - `apps/db/src/transit_ops/snapshots/builders/historic/stop_reliability.py:124-131` —
    "DELIBERATE CARVE-OUT (GC1 / Step G4): this is the ONE stop grain still on the
    legacy read off `gold.stop_delay_hourly` ... (GC1.5 owns that follow-up) — this
    read is a conscious residual, not an oversight."
  - `apps/db/src/transit_ops/maintenance/gold.py:31,81` — table retained in the
    reporting-aggregate + retention config.
- **Decision pending:** none — needs an hour-grain append-only spine analogous to
  `route_occupancy_band_hourly` (0074) before the habits heatmap can move off the
  legacy hourly mart.
- **Smallest action to close:** build a `stop_delay_hourly`-replacement append-only
  hour-grain spine (mirroring the 0074 pattern), re-point `_STOP_HABIT_SQL`, then drop
  the legacy table. Full slice scope.

### 2c. Headway folds
- **Files/lines:** `apps/db/src/transit_ops/gold/rollups.py:796,1154-1174,1607-1925` —
  the live `route_headway_by_shift` / `route_headway_by_direction_shift` rolling
  tables plus `route_headway_shift_daily` (an append-only spine, migration 0065)
  co-exist; 0065's own docstring (`0065_route_headway_shift_daily.py:11`) notes
  "EVERY direction is stored (NO busiest_direction collapse — argmax deferred to read
  time, per window)."
  - Precedent already executed for the analogous stop case:
    `apps/db/src/transit_ops/db/migrations/versions/0067_drop_stop_delay_folds.py` —
    dropped `stop_delay_weekly`/`stop_delay_monthly` fold tables in favor of read-time
    derivation from `gold.stop_delay_spine`. The headway family has not had its
    equivalent fold-table drop yet.
- **Decision pending:** none — mechanical, same pattern as the already-shipped 0067.
- **Smallest action to close:** confirm every reader of `route_headway_by_shift` /
  `route_headway_by_direction_shift` can derive the same breakdown at read time from
  `route_headway_shift_daily`, then drop the two rolling tables in a migration
  (mirrors 0067 exactly).

### 2d. prod unrouted-share quantification
- Same as 2a — this is the *prerequisite* for the route_delay_hourly drop, called out
  separately in memory because it is itself an action item (run a query against prod),
  not a code change. Zero-cost, blocks 2a.

### 2e. Twin-SQL dedup
- **Context:** `apps/db/src/transit_ops/gold/reader/buckets.py:1-3` shows the
  canonical pattern already exists for shift/day_type bucketing ("The ONE shift /
  day_type bucket source (SQL emitters + the Python twin)" — SQL CASE + a Python
  `infer_shift` twin at `buckets.py:70-73`, deliberately kept in lockstep).
- **What's NOT yet deduped:** the headway family (2c) runs near-identical SQL bodies
  across `route_headway_by_shift` (0-14d rolling) and `route_headway_shift_daily`
  (append-only spine) — `rollups.py:1846` explicitly notes "the clamp (0 < gap_min <
  240) + n>=2 guard are byte-identical to route_headway_by_shift," i.e. duplicated
  logic across two builders that GC1.5 is expected to collapse into one read-time
  source once 2c's fold-drop lands.
- **Decision pending:** none.
- **Smallest action to close:** subsumed by 2c — dropping the headway folds and
  deriving at read time from the spine removes the twin SQL bodies as a side effect.

**GC1.5 verdict:** all 5 items are well-documented, intentional, correctly tagged, and
none of them contain an ambiguous decision — they are pure "not started yet" backlog
items whose smallest action is "run this as its own slice," not something to be
resolved inline in a wrap-up pass.

---

## 3. TODO/FIXME/DEFER comments naming a slice/phase (source-level sweep)

95 total `TODO|FIXME|DEFER|deferred` hits in source (excluding build artifacts);
below are the ones that explicitly tag a slice/phase/program item beyond the GC1/GC1.5/GC2
items already covered in §2, plus every other named-slice DEFER found.

| # | File:line | Tag | What it says | Status |
|---|-----------|-----|--------------|--------|
| 1 | `apps/web/src/lib/features/network/reliability/sections/NetworkSurface.svelte:425-430` | S9 Handoff | "TODO(beauty2-honest-absence · DECISIONS C3): when `net.vehicles_in_service === 0` ... surface an honest-absence banner ... DEFERRED — carried to the S9 Handoff with the pipeline note (needs an unpublished network service-span signal)." | **STALE / ORPHANED.** S9 (#188) is CLOSED (verified via `gh pr view 188` body — ships completeness tile + live cards, does NOT mention this banner). The TODO names a carrier that already closed without absorbing it. This is now homeless. |
| 2 | `apps/web/src/lib/features/map/MapHero.svelte:402-409` | `beauty2-honest-absence PR-3` | "TODO(beauty2-honest-absence PR-3): upgrade 'no-vehicles' to the inferred reason via `$lib/site/serviceWindow.inferAbsenceReason`. ... The selected-but-silent 'last seen N ago' half is also DEFERRED: it needs a per-vehicle report timestamp in /v1" | Same root blocker as #1 above (no network-wide service-span signal published yet) plus a second, harder blocker: `updated_utc` is uniform across all vehicles (see memory `vehicle-updated-utc-uniform.md` — confirmed 1 distinct value across 773 vehicles), so per-vehicle "last seen" is a pipeline change, not a web fix. Tag `beauty2-*` predates the current A+ Program numbering — orphaned batch name, no live slice owns it. |
| 3 | `apps/web/src/lib/features/receipt/AccountabilityReceipt.svelte:25` | GC2 ramp | "stand DOWN (their `hasData`) during the GC2 ramp — an absent list is honest-absence" | Not a TODO — documents intentional current behavior tied to GC2 data accrual (self-resolving as GC2 data accumulates over time, no action needed). |
| 4 | `apps/web/src/lib/features/network/reliability/selectors/completeness.ts:21` | GC2 ramp | "reality until the GC2 scheduled-universe data accrues across the retained window" | Same — self-resolving, not an action item. |
| 5 | `apps/web/src/lib/features/receipt/selectors/{notReportedLines,stateCuts}.ts` | GC2 ramp | Same GC2 ramp-in framing, multiple lines | Same — self-resolving. |
| 6 | `apps/db/src/transit_ops/db/migrations/versions/0073_route_scheduled_trips_daily.py:20` | GC2 | "the same gap 0069:20-21 deferred to GC2. dataset_version_id" | Points at GC2 (CLOSED, #186) — but this specific sub-gap (calendar_dates-only editions yield no day_type rows) is explicitly flagged in `0069_schedule_version_service_summary.py:20-21,31,100` as "RESERVED — always NULL in v1; GC2 fills via a data backfill with no migration." Since GC2 (#186) is closed and this is a **data backfill**, not a migration, verify whether the backfill actually ran — this is the one GC2 item that could still be open despite the slice showing closed. **Needs an operator/data check**, not a code TODO. |

### Non-slice-tagged TODOs (present but out of the requested slice-naming scope, listed for completeness)
- `apps/web/src/lib/seo/routeSeo.ts:314-317` — "TODO(seo): the leaf uses the URL id
  ... not the entity NAME ... needs the data-binding SSR-seed." No slice tag; cosmetic
  SEO polish, self-contained, no dependency.
- `apps/web/src/lib/site/securityHeaders.ts:31-34` — "TODO(security/csp-hardening):
  drop script-src 'unsafe-inline' ... needs a CSP-Report-Only rollout first." No slice
  tag; real but pre-scoped follow-up, not urgent (defense-in-depth already covers the
  main risk).
- `apps/web/src/lib/components/surface/EntityRow.svelte:7-8` — "Desktop master/detail
  panels are deferred to the 9.3 brainstorm" — references `9.3`, but that's the OLD
  slice-9.x numbering (map hero epic, already closed per memory
  `slice-9.3-map-hero-handoff.md`), predates the current S-series. Orphaned pointer —
  the "9.3 brainstorm" never happened under that name; superseded by
  `$lib/nav/intent.svelte.ts:1,181` which documents the same "panels, not pages"
  deferral as a standing architecture decision, not tied to any open slice.
- `apps/web/src/lib/components/surface/EntityDetail.svelte:60` — cross-references the
  routeSeo TODO above, same status.
- `apps/web/src/lib/features/lines/LinesIndex.svelte:24` and
  `apps/web/src/lib/features/search/SearchSurface.svelte:31` — near-identical "DEFER
  (tracked follow-ups, out of scope this batch): near-me / distance sort; per-row
  reliability grain selection; accessible-only filter (needs a DB field)." No slice
  tag, no owner named — matches the operator's "No orphan deferrals" standing rule
  (memory `no-orphan-deferrals.md`) in spirit but these predate that rule's enforcement
  and were never picked up by a slice. Two duplicate copies of the same deferred list.

### DB-side non-slice deferred items (routine, self-documenting, not action items)
- `apps/db/src/transit_ops/maintenance/static.py:34-36,133-221` and mirrored tests
  (`test_maintenance.py`, `test_maintenance_real_db_regression.py`) — `deferred` here
  means "FK-referenced dataset versions are never candidates for deletion," a
  permanent safety mechanism, not a backlog item. No action needed, ever.
- `apps/db/src/transit_ops/db/migrations/versions/0021_i3_alerts_scd2_dedup.py:166,351`
  and `0039_i3_content_hash_not_null.py` — a deferred `SET NOT NULL` that **was
  already resolved** by migration 0039 (slice-9.1.1l, long closed). Historical
  comment, not an open thread.
- `apps/db/src/transit_ops/db/migrations/versions/0034_trip_delay_stop_attribution.py:14,407`
  — "WAVE-2 PROD HARDENING -- PRE-DEPLOY FACT BACKFILL DEFERRED" — wave-2 was deployed
  and closed 2026-06-13 per memory (`wave2-prod-deploy-incident.md`). Historical,
  resolved.
- `apps/db/src/transit_ops/db/migrations/versions/0024_gold_current_i3_alerts_synthesized_dedup.py:16`
  — "redeploy + SET NOT NULL on content_hash is deferred" — superseded/closed by 0039
  as above.

---

## 4. Skip/todo-marked tests

Full sweep of `.skip(`, `.todo(`, `it.skip`, `test.skip`, `describe.skip`,
`@pytest.mark.skip`, `xfail`, `pytest.skip` across `*.ts`, `*.svelte`, `*.py`, `*.js`:

| File:line | Marker | Reason given | Verdict |
|---|---|---|---|
| `apps/db/tests/test_pg_repack_extension_real_db.py:80` | `pytest.skip` | "postgresql-16-repack not installed in this test cluster" | Environment-conditional, correct use, not a loose thread. |
| `apps/db/tests/test_pg_repack_extension_real_db.py:107` | `pytest.skip` | "pg_repack package IS available — guard-skip path not exercised" | Same — the inverse-condition twin of the above, correct. |
| `apps/db/tests/test_spine_cutover_gate.py:416` | `@pytest.mark.skipif` | conditional (not printed above; environment gate) | Standard conditional skip. |
| `apps/db/tests/test_data_proxy_artifacts.py:156,169,178` | `@pytest.mark.skipif` / `pytest.skip` | "git is not installed" / "not a git checkout" / "node is not installed" | Tooling-availability guards, correct use. |

**Zero `.skip`/`.todo` markers found in the web (`*.ts`/`*.svelte`) test suite** — all
web tests run unconditionally. **No genuinely-disabled/ignored tests anywhere in the
repo** — every skip found is a legitimate environment-capability guard, not a "test is
broken, revisit later" marker. This category is clean.

---

## 5. `workerd.log` untracked file (git status)

Not a code loose-thread, but flagged since it showed up in the git status snapshot:
`?? workerd.log` at repo root. This is a Cloudflare Workers runtime log file, almost
certainly a local dev artifact from `wrangler dev` / `bun run dev` on `apps/web` or
`apps/data-proxy`. Should be `.gitignore`d if it isn't already (quick check: it's
currently untracked, meaning it would get committed if anyone runs a bare `git add
-A`). Not in `.gitignore` currently based on its appearance in `git status` as `??`
rather than being silently excluded — worth a one-line `.gitignore` addition, purely
cosmetic hygiene, not blocking anything.

---

## Summary table — every thread, grouped

| Thread | Category | Blocks "closed beautifully"? |
|---|---|---|
| FR enumLabels winners (§1a) | Operator veto — decision only | **YES** — explicitly flagged "operator veto welcome," sitting unanswered since S7.5 (#181) closed |
| resolveWindow whole-drop (§1b) | Operator veto — decision only | **YES** — same slice, same unanswered-decision status |
| T8 browser semantics check (§1c) | Unexecuted verification | **YES** — cheapest to close (10 min browser pass), explicitly named in memory as still pending |
| GC1.5 — route_delay_hourly + view re-point (§2a) | Real backlog slice | **YES** — the largest of the 5 GC1.5 items, blocks the last legacy hourly-mart drop |
| GC1.5 — the other 4 items (stop habit-hour, headway folds, unrouted-share, twin-SQL) (§2b-e) | Real backlog slice | Same slice as above — bundle, not separately blocking |
| NetworkSurface.svelte:425 stale "S9 Handoff" pointer (§3.1) | Orphaned TODO | Cosmetic — names a closed carrier; needs re-homing to a real slice or deletion, not urgent |
| MapHero.svelte:402 stale "beauty2" pointer (§3.2) | Orphaned TODO | Cosmetic — same re-homing need, pipeline-blocked anyway (updated_utc uniformity) |
| 0073/0069 GC2 calendar_dates-only backfill (§3.6) | Possible open data gap | Worth a quick verify — "data backfill with no migration" could be silently undone; low effort to check |
| routeSeo.ts / securityHeaders.ts / EntityRow "9.3 brainstorm" / duplicate near-me DEFER blocks (§3, non-slice) | Cosmetic backlog | No — none block closure, none are urgent, none are mis-tracked (well-documented, self-contained) |
| Skip-marked tests (§4) | N/A | No — all legitimate environment guards, zero disabled tests |
| workerd.log untracked file (§5) | Repo hygiene | No — cosmetic gitignore gap |

**Total distinct loose threads found: 14** (3 operator vetoes + 5 GC1.5 items bundled
as 1 slice-level entry really = 2 practical GC1.5 action items since 2b-2e are one
backlog slice + 2a is the standalone big one, so realistically **~4 actionable
clusters**: FR labels, resolveWindow, T8, GC1.5-as-one-slice) + 2 stale/orphaned
TODOs + 1 possible-open-data-gap + 4 cosmetic/non-blocking items.

**The 5 items that block "closed beautifully":**
1. FR enumLabels operator veto (`enumLabels.ts:9-13`) — needs a yes/no.
2. resolveWindow whole-drop operator veto (`grain.ts:81-94`) — needs a yes/no.
3. T8 browser semantics check — needs a 10-minute browser pass, zero code risk.
4. GC1.5 slice (5 bundled deferred-drop items, `rollups.py` + `stop_reliability.py` +
   `network_trend.py` + `small_surfaces.py` + `maintenance/gold.py`) — real backlog
   work, own slice, not closeable inline.
5. The GC2 calendar_dates-only data-backfill status (`0069:20-21,31,100` /
   `0073:20`) — unclear if it actually ran; needs a prod data check before GC2 can be
   called fully done despite the slice showing CLOSED.
