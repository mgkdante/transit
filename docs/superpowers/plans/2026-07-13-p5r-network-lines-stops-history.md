# P5-R Network, Lines, and Stops Retained-History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Every implementation task is strict RED -> GREEN and ends in a focused commit only after its focused verification is green.

**Goal:** Let people request the full honestly retained Network, Line, and Stop history through bounded date ranges, while keeping the present snapshots and present-day pages byte- and behavior-compatible when no range is requested.

**Architecture:** Keep the existing singleton historic payloads as the compatibility/default lane. Add content-addressed calendar-month partitions, one Network collection index, per-entity Line/Stop collection indexes behind family entity directories, and the already-approved global `historic/history/index.json` discovery root. Each partition carries additive daily ingredients where exact range pooling is possible; daily-only and current-only metrics are explicitly classified instead of being approximated. The publisher works in bounded partition/entity batches and retains only compact refs between stages, so two years of Stop/Line history never becomes one in-memory monolith. Stable pointer objects carry expected collection-generation IDs; clients validate every root -> directory -> entity-index edge and fail closed/retry during a transient publish mismatch. The web resolves a range through the shared history selector, fetches only intersecting partitions with the existing bounded/cancellable loader, and overlays exact retained-history view models into the existing Network/Line/Stop surfaces. A thin shared range-resource coordinator owns cancellation, stale-response protection, fallback, and loading/error state; each family supplies its own path validation, partition parsing, merge, and presentation mapping.

**Tech Stack:** Python 3.12, SQLAlchemy 2, Pydantic 2, pytest, Cloudflare R2/S3 storage, SvelteKit 5, TypeScript, Zod, Vitest, Testing Library, existing Transit/yesid surface primitives and URL codec.

## Global Constraints

- Work only in `/home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history` on `slice/p5r-partitioned-history`; never edit the saved-project root checkout.
- The approved Option 2 design is locked. Do not reopen the design discussion.
- Follow strict RED -> GREEN. Run the named RED test first and record the expected failure before implementation.
- Preserve the current compatibility keys and contracts:
  - `historic/network_trend.json`
  - `historic/route_reliability/{raw-route-id}.json`
  - `historic/route_reliability/index.json`
  - `historic/stop_reliability/{raw-stop-id}.json`
- Preserve default behavior: with no complete `?from=YYYY-MM-DD&to=YYYY-MM-DD`, the web reads only the current singleton and does not fetch retained partitions.
- Preserve `?grain`, `?tab`, and unrelated query parameters. Canonicalize only invalid/out-of-coverage `from`/`to`; never propagate history queries into route/stop navigation links.
- Keep one existing `SurfaceRail` per page. Seat `HistoryNavigator` inside it; do not add a second pill, sheet, drawer, or control-level horizontal scroller.
- Keep current/live and static identity sections current. Historical labels may apply only to metrics actually supplied by selected retained partitions.
- Fetch only intersecting monthly partitions. Reuse the existing bounded concurrency of four, AbortSignal cancellation, stable deduplication, and stale-response suppression.
- Do not pool rounded percentages or percentiles. Exact arbitrary-range metrics must derive from additive numerators/denominators. Non-additive percentiles/vehicle counts are daily-only. Auxiliary metrics without retained additive sources remain current-only and are labelled as such.
- No fabricated calendar rows. A real zero numerator with a positive/known denominator is zero; an absent denominator or absent day is no data. Gaps remain gaps and are never interpolated or zero-filled.
- Treat a missing advertised partition, digest mismatch, entity mismatch, month mismatch, unsafe path, malformed payload, or duplicate conflict as an error for the requested range. Optional discovery-index 404s fall back to current-only default behavior; they do not erase valid current snapshots.
- Publish immutable partitions first, then entity collection indexes, then Line/Stop entity directories, then the global availability root last. The new root must also advertise the already-published Alerts and Receipts indexes at their existing paths; a reader must never discover an unpublished child.
- Content-addressed partition bytes must be stable across republish runs. Do not inject run-specific publish-generation stamps into them, and do not PUT an already-existing immutable key again.
- Keep the current route singleton under `ROUTE_RELIABILITY_BYTE_CEILING`; retained data lives in separate partition files.
- Do not attach today's static schedule/headway metadata to old months. The Stop 7x24 habits heatmap has no retained hourly source and remains current-only.
- Real-DB tests may skip only when their documented DB environment is unavailable. Unit/contract/publisher tests must not skip.
- No browser QA, deployment, workflow dispatch, push, PR, or merge in this task. Those remain convergence work after automated verification and review.

## Locked Publication Contract

| Family | Stable discovery object | Immutable monthly object |
| --- | --- | --- |
| Network | `historic/history/network/index.json` | `historic/history/network/generations/{sha256}/{YYYY-MM}.json` |
| Lines | `historic/history/lines/index.json` -> `historic/history/lines/{encoded-id}/index.json` | `historic/history/lines/{encoded-id}/generations/{sha256}/{YYYY-MM}.json` |
| Stops | `historic/history/stops/index.json` -> `historic/history/stops/{encoded-id}/index.json` | `historic/history/stops/{encoded-id}/generations/{sha256}/{YYYY-MM}.json` |
| Global | `historic/history/index.json` | n/a |

`encoded-id` is the lowercase hexadecimal representation of the entity ID's UTF-8 bytes. It is bijective and safe for slashes, percent signs, query/fragment characters, spaces, Unicode, and dot-segment strings. Directory entries always carry the original `entity_id`; public URLs and existing compatibility paths continue to use their current raw-ID behavior.

Metric aggregation classes are:

- `additive`: exact arbitrary-range pooling from served counts/sums.
- `daily_only`: exact values at their source day, but no fabricated week/month/range percentile.
- `current_only`: intentionally absent from retained partitions and visibly scoped to the current snapshot.

The shared metric tokens and Phase 2 classifications are locked:

| Token | Network | Lines | Stops |
| --- | --- | --- | --- |
| `delay` | additive | additive | additive severe-delay proxy |
| `delay_percentiles` | daily_only | daily_only | daily_only |
| `vehicles` | daily_only | n/a | n/a |
| `cancellation` | additive | additive | n/a |
| `occupancy` | additive | additive | additive |
| `service_span` | n/a | daily_only, filtered as exact daily rows | n/a |
| `skipped_stops` | n/a | additive | n/a |

Current-only section tokens remain outside retained partitions. In particular, headway, habits, weak stops, shift/day-type breakdowns, by-route Stop associations, and Stop hour heatmaps are not silently classified as retained. `HistoryMetricName` is the shared Python/TypeScript enum for the table above; adding a later family metric is an explicit contract change, not an ad hoc string.

Collection-level coverage is the union of days with at least one real retained metric. Per-metric coverage is independent and carries its own first/last dates and conservative gaps. A range may therefore be partially covered without claiming every metric exists throughout it.

## File Structure

### Database

- Modify `apps/db/src/transit_ops/snapshots/contract.py`: additive history contracts, metric coverage, entity directories, monthly partitions, and top-level model registration.
- Modify `apps/db/src/transit_ops/snapshots/contract.py`'s `TOP_LEVEL_MODELS`/`export_schemas()` registry and run `apps/db/scripts/export_snapshot_schemas.py`: export every new top-level contract.
- Create `apps/db/src/transit_ops/snapshots/builders/historic/history_common.py`: entity encoding, local-month windows, coverage/gap helpers, collection generation IDs, and shared SQL row guards.
- Create `apps/db/src/transit_ops/snapshots/serialization.py`: the one compact JSON byte/digest authority shared by builders, gates, and storage.
- Create `apps/db/src/transit_ops/snapshots/builders/historic/network_history.py`: retained Network daily partition builder.
- Create `apps/db/src/transit_ops/snapshots/builders/historic/line_history.py`: retained per-Line daily partition builder.
- Create `apps/db/src/transit_ops/snapshots/builders/historic/stop_history.py`: retained per-Stop daily partition builder.
- Modify `apps/db/src/transit_ops/snapshots/builders/historic/__init__.py` and `apps/db/src/transit_ops/snapshots/builders/__init__.py`: export retained-history builders.
- Modify `apps/db/src/transit_ops/snapshots/storage.py`: immutable-if-absent support with local and R2 existence probes, plus hash-gated accounting.
- Modify `apps/db/src/transit_ops/snapshots/publish.py`: staged partition/index/root publication and content-addressed stamp exemption.
- Modify `apps/db/src/transit_ops/snapshots/gate.py`: retained partition/index/directory/root coherence checks.
- Add `apps/db/tests/test_partitioned_history_contract.py`.
- Add `apps/db/tests/test_partitioned_history_builders.py`.
- Add `apps/db/tests/test_partitioned_history_publish.py`.
- Add `apps/db/tests/test_partitioned_history_real_db.py`.
- Modify existing schema/storage/publisher/gate regression tests named in the tasks below.

### Web

- Modify `apps/web/src/lib/v1/schemas/history.ts` and `apps/web/src/lib/v1/schemas/index.ts`: Zod mirrors and exports.
- Regenerate `apps/web/src/lib/v1/schemas/json/*.schema.json` from the database contracts; never hand-edit generated JSON.
- Add `apps/web/src/lib/v1/history/entity.ts`: matching lowercase UTF-8 hex encoder and exact family path constructors/validators.
- Add `apps/web/src/lib/v1/history/families.ts`: pure partition selection, identity/month validation, deterministic dedupe, exact range pooling, and current-shape overlays.
- Add `apps/web/src/lib/v1/history/rangeResource.svelte.ts`: shared controlled range-resource coordinator.
- Modify `apps/web/src/lib/v1/adapter/types.ts` and `apps/web/src/lib/v1/adapter/r2.ts`: typed discovery/index/partition fetches with family-specific path allowlists.
- Modify `apps/web/src/lib/v1/repositories/historic.ts`: family/entity discovery and bounded intersecting-partition loaders.
- Modify `apps/web/src/lib/features/network/reliability/sections/NetworkSurface.svelte`, `apps/web/src/lib/features/network/reliability/network-reliability.copy.ts`, and tests.
- Modify `apps/web/src/lib/features/lines/RouteDetail.svelte`, `apps/web/src/lib/features/lines/reliability/RouteReliabilityClusters.svelte`, `apps/web/src/lib/features/lines/lines.copy.ts`, `apps/web/src/lib/features/lines/reliability/reliability.copy.ts`, and tests.
- Modify `apps/web/src/lib/features/stops/StopDetail.svelte`, `apps/web/src/lib/features/stops/reliability/sections/StopReliabilitySurface.svelte`, `apps/web/src/lib/features/stops/stops.copy.ts`, `apps/web/src/lib/features/stops/reliability/stops-reliability.copy.ts`, and tests.

---

### Task 1: Define retained-history contracts and safe entity identity

**Files:**
- Create: `apps/db/tests/test_partitioned_history_contract.py`
- Modify: `apps/db/tests/test_snapshots_contract.py`
- Modify: `apps/db/tests/test_snapshots_schema_export.py`
- Modify: `apps/db/src/transit_ops/snapshots/contract.py`
- Modify: `apps/db/src/transit_ops/snapshots/contract.py` (`TOP_LEVEL_MODELS`, `PAYLOAD_METHODOLOGY`, and `export_schemas()`)
- Run: `apps/db/scripts/export_snapshot_schemas.py`
- Create: `apps/db/src/transit_ops/snapshots/builders/historic/history_common.py`
- Create: `apps/web/src/lib/v1/history/entity.test.ts`
- Create: `apps/web/src/lib/v1/history/entity.ts`
- Modify: `apps/web/src/lib/v1/schemas/history.test.ts`
- Modify: `apps/web/src/lib/v1/schemas/history.ts`
- Modify: `apps/web/src/lib/v1/schemas/receipts_index.ts`
- Modify: `apps/web/src/lib/v1/schemas/receipts_regranulation.test.ts`
- Modify: `apps/web/src/lib/v1/schemas/index.ts`
- Modify: `apps/web/src/lib/v1/schemas/roundtrip.test.ts`
- Modify: `apps/web/src/lib/v1/schemas/zod-conformance.test.ts`

**Interfaces:**

```python
class HistoryMetricAggregation(str, Enum):
    additive = "additive"
    daily_only = "daily_only"
    current_only = "current_only"

class HistoryMetricName(str, Enum):
    delay = "delay"
    delay_percentiles = "delay_percentiles"
    vehicles = "vehicles"
    cancellation = "cancellation"
    occupancy = "occupancy"
    service_span = "service_span"
    skipped_stops = "skipped_stops"

class HistoricMetricCoverage(BaseModel):
    metric: HistoryMetricName
    aggregation: HistoryMetricAggregation
    first_available_date: str | None = None
    last_available_date: str | None = None
    gaps: list[HistoricCoverageGap] = Field(default_factory=list)

class HistoricEntityIndexRef(BaseModel):
    entity_id: str
    encoded_id: str
    index_path: str
    collection_generation_id: str
    first_available_date: str | None = None
    last_available_date: str | None = None

class HistoricEntityDirectoryIndex(PayloadEnvelope):
    generated_utc: str
    family: Literal["lines", "stops"]
    selection_mode: Literal[HistorySelectionMode.range]
    collection_generation_id: str
    first_available_date: str | None = None
    last_available_date: str | None = None
    entities: list[HistoricEntityIndexRef] = Field(default_factory=list)

class HistoricDelayMetric(BaseModel):
    observation_count: int = Field(ge=1)
    in_clamp_observation_count: int | None = Field(default=None, ge=1)
    on_time_count: int | None = Field(default=None, ge=0)
    severe_count: int | None = Field(default=None, ge=0)
    sum_delay_seconds: int | None = None

class HistoricDelayPercentiles(BaseModel):
    observation_count: int = Field(ge=1)
    p50_delay_seconds: float | None = None
    p90_delay_seconds: float | None = None

class HistoricCancellationMetric(BaseModel):
    canceled_trip_days: int = Field(ge=0)
    total_trip_days: int = Field(ge=0)
    scheduled_trip_days: int | None = Field(default=None, ge=0)
    delivered_trip_days: int | None = Field(default=None, ge=0)
    silent_trip_days: int | None = Field(default=None, ge=0)

class HistoricOccupancyMetric(BaseModel):
    empty: int = Field(ge=0)
    many_seats: int = Field(ge=0)
    few_seats: int = Field(ge=0)
    standing: int = Field(ge=0)
    full: int = Field(ge=0)

class HistoricServiceSpanMetric(BaseModel):
    trip_count: int = Field(ge=1)
    first_trip_utc: str | None = None
    last_trip_utc: str | None = None
    first_trip_delay_seconds: int | None = None
    last_trip_delay_seconds: int | None = None

class HistoricSkippedStopMetric(BaseModel):
    skipped_stop_count: int = Field(ge=0)
    stop_time_update_count: int = Field(ge=1)

class NetworkHistoryDay(BaseModel):
    date: str
    delay: HistoricDelayMetric | None = None
    delay_percentiles: HistoricDelayPercentiles | None = None
    cancellation: HistoricCancellationMetric | None = None
    occupancy: HistoricOccupancyMetric | None = None
    vehicles: int | None = Field(default=None, ge=1)

class LineHistoryDay(BaseModel):
    date: str
    delay: HistoricDelayMetric | None = None
    delay_percentiles: HistoricDelayPercentiles | None = None
    cancellation: HistoricCancellationMetric | None = None
    occupancy: HistoricOccupancyMetric | None = None
    service_span: HistoricServiceSpanMetric | None = None
    skipped_stops: HistoricSkippedStopMetric | None = None

class StopHistoryDay(BaseModel):
    date: str
    delay: HistoricDelayMetric | None = None
    delay_percentiles: HistoricDelayPercentiles | None = None
    occupancy: HistoricOccupancyMetric | None = None

class NetworkHistoryPartition(PayloadEnvelope):
    generated_utc: str
    month: str
    days: list[NetworkHistoryDay] = Field(min_length=1)

class LineHistoryPartition(PayloadEnvelope):
    generated_utc: str
    month: str
    entity_id: str
    days: list[LineHistoryDay] = Field(min_length=1)

class StopHistoryPartition(PayloadEnvelope):
    generated_utc: str
    month: str
    entity_id: str
    days: list[StopHistoryDay] = Field(min_length=1)
```

Add `metrics: list[HistoricMetricCoverage] = Field(default_factory=list)` to both `HistoricCollectionIndex` and `HistoricFamilyAvailability`, plus `collection_generation_id: str | None = None` to `HistoricFamilyAvailability`. Add the same additive-optional `collection_generation_id` to `ReceiptsIndex`; the publisher hashes the sorted canonical semantic Receipt payloads with volatile envelope/run-stamp fields excluded, so a same-day republish that changes any real Receipt value cannot reuse the old collection generation while a stamp-only rewrite does not invent a new semantic collection. The global root pins the expected child generation; every Line/Stop directory entry pins the expected entity-index generation. Keep every new field optional/defaulted where it extends an existing model so Task 4/5 payloads remain valid.

Also add `byte_size: int | None = Field(default=None, ge=1)` to `HistoricPartitionRef`. New Network/Line/Stop refs always populate both `sha256` and positive `byte_size`; the fields stay optional so the already-shipped generic Task 4 contract remains backward-compatible.

- [ ] **Step 1: Write DB contract RED tests.** Prove every new model rejects impossible counts, invalid family/selection combinations, a day with every metric absent, an empty monthly partition, duplicate/out-of-order days, invalid `YYYY-MM`, a date outside its partition month, an empty percentile object, a zero vehicle count, `on_time_count > observation_count`, `severe_count > observation_count`, `in_clamp_observation_count > observation_count`, a delay sum without an in-clamp denominator, malformed SHA/non-positive byte size, unknown metric tokens, and missing generation pins on new directory edges. Cancellation permits `total_trip_days == 0` only when a positive scheduled denominator proves a real scheduled-only day; it rejects `canceled > total` and a metric with no positive denominator. Occupancy rejects an all-zero five-band object as no telemetry. Prove existing Task 4 minimal indexes and Receipts indexes still validate unchanged. Test `encode_history_entity_id`/`decode_history_entity_id` round-trips `"747"`, `"A/B"`, `"%2F"`, `"?x#y"`, `".."`, spaces, accents, and non-Latin Unicode; reject uppercase, odd-length, non-hex, and invalid UTF-8 encoded paths.
- [ ] **Step 2: Run DB RED.**

```bash
cd /home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history/apps/db
uv run pytest tests/test_partitioned_history_contract.py tests/test_snapshots_contract.py -q -k 'partitioned or historic_history or entity_id'
```

Expected: import/collection failures because the new contracts and identity helpers do not exist.

- [ ] **Step 3: Implement the minimal Pydantic models and validators.** Use model validators for relational invariants, sorted unique dates, and month membership. Register every top-level partition/directory model in `TOP_LEVEL_MODELS` and `PAYLOAD_METHODOLOGY`; keep existing model names and defaults intact.
- [ ] **Step 4: Write matching web RED tests.** Mirror the contracts in Zod and prove the TypeScript encoder emits exactly the Python test vectors. Prove Zod rejects the same relational/month/entity errors, preserves SHA/byte-size/generation pins including `ReceiptsIndex.collection_generation_id`, and accepts old minimal availability/index fixtures.
- [ ] **Step 5: Run web RED.**

```bash
cd /home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history
bun run --cwd apps/web test -- src/lib/v1/history/entity.test.ts src/lib/v1/schemas/history.test.ts src/lib/v1/schemas/receipts_regranulation.test.ts src/lib/v1/schemas/roundtrip.test.ts src/lib/v1/schemas/zod-conformance.test.ts
```

Expected: missing exports/modules and failed schema fixtures.

- [ ] **Step 6: Implement the Zod mirrors, regenerate JSON schemas, copy the complete generated schema set into the web mirror, and run GREEN.** Do not hand-edit generated JSON.

```bash
cd /home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history/apps/db
uv run python scripts/export_snapshot_schemas.py
cp src/transit_ops/snapshots/schemas/*.schema.json ../web/src/lib/v1/schemas/json/
uv run pytest tests/test_partitioned_history_contract.py tests/test_snapshots_contract.py tests/test_snapshots_schema_export.py tests/test_v1_contract_web_mirror_sync.py -q
uv run ruff check src/transit_ops/snapshots/contract.py src/transit_ops/snapshots/builders/historic/history_common.py tests/test_partitioned_history_contract.py
cd ../..
bun run --cwd apps/web test -- src/lib/v1/history/entity.test.ts src/lib/v1/schemas/history.test.ts src/lib/v1/schemas/receipts_regranulation.test.ts src/lib/v1/schemas/roundtrip.test.ts src/lib/v1/schemas/zod-conformance.test.ts
```

- [ ] **Step 7: Commit.**

```bash
git add apps/db/src/transit_ops/snapshots/contract.py \
  apps/db/src/transit_ops/snapshots/builders/historic/history_common.py \
  apps/db/src/transit_ops/snapshots/schemas \
  apps/db/tests/test_partitioned_history_contract.py \
  apps/db/tests/test_snapshots_contract.py apps/db/tests/test_snapshots_schema_export.py \
  apps/web/src/lib/v1/schemas apps/web/src/lib/v1/history/entity.ts \
  apps/web/src/lib/v1/history/entity.test.ts
git commit -m "feat(history): define partitioned family contracts"
```

### Task 2: Add stable immutable publication primitives

**Files:**
- Modify: `apps/db/tests/test_snapshots_storage.py`
- Modify: `apps/db/tests/test_snapshots_publish_parallel.py`
- Modify: `apps/db/tests/test_alert_archive_publication.py`
- Modify: `apps/db/src/transit_ops/snapshots/storage.py`
- Create: `apps/db/src/transit_ops/snapshots/serialization.py`
- Modify: `apps/db/src/transit_ops/snapshots/publish.py`
- Modify: `apps/db/src/transit_ops/snapshots/builders/historic/history_common.py`

**Interfaces:**

```python
snapshot_json_bytes(payload: BaseModel | dict) -> bytes
snapshot_sha256(payload: BaseModel | dict) -> str
SnapshotStorage.immutable_exists(rel_key: str) -> bool
SnapshotStorage.put_immutable_json(rel_key: str, payload: BaseModel | dict) -> str
HashGatedStorage.put_immutable_json(rel_key: str, payload: BaseModel | dict) -> str
```

`serialization.py` owns the exact compact UTF-8 bytes used for hashing, gate evidence, byte-size refs, and storage writes. Replace storage's private serializer with this shared function; no builder may duplicate JSON options or import a private storage helper. `put_immutable_json` validates that an existing object's bytes match the requested canonical bytes; it skips the PUT only on an exact match and fails closed on a key collision. New R2 objects carry their SHA-256 as object metadata so a later `head_object` can prove equality without downloading the body; an older object without that metadata falls back to one exact `get_object` comparison. Local storage compares file bytes. `HashGatedStorage` tracks normal mutable skips in `skipped`, new immutable writes in `immutable_written`, and exact-existing immutable objects in a separate `immutable_skipped` list. Physical `files_total/files_skipped` include immutable outcomes; `stable_files_total` includes only mutable compatibility/index/directory/root objects, never content-addressed generations. Content-addressed partition model types join `AlertArchivePage` in `_stamp_envelope`'s exemption.

- [ ] **Step 1: Write RED serialization/storage tests.** Prove `snapshot_json_bytes` is byte-identical to the bytes passed to local/R2 storage and gate SHA evidence for both Pydantic models and sorted dicts. Cover new write, exact repeated write with no second PUT, existing different bytes raising a stable collision error, 404/non-404 R2 probe behavior, thread-safe duplicate concurrent attempts, separate `immutable_written`/`immutable_skipped`/mutable `skipped` accounting, physical totals that include immutable outcomes, stable totals that exclude every immutable generation, and unchanged ordinary `put_json` semantics. Add a publisher-stamp test proving every partition's canonical bytes/digest remain identical across two different run stamps.
- [ ] **Step 2: Run RED.**

```bash
cd /home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history/apps/db
uv run pytest tests/test_snapshots_storage.py tests/test_snapshots_publish_parallel.py tests/test_alert_archive_publication.py -q -k 'immutable or content_addressed or stamp'
```

Expected: repeated immutable writes still PUT and the partition stamp exemption is absent.

- [ ] **Step 3: Implement minimal immutable-if-absent storage and stamp exemption.** Preserve Alert archive behavior and error mapping. Lock the existence-check/write critical section per key so parallel duplicate submissions cannot double-PUT.
- [ ] **Step 4: Run GREEN and commit.**

```bash
cd /home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history/apps/db
uv run pytest tests/test_snapshots_storage.py tests/test_snapshots_publish_parallel.py tests/test_alert_archive_publication.py -q
uv run ruff check src/transit_ops/snapshots/serialization.py src/transit_ops/snapshots/storage.py src/transit_ops/snapshots/publish.py src/transit_ops/snapshots/builders/historic/history_common.py tests/test_snapshots_storage.py tests/test_snapshots_publish_parallel.py
cd ../..
git add apps/db/src/transit_ops/snapshots/serialization.py apps/db/src/transit_ops/snapshots/storage.py apps/db/src/transit_ops/snapshots/publish.py \
  apps/db/src/transit_ops/snapshots/builders/historic/history_common.py \
  apps/db/tests/test_snapshots_storage.py apps/db/tests/test_snapshots_publish_parallel.py \
  apps/db/tests/test_alert_archive_publication.py
git commit -m "feat(history): skip existing immutable partitions"
```

### Task 3: Build and publish Network monthly history

**Files:**
- Create: `apps/db/tests/test_partitioned_history_builders.py`
- Create: `apps/db/tests/test_partitioned_history_publish.py`
- Create: `apps/db/tests/test_partitioned_history_real_db.py`
- Create: `apps/db/src/transit_ops/snapshots/builders/historic/network_history.py`
- Modify: `apps/db/src/transit_ops/snapshots/builders/historic/__init__.py`
- Modify: `apps/db/src/transit_ops/snapshots/builders/__init__.py`
- Modify: `apps/db/src/transit_ops/snapshots/publish.py`
- Modify: `apps/db/src/transit_ops/snapshots/gate.py`
- Modify: `apps/db/tests/test_snapshots_gate.py`

**Source and metric rules:**

- Delay uses `gold.route_delay_spine`, grouped by provider-local closed date across all routes: `SUM(delay_observation_count)`, `SUM(on_time_observation_count)`, `SUM(severe_delay_count)`, `SUM(sum_delay_seconds)`, and the exact in-clamp denominator `SUM(the 21 delay_histogram bins)`. OTP divides by `observation_count`; average delay divides by `in_clamp_observation_count`. Emit no delay metric when observation count is zero, and never substitute one denominator for the other.
- Cancellation uses the existing route-cancellation daily source and keeps RT-observed and scheduled-universe counts separate.
- Occupancy sums the five existing daily band counts.
- When an exact recent raw p90 or vehicle-count source row exists, the builder must emit it as `daily_only`; never pool it into a range scalar. Absence outside the real raw-fact window remains honest absence.
- Partition `generated_utc` is the maximum contributing source build timestamp (normalized UTC), not the current publish run.

- [ ] **Step 1: Write pure-builder RED tests.** Feed shuffled/duplicate fake rows spanning two months and assert one sorted partition per month, exact additive totals, distinct OTP and in-clamp denominators, average delay from `sum_delay_seconds / in_clamp_observation_count`, exact source-backed daily p90/vehicle values emitted inside their real window and absent outside it, stable bytes/digests regardless of row order, no zero-observation day, real zero numerators retained, scheduled-only cancellation days retained, all-zero occupancy omitted, per-metric coverage independent from family coverage, conservative gaps, and no percentile/vehicle pooling.
- [ ] **Step 2: Write publication/gate RED tests.** Assert stage order `partitions -> network index`, exact SHA/path/count/coverage checks, root not yet advertised, immutable skips on an unchanged second publish, and gate failures for wrong month, digest, count, coverage, generation/path, duplicate date, or metric range.
- [ ] **Step 3: Run RED.**

```bash
cd /home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history/apps/db
uv run pytest tests/test_partitioned_history_builders.py tests/test_partitioned_history_publish.py tests/test_snapshots_gate.py -q -k 'network_history'
```

Expected: missing Network retained builder/publisher/gate registration.

- [ ] **Step 4: Implement minimal Network builder and staged publication.** Reuse current SQL lineage but query the full available retained spine, never the compatibility payload's current cap. Build/gate/upload one bounded calendar-month batch at a time and retain only refs; publish the Network collection index only after all referenced partitions succeed.
- [ ] **Step 5: Add real-DB equivalence RED/GREEN.** Against the documented test DB, compare a cross-month partition sum to direct SQL for delay/cancellation/occupancy and assert the current singleton remains unchanged. If the DB fixture is unavailable, skip with its existing explicit environment reason.
- [ ] **Step 6: Run GREEN and commit.**

```bash
cd /home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history/apps/db
uv run pytest tests/test_partitioned_history_builders.py tests/test_partitioned_history_publish.py tests/test_partitioned_history_real_db.py tests/test_snapshots_gate.py -q -k 'network_history'
uv run ruff check src/transit_ops/snapshots/builders/historic/network_history.py src/transit_ops/snapshots/publish.py src/transit_ops/snapshots/gate.py tests/test_partitioned_history_builders.py tests/test_partitioned_history_publish.py tests/test_partitioned_history_real_db.py
cd ../..
git add apps/db/src/transit_ops/snapshots/builders apps/db/src/transit_ops/snapshots/publish.py \
  apps/db/src/transit_ops/snapshots/gate.py apps/db/tests/test_partitioned_history_builders.py \
  apps/db/tests/test_partitioned_history_publish.py apps/db/tests/test_partitioned_history_real_db.py \
  apps/db/tests/test_snapshots_gate.py
git commit -m "feat(history): publish network month partitions"
```

### Task 4: Build and publish per-Line monthly history

**Files:**
- Modify: `apps/db/tests/test_partitioned_history_builders.py`
- Modify: `apps/db/tests/test_partitioned_history_publish.py`
- Modify: `apps/db/tests/test_partitioned_history_real_db.py`
- Create: `apps/db/src/transit_ops/snapshots/builders/historic/line_history.py`
- Modify: `apps/db/src/transit_ops/snapshots/builders/historic/__init__.py`
- Modify: `apps/db/src/transit_ops/snapshots/builders/__init__.py`
- Modify: `apps/db/src/transit_ops/snapshots/publish.py`
- Modify: `apps/db/src/transit_ops/snapshots/gate.py`

**Source and metric rules:**

- Delay uses per-route daily additive spine counts/sums plus the exact histogram-bin in-clamp denominator; do not derive on-time counts from rounded OTP or divide the delay sum by the OTP denominator.
- Cancellation, occupancy, service-span, and skipped-stop metrics use their existing daily Gold sources and their real denominators.
- Every exact per-day p50/p90 source row must be carried as `daily_only`. Percentiles remain null in pooled range summaries.
- Headway, habits, weak stops, delay-by-crowding, shift/day-type breakdowns, and static route identity remain `current_only` until a retained additive source exists for the exact UI metric.

- [ ] **Step 1: Extend builder RED tests.** Prove entity isolation for IDs that share prefixes, safe encoding vectors, two entities across two months, exact counts/sums, every source-backed daily p50/p90 value emitted but never pooled, sparse ramp-in metrics, no present-day static schedule attached to old days, and stable output independent of row order.
- [ ] **Step 2: Extend publisher/gate RED tests.** Prove immutable partitions publish before each entity index, entity indexes before the Lines directory, directory entries carry raw and encoded IDs, empty entities are omitted, duplicate raw/encoded IDs fail, and wrong-entity partition refs fail before upload.
- [ ] **Step 3: Run RED.**

```bash
cd /home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history/apps/db
uv run pytest tests/test_partitioned_history_builders.py tests/test_partitioned_history_publish.py tests/test_snapshots_gate.py -q -k 'line_history'
```

- [ ] **Step 4: Implement minimal Line builder, collection indexes, directory, and gates.** Use batched SQL grouped by entity/date/month, then build/gate/upload bounded entity-month batches; never call the current per-route singleton builder once per month. Retain only refs between stages. Keep current raw-ID compatibility files untouched and route singleton size tests unchanged.
- [ ] **Step 5: Add real-DB direct-SQL checks for one route crossing a month boundary and one route with partial auxiliary coverage.** Assert the entity directory advertises only real entity indexes and current singleton bytes/ceiling stay valid.
- [ ] **Step 6: Run GREEN and commit.**

```bash
cd /home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history/apps/db
uv run pytest tests/test_partitioned_history_builders.py tests/test_partitioned_history_publish.py tests/test_partitioned_history_real_db.py tests/test_snapshots_gate.py tests/test_snapshots_historic.py -q -k 'line_history or route_reliability_byte'
uv run ruff check src/transit_ops/snapshots/builders/historic/line_history.py src/transit_ops/snapshots/publish.py src/transit_ops/snapshots/gate.py tests/test_partitioned_history_builders.py tests/test_partitioned_history_publish.py
cd ../..
git add apps/db/src/transit_ops/snapshots/builders/historic/line_history.py \
  apps/db/src/transit_ops/snapshots/builders/historic/__init__.py apps/db/src/transit_ops/snapshots/builders/__init__.py \
  apps/db/src/transit_ops/snapshots/publish.py apps/db/src/transit_ops/snapshots/gate.py \
  apps/db/tests/test_partitioned_history_builders.py apps/db/tests/test_partitioned_history_publish.py \
  apps/db/tests/test_partitioned_history_real_db.py
git commit -m "feat(history): publish per-line month partitions"
```

### Task 5: Build Stops and publish the complete pointer-last discovery graph

**Files:**
- Modify: `apps/db/tests/test_partitioned_history_builders.py`
- Modify: `apps/db/tests/test_partitioned_history_publish.py`
- Modify: `apps/db/tests/test_partitioned_history_real_db.py`
- Create: `apps/db/src/transit_ops/snapshots/builders/historic/stop_history.py`
- Modify: `apps/db/src/transit_ops/snapshots/builders/historic/__init__.py`
- Modify: `apps/db/src/transit_ops/snapshots/builders/__init__.py`
- Modify: `apps/db/src/transit_ops/snapshots/publish.py`
- Modify: `apps/db/src/transit_ops/snapshots/gate.py`
- Modify: `apps/db/tests/test_snapshots_publish.py`
- Modify: `apps/db/tests/test_snapshots_publish_parallel.py`

**Source and metric rules:**

- Stop delay uses `gold.stop_delay_spine`: `observation_count`, `severe_delay_count`, and `sum_delay_seconds`. At Stop scope, `observation_count` is already the in-clamp denominator; publish `in_clamp_observation_count == observation_count` so the shared reducer has one explicit field without inventing a second population. Stop reliability remains the severe-delay proxy, never route-style OTP.
- Exact daily Stop p50/p90 values use `gold.stop_delay_percentile_daily` and stay `delay_percentiles: daily_only`; they are never pooled into a selected-range percentile.
- Stop occupancy uses the existing additive five-band daily source.
- Stop habits/hour heatmap, weekday/shift/day-type/by-route associations, and static stop identity remain current-only.

- [ ] **Step 1: Extend Stop RED tests.** Prove exact delay/occupancy sums, `in_clamp_observation_count == observation_count` from the Stop spine (no invented second denominator), every source-backed daily p50/p90 value emitted but never pooled, real zero severe counts, zero-observation omission, all-zero occupancy omission, sparse dates, encoded identity, per-metric partial coverage, no heatmap/history fabrication, and entity isolation across awkward Unicode/slash IDs.
- [ ] **Step 2: Extend full graph RED tests.** First prove two same-stamp Receipt sets that differ by one semantic payload value produce different `ReceiptsIndex.collection_generation_id` values, unchanged semantic Receipt content produces the same value regardless of mapping order, and changing only volatile envelope/run stamps does not change the semantic collection ID. Then assert exact publication order:

```text
all Network/Line/Stop immutable partitions
-> Network and per-entity Line/Stop collection indexes
-> Lines and Stops entity directories
-> historic/history/index.json containing Alerts, Receipts, Network, Lines, and Stops
```

The global root must advertise `alerts`, `receipts`, `network`, `lines`, and `stops` with real coverage and exact child paths. Its Alerts/Receipts entries are derived from the already-built `AlertArchiveIndex` and `ReceiptsIndex`, never from hard-coded retention settings. `ReceiptsIndex.collection_generation_id` must change when any exact Receipt payload changes even if the publish day/stamp does not. Network/Lines/Stops also advertise their real per-metric coverage. Inject failure at each stage and prove no later pointer is written. Prove a second unchanged run records immutable partition skips separately but rewrites mutable indexes/root. Prove physical totals include all immutable outcomes, while `snapshot_publish_state.stable_files_total` excludes every `*/generations/*` object and includes only compatibility payloads plus mutable indexes/directories/root.

- [ ] **Step 3: Run RED.**

```bash
cd /home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history/apps/db
uv run pytest tests/test_partitioned_history_builders.py tests/test_partitioned_history_publish.py tests/test_snapshots_publish.py tests/test_snapshots_publish_parallel.py tests/test_snapshots_gate.py -q -k 'stop_history or history_root or pointer_last'
```

- [ ] **Step 4: Implement Stop builder, directories, root, gates, and publisher accounting.** Build, gate, and upload immutable partitions in bounded month/entity batches; retain only compact refs. Build/publish per-entity indexes after all of that entity's children succeed, then directories after all referenced entity indexes succeed, then the global root last. Use stable sorting by raw entity ID and family name. Pin every mutable parent to its child's collection generation so an old-root/new-child race fails closed instead of mixing generations.
- [ ] **Step 5: Add real-DB equivalence for one Stop across two months and root coverage reconciliation.**
- [ ] **Step 6: Run GREEN and commit.**

```bash
cd /home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history/apps/db
uv run pytest tests/test_partitioned_history_builders.py tests/test_partitioned_history_publish.py tests/test_partitioned_history_real_db.py tests/test_snapshots_publish.py tests/test_snapshots_publish_parallel.py tests/test_snapshots_gate.py -q
uv run ruff check src/transit_ops/snapshots/builders/historic/stop_history.py src/transit_ops/snapshots/publish.py src/transit_ops/snapshots/gate.py tests/test_partitioned_history_builders.py tests/test_partitioned_history_publish.py tests/test_partitioned_history_real_db.py
cd ../..
git add apps/db/src/transit_ops/snapshots/builders/historic/stop_history.py \
  apps/db/src/transit_ops/snapshots/builders/historic/__init__.py apps/db/src/transit_ops/snapshots/builders/__init__.py \
  apps/db/src/transit_ops/snapshots/publish.py apps/db/src/transit_ops/snapshots/gate.py \
  apps/db/tests/test_partitioned_history_builders.py apps/db/tests/test_partitioned_history_publish.py \
  apps/db/tests/test_partitioned_history_real_db.py apps/db/tests/test_snapshots_publish.py \
  apps/db/tests/test_snapshots_publish_parallel.py
git commit -m "feat(history): publish retained family discovery"
```

### Task 6: Add web discovery, safe partition loading, and exact family reducers

**Files:**
- Create: `apps/web/src/lib/v1/history/families.test.ts`
- Create: `apps/web/src/lib/v1/history/families.ts`
- Modify: `apps/web/src/lib/v1/history/partitions.test.ts`
- Modify: `apps/web/src/lib/v1/history/partitions.ts`
- Modify: `apps/web/src/lib/v1/http.test.ts`
- Modify: `apps/web/src/lib/v1/http.ts`
- Modify: `apps/web/src/lib/v1/adapter/types.ts`
- Modify: `apps/web/src/lib/v1/adapter/r2.history.test.ts`
- Modify: `apps/web/src/lib/v1/adapter/r2.ts`
- Modify: `apps/web/src/lib/v1/repositories/historic.history.test.ts`
- Modify: `apps/web/src/lib/v1/repositories/historic.ts`

**Interfaces:**

```ts
type HistoryFamily = 'network' | 'lines' | 'stops';

getNetworkHistoryIndex(ctx?: AdapterCtx): Promise<HistoricCollectionIndex | null>;
getLineHistoryDirectory(ctx?: AdapterCtx): Promise<HistoricEntityDirectoryIndex | null>;
getStopHistoryDirectory(ctx?: AdapterCtx): Promise<HistoricEntityDirectoryIndex | null>;
getLineHistoryIndex(entityId: string, ctx?: AdapterCtx): Promise<HistoricCollectionIndex | null>;
getStopHistoryIndex(entityId: string, ctx?: AdapterCtx): Promise<HistoricCollectionIndex | null>;

loadNetworkHistoryRange(index, window, ctx?): Promise<NetworkHistoryPartition[]>;
loadLineHistoryRange(entityId, index, window, ctx?): Promise<LineHistoryPartition[]>;
loadStopHistoryRange(entityId, index, window, ctx?): Promise<StopHistoryPartition[]>;

mergeNetworkHistory(partitions, window): NetworkHistoryRange;
mergeLineHistory(entityId, partitions, window): LineHistoryRange;
mergeStopHistory(entityId, partitions, window): StopHistoryRange;

interface RawJsonEntity<T> {
  readonly value: T;
  readonly bytes: Uint8Array;
}

getEntityJsonWithBytes<T>(url, schema, label, fetchFn?, init?): Promise<RawJsonEntity<T> | undefined>;
sha256Hex(bytes: Uint8Array): Promise<string>;
```

`getEntityJsonWithBytes` reads `arrayBuffer()` once, preserves the exact response bytes, parses JSON from those bytes, and validates through the same `parsePort`/404/error semantics as `getEntityJson`; refactor shared HTTP response handling rather than implementing a second inconsistent transport. Partition adapter methods return the parsed value plus exact bytes so repositories can verify advertised `byte_size` and SHA-256 before merging.

Do not weaken the Alert archive validator. Add exact family validators that accept only the locked paths, lowercase 64-character SHA, exact byte size, exact encoded ID, matching advertised coverage/month, no query/fragment/backslash/dot segment, matching parsed payload identity, and matching root/directory/index collection-generation pins. On a generation mismatch, refetch the immediate parent once with cache busting; if it still disagrees, return a typed transient-publication error rather than mixing generations. Reuse the existing `loadHistoryPartitions` helper rather than duplicating concurrency/cancellation logic.

- [ ] **Step 1: Write HTTP/adapter/repository RED tests.** In `http.test.ts`, prove the raw-body helper consumes the response once, returns byte-identical UTF-8 bytes, preserves 404/abort/cache/labelled-parse behavior, and computes the known SHA-256 vector. Then cover optional root/index 404 fallback, exact root/directory/entity lookups, awkward IDs, cross-month selection, only-intersecting fetches, bounded concurrency <= 4, AbortSignal propagation, request cancellation, stale completion ignored by caller, missing advertised child failure, unsafe ref rejection before fetch, mandatory raw-byte SHA/byte-size verification, family/entity/month mismatch, duplicate refs, deterministic partition order, one cache-busted parent refetch on generation mismatch, and fail-closed behavior if the mismatch remains.
- [ ] **Step 2: Write reducer RED tests.** Cross two months and assert exact pooled OTP/severe/average/cancellation/completeness/occupancy/skipped-stop results from counts/sums, while `service_span` remains exact daily rows filtered to the requested range and is never summed or averaged. Explicitly prove average delay divides pooled `sum_delay_seconds` by pooled `in_clamp_observation_count`, not `observation_count`; scheduled-only cancellation remains real while a denominator-free row is absent; and all-zero occupancy never becomes a fabricated mix. Assert daily percentile values remain daily-only, current-only fields are absent, sparse missing days remain absent, real zero numerators survive, missing metric coverage returns no-data/partial rather than zero, and duplicate day conflicts fail instead of last-write-wins.
- [ ] **Step 3: Run RED.**

```bash
bun run --cwd apps/web test -- src/lib/v1/http.test.ts src/lib/v1/history/families.test.ts src/lib/v1/history/partitions.test.ts src/lib/v1/adapter/r2.history.test.ts src/lib/v1/repositories/historic.history.test.ts
```

Expected: missing family adapter/repository/reducer interfaces.

- [ ] **Step 4: Implement the minimal typed loaders and pure reducers.** Return view models that distinguish `complete`, `partial`, `no_data`, and `current_only`; do not silently fall back to current values after an explicit historical range request.
- [ ] **Step 5: Run GREEN and commit.**

```bash
bun run --cwd apps/web test -- src/lib/v1/http.test.ts src/lib/v1/history/entity.test.ts src/lib/v1/history/selection.test.ts src/lib/v1/history/partitions.test.ts src/lib/v1/history/families.test.ts src/lib/v1/adapter/r2.history.test.ts src/lib/v1/repositories/historic.history.test.ts
bun run --cwd apps/web check
git add apps/web/src/lib/v1/http.ts apps/web/src/lib/v1/http.test.ts apps/web/src/lib/v1/history apps/web/src/lib/v1/adapter apps/web/src/lib/v1/repositories/historic.ts apps/web/src/lib/v1/repositories/historic.history.test.ts
git commit -m "feat(web): load retained metric partitions"
```

### Task 7: Add the reusable range-resource coordinator

**Files:**
- Create: `apps/web/src/lib/v1/history/rangeResource.svelte.test.ts`
- Create: `apps/web/src/lib/v1/history/rangeResource.svelte.ts`
- Modify: `apps/web/src/lib/v1/index.ts`

**Interface:**

```ts
interface RawHistoryRangeRequest {
  readonly hasFrom: boolean;
  readonly hasTo: boolean;
  readonly rawFrom: string | null;
  readonly rawTo: string | null;
}

interface HistoryRangeLoadResult<TValue> {
  readonly value: TValue | null;
  readonly status: 'complete' | 'partial' | 'no_data';
}

interface HistoryRangeLoader<TIndex, TValue> {
  loadIndex(signal: AbortSignal): Promise<TIndex | null>;
  availability(index: TIndex): HistoryAvailability;
  defaultWindow(index: TIndex): DateWindow;
  load(
    resolved: ResolvedHistoryRange,
    index: TIndex,
    signal: AbortSignal,
  ): Promise<HistoryRangeLoadResult<TValue>>;
}

interface HistoryRangeResource<TIndex, TValue> {
  readonly request: RawHistoryRangeRequest;
  readonly index: TIndex | null;
  readonly resolved: ResolvedHistoryRange | null;
  readonly value: TValue | null;
  readonly state: 'idle' | 'loading-index' | 'current' | 'loading-range' | 'ready' | 'partial' | 'no-data' | 'error';
  readonly error: Error | null;
  setRequest(request: RawHistoryRangeRequest): void;
  retry(): void;
  destroy(): void;
}

interface HistoryRangeResourceOptions {
  readonly initialRequest: RawHistoryRangeRequest;
}

historyRangeRequestFromSearchParams(params: URLSearchParams): RawHistoryRangeRequest;
createHistoryRangeResource<TIndex, TValue>(
  loader: HistoryRangeLoader<TIndex, TValue>,
  options: HistoryRangeResourceOptions,
): HistoryRangeResource<TIndex, TValue>;
```

The generic coordinator knows no family path, schema, metric, or UI copy. It preserves raw `from`/`to` presence and values until the existing `resolveHistoryRange()` returns a `ResolvedHistoryRange`, so malformed and half-present deep links produce one stable correction instead of disappearing in the filter codec. It exposes the resolved canonical window, correction, and intersecting gaps to the UI. A request with neither key is the current compatibility state and must issue no partition request; an invalid explicit request corrects back to current without flashing or fetching fallback partition data. It delegates all family content/status to the loader and uses the existing `createResource` mechanics where possible.

- [ ] **Step 1: Write RED state-machine tests.** Prove default current/no partition request, index 404 current-only fallback, raw absent vs half-present vs malformed bounds remain distinguishable, half/malformed/out-of-coverage requests expose one stable `ResolvedHistoryRange.correction` and canonicalize to current without a partition fetch, initial valid deep-linked range loads without current-data flash, one request per resolved selection, abort on changed range/destroy, stale response ignored even if a fake ignores abort, retry after failure, canonical window/intersecting gaps exposed, loader `complete`/`partial`/`no_data` mapped without guessing, and an identical raw request is a no-op.
- [ ] **Step 2: Run RED.**

```bash
bun run --cwd apps/web test -- src/lib/v1/resource.svelte.test.ts src/lib/v1/history/rangeResource.svelte.test.ts
```

- [ ] **Step 3: Implement minimal coordinator; do not duplicate transport/path logic.**
- [ ] **Step 4: Run GREEN and commit.**

```bash
bun run --cwd apps/web test -- src/lib/v1/resource.svelte.test.ts src/lib/v1/history/rangeResource.svelte.test.ts
bun run --cwd apps/web check
git add apps/web/src/lib/v1/history/rangeResource.svelte.ts apps/web/src/lib/v1/history/rangeResource.svelte.test.ts apps/web/src/lib/v1/index.ts
git commit -m "feat(web): coordinate retained range loading"
```

### Task 8: Integrate retained ranges into Network

**Files:**
- Modify: `apps/web/src/lib/features/network/reliability/sections/NetworkSurface.svelte.test.ts`
- Modify: `apps/web/src/lib/features/network/reliability/sections/NetworkSurface.svelte`
- Modify: `apps/web/src/lib/features/network/reliability/network-reliability.copy.ts`

**Behavior:**

- Mount `HistoryNavigator` in the existing rail, sharing the same current `from/to` URL ownership and preserving `grain`/unrelated params.
- No range: render the current singleton exactly as today.
- Explicit range: keep the dated chart/content in loading state until retained partitions resolve; then render exact daily points for the selected range and derive week/month buckets only from additive ingredients.
- Network live status, `by_shift`, `by_daytype`, recent daily p90, and vehicle series remain explicitly current/daily-only where applicable.
- Partial metric coverage gets a localized visible note; no-data gets the standard honest absence treatment.

- [ ] **Step 1: Write component RED tests.** Prove default parity/no partition fetch, deep-linked cross-month range, navigator inside the one `SurfaceRail`, `grain/from/to` preservation/correction, loading without current-data flash, partial gaps, empty vs missing days, current-only labels, cancellation of a superseded range, no query propagation in links, and EN/FR copy.
- [ ] **Step 2: Run RED.**

```bash
bun run --cwd apps/web test -- src/lib/components/surface/HistoryNavigator.svelte.test.ts src/lib/components/surface/SurfaceRail.svelte.test.ts src/lib/filters/url.test.ts src/lib/features/network/reliability/sections/NetworkSurface.svelte.test.ts
```

- [ ] **Step 3: Implement minimal integration using the shared coordinator and existing surface primitives.**
- [ ] **Step 4: Run GREEN and commit.**

```bash
bun run --cwd apps/web test -- src/lib/components/surface/HistoryNavigator.svelte.test.ts src/lib/components/surface/SurfaceRail.svelte.test.ts src/lib/filters/url.test.ts src/lib/features/network/reliability/sections/NetworkSurface.svelte.test.ts
bun run --cwd apps/web check
git add apps/web/src/lib/features/network/reliability
git commit -m "feat(web): browse retained network history"
```

### Task 9: Integrate retained ranges into Line details

**Files:**
- Modify: `apps/web/src/lib/features/lines/LinesIndex.svelte.test.ts`
- Modify: `apps/web/src/lib/features/lines/RouteDetail.svelte.test.ts`
- Modify: `apps/web/src/lib/features/lines/RouteDetail.svelte`
- Modify: `apps/web/src/lib/features/lines/reliability/RouteReliabilityClusters.svelte.test.ts`
- Modify: `apps/web/src/lib/features/lines/reliability/RouteReliabilityClusters.urlseed.svelte.test.ts`
- Modify: `apps/web/src/lib/features/lines/reliability/RouteReliabilityClusters.svelte`
- Modify: `apps/web/src/lib/features/lines/lines.copy.ts`
- Modify: `apps/web/src/lib/features/lines/reliability/reliability.copy.ts`

**Behavior:**

- The Line listing stays current and performs no per-entity history fanout.
- The detail page loads the encoded entity index only for the current route.
- Exact selected-range values apply to dated punctuality, cancellation/completeness, occupancy when covered, service-span, and skipped-stop sections.
- Route identity/live header verdict, headway, habits, weak stops, shift/day-type/crowding association sections remain current-only and are labelled once at the section/scope level, not on every datum.
- Preserve the existing four-option grain/range control behavior and `tab` ownership. `HistoryNavigator` may replace the internal date picker only where it is the same single range owner; never mount two competing range inputs.

- [ ] **Step 1: Write RED tests.** In `LinesIndex.svelte.test.ts`, prove the listing stays current and performs no history-directory/per-entity fanout. In the detail tests, prove default current singleton parity, only current entity index/partitions fetched, cross-month exact pooling, entity/path isolation, `tab/grain/from/to` preservation, range-mode URL correction, partial auxiliary metrics, no current-data flash, current-only section labels, cancellation, no query propagation into Stop links, and EN/FR copy.
- [ ] **Step 2: Run RED.**

```bash
bun run --cwd apps/web test -- src/lib/features/lines/LinesIndex.svelte.test.ts src/lib/features/lines/RouteDetail.svelte.test.ts src/lib/features/lines/reliability/RouteReliabilityClusters.svelte.test.ts src/lib/features/lines/reliability/RouteReliabilityClusters.urlseed.svelte.test.ts src/lib/v1/history/rangeResource.svelte.test.ts
```

- [ ] **Step 3: Implement minimal Line integration and remove any duplicate date-range ownership exposed by the tests.**
- [ ] **Step 4: Run GREEN and commit.**

```bash
bun run --cwd apps/web test -- src/lib/features/lines/LinesIndex.svelte.test.ts src/lib/features/lines/RouteDetail.svelte.test.ts src/lib/features/lines/reliability/RouteReliabilityClusters.svelte.test.ts src/lib/features/lines/reliability/RouteReliabilityClusters.urlseed.svelte.test.ts
bun run --cwd apps/web check
git add apps/web/src/lib/features/lines
git commit -m "feat(web): browse retained line history"
```

### Task 10: Integrate retained ranges into Stop details

**Files:**
- Modify: `apps/web/src/lib/features/stops/StopsIndex.svelte.test.ts`
- Modify: `apps/web/src/lib/features/stops/StopDetail.svelte.test.ts`
- Modify: `apps/web/src/lib/features/stops/StopDetail.svelte`
- Modify: `apps/web/src/lib/features/stops/reliability/sections/StopReliabilitySurface.svelte.test.ts`
- Modify: `apps/web/src/lib/features/stops/reliability/sections/StopReliabilitySurface.svelte`
- Modify: `apps/web/src/lib/features/stops/reliability/selectors/dailyRange.test.ts`
- Modify: `apps/web/src/lib/features/stops/stops.copy.ts`
- Modify: `apps/web/src/lib/features/stops/reliability/stops-reliability.copy.ts`

**Behavior:**

- The Stop listing stays current and performs no per-entity history fanout.
- Selected range applies to exact stop daily severe-delay proxy/average and occupancy where covered.
- Never call the stop severe-delay proxy route-style OTP.
- Periods, habits heatmap, weekday, time-of-day, by-route, and current header/identity remain current-only and are labelled honestly.
- Replace the surface's current local date-range picker with the shared `HistoryNavigator` as the single `from/to` owner; keep its grain picker and ToC in the same `SurfaceRail`.

- [ ] **Step 1: Write RED tests.** In `StopsIndex.svelte.test.ts`, prove the listing stays current and performs no history-directory/per-entity fanout. In detail/surface tests, prove default singleton parity, one Stop entity lookup, awkward-ID safety, cross-month exact severe/average pooling, real zero severe vs no data, partial occupancy, no heatmap/history fabrication, URL/tab/grain preservation, loading/cancellation/stale response, current-only scope labels, no query propagation into Line links, one rail/one navigator, and EN/FR copy.
- [ ] **Step 2: Run RED.**

```bash
bun run --cwd apps/web test -- src/lib/features/stops/StopsIndex.svelte.test.ts src/lib/features/stops/StopDetail.svelte.test.ts src/lib/features/stops/reliability/sections/StopReliabilitySurface.svelte.test.ts src/lib/features/stops/reliability/selectors/dailyRange.test.ts src/lib/components/surface/HistoryNavigator.svelte.test.ts
```

- [ ] **Step 3: Implement minimal Stop integration and delete duplicate local range state.**
- [ ] **Step 4: Run GREEN and commit.**

```bash
bun run --cwd apps/web test -- src/lib/features/stops/StopsIndex.svelte.test.ts src/lib/features/stops/StopDetail.svelte.test.ts src/lib/features/stops/reliability/sections/StopReliabilitySurface.svelte.test.ts src/lib/features/stops/reliability/selectors/dailyRange.test.ts src/lib/components/surface/HistoryNavigator.svelte.test.ts
bun run --cwd apps/web check
git add apps/web/src/lib/features/stops
git commit -m "feat(web): browse retained stop history"
```

### Task 11: Regression, architecture review, and Task 7 handoff

**Files:**
- Modify: `.superpowers/sdd/progress.md` (ignored local execution pointer)
- Create: `.superpowers/sdd/task-7-network-lines-stops-history-report.md` (ignored evidence report)
- Modify only production/tests required by verified findings; no scope expansion.

- [ ] **Step 1: Run focused database suite.**

```bash
cd /home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history/apps/db
uv run pytest \
  tests/test_partitioned_history_contract.py \
  tests/test_partitioned_history_builders.py \
  tests/test_partitioned_history_publish.py \
  tests/test_partitioned_history_real_db.py \
  tests/test_snapshots_contract.py \
  tests/test_snapshots_schema_export.py \
  tests/test_v1_contract_web_mirror_sync.py \
  tests/test_snapshots_storage.py \
  tests/test_snapshots_historic.py \
  tests/test_snapshots_publish.py \
  tests/test_snapshots_publish_parallel.py \
  tests/test_snapshots_gate.py \
  tests/test_alert_archive_publication.py -q
```

- [ ] **Step 2: Run focused web suite.**

```bash
cd /home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history
bun run --cwd apps/web test -- \
  src/lib/v1/http.test.ts \
  src/lib/v1/schemas/history.test.ts \
  src/lib/v1/schemas/receipts_regranulation.test.ts \
  src/lib/v1/schemas/roundtrip.test.ts \
  src/lib/v1/schemas/zod-conformance.test.ts \
  src/lib/v1/history/entity.test.ts \
  src/lib/v1/history/selection.test.ts \
  src/lib/v1/history/partitions.test.ts \
  src/lib/v1/history/families.test.ts \
  src/lib/v1/history/rangeResource.svelte.test.ts \
  src/lib/v1/adapter/r2.history.test.ts \
  src/lib/v1/repositories/historic.history.test.ts \
  src/lib/v1/resource.svelte.test.ts \
  src/lib/components/surface/HistoryNavigator.svelte.test.ts \
  src/lib/components/surface/SurfaceRail.svelte.test.ts \
  src/lib/filters/url.test.ts \
  src/lib/features/network/reliability/sections/NetworkSurface.svelte.test.ts \
  src/lib/features/lines/LinesIndex.svelte.test.ts \
  src/lib/features/lines/RouteDetail.svelte.test.ts \
  src/lib/features/lines/reliability/RouteReliabilityClusters.svelte.test.ts \
  src/lib/features/lines/reliability/RouteReliabilityClusters.urlseed.svelte.test.ts \
  src/lib/features/stops/StopsIndex.svelte.test.ts \
  src/lib/features/stops/StopDetail.svelte.test.ts \
  src/lib/features/stops/reliability/sections/StopReliabilitySurface.svelte.test.ts \
  src/lib/features/stops/reliability/selectors/dailyRange.test.ts
```

- [ ] **Step 3: Run full repository checks.**

```bash
cd /home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history/apps/db
uv run pytest -q
uv run ruff check src/transit_ops/snapshots tests/test_partitioned_history_contract.py tests/test_partitioned_history_builders.py tests/test_partitioned_history_publish.py tests/test_partitioned_history_real_db.py
uv run ruff format --check src/transit_ops/snapshots tests/test_partitioned_history_contract.py tests/test_partitioned_history_builders.py tests/test_partitioned_history_publish.py tests/test_partitioned_history_real_db.py
cd /home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history
bun run --cwd apps/web test
bun run --cwd apps/web check
bun run --cwd apps/web build
bun run --cwd apps/web lint
bun run --cwd apps/web format:check
git diff --check
```

If whole-tree lint/format exposes inherited debt outside this branch, record the exact command/output and also run the exact changed-file scoped equivalent. Do not claim the whole-tree command passed.

- [ ] **Step 4: Request two fresh independent reviews.** One reviewer checks contract/math/publication atomicity and empty-vs-missing semantics. A second reviewer checks Svelte architecture, cancellation/races, URL ownership, one-rail composition, accessibility, current-default parity, and component reuse. Reviewers inspect the actual diff and tests, not this plan summary.
- [ ] **Step 5: Fix every confirmed finding test-first, rerun affected focused tests, then rerun the complete verification matrix above.**
- [ ] **Step 6: Write the ignored Task 7 evidence report.** Record exact test counts, skips/reasons, lint/build outputs, review findings/fixes, unchanged compatibility keys/default behavior, and the explicit fact that no browser/deploy/push/PR/merge proof exists yet.
- [ ] **Step 7: Commit only if review fixes changed tracked files.** Stage only the exact reviewed files shown by `git diff --name-only`, then commit them with `git commit -m "fix(history): close retained family review"`.

Task 7 is complete only when the worktree is clean, all required automated evidence is current, both independent reviews are closed, and the implementation still respects the explicit no-browser/no-deploy/no-push boundary.
