#!/usr/bin/env node
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  assertNoVitalsRequests,
  assertTrustedInteractionStart,
  createArmContext,
  launchChromium,
  observeForbiddenVitals,
  readMapTickSnapshot,
  runObservedRefreshes,
  runTrustedInteractions,
  waitForMapReady,
  waitForMapTickChange,
} from "./lib/browser.mjs";
import { captureIntervalMs } from "./lib/capture.mjs";
import {
  assertPortsAvailable,
  startManagedProcess,
  stopManagedProcess,
  waitForHttp,
} from "./lib/process.mjs";
import {
  E6_BUSY_PROBE_CADENCE_MS,
  assertSamplerEvidence,
  assertSyntheticProof,
  installSampler,
  markSamplerWorkloadComplete,
  readSampler,
  startSampler,
} from "./lib/sampler.mjs";
import {
  PERCENTILE_METHOD,
  scoreArmVerdict,
  scoreBusyBudget,
  scoreInteractionBudget,
} from "./lib/stats.mjs";
import {
  E6_BUSY_BUDGET_MS,
  E6_WINDOW_MS,
  buildMeasurementPlan,
} from "./lib/config.mjs";
import { loadRecording, recordingContentDigest } from "./lib/files.mjs";
import { fingerprintServedBuild } from "./lib/fingerprint.mjs";
import { validateRecordingSnapshot } from "./lib/recording.mjs";
import {
  assertReplayVehicleRequests,
  assertReplayVehicleTicks,
  startReplayServer,
} from "./lib/replay.mjs";
import { createSyntheticRecording } from "./lib/synthetic.mjs";

const execFileAsync = promisify(execFile);
const PREVIEW_PORTS = [4217, 4218];
export const webPaths = Object.freeze({
  webDirectory: fileURLToPath(new URL("../../apps/web/", import.meta.url)),
  clientRoot: fileURLToPath(
    new URL("../../apps/web/.svelte-kit/output/client", import.meta.url),
  ),
});

function fail(message) {
  throw new Error(message);
}

function numberOption(value, name, { minimum = 0 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum)
    fail(`E6_OPTION_INVALID ${name}=${String(value)}`);
  return parsed;
}

function parseArgs(args, env = process.env) {
  const options = {
    recordingDirectory: env.E6_RECORDING_DIR ?? null,
    durationMs: numberOption(
      env.E6_DURATION_MS ?? E6_WINDOW_MS,
      "E6_DURATION_MS",
    ),
    redProof: false,
    redBlockMs: 28,
    redToleranceMs: 4,
    dryRun: false,
    expectedHead: env.E6_EXPECTED_HEAD ?? null,
    expectedRecordingDigest: env.E6_EXPECTED_RECORDING_DIGEST ?? null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = () => args[++index] ?? fail(`E6_OPTION_VALUE_MISSING ${arg}`);
    if (arg === "--recording") options.recordingDirectory = value();
    else if (arg === "--mode") value();
    else if (arg === "--rate") value();
    else if (arg === "--fleet-vehicles") value();
    else if (arg === "--expected-head") options.expectedHead = value();
    else if (arg === "--expected-recording-digest")
      options.expectedRecordingDigest = value();
    else if (arg === "--duration-ms")
      options.durationMs = numberOption(value(), "--duration-ms");
    else if (arg === "--red-proof") options.redProof = true;
    else if (arg === "--red-block-ms")
      options.redBlockMs = numberOption(value(), "--red-block-ms", {
        minimum: Number.EPSILON,
      });
    else if (arg === "--red-tolerance-ms")
      options.redToleranceMs = numberOption(value(), "--red-tolerance-ms");
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help") return { help: true };
    else fail(`E6_OPTION_UNKNOWN ${arg}`);
  }
  options.plan = buildMeasurementPlan({ env, argv: args });
  if (
    !options.redProof &&
    !options.dryRun &&
    options.durationMs !== E6_WINDOW_MS
  ) {
    fail(`E6_BENCHMARK_WINDOW_REQUIRED windowMs=${E6_WINDOW_MS}`);
  }
  return options;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function blockSamplerProbe(page, blockMs, phase) {
  await page.evaluate(
    ({ duration, hook }) => {
      window[hook] = () => {
        const until = performance.now() + duration;
        while (performance.now() < until) {}
      };
    },
    {
      duration: blockMs,
      hook:
        phase === "before-post"
          ? "__e6BeforeSamplerPostMessage"
          : "__e6AfterSamplerPostMessage",
    },
  );
}

export function redProofReceipt(evidence, options) {
  const expectedServiceMs = options.redBlockMs + E6_BUSY_PROBE_CADENCE_MS;
  const proof = assertSyntheticProof(evidence, {
    expectedBusyMs: expectedServiceMs,
    toleranceMs: options.redToleranceMs,
  });
  const budget = scoreBusyBudget(proof.summary.p95, E6_BUSY_BUDGET_MS);
  return {
    label: "SYNTHETIC_NOT_A_BENCHMARK",
    sourceKind: "synthetic",
    benchmarkEligible: false,
    proof: {
      injectedBlockMs: options.redBlockMs,
      cadenceMs: E6_BUSY_PROBE_CADENCE_MS,
      expectedServiceMs,
      toleranceMs: options.redToleranceMs,
    },
    busy: proof.summary,
    budget,
  };
}

export function previewEnvironment(env, replayBaseUrl) {
  return {
    ...env,
    PUBLIC_VITALS_ENABLED: "false",
    PUBLIC_V1_BASE: replayBaseUrl,
    PUBLIC_SITE_ORIGIN: "http://127.0.0.1:4217",
    PUBLIC_INDEXING: "false",
  };
}

export function assertExpectedIdentity({
  benchmarkEligible,
  actualHead,
  expectedHead,
  actualRecordingDigest,
  expectedRecordingDigest,
} = {}) {
  if (typeof actualHead !== "string" || actualHead.length === 0) {
    fail("E6_IDENTITY_HEAD_INVALID");
  }
  if (
    typeof actualRecordingDigest !== "string" ||
    !/^[a-f\d]{64}$/u.test(actualRecordingDigest)
  ) {
    fail("E6_IDENTITY_RECORDING_DIGEST_INVALID");
  }
  if (benchmarkEligible) {
    if (!expectedHead) fail("E6_IDENTITY_EXPECTED_HEAD_MISSING");
    if (!expectedRecordingDigest)
      fail("E6_IDENTITY_EXPECTED_RECORDING_DIGEST_MISSING");
    if (expectedHead !== actualHead) {
      fail(
        `E6_IDENTITY_HEAD_MISMATCH expected=${expectedHead} actual=${actualHead}`,
      );
    }
    if (expectedRecordingDigest !== actualRecordingDigest) {
      fail(
        `E6_IDENTITY_RECORDING_DIGEST_MISMATCH expected=${expectedRecordingDigest} actual=${actualRecordingDigest}`,
      );
    }
  }
  return { head: actualHead, recordingDigest: actualRecordingDigest };
}

export function assertCleanGitStatus(status) {
  if (status !== "") fail("E6_IDENTITY_WORKTREE_DIRTY");
}

export function assertVehicleDelivery({
  before,
  after,
  vehiclePath,
  observedTickKey,
  vehicleCount,
  expectedVehicleCount,
} = {}) {
  const request = assertReplayVehicleRequests(after, vehiclePath, before, 1);
  const beforeCount = before?.vehicleDeliveries?.length ?? 0;
  const deliveries = after?.vehicleDeliveries?.slice(beforeCount);
  if (
    !Array.isArray(deliveries) ||
    deliveries.length !== 1 ||
    deliveries[0]?.servedGeneratedUtc !== observedTickKey ||
    vehicleCount !== expectedVehicleCount
  ) {
    fail("E6_VEHICLE_DELIVERY_MISMATCH");
  }
  return {
    request,
    delivery: { ...deliveries[0] },
    processed: { tickKey: observedTickKey, vehicleCount },
  };
}

export function assertNaturalPollMargin({
  servedGeneratedUtc,
  manifest,
  windowMs,
  nowMs = Date.now(),
} = {}) {
  const ttlSeconds = Number(manifest?.files?.live?.ttl_s ?? 30);
  const ttlMs = Math.max(1, ttlSeconds) * 1000;
  const servedMs = Date.parse(servedGeneratedUtc);
  const alignmentAgeMs = nowMs - servedMs;
  const safetyMs = (ttlMs - windowMs) / 2;
  const remainingAfterWindowMs = ttlMs - alignmentAgeMs - windowMs;
  if (
    ![ttlMs, servedMs, nowMs, windowMs].every(Number.isFinite) ||
    windowMs <= 0 ||
    ttlMs <= windowMs ||
    alignmentAgeMs < 0 ||
    remainingAfterWindowMs <= safetyMs
  ) {
    fail("E6_NATURAL_POLL_MARGIN_INVALID");
  }
  return { ttlMs, alignmentAgeMs, safetyMs, remainingAfterWindowMs };
}

export async function startMeasurementWindow({
  start,
  stats,
  alignedReplay,
  vehiclePath,
  servedGeneratedUtc,
  manifest,
  windowMs,
  now = Date.now,
}) {
  await start();
  const pollAlignment = assertNaturalPollMargin({
    servedGeneratedUtc,
    manifest,
    windowMs,
    nowMs: now(),
  });
  assertReplayVehicleRequests(stats(), vehiclePath, alignedReplay, 0);
  return { replay: alignedReplay, pollAlignment };
}

async function measureRedProof(browser, options) {
  const phases = [];
  for (const phase of ["before-post", "after-post"]) {
    const arm = await createArmContext(browser, { rate: 1 });
    try {
      await installSampler(arm.page);
      await arm.page.goto(
        'data:text/html,<button aria-label="red proof blocker">red proof blocker</button>',
        { waitUntil: "load" },
      );
      await arm.page.getByRole("button", { name: "red proof blocker" }).click();
      await blockSamplerProbe(arm.page, options.redBlockMs, phase);
      await startSampler(arm.page, options.durationMs);
      const receipt = redProofReceipt(await readSampler(arm.page), options);
      phases.push({ phase, busy: receipt.busy, budget: receipt.budget });
    } finally {
      await arm.context.close();
    }
  }
  return {
    label: "SYNTHETIC_NOT_A_BENCHMARK",
    sourceKind: "synthetic",
    benchmarkEligible: false,
    proof: {
      injectedBlockMs: options.redBlockMs,
      cadenceMs: E6_BUSY_PROBE_CADENCE_MS,
      expectedServiceMs: options.redBlockMs + E6_BUSY_PROBE_CADENCE_MS,
      toleranceMs: options.redToleranceMs,
    },
    phases,
  };
}

async function measureArm(browser, options, environment) {
  const plan = options.plan;
  const arm = await createArmContext(browser, {
    rate: plan.rate,
    storage: {
      "transit:motion-mode": plan.mode,
      "transit:controls-rail": "false",
    },
  });
  try {
    await installSampler(arm.page);
    const vitalsAttempts = await observeForbiddenVitals(arm.page);
    await arm.page.goto(environment.previewUrl, { waitUntil: "networkidle" });
    await waitForMapReady(arm.page);
    const alignmentTickKey = (await readMapTickSnapshot(arm.page)).tickKey;
    const vehiclePath = environment.recording.metadata.paths.vehicles;
    const beforeAlignment = environment.replay.stats();
    const alignment = await waitForMapTickChange(arm.page, {
      previousTickKey: alignmentTickKey,
      expectedVehicleCount: plan.fleetVehicles,
      timeoutMs: captureIntervalMs(
        environment.recording.payloads.get("manifest.json"),
      ),
    });
    const alignedReplay = environment.replay.stats();
    const alignmentDelivery = assertVehicleDelivery({
      before: beforeAlignment,
      after: alignedReplay,
      vehiclePath,
      observedTickKey: alignment.tickKey,
      vehicleCount: alignment.vehicleCount,
      expectedVehicleCount: plan.fleetVehicles,
    });
    await assertTrustedInteractionStart(arm.page);
    const startBoundary = await startMeasurementWindow({
      start: () => startSampler(arm.page, options.durationMs),
      stats: () => environment.replay.stats(),
      alignedReplay,
      vehiclePath,
      servedGeneratedUtc: alignmentDelivery.delivery.servedGeneratedUtc,
      manifest: environment.recording.payloads.get("manifest.json"),
      windowMs: options.durationMs,
    });
    const [evidenceReport, workload] = await Promise.all([
      readSampler(arm.page),
      (async () => {
        const actions = await runTrustedInteractions(arm.page, {
          interactions: plan.interactions,
        });
        const refreshEvidence = [];
        let refreshBaseline = environment.replay.stats();
        const tickObservation = await runObservedRefreshes(arm.page, {
          count: 2,
          expectedVehicleCount: plan.fleetVehicles,
          timeoutMs: options.durationMs,
          afterTransition: async ({ nextTickKey, vehicleCount }) => {
            const after = environment.replay.stats();
            refreshEvidence.push(
              assertVehicleDelivery({
                before: refreshBaseline,
                after,
                vehiclePath,
                observedTickKey: nextTickKey,
                vehicleCount,
                expectedVehicleCount: plan.fleetVehicles,
              }),
            );
            refreshBaseline = after;
          },
        });
        await markSamplerWorkloadComplete(arm.page);
        return { actions, refreshEvidence, tickObservation };
      })(),
    ]);
    const endBoundary = environment.replay.stats();
    const evidence = assertSamplerEvidence(evidenceReport, {
      requireInteraction: true,
      requiredWindowMs: options.durationMs,
    });
    assertNoVitalsRequests(vitalsAttempts);
    const replay = assertReplayVehicleTicks(
      endBoundary,
      environment.recording.metadata.vehicleTickPaths,
      startBoundary.replay,
    );
    const interactionBudget = scoreInteractionBudget(evidence.interactions, {
      requiredInteractions: plan.interactions,
      budgetMs: plan.interactionBudgetMs,
    });
    const busyBudget = scoreBusyBudget(evidence.summary.p95, plan.busyBudgetMs);
    const verdict = scoreArmVerdict({
      busyPassed: busyBudget.passed,
      interactionPassed: interactionBudget.passed,
      requestedActions: plan.interactions,
      completedActions: workload.actions.length,
    });
    const benchmarkEligible =
      environment.recording.metadata.benchmarkEligible === true;
    return {
      label: benchmarkEligible
        ? "BENCHMARK"
        : "SYNTHETIC_DRY_RUN_NOT_A_BENCHMARK",
      sourceKind: environment.recording.metadata.sourceKind,
      sourceBase: environment.recording.metadata.sourceBase ?? null,
      provider: environment.recording.metadata.provider,
      benchmarkEligible,
      id: plan.id,
      mode: plan.mode,
      rate: plan.rate,
      fleetVehicles: plan.fleetVehicles,
      actions: workload.actions,
      tickObservation: workload.tickObservation,
      refreshEvidence: workload.refreshEvidence,
      pollAlignment: startBoundary.pollAlignment,
      replay,
      forbiddenVitalsRequests: 0,
      busy: evidence.summary,
      busySamples: evidence.busy,
      busyProbes: evidence.busyProbes,
      busyProbeCadenceMs: evidence.busyProbeCadenceMs,
      windowStartedAt: evidence.windowStartedAt,
      stopRequestedAt: evidence.stopRequestedAt,
      requestedWindowMs: evidence.requestedWindowMs,
      observedWindowMs: evidence.observedWindowMs,
      workloadCompletedAt: evidence.workloadCompletedAt,
      eventTimingEntries: evidence.interactions,
      percentileMethod: PERCENTILE_METHOD,
      interactionTiming: interactionBudget,
      budgets: { busy: busyBudget, interaction: interactionBudget },
      verdict,
      scored: true,
    };
  } finally {
    await arm.context.close();
  }
}

async function startPreview(replayBaseUrl) {
  const webDirectory = webPaths.webDirectory;
  const runtimeEnv = previewEnvironment(process.env, replayBaseUrl);
  await execFileAsync("bun", ["run", "build"], {
    cwd: webDirectory,
    env: runtimeEnv,
  });
  const child = startManagedProcess(
    "bun",
    [
      "run",
      "preview",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      "4217",
      "--strictPort",
    ],
    {
      cwd: webDirectory,
      env: runtimeEnv,
    },
  );
  try {
    await waitForHttp("http://127.0.0.1:4217/");
    return child;
  } catch (error) {
    await stopManagedProcess(child);
    throw error;
  }
}

async function startEnvironment(options) {
  const recording = options.dryRun
    ? createSyntheticRecording()
    : options.recordingDirectory
      ? await loadRecording(options.recordingDirectory)
      : fail("E6_RECORDING_REQUIRED provide --recording or E6_RECORDING_DIR");
  validateRecordingSnapshot(recording, {
    purpose: options.dryRun ? "dry-run" : "benchmark",
  });
  if (!options.dryRun) {
    const { stdout: status } = await execFileAsync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=normal"],
      { cwd: fileURLToPath(new URL("../../", import.meta.url)) },
    );
    assertCleanGitStatus(status);
  }
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
  });
  const actualHead = stdout.trim();
  const actualRecordingDigest =
    recording.recordingDigest ?? recordingContentDigest(recording);
  const identity = assertExpectedIdentity({
    benchmarkEligible: recording.metadata.benchmarkEligible === true,
    actualHead,
    expectedHead: options.expectedHead,
    actualRecordingDigest,
    expectedRecordingDigest: options.expectedRecordingDigest,
  });
  await assertPortsAvailable(PREVIEW_PORTS);
  const replay = await startReplayServer(recording, { port: 4218 });
  try {
    const preview = await startPreview(replay.baseUrl);
    const previewUrl = "http://127.0.0.1:4217/map";
    const html = await (await fetch(previewUrl)).text();
    const fingerprint = await fingerprintServedBuild({
      head: actualHead,
      origin: new URL(previewUrl).origin,
      html,
      clientRoot: webPaths.clientRoot,
    });
    return {
      recording,
      replay,
      preview,
      previewUrl,
      fingerprint,
      identity,
    };
  } catch (error) {
    await replay.close();
    throw error;
  }
}

function usage() {
  return "Usage: node tools/e6/e6-measure.mjs [--expected-head SHA] [--expected-recording-digest SHA256] [--duration-ms N] [--dry-run] [--red-proof]";
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const options = parseArgs(args, env);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  let preview;
  let replay;
  let browser;
  try {
    if (options.redProof) {
      browser = await launchChromium();
      const result = await measureRedProof(browser, options);
      print({ kind: "E6_RED_PROOF_RESULT", ...result });
      return result.phases.every(({ budget }) => !budget.passed) ? 0 : 1;
    }
    const environment = await startEnvironment(options);
    preview = environment.preview;
    replay = environment.replay;
    browser = await launchChromium();
    const arm = await measureArm(browser, options, environment);
    print({
      kind: "E6_MEASURE_RESULT",
      label: options.dryRun ? "SYNTHETIC_DRY_RUN_NOT_A_BENCHMARK" : "BENCHMARK",
      sourceKind: environment.recording.metadata.sourceKind,
      benchmarkEligible:
        environment.recording.metadata.benchmarkEligible !== false,
      portsChecked: PREVIEW_PORTS,
      windowMs: options.durationMs,
      previewUrl: environment.previewUrl,
      fingerprint: environment.fingerprint,
      identity: environment.identity,
      scale: environment.recording.metadata.scale,
      arms: [arm],
    });
    return arm.verdict.passed ? 0 : 1;
  } finally {
    await browser?.close();
    await stopManagedProcess(preview);
    await replay?.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
}
