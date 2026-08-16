# B2 peak-fleet harness

This directory contains the durable B2 recorder, replay server, and Chromium measurement runner. The binding arm is one raw, unthrottled replay of exactly 3,424 deterministic vehicles in each of two ticks. It independently scores main-thread busy p95 at `<=8ms` and trusted Event Timing p95 at `<200ms`.

Synthetic runs exercise the machinery but are never benchmark evidence and cannot close B2.

## Local contract gate

From the repository root:

```sh
bun run --cwd tools/e6 b2:check
```

This runs every unit and workflow contract under `tools/e6/test`, then runs the deterministic synthetic busy-budget RED proof. It does not run the browser benchmark or deploy anything.

`b2:check` is the required hermetic CI gate and must remain under 90 seconds. The full `/map` replay/browser integration (`node tools/e6/e6-measure.mjs --dry-run`) is instead a required manual pre-Monday and exact-main gate. It is deliberately not required CI because Chromium, the production build, WebGL, and the trusted canvas actions make it multi-minute and environment-sensitive; do not replace that manual receipt with optional CI theater.

## Monday weekday-rush capture

The only closure-eligible capture date is Monday, 2026-08-17 in `America/Toronto`. The CLI requires the explicit `weekday-rush` label; there is no hidden hour window.

```sh
E6_CAPTURE_LABEL=weekday-rush \
E6_RECORDING_DIR="artifacts/e6/peak-$(date -u +%Y%m%dT%H%M%SZ)" \
node tools/e6/e6-record.mjs
```

The recorder fetches two live vehicle ticks separated by `max(live ttl, 30 seconds) + 5 seconds`. Each source tick must contain at least 856 distinct, non-empty vehicle identities. It sorts all source identities by explicit code-point order, selects the first 856, and creates four stable lane identities per source. A larger source still produces exactly `856 x 4 = 3,424` vehicles.

The receipt records the exact UTC and Toronto-local capture instant, weekday-rush label, source identities and count, selected identity order, four-lane scale metadata, and a recomputed SHA-256 digest of canonical recording content. A non-Monday capture remains structurally valid but is labeled ineligible.

Validate a stored recording and recompute its digest without measuring it:

```sh
node tools/e6/e6-record.mjs --validate artifacts/e6/peak-YYYYMMDDTHHMMSSZ
```

Prove that 855 source identities fail closed:

```sh
node tools/e6/e6-record.mjs --prove-thin-refusal
```

## Binding measurement

Install the locked workspace dependencies first. The runner uses `bun`, `git`, and `apps/web`'s `playwright-core`; it launches `/usr/bin/google-chrome` unless `E6_CHROME_EXECUTABLE` or `CHROME_EXECUTABLE` points to another Chromium executable. Ports 4217 through 4223 must be free.

A benchmark-eligible run requires the expected worktree HEAD and the digest printed by the recorder or validator:

```sh
E6_RECORDING_DIR=artifacts/e6/peak-YYYYMMDDTHHMMSSZ \
E6_EXPECTED_HEAD="$(git rev-parse HEAD)" \
E6_EXPECTED_RECORDING_DIGEST="<64-character digest>" \
node tools/e6/e6-measure.mjs
```

The runner rejects smooth mode, any rate other than `1`, any fleet count other than `3424`, and any E6 throttle field before browser launch. It never sends `Emulation.setCPUThrottlingRate`, including with rate 1.

The web build and preview force `PUBLIC_VITALS_ENABLED=false`. The binding path does not trigger visibility changes or wait for/intercept a vitals beacon as evidence. It observes `/api/vitals` only to abort and fail an attempted request.

The Event Timing observer stays active while all trusted Playwright actions run and is stopped/read only afterward. Chromium's minimum Event Timing observer threshold is 16 ms. Only entries with a positive `interactionId` are retained and scored. Entries are grouped by `interactionId` using each interaction's maximum duration; missing, malformed, or insufficient distinct interactions fail the run.

Both p95 values use R-7 linear interpolation: `rank=(n-1)*p`. The stable receipt field is `percentileMethod: "r7-linear-interpolation"`. This is a percentile budget, not a maximum-sample budget. The receipt retains both raw busy samples and raw Event Timing entries so the results can be recomputed independently.

Every emitted measurement binds:

- the exact Git HEAD and expected-HEAD match;
- the recomputed canonical recording digest and expected-digest match;
- the served immutable-asset fingerprint and per-asset SHA-256 values;
- the full two-tick source-selection and 3,424-vehicle scale metadata;
- the exact completed action list, raw evidence, independent budgets, and combined verdict.

## Synthetic dry run and RED proof

The dry run builds and measures the same deterministic 3,424-vehicle shape, but always emits `sourceKind=synthetic`, `benchmarkEligible=false`, and `SYNTHETIC_DRY_RUN_NOT_A_BENCHMARK`:

The preview targets the real `/map` route. Its app and immutable local replay run on separate loopback ports, so only the isolated Playwright context bypasses the production `connect-src` policy; the application build and production CSP remain unchanged.

```sh
node tools/e6/e6-measure.mjs --dry-run
```

The sampler RED proof injects a 28 ms main-thread block and exits zero only when the measured busy p95 is within tolerance and the binding 8 ms budget verdict is `FAIL`:

```sh
node tools/e6/e6-measure.mjs --red-proof --duration-ms 2000
```

## Deployment scope

The `web` workflow runs B2 contracts for `tools/e6/**`, but a tooling-only push does not redeploy the unchanged Worker. The known non-deployable B2 set is `tools/e6/**`, `.github/workflows/web.yml`, and the exact non-product test paths `apps/web/src/tests/shared-tooling-adoption.test.ts` and `apps/web/src/lib/features/lines/RouteDetail.svelte.test.ts`. Every other `apps/web/**` path remains deployable. Manual dispatch, an unresolved diff, an empty resolved diff, or an unknown path conservatively remains deployment-eligible.
