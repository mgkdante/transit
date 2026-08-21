# B2 peak-fleet harness

This directory contains the durable B2 recorder, replay server, and Chromium measurement runner. The binding capture is fixed to `sourceBase=https://data.yesid.dev/v1` and `provider=stm`. Its single raw, unthrottled arm replays exactly 3,424 deterministic vehicles in each of two ticks, completes exactly 13 trusted actions, and independently scores main-thread busy p95 at `<=8ms` and trusted Event Timing p95 at `<200ms`.

Synthetic runs exercise the machinery but are never benchmark evidence and cannot close B2. A result is closure-eligible only when one durable attempt was consumed inside the declared window, its recording binds that exact marker, and it was measured from the same clean public-main commit. A structurally valid receipt alone is insufficient.

## Local contract gate

From the repository root:

```sh
bun run --shell=bun --cwd tools/e6 b2:check
```

This runs every unit and workflow contract under `tools/e6/test`, then runs the deterministic synthetic busy-budget RED proof. `--shell=bun` keeps nested `bun` commands on the caller's pinned runtime instead of another installation on `PATH`. It does not run the browser benchmark or deploy anything.

`b2:check` is the required hermetic CI gate and must remain under 90 seconds. The full `/map` replay/browser integration (`node tools/e6/e6-measure.mjs --dry-run`) is instead a required manual gate before an eligible capture and on the exact clean commit that would be measured. It remains outside required CI because Chromium, the production build, WebGL, and the trusted canvas actions make it multi-minute and environment-sensitive.

## Monday weekday-rush capture

The capture gate recognizes only Monday, 2026-08-24 from `06:00` inclusive through `09:00` exclusive in `America/Toronto`, with live source kind and the explicit `weekday-rush` label. Complete the manual dry run, confirm Bun `1.3.11`, Node `24.15.0`, the clean worktree, and the intended absent output directory before the window. The recorder itself anonymously verifies that local HEAD is still public Transit `main` both before and after consumption.

Before the authorized window, create and retain the real output parent with `install -d -m 700 artifacts/e6`; verify it is a real writable directory. The final timestamped `peak-*` recording directory itself must remain absent. Capture preflight proves and syncs that existing ancestry before consuming the attempt.

```sh
env -i HOME="$HOME" LANG=C.UTF-8 \
PATH="<pinned-bun-dir>:<pinned-node-dir>:/usr/bin:/bin" \
E6_CAPTURE_LABEL=weekday-rush \
E6_RECORDING_DIR="artifacts/e6/peak-$(date -u +%Y%m%dT%H%M%SZ)" \
<absolute-node-24.15.0> tools/e6/e6-record.mjs
```

Immediately before its first live request, the recorder publishes the one fixed `B2` attempt marker under the shared Git common directory. All worktrees of this clone contend on the same filename. Publication uses a complete mode-`0600` file, an atomic non-overwriting hard link, and file/directory syncs; the owner directory is mode `0700`. No environment variable or CLI argument can select another marker.

Once the fixed marker exists, the capture is consumed for every normal, non-destructive operation in this retained clone. A crash, fetch failure, thin fleet, invalid tick, late completion, recording error, empty/malformed marker, or any other post-consumption failure never clears, repairs, expires, or reuses it. All worktrees of this clone share the marker, but a different clone, another host, or an owner deleting the Git common directory is outside this cooperative safety boundary. The Monday operator must designate this clone as the sole authority and retain its common directory as closure evidence. Read-only Git preflight and the synthetic dry run do not create the marker. The marker is durable local attempt-state evidence, not a tracked file, raw log, or extra control document.

The recorder fetches two live vehicle ticks separated by `max(live ttl, 30 seconds) + 5 seconds`. Each source tick must contain at least 856 distinct, non-empty vehicle identities. It sorts all source identities by explicit code-point order, selects the first 856, and creates four stable lane identities per source. A larger source still produces exactly `856 x 4 = 3,424` vehicles.

The immutable marker contains exactly schema version, consumption instant, pinned recorder runtime, exact public HEAD and tree, and intended recording basename. The fixed source, provider, label, date, and attempt number come from the non-overridable harness contract and filename. The marker's canonical bytes produce `attemptMarkerDigest`; the recording embeds the same claim and digest, so its own canonical SHA-256 transitively binds the consumed capture. The capture command fails outside the binding window and cannot seal a late or otherwise ineligible recording. Both source ticks must be valid, strictly increasing instants inside that same window.

Validate the consumed attempt independently, including after a failed capture that produced no recording:

```sh
node tools/e6/e6-record.mjs --validate-attempt
```

Validate a stored recording and recompute its digest without measuring it:

```sh
node tools/e6/e6-record.mjs --validate artifacts/e6/peak-YYYYMMDDTHHMMSSZ
```

Prove that 855 source identities fail closed:

```sh
node tools/e6/e6-record.mjs --prove-thin-refusal
```

## Binding measurement

Install the locked workspace dependencies first. The binding path requires Node `24.15.0`, Bun `1.3.11`, and Chrome `148.0.7778.178`; it records each resolved executable's real path and file identity, then rechecks them immediately before and after the raw arm. Run the recorder and measurement from a clean, allowlisted process environment. Non-empty Node/Bun preload variables, `LD_PRELOAD`, or loader-style Node arguments fail before the corresponding marker claim. The preview child receives only the pinned Node/Bun path, basic locale/home fields, and the fixed `PUBLIC_*` contract. Loopback ports 4217 and 4218 must be free.

A benchmark-eligible run requires the same clean public-main worktree and the recording digest printed by the recorder or validator. That digest already covers the embedded attempt, whose canonical bytes must match the one fixed external marker:

```sh
env -i HOME="$HOME" LANG=C.UTF-8 \
PATH="<pinned-bun-dir>:<pinned-node-dir>:/usr/bin:/bin" \
E6_RECORDING_DIR=artifacts/e6/peak-YYYYMMDDTHHMMSSZ \
E6_EXPECTED_HEAD="<40-character exact public HEAD>" \
E6_EXPECTED_RECORDING_DIGEST="<64-character digest>" \
<absolute-node-24.15.0> tools/e6/e6-measure.mjs
```

The live runner has a second one-shot boundary for the raw metric arm. Build, preview launch, HTML/asset fingerprinting, map readiness, natural-poll alignment, and trusted-input readiness are reversible preparation and do not start the sampler or Event Timing observer. Immediately before `startSampler`, the runner re-verifies anonymous public `main`, local identity, preview liveness, and the pinned runtimes, then atomically publishes the one fixed `measurement-start` marker in the same Git common directory. Concurrent runners may prepare, but only the non-overwriting publication winner can start a sampler. A claim failure starts zero samplers.

Every failure from that claim onward is terminal. A sampler, action, browser, identity, runtime, fingerprint, or write failure leaves the immutable start marker and no eligible retry. A completed arm, including a metric `FAIL`, atomically publishes one canonical mode-`0600` `e6-measure-result.json` inside the bound mode-`0700` recording directory. The full raw file is the terminal receipt: it retains primitive probes, Event Timing rows, replay/tick/poll guards, runtime and build identity, and the independently recomputed verdict. There is no separate result marker and no selectable output name.

Validate a stored terminal result without requiring the recorded commit to remain current `main`, rebuilding, launching Chrome, or rerunning the arm:

```sh
node tools/e6/e6-measure.mjs --validate-result artifacts/e6/peak-YYYYMMDDTHHMMSSZ
```

Successful structural validation exits zero for either a metric `PASS` or metric `FAIL`; the printed `verdict` remains authoritative. A start marker without a complete result means consumed/incomplete, never retryable.

The live command exits `0` only for a structurally valid persisted metric `PASS`. It exits `1` for a structurally valid persisted metric `FAIL` and for invalid or incomplete execution; the durable result's presence plus `--validate-result` distinguishes a valid metric failure from invalid evidence.

The runner rejects smooth mode, any rate other than `1`, any fleet count other than `3424`, any interaction-count or route override, and any E6 throttle field before browser launch. The action count is fixed at 13. It never sends `Emulation.setCPUThrottlingRate`, including with rate 1.

The web build and preview force `PUBLIC_VITALS_ENABLED=false`. The binding path does not trigger visibility changes or wait for/intercept a vitals beacon as evidence. It observes `/api/vitals` only to abort and fail an attempted request.

Before scoring, the runner waits for one natural vehicle poll and binds that single replay delivery to the post-feed map timestamp and 3,424-vehicle count. It then requires the canonical `/map` URL with no selection, raw motion, and no active filter. After Chromium acknowledges sampler start, the runner recomputes the aligned delivery's age and requires the fixed window to finish with more than half of the TTL-minus-window slack remaining (more than 5 seconds for the 30-second TTL and 20-second window). Any vehicle request between alignment and sampler start, or any unexpected request during the arm, invalidates the run.

At the fixed sampler start, the original 13 trusted Playwright actions run unchanged. Canvas actions 1, 7, and 13 acquire a real hoverable vehicle from a deterministic center-first grid immediately before clicking; that bounded search and its map work stay inside the same fixed busy window and cannot extend its deadline. The real Refresh button handler then runs twice through programmatic clicks. Each stimulus must drive exactly one public vehicle request, one of each recorded payload across the pair, and a matching post-feed map marker with all 3,424 vehicles. Any fan-out, natural third request, missing/repeated tick, mismatched generated timestamp, failed target search, or late workload invalidates the arm. The script-generated refresh events have no positive interaction ID and therefore remain outside the trusted interaction population; the exact-count check fails if that invariant changes.

The Event Timing observer stays active for the fixed window and is stopped/read only at its deadline. Chromium's minimum Event Timing observer threshold is 16 ms. Only entries with a positive `interactionId` are retained and scored. Entries are grouped by `interactionId` using each interaction's maximum duration; the run requires exactly 13 distinct interactions, not a minimum.

Both p95 values use R-7 linear interpolation: `rank=(n-1)*p`. The stable receipt field is `percentileMethod: "r7-linear-interpolation"`. This is a percentile budget, not a maximum-sample budget. Main-thread busy is the raw service interval of an always-pending 4 ms timer-to-MessageChannel probe, where 4 ms is half the fixed 8 ms budget. Each raw `{ scheduledAt, postedAt, sampledAt }` triple covers work before and after publication; the chain has no unobserved gap and stops after the first drained probe crossing the exact `t0 + 20,000 ms` deadline. The deadline never moves: both tick stimuli and all 13 actions must complete before it. No sample-count floor is used. The receipt retains every probe and raw Event Timing entry so both results can be recomputed independently.

Every emitted measurement binds:

- the exact Git HEAD and expected-HEAD match;
- the exact public-main tree and durable external attempt marker;
- the recomputed canonical recording digest and expected-digest match;
- the served HTML SHA-256 plus the complete immutable-build file set, per-asset SHA-256 values, and browser-loaded byte checks;
- the full two-tick source-selection and 3,424-vehicle scale metadata;
- the post-start poll-check instant, recomputed natural-poll age, TTL, safety margin, and remaining time after the fixed window;
- two ordered replay deliveries, each exact public-request delta, and matching post-feed map tick/count acknowledgements while the busy sampler was active;
- the exact completed action list, raw evidence, independent budgets, and combined verdict.

## Synthetic dry run and RED proof

The dry run builds and measures the same deterministic 3,424-vehicle shape, but always emits `sourceKind=synthetic`, `benchmarkEligible=false`, and `SYNTHETIC_DRY_RUN_NOT_A_BENCHMARK`.

The preview targets the real `/map` route. Its app and immutable local replay run on separate loopback ports, so only the isolated Playwright context bypasses the production `connect-src` policy; the application build and production CSP remain unchanged.

```sh
node tools/e6/e6-measure.mjs --dry-run
```

The sampler RED proof injects a 28 ms main-thread block before publication and again after publication. For every raw probe it validates one complete blocker span on the declared side of publication. It exits zero only when both raw service p95 values meet the one-sided 30 ms lower guard around the nominal 32 ms service time including cadence and both binding 8 ms budget verdicts are `FAIL`; scheduler overshoot remains valid RED evidence:

```sh
node tools/e6/e6-measure.mjs --red-proof --duration-ms 2000
```

## Deployment scope

The `web` workflow runs B2 contracts for `tools/e6/**`, but a tooling-only push does not redeploy the unchanged Worker. The known non-deployable B2 set is `tools/e6/**`, `.github/workflows/web.yml`, and the exact non-product test paths `apps/web/src/tests/shared-tooling-adoption.test.ts` and `apps/web/src/lib/features/lines/RouteDetail.svelte.test.ts`. Every other `apps/web/**` path remains deployable. Manual dispatch, an unresolved diff, an empty resolved diff, or an unknown path conservatively remains deployment-eligible.

Merging this tooling changes public `main` while the currently deployed product can remain on the earlier equivalent product tree. Before Monday's capture, manually dispatch the production workflow for the merged commit, prove the deployed version matches that exact public HEAD, and then freeze public `main` through capture and terminal raw-result publication. The tooling-only merge needs no new visual decision because it does not change product bytes, but exact commit reconciliation is still required by the evidence contract.
