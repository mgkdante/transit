# Hotspots and Repeat Offenders As-Of History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people browse every honestly publishable retained Hotspots and Repeat Offenders ranking date through `?date=YYYY-MM-DD`, while keeping the current fixed snapshots, ranking math, controls, charts, tables, links, mobile tap details, and empty/null behavior intact.

**Architecture:** Keep `historic/hotspots.json` and `historic/repeat_offenders.json` as byte-compatible current lanes. Build separate self-identifying as-of payloads from append-only daily spines, never from mutable current marts, using one ordered source scan and bounded rolling 1/7/14/30-day state. Repeat Offenders history uses 14 closed provider-local calendar dates; its fixed current mart uses an instant `now()-14d` fact window, so exact scalar parity applies only when those source windows are aligned. Publish each as-of payload at a content-addressed immutable date path, publish exact-byte immutable family indexes, then extend the stable CAS availability root from five to seven families and activate it last. On the web, extend the existing root-pinned repository graph with safe point-date paths and exact-byte validation. One shared point-date coordinator owns current/default fallback, URL correction, cancellation, stale-response suppression, and retry; Hotspots and Repeat Offenders only supply their typed index/value loaders. `HistoryNavigator` sits inside each existing independently collapsible Controls disclosure. Current/latest stays canonical with no `date`; only a valid older date loads an immutable artifact.

**Tech Stack:** Python 3.12, SQLAlchemy 2, Pydantic 2, pytest, Cloudflare R2/S3 storage, SvelteKit 5, TypeScript, Zod, Vitest, Testing Library, and the existing Transit/yesid surface, chart, URL, history, and persistence primitives.

## Global Constraints

- Work only in `/home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history` on `slice/p5r-partitioned-history`. Never edit the saved-project root checkout.
- The approved Option 2 design is locked. Do not reopen the product design.
- Follow strict RED -> GREEN. Run each named RED test first and record the expected failure before production code.
- Preserve the fixed compatibility keys and their existing builders:
  - `historic/hotspots.json`
  - `historic/repeat_offenders.json`
- Do not add mutable `historic/history/hotspots/index.json` or `historic/history/repeat_offenders/index.json` aliases. These are new families; the stable root advertises exact immutable index paths only.
- Preserve the existing manifest fields and fixed-file URL behavior. A missing history root/family remains a rollout-compatible current-only state.
- Use `?date=YYYY-MM-DD` only for an older as-of selection. Current/latest omits `date`. Preserve `?grain`, `?n`, locale routing, and every unrelated query parameter.
- Canonicalize a blank, malformed, outside-coverage, gap, unpublished, or explicit-latest date exactly once, announce the correction, and never fetch the invalid date.
- Do not propagate `date`, `grain`, or `n` into Line/Stop drill links or mobile chart-popover actions.
- Use one existing `SurfaceRail` per page. Put one `HistoryNavigator` inside the existing Controls disclosure before the existing grain controls. Do not add a second pill, sheet, drawer, dialog, scroll region, or feature-local async resource wrapper.
- Preserve Hotspots' approved compact centered 2x2 `time-grid` GrainPicker: equal cells, centered labels, straight inner seams, outer-only rounding, 44px targets, roving radio semantics, full mobile visibility, and the existing accessible full French label for compact `Pointe`.
- Preserve the independent persisted Controls and TOC disclosures, their locale-free keys, exact global Collapse all / Expand all signals, and Always start collapsed behavior.
- Preserve chart doctrine and mobile interaction: absolute severe domain, chart-only mobile/tablet horizontal scroller, no page overflow, tap opens only the custom detail popover, no direct row navigation, no native-tooltip flash, and the optional explicit action link remains inside the popover.
- Preserve Repeat Offenders evidence tables under each chart, row/table agreement, recurrence evidence, caps, per-kind rank restart, links, and honest null versus real zero behavior.
- Do not use `gold.repeated_problem_route_stop` or `gold.repeat_offender` to build old dates. Both can leak current/future state. Historical scalar and by-grain sections must be recomposed from retained daily spines ending at the requested date.
- Never query the existing trailing-window SQL once per retained date. Read ordered daily source rows once and maintain bounded rolling state so 730 retained dates do not create an N+1 database workload.
- Historical names must resolve as of the artifact date through dimension history. A later rename must not silently rewrite an old artifact's identity.
- Resolve historical names at the provider-local close of the artifact date: convert the next local midnight through the provider's configured IANA timezone and select the interval in force immediately before that exclusive UTC boundary. A rename during the day therefore uses the last name actually in force that day; a rename exactly at the next midnight belongs to the next artifact. On overlapping bad source intervals choose the greatest `valid_from_utc` deterministically; on a true gap publish `name=None`/`route_name=None`, never a future or current fallback.
- Emit an artifact for a real retained source date even when nothing qualifies. Published-empty is distinct from an unpublished date and must remain navigable.
- Early retained dates may be left-censored. Historical copy must say the ranking uses available retained observations ending on the selected date; it must not claim a complete 30-day window where the source has not accrued it.
- A real zero numerator with a known positive denominator is zero. Missing denominators, missing rows, and unavailable dates are no data, never zero.
- Content-addressed as-of payloads must be stable across republish runs: source-derived `generated_utc`, `publish_generation_id=None`, explicit methodology, deterministic ordering, and SHA computed only after the final envelope is complete.
- Publish immutable date artifacts first, their immutable family indexes second, every remaining existing retained parent next, and activate stable `historic/history/index.json` last through existing CAS. A failure may leave unreferenced immutable objects but must never advance the root.
- Keep publish and read-only validation/collection paths aligned. Do not add brittle positional tuple contracts when a typed retained-plan bundle can carry the two new plans.
- Real-DB tests may skip only when their documented database environment is unavailable. Unit, contract, gate, publisher, adapter, repository, and component tests must not skip.
- No browser QA, deployment, Notion mutation, workflow dispatch, push, PR, or merge in Task 8. Those remain final convergence work after automated review.

## Locked Publication Contract

| Family | Current compatibility object | Immutable family index | Immutable as-of object |
| --- | --- | --- | --- |
| Hotspots | `historic/hotspots.json` | `historic/history/hotspots/generations/{index-sha256}/index.json` | `historic/history/hotspots/generations/{payload-sha256}/{YYYY-MM-DD}.json` |
| Repeat Offenders | `historic/repeat_offenders.json` | `historic/history/repeat_offenders/generations/{index-sha256}/index.json` | `historic/history/repeat_offenders/generations/{payload-sha256}/{YYYY-MM-DD}.json` |
| Global | n/a | `historic/history/index.json` activated last | n/a |

Each family index reuses `HistoricCollectionIndex` with:

- `family="hotspots"` or `family="repeat_offenders"`
- `selection_mode="date"`
- exact sorted `available_dates`
- one `HistoricPartitionRef` per published date
- `coverage_start == coverage_end == date`
- `count == 1`
- exact `sha256` and `byte_size` from the published bytes
- `collection_generation_id == history_index_generation_id(index)`

The stable root contains exactly seven sorted families after rollout:

1. `alerts`
2. `hotspots`
3. `lines`
4. `network`
5. `receipts`
6. `repeat_offenders`
7. `stops`

Historical payloads are separate self-identifying contracts:

```python
class HistoricHotspotsDay(Hotspots):
    date: str

class HistoricRepeatOffenderGrain(RepeatOffenderGrain):
    date: str
    window_end: str

class HistoricRepeatOffendersDay(RepeatOffenders):
    date: str
    by_grain: list[HistoricRepeatOffenderGrain] = Field(default_factory=list)
```

The current `Hotspots` and `RepeatOffenders` contracts do not gain these required historical fields, so fixed compatibility bytes stay unchanged.

## File Structure

### Database

- Create `apps/db/src/transit_ops/snapshots/builders/historic/hotspots_history.py`.
- Create `apps/db/src/transit_ops/snapshots/builders/historic/repeat_offenders_history.py`.
- Modify `apps/db/src/transit_ops/snapshots/builders/historic/history_common.py` for shared point-date refs/index helpers and rolling-date utilities.
- Modify `apps/db/src/transit_ops/snapshots/builders/historic/small_surfaces.py` only where a tested pure helper can be shared without changing current output.
- Modify both historic builder export barrels.
- Modify `apps/db/src/transit_ops/snapshots/contract.py`, generated schemas, `publish.py`, `gate.py`, and validation collection.
- Create `apps/db/tests/test_as_of_rankings_contract.py`.
- Create `apps/db/tests/test_as_of_rankings_builders.py`.
- Create `apps/db/tests/test_as_of_rankings_publish.py`.
- Create `apps/db/tests/test_as_of_rankings_real_db.py`.
- Extend the existing history, publisher, gate, schema, storage, and cross-language mirror tests named below.

### Web

- Modify `apps/web/src/lib/v1/schemas/history.ts`, `hotspots.ts`, `repeat_offenders.ts`, and schema exports/tests.
- Modify `apps/web/src/lib/v1/history/pointers.ts` and add point-date helpers/tests.
- Create `apps/web/src/lib/v1/history/dateResource.svelte.ts` and its focused test. This is the one shared point-date coordinator; do not add Hotspots/Repeat-specific resource wrappers.
- Modify adapter ports, R2 adapter, historic repository, and exact-byte history tests.
- Modify `HotspotsBoard.svelte`, `hotspots.copy.ts`, and add `HotspotsBoard.history.svelte.test.ts` while retaining the existing current/default suite.
- Modify `RepeatOffenders.svelte`, `repeatOffenders.copy.ts`, and add `RepeatOffenders.history.svelte.test.ts` while retaining the existing current/default suite.

---

### Task 1: Define self-identifying point-date contracts and safe paths

**Files:**
- Create: `apps/db/tests/test_as_of_rankings_contract.py`
- Modify: `apps/db/tests/test_snapshots_contract.py`
- Modify: `apps/db/tests/test_snapshots_schema_export.py`
- Modify: `apps/db/src/transit_ops/snapshots/contract.py`
- Run: `apps/db/scripts/export_snapshot_schemas.py`
- Modify: `apps/web/src/lib/v1/schemas/history.ts`
- Modify: `apps/web/src/lib/v1/schemas/hotspots.ts`
- Modify: `apps/web/src/lib/v1/schemas/repeat_offenders.ts`
- Modify: `apps/web/src/lib/v1/schemas/index.ts`
- Modify: `apps/web/src/lib/v1/schemas/history.test.ts`
- Modify: `apps/web/src/lib/v1/schemas/hotspots_by_grain.test.ts`
- Modify: the existing Repeat Offenders schema tests
- Modify: `apps/web/src/lib/v1/history/pointers.ts`
- Create or modify: point-path tests beside `pointers.ts`
- Modify: generated `apps/web/src/lib/v1/schemas/json/*.schema.json` only by byte-copying the Python export; there is no schema sync command
- Modify: `apps/db/tests/test_v1_contract_web_mirror_sync.py`

- [ ] Add RED contract tests proving the two historical day models require a real self-identifying date, current models still validate without it, historical Repeat grains require exact window endpoints, and impossible dates fail.
- [ ] Run the RED database tests and confirm failures are missing contracts/exports, not fixture mistakes:

```bash
cd apps/db
uv run pytest tests/test_as_of_rankings_contract.py tests/test_snapshots_contract.py tests/test_snapshots_schema_export.py -q
```

- [ ] Add RED web tests proving existing range families retain their fixed/versioned index allowlist, while `hotspots`/`repeat_offenders` point-family indexes allow only exact versioned paths (never a mutable fixed alias); artifact paths require an exact payload SHA plus real date, and cross-family/traversal/query/fragment variants fail before fetch.
- [ ] Run the RED web tests:

```bash
cd apps/web
bun run test -- src/lib/v1/schemas/history.test.ts src/lib/v1/schemas/hotspots_by_grain.test.ts src/lib/v1/history/pointers.test.ts
```

- [ ] Add `HistoricHotspotsDay`, `HistoricRepeatOffenderGrain`, and `HistoricRepeatOffendersDay`; register methodology and top-level schema exports without changing current model required fields.
- [ ] Extend TypeScript/Zod mirrors and exports. Generate the DB JSON schemas, then copy those exact bytes into the web mirror; never hand-edit generated JSON:

```bash
cd apps/db
uv run python scripts/export_snapshot_schemas.py
cd ../..
cp apps/db/src/transit_ops/snapshots/schemas/*.schema.json apps/web/src/lib/v1/schemas/json/
cd apps/db
uv run pytest tests/test_snapshots_schema_export.py tests/test_v1_contract_web_mirror_sync.py -q
```
- [ ] Generalize `RetainedHistoryFamily`/path helpers so range families and point families have explicit closed vocabularies and family-specific regexes.
- [ ] Re-run both focused suites GREEN, then run the cross-language mirror test.
- [ ] Commit only Task 1:

```bash
git add apps/db/src/transit_ops/snapshots/contract.py apps/db/src/transit_ops/snapshots/schemas apps/db/tests/test_as_of_rankings_contract.py apps/db/tests/test_snapshots_contract.py apps/db/tests/test_snapshots_schema_export.py apps/db/tests/test_v1_contract_web_mirror_sync.py apps/web/src/lib/v1/schemas apps/web/src/lib/v1/history/pointers.ts apps/web/src/lib/v1/history/pointers.test.ts
git commit -m "feat(history): define as-of ranking contracts"
```

### Task 2: Build Hotspots as-of days from one ordered retained stream

**Files:**
- Create: `apps/db/src/transit_ops/snapshots/builders/historic/hotspots_history.py`
- Modify: `apps/db/src/transit_ops/snapshots/builders/historic/history_common.py`
- Modify: `apps/db/src/transit_ops/snapshots/builders/historic/small_surfaces.py` only for proven byte-neutral helper extraction
- Modify: historic builder export barrels
- Create/modify: `apps/db/tests/test_as_of_rankings_builders.py`
- Modify: `apps/db/tests/test_snapshots_historic.py`
- Modify: `apps/db/tests/test_spine_cutover_gate.py`

- [ ] Write RED tests for an older date followed by appended future rows; the old artifact bytes, ranks, windows, and names must not change.
- [ ] Add RED tests for Hotspots history:
  - ISO-week-to-date scalar ends on the artifact date and cannot read later-in-week rows. It preserves the current scalar doctrine separately from the ladders: one cross-kind top-20, eligible under the mart's exact `issue_count > 0 OR avg_delay_seconds > 300` and severity formulas, ordered primarily by `issue_count DESC`.
  - day/week/month use inclusive 1/7/30-day rolling windows ending on the date.
  - peak uses AM+PM peak observations from the trailing week only.
  - only the `by_grain` ladders rank routes and stops independently with rank restart.
  - `by_grain` Wilson-lower-bound order, average-delay and deterministic history-only tie keys are exact.
  - historical scalar ties add the stable trailing order `entity_kind`, `entity_id`, then source `route_id`; current/newest parity means exact eligibility, fields, and primary `issue_count` order, with byte/order equality required only outside the current SQL's inherently unordered equal-`issue_count` tie groups. Do not change current SQL to manufacture parity.
  - `MIN_N=30`, 50-per-kind ranked caps, 60-total tray cap, sentinels, nulls, and zero denominators remain honest.
  - `issue_count` stays `None` for by-grain entries.
  - real source dates emit published-empty artifacts when nothing qualifies.
  - resolved names use the locked provider-local closing-instant rule, including midday rename, next-midnight, DST, overlap, and gap cases.
  - current `build_hotspots()` bytes and SQL dispatch remain unchanged.
- [ ] Run the RED builder slice:

```bash
cd apps/db
uv run pytest tests/test_as_of_rankings_builders.py tests/test_snapshots_historic.py tests/test_spine_cutover_gate.py -q -k 'hotspot or as_of'
```

- [ ] Implement one ordered route daily stream and one ordered stop daily stream. Aggregate once by provider-local date/entity, include the required additive counts/sums and peak-only counts, and merge date groups without materializing all retained payloads.
- [ ] Maintain bounded rolling maps/deques for day/week/month and ISO-week-to-date state. Each source row enters and leaves each rolling window once.
- [ ] Load the provider timezone and dimension-history intervals once. Resolve names at the artifact day's provider-local closing instant using the locked overlap/gap rule, and use deterministic history-only trailing tie keys without altering current fixed output. Test a rename during a local day, a rename exactly at the next local midnight, a DST boundary, an overlap, and a gap.
- [ ] Emit `HistoricHotspotsDay` one at a time with source-derived `generated_utc`, explicit methodology, no publish generation, exact grain ordering, and the existing 256 KiB ceiling.
- [ ] Add `build_hotspots_history_plan()` and `build_hotspots_history_plan_from_rows()` seams. The test seam must exercise the same reducer/ranker as production.
- [ ] Run the focused slice GREEN and prove the current compatibility regression set remains green.
- [ ] Commit only Task 2:

```bash
git add apps/db/src/transit_ops/snapshots/builders/historic apps/db/tests/test_as_of_rankings_builders.py apps/db/tests/test_snapshots_historic.py apps/db/tests/test_spine_cutover_gate.py
git commit -m "feat(history): build hotspots as of retained dates"
```

### Task 3: Build Repeat Offenders as-of days from one ordered retained stream

**Files:**
- Create: `apps/db/src/transit_ops/snapshots/builders/historic/repeat_offenders_history.py`
- Modify: `apps/db/src/transit_ops/snapshots/builders/historic/history_common.py`
- Modify: `apps/db/src/transit_ops/snapshots/builders/historic/small_surfaces.py` only for proven byte-neutral helper extraction
- Modify: historic builder export barrels
- Modify: `apps/db/tests/test_as_of_rankings_builders.py`
- Modify: `apps/db/tests/test_snapshots_historic.py`
- Modify: `apps/db/tests/test_windowable_repeat_offenders_realdb.py`

- [ ] Add RED tests for Repeat Offenders history:
  - scalar list is recomposed from the trailing 14 closed provider-local retained dates, requires recurrence on at least 3 days, orders recurrence descending then average delay descending, and caps at 50. The mutable current mart's instant `now()-14d` window can include the open local day and a partial oldest day; compare exact scalar parity only against an aligned mutable window or equivalent closed-spine math, never by weakening the immutable closed-day rule.
  - week/month by-grain windows end exactly on the selected date and never consume later rows.
  - trip and vehicle ladders rank independently with rank restart.
  - Wilson order, recurrence evidence, unrounded severity boundary, `MIN_N=30`, 50-per-kind caps, recurrence>=2 tray admission, 60-total tray cap, and null/zero honesty are unchanged.
  - equal-score rows with the same entity ID on different routes remain distinct and deterministic using route identity as a history-only tie key.
  - real source dates with no qualifying offender still emit published-empty artifacts.
  - historical route names use the same locked provider-local closing-instant, overlap, and gap rules as Hotspots.
  - current `build_repeat_offenders()` bytes and mutable-mart SQL stay unchanged.
- [ ] Run the RED builder slice:

```bash
cd apps/db
uv run pytest tests/test_as_of_rankings_builders.py tests/test_snapshots_historic.py tests/test_windowable_repeat_offenders_realdb.py -q -k 'repeat or offender or as_of'
```

- [ ] Implement one ordered `repeat_offender_daily_spine` stream and bounded 7/14/30-day maps/deques. Do not issue one window query per output date.
- [ ] Emit `HistoricRepeatOffendersDay` one at a time with a 14-day scalar and required dated week/month grains, source-derived generation time, no publish generation, deterministic order, and the existing 256 KiB ceiling.
- [ ] Add production and row-fed test plan seams matching Hotspots.
- [ ] Run GREEN, including the real-DB parity test when its database is available.
- [ ] Commit only Task 3:

```bash
git add apps/db/src/transit_ops/snapshots/builders/historic apps/db/tests/test_as_of_rankings_builders.py apps/db/tests/test_snapshots_historic.py apps/db/tests/test_windowable_repeat_offenders_realdb.py
git commit -m "feat(history): build offenders as of retained dates"
```

### Task 4: Publish, gate, and root-pin both point-date families

**Files:**
- Create: `apps/db/tests/test_as_of_rankings_publish.py`
- Create: `apps/db/tests/test_as_of_rankings_real_db.py`
- Modify: `apps/db/src/transit_ops/snapshots/builders/historic/history_common.py`
- Modify: `apps/db/src/transit_ops/snapshots/publish.py`
- Modify: `apps/db/src/transit_ops/snapshots/gate.py`
- Modify: `apps/db/src/transit_ops/validation/historic_publish.py` where the proof inventory enumerates families
- Modify: `apps/db/tests/test_partitioned_history_publish.py`
- Modify: `apps/db/tests/test_partitioned_history_contract.py`
- Modify: `apps/db/tests/test_snapshots_publish.py`
- Modify: `apps/db/tests/test_snapshots_publish_parallel.py`
- Modify: `apps/db/tests/test_snapshots_gate.py`
- Modify: `apps/db/tests/test_snapshots_storage.py` only if the typed plan needs a storage seam
- Modify: historic validation/recovery proof tests that pin family counts

- [ ] Add RED tests proving every date ref uses the exact final payload bytes for SHA and byte size, date paths match the payload date, indexes are exact-byte versioned, and no mutable point-family alias is written.
- [ ] Add RED publication-order/failure tests proving all date children precede both family indexes, both family indexes precede the stable root, and any child/index/gate failure leaves the old root active.
- [ ] Add RED graph tests proving the root has exactly seven sorted families and rejects duplicate/missing/wrong-mode/wrong-path/wrong-generation/wrong-date/wrong-coverage/wrong-digest point-family edges.
- [ ] Add RED tests for published-empty dates, honest gaps, root timestamp derivation, stable-versus-immutable accounting, validation collection parity, force semantics, idempotent republish, and concurrent root CAS.
- [ ] Run the RED publisher/gate slice:

```bash
cd apps/db
uv run pytest tests/test_as_of_rankings_publish.py tests/test_partitioned_history_publish.py tests/test_partitioned_history_contract.py tests/test_snapshots_publish.py tests/test_snapshots_publish_parallel.py tests/test_snapshots_gate.py tests/test_snapshots_storage.py -q
```

- [ ] Add shared point-date ref/index construction that consumes artifact iterators and retains only refs/coverage scalars between dates.
- [ ] Integrate typed Hotspots/Repeat plans into `_publish_historic()` and the read-only `collect_payloads()`/validation path without changing fixed compatibility stages.
- [ ] Gate every as-of payload before immutable upload, every ref against its exact payload, both family indexes against their full ref summaries, and the seven-family root against exact child objects.
- [ ] Stamp family indexes only before computing their exact-byte pointer path. Never stamp the content-addressed date payloads.
- [ ] Upload date payloads in a bounded batch/concurrency arrangement that does not hold 730 payload models in memory. Activate `historic/history/index.json` last through existing CAS.
- [ ] Extend proof/report inventories to seven families without weakening existing Alert/Receipt/Network/Line/Stop assertions.
- [ ] Run the focused suite GREEN, then run the new real-DB test when available. Its required proof is: no future leakage, full actual-date discovery, exact Hotspots-by-grain current/newest parity, exact Repeat parity against an aligned mutable window or equivalent 14-closed-date spine math, Hotspots scalar parity under the explicitly documented unordered-tie equivalence, exact content addressing, and bounded query count independent of retained date count.
- [ ] Commit only Task 4:

```bash
git add apps/db/src/transit_ops/snapshots apps/db/src/transit_ops/validation apps/db/tests/test_as_of_rankings_publish.py apps/db/tests/test_as_of_rankings_real_db.py apps/db/tests/test_partitioned_history_publish.py apps/db/tests/test_partitioned_history_contract.py apps/db/tests/test_snapshots_publish.py apps/db/tests/test_snapshots_publish_parallel.py apps/db/tests/test_snapshots_gate.py apps/db/tests/test_snapshots_storage.py apps/db/tests/test_historic_publish_proof.py
git commit -m "feat(history): publish as-of ranking families"
```

### Task 5: Add exact root-pinned web discovery and point-artifact loading

**Files:**
- Modify: `apps/web/src/lib/v1/adapter/types.ts`
- Modify: `apps/web/src/lib/v1/adapter/r2.ts`
- Modify: `apps/web/src/lib/v1/adapter/r2.history.test.ts`
- Modify: `apps/web/src/lib/v1/repositories/historic.ts`
- Modify: `apps/web/src/lib/v1/repositories/historic.history.test.ts`
- Modify: `apps/web/src/lib/v1/history/pointers.ts`
- Modify: `apps/web/src/lib/v1/history/selection.ts` only if a generic collection-index availability helper removes Receipt-only naming
- Modify: relevant schema/history tests

- [ ] Add RED adapter tests for exact immutable point-family index reads, exact raw artifact bytes, signals, one cache-busted parent refresh, transport-null 404s, and pre-fetch rejection of unsafe/cross-family paths.
- [ ] Add RED repository tests for:
  - optional missing root/family -> current-only `null` index;
  - advertised missing index/artifact -> typed contract error;
  - family/mode/generation/date/ref uniqueness/coverage/path/SHA/byte-size validation;
  - one bounded root/index mismatch refresh with abort identity preserved;
  - valid older date -> exact artifact;
  - explicit latest, malformed, and unpublished dates never call the artifact port;
  - payload date and Repeat grain endpoints must match the advertised date;
  - digest and byte-size mismatches fail closed;
  - published-empty artifacts return normally.
- [ ] Run RED:

```bash
cd apps/web
bun run test -- src/lib/v1/adapter/r2.history.test.ts src/lib/v1/repositories/historic.history.test.ts src/lib/v1/history/pointers.test.ts src/lib/v1/history/selection.test.ts src/lib/v1/schemas/history.test.ts
```

- [ ] Add typed adapter ports for both point-family indexes and raw date artifacts. Reuse `getEntityJsonWithBytes`; do not parse and reserialize before hashing.
- [ ] Add one generic internal point-family repository path with thin typed exports for Hotspots and Repeat Offenders. Validate the entire index before selecting a ref.
- [ ] Reuse the existing root mismatch recovery rules: exact root-advertised path first, one bounded cache-busted parent refresh, then a typed transient failure. Never silently fall back after an advertised artifact fails.
- [ ] Run GREEN and all existing retained-history repository/adapter regressions.
- [ ] Commit only Task 5:

```bash
git add apps/web/src/lib/v1/adapter apps/web/src/lib/v1/repositories apps/web/src/lib/v1/history apps/web/src/lib/v1/schemas
git commit -m "feat(web): load as-of ranking artifacts"
```

### Task 6: Add one reusable current-or-date history coordinator

**Files:**
- Create: `apps/web/src/lib/v1/history/dateResource.svelte.ts`
- Create: `apps/web/src/lib/v1/history/dateResource.svelte.test.ts`
- Modify: `apps/web/src/lib/v1/history/index.ts`
- Modify: `apps/web/src/lib/filters/state.ts` comments only if still Receipt-specific
- Modify: `apps/web/src/lib/filters/url.ts` comments/tests only if still Receipt-specific

**Interface:**

```ts
interface RawHistoryDateRequest {
	hasDate: boolean;
	rawDate: string | null;
}

interface HistoryDateLoader<TIndex, TValue> {
	loadIndex(signal: AbortSignal): Promise<TIndex | null>;
	availability(index: TIndex): HistoryAvailability;
	loadCurrent(signal: AbortSignal): Promise<TValue>;
	loadDate(date: string, index: TIndex, signal: AbortSignal): Promise<TValue>;
}
```

- [ ] Write RED coordinator tests proving:
  - no `date` displays current, discovers optional history, and never fetches a retained artifact;
  - missing/empty index preserves current and exposes no navigator dates;
  - valid older date hides current/stale data while loading only that artifact;
  - explicit latest canonicalizes to current and never fetches its retained artifact;
  - blank/malformed/outside/gap/unpublished values correct once to current, announce once, and never fetch invalid/fallback artifacts;
  - a default-path discovery failure leaves current usable, while an explicit-date discovery failure is retryable and never lies about the requested date;
  - advertised artifact errors never substitute current;
  - A -> B aborts A, suppresses stale completion, and keeps the selected date honest;
  - retry, destroy, synchronous/asynchronous AbortError, and raw first-repeat behavior match the proven range coordinator semantics;
  - a global `dataRefresh.epoch` bump refetches the currently selected lane without losing the raw/canonical date;
  - freshness remains opt-in and only the final accepted current-or-retained payload contributes its `generated_utc` through `dataRefresh.noteDataGeneratedUtc`; indexes, rejected stale completions, aborted requests, and failed payloads never contribute freshness.
- [ ] Run RED:

```bash
cd apps/web
bun run test -- src/lib/v1/history/dateResource.svelte.test.ts src/lib/v1/history/selection.test.ts src/lib/v1/history/rangeResource.svelte.test.ts
```

- [ ] Implement the one shared coordinator by reusing pure selection/correction helpers and composing `createResource` where its lifecycle fits. If the coordinator needs lifecycle behavior that cannot be composed, extract one shared request-lifecycle core used by both resources; do not copy the refresh epoch, freshness, abort, retry, or stale-response machinery into a second fork. Do not add feature-local resource classes.
- [ ] Expose selected/current/history status, canonical date, available dates, previous/next, correction, loading/error/retry, and the accepted payload in one stable interface.
- [ ] Run GREEN plus the range-resource regression to prove no history-mode regression.
- [ ] Commit only Task 6:

```bash
git add apps/web/src/lib/v1/history apps/web/src/lib/filters
git commit -m "feat(web): coordinate point-date history"
```

### Task 7: Integrate Hotspots history without changing the approved surface

**Files:**
- Create: `apps/web/src/lib/features/hotspots/HotspotsBoard.history.svelte.test.ts`
- Modify: `apps/web/src/lib/features/hotspots/HotspotsBoard.svelte`
- Modify: `apps/web/src/lib/features/hotspots/HotspotsBoard.svelte.test.ts` only for unavoidable shared fixture seams
- Modify: `apps/web/src/lib/features/hotspots/hotspots.copy.ts`
- Verify unchanged: `apps/web/src/lib/components/surface/GrainPicker.svelte`
- Verify unchanged: `apps/web/src/lib/features/hotspots/sections/HotspotSection.svelte`
- Verify unchanged: shared chart datum popover files

- [ ] Add RED page tests for current/default parity: no date artifact fetch, exact current cards/TOC/links, exact two header buttons, unchanged 2x2 grain control, `?grain`/`?n` behavior, published-empty behavior, missing index fallback, global refresh refetch, and accepted-payload freshness reporting.
- [ ] Add RED history tests for valid older date, explicit latest cleanup, malformed/unpublished correction announcement, previous/next skipping unpublished dates, cancellation/stale suppression, retry, published-empty retained date, and a missing advertised artifact failing visibly.
- [ ] Add RED rail tests proving `HistoryNavigator` is inside the existing Controls disclosure before the 2x2 grain control, Controls/TOC remain independent and persisted with `hotspots-controls`/`hotspots-toc`, global signals are exact, and one mobile sheet contains everything.
- [ ] Add RED URL tests proving `{date, grain, n}` mirrors in one update without clobbering unrelated params and all Line/Stop links/popover actions remain clean.
- [ ] Add RED retained-payload rendering tests proving rankings, absolute severe domain, chart/table rows, readings/null honesty, chart-only scroller, focus, and tap-first custom popover behavior are unchanged.
- [ ] Run RED:

```bash
cd apps/web
bun run test -- src/lib/features/hotspots/HotspotsBoard.svelte.test.ts src/lib/features/hotspots/HotspotsBoard.history.svelte.test.ts src/lib/features/hotspots/sections/HotspotSection.svelte.test.ts src/lib/components/surface/HistoryNavigator.svelte.test.ts src/lib/components/surface/GrainPicker.svelte.test.ts src/lib/v1/history/dateResource.svelte.test.ts
```

- [ ] Replace the board's direct current resource with the shared date coordinator. Derive every card, TOC entry, chart, table, popover, ArticleHeader timestamp, and global freshness contribution from the accepted current-or-retained payload only; an index timestamp or stale/failed payload must never become the displayed freshness anchor.
- [ ] Add localized EN/FR navigator, coverage, selection, correction, and retained-window copy. Historical captions must say available retained observations ending on the selected date.
- [ ] Seat `HistoryNavigator` before the unchanged `variant="time-grid"` GrainPicker in the Controls disclosure. Keep the rail visible on a published-empty retained day so the user can leave it.
- [ ] Batch date/grain/n URL mirroring; preserve navigation links and every unrelated parameter.
- [ ] Run GREEN plus the full existing Hotspots and shared chart-interaction regression set.
- [ ] Commit only Task 7:

```bash
git add apps/web/src/lib/features/hotspots
git commit -m "feat(web): browse hotspots as of date"
```

### Task 8: Integrate Repeat Offenders history with chart/table parity

**Files:**
- Create: `apps/web/src/lib/features/repeat-offenders/RepeatOffenders.history.svelte.test.ts`
- Modify: `apps/web/src/lib/features/repeat-offenders/RepeatOffenders.svelte`
- Modify: `apps/web/src/lib/features/repeat-offenders/RepeatOffenders.svelte.test.ts` only for unavoidable shared fixture seams
- Modify: `apps/web/src/lib/features/repeat-offenders/repeatOffenders.copy.ts`
- Verify unchanged: `RepeatOffendersSection.svelte`
- Verify unchanged: `RepeatOffenderEvidenceTable.svelte`
- Verify unchanged: shared chart datum popover files

- [ ] Add RED current/default parity tests: no retained artifact fetch, fixed current payload behavior, exact two header buttons, existing rail/collapse persistence, week/month and worst-N controls, ranking math, links, legacy fallback, published-empty behavior, global refresh refetch, and accepted-payload freshness reporting.
- [ ] Add RED date-history tests matching Hotspots: valid older date, latest cleanup, correction, previous/next gaps, abort/stale suppression, retry, strict advertised failures, and published-empty navigation.
- [ ] Prove each retained chart row and semantic evidence-table row comes from the same accepted payload and preserves rank, recurrence, average delay, readings, route link, null honesty, and real zero.
- [ ] Prove trip/vehicle chart taps open only the custom mobile popover, never directly redirect, never flash the native tooltip, and expose only the explicit clean Line action.
- [ ] Prove date/grain/n mirror atomically and a history change cannot reset the user's chosen grain or cap.
- [ ] Run RED:

```bash
cd apps/web
bun run test -- src/lib/features/repeat-offenders/RepeatOffenders.svelte.test.ts src/lib/features/repeat-offenders/RepeatOffenders.history.svelte.test.ts src/lib/features/repeat-offenders/sections/RepeatOffendersSection.svelte.test.ts src/lib/features/repeat-offenders/sections/RepeatOffenderEvidenceTable.svelte.test.ts src/lib/v1/history/dateResource.svelte.test.ts
```

- [ ] Wire the same shared date coordinator into Repeat Offenders and derive hero, cards, TOC, charts, trays, evidence tables, metadata, and global freshness from only the accepted payload.
- [ ] Seat one `HistoryNavigator` in the existing Controls disclosure; preserve the existing week/month and worst-N controls plus both disclosure persistence keys/signals.
- [ ] Add complete EN/FR history copy and honest partial-window wording.
- [ ] Run GREEN plus every existing Repeat Offenders selector, table, chart, URL, and rail regression.
- [ ] Commit only Task 8:

```bash
git add apps/web/src/lib/features/repeat-offenders
git commit -m "feat(web): browse offenders as of date"
```

### Task 9: Full verification, demonolithic architecture review, and Task 8 handoff

**Files:**
- Modify only files required by accepted review findings
- Update ignored `.superpowers/sdd/progress.md`
- Create ignored `.superpowers/sdd/task-8-hotspots-repeat-offenders-history-report.md`

- [ ] Run the focused database matrix:

```bash
cd apps/db
uv run pytest \
  tests/test_as_of_rankings_contract.py \
  tests/test_as_of_rankings_builders.py \
  tests/test_as_of_rankings_publish.py \
  tests/test_as_of_rankings_real_db.py \
  tests/test_snapshots_historic.py \
  tests/test_windowable_repeat_offenders_realdb.py \
  tests/test_spine_cutover_gate.py \
  tests/test_windowable_offline.py \
  tests/test_partitioned_history_contract.py \
  tests/test_partitioned_history_publish.py \
  tests/test_snapshots_contract.py \
  tests/test_snapshots_schema_export.py \
  tests/test_v1_contract_web_mirror_sync.py \
  tests/test_snapshots_gate.py \
  tests/test_snapshots_publish.py \
  tests/test_snapshots_publish_parallel.py \
  tests/test_snapshots_storage.py -q
```

- [ ] Run the focused web matrix:

```bash
cd apps/web
bun run test -- \
  src/lib/v1/history/dateResource.svelte.test.ts \
  src/lib/v1/history/rangeResource.svelte.test.ts \
  src/lib/v1/history/selection.test.ts \
  src/lib/v1/schemas/history.test.ts \
  src/lib/v1/schemas/hotspots_by_grain.test.ts \
  src/lib/v1/adapter/r2.history.test.ts \
  src/lib/v1/repositories/historic.history.test.ts \
  src/lib/filters/url.test.ts \
  src/lib/site/urlMirror.svelte.test.ts \
  src/lib/components/surface/DateRangePicker.svelte.test.ts \
  src/lib/components/surface/HistoryNavigator.svelte.test.ts \
  src/lib/components/surface/GrainPicker.svelte.test.ts \
  src/lib/components/surface/SurfaceRail.svelte.test.ts \
  src/lib/components/shared/CollapsibleSection.test.ts \
  src/lib/components/shared/TocNav.test.ts \
  src/lib/components/layout/DetailShell.svelte.test.ts \
  src/lib/components/dataviz/chart/ChartDatumPopover.svelte.test.ts \
  src/lib/components/dataviz/chart/marks/magnitudeRowActivation.test.ts \
  src/lib/components/dataviz/chart/marks/MagnitudeBarsMark.svelte.test.ts \
  src/lib/features/hotspots/HotspotsBoard.svelte.test.ts \
  src/lib/features/hotspots/HotspotsBoard.history.svelte.test.ts \
  src/lib/features/hotspots/sections/HotspotSection.svelte.test.ts \
  src/lib/features/repeat-offenders/RepeatOffenders.svelte.test.ts \
  src/lib/features/repeat-offenders/RepeatOffenders.history.svelte.test.ts \
  src/lib/features/repeat-offenders/sections/RepeatOffendersSection.svelte.test.ts \
  src/lib/features/repeat-offenders/sections/RepeatOffenderEvidenceTable.svelte.test.ts \
  src/lib/features/receipt/AccountabilityReceipt.async.svelte.test.ts \
  src/lib/features/metrics/MetricInfo.svelte.test.ts \
  src/lib/features/metrics/MetricsExplainer.svelte.test.ts \
  src/lib/features/health/HealthStatus.svelte.test.ts \
  src/lib/features/health/HealthStatus.async.svelte.test.ts
```

- [ ] Run full project verification:

```bash
cd apps/db && uv run pytest -q
cd ../web && bun run test
bun run check
bun run lint
bun run format:check
bun run build
cd ../.. && git diff --check
```

- [ ] Run scoped Ruff lint/format over every changed/new Python file and record inherited whole-tree Ruff debt separately; do not silently reformat unrelated files.
- [ ] Request fresh independent reviews in three lanes:
  1. backend data/contract/publisher correctness and query boundedness;
  2. frontend history/URL/async/a11y/mobile interaction correctness;
  3. architecture/componentization review focused on monolith growth, reusable primitives, duplicate async logic, exact contract ownership, and yesid/Transit design-system consistency.
- [ ] Treat every accepted finding as a new RED test, fix it, rerun the focused matrix, and request re-review until no Critical or Important finding remains.
- [ ] Confirm `HotspotsBoard.svelte` and `RepeatOffenders.svelte` did not absorb repository/state-machine logic that belongs in shared history modules. Extract only proven reusable seams; do not churn stable presenters or chart primitives.
- [ ] Update the ignored progress/report with exact commits, pass/skip counts, review findings/fixes, Ruff baseline, and explicit non-claims: no browser QA, deployment, push, PR, merge, or Notion mutation.
- [ ] Commit accepted review fixes and final Task 8 convergence only after fresh evidence is green.

## Completion Gate

Task 8 is complete only when all of the following are true:

- Fixed Hotspots and Repeat Offenders compatibility outputs remain unchanged and current/latest URLs omit `date`.
- Every advertised older date maps to one exact immutable self-identifying artifact; invalid or absent dates never fabricate data.
- Historical builders are bounded one-pass reducers, not date-by-date database rescans.
- The stable root advertises seven exact child families and still activates last through CAS.
- Hotspots preserves its approved 2x2 grain control, combined rail, disclosures, charts, tables, focus, and mobile tap behavior.
- Repeat Offenders preserves its ranking math, chart/table agreement, links, recurrence evidence, caps, and null honesty.
- Both pages share one point-date coordinator and no feature-local duplicate interaction/resource logic.
- Focused and full automated verification is green, known skips/debt are explicit, and fresh independent backend/frontend/architecture reviews have no unresolved Critical or Important findings.
