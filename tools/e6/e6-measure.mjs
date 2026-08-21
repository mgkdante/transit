#!/usr/bin/env node
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  assertNoVitalsRequests,
  assertTrustedInteractionStart,
  createArmContext,
  launchChromium,
  observeForbiddenVitals,
  readMapTickSnapshot,
  resolveChromeExecutable,
  runObservedRefreshes,
  runTrustedInteractions,
  waitForMapReady,
  waitForMapTickChange,
} from "./lib/browser.mjs";
import { captureIntervalMs } from "./lib/capture.mjs";
import {
  assertPortsAvailable,
  assertManagedProcessRunning,
  requestManagedProcessShutdown,
  runManagedProcess,
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
import {
  assertAttemptMarkerBinding,
  loadAttemptMarker,
} from "./lib/attempt.mjs";
import {
  assertSameServedBuildFingerprint,
  assertServedAssetBytes,
  assertServedHtmlBytes,
  fingerprintServedBuild,
} from "./lib/fingerprint.mjs";
import {
  assertCleanGitStatus,
  assertGitIdentityUnchanged,
  readGitCommonDirectory,
  readLocalGitIdentity,
  readPublicGitIdentity,
} from "./lib/identity.mjs";
import { validateRecordingSnapshot } from "./lib/recording.mjs";
import {
  assertReplayVehicleRequests,
  assertReplayVehicleTicks,
  startReplayServer,
} from "./lib/replay.mjs";
import { createSyntheticRecording } from "./lib/synthetic.mjs";
import {
  assertCleanBenchmarkEnvironment,
  assertBrowserRuntimeVersion,
  preflightBenchmarkRuntime,
  recheckBenchmarkRuntime,
} from "./lib/runtime.mjs";
import {
  assertMeasurementPreclaimReady,
  assertMeasurementRawResult,
  buildMeasurementStart,
  claimMeasurementStartMarker,
  loadCompletedMeasurement,
  writeMeasurementRawResult,
} from "./lib/measurement-attempt.mjs";

export { assertCleanGitStatus } from "./lib/identity.mjs";

const execFileAsync = promisify(execFile);
const PREVIEW_PORTS = [4217, 4218];
const previewRuntimeHomes = new WeakMap();
const resourceCleanupPromises = new WeakMap();
export const webPaths = Object.freeze({
  repositoryRoot: fileURLToPath(new URL("../../", import.meta.url)),
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
  if (args[0] === "--validate-result") {
    if (args.length !== 2 || !args[1]) {
      fail("E6_OPTION_VALUE_MISSING --validate-result");
    }
    return {
      validateResult: true,
      recordingDirectory: resolve(args[1]),
    };
  }
  const options = {
    recordingDirectory: env.E6_RECORDING_DIR ?? null,
    durationMs: numberOption(
      env.E6_DURATION_MS ?? E6_WINDOW_MS,
      "E6_DURATION_MS",
    ),
    redProof: false,
    redBlockMs: 28,
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
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help") return { help: true };
    else fail(`E6_OPTION_UNKNOWN ${arg}`);
  }
  options.plan = buildMeasurementPlan({ env, argv: args });
  if (options.recordingDirectory) {
    options.recordingDirectory = resolve(options.recordingDirectory);
  }
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

export function measurementExitCode({ passed, validation = false } = {}) {
  if (typeof passed !== "boolean") fail("E6_MEASUREMENT_VERDICT_INVALID");
  return validation || passed ? 0 : 1;
}

export async function validateStoredMeasurement(
  recordingDirectory,
  {
    readCommonDirectory = readGitCommonDirectory,
    loadCompleted = loadCompletedMeasurement,
  } = {},
) {
  return loadCompleted({
    gitCommonDirectory: await readCommonDirectory(),
    recordingDirectory,
  });
}

async function blockSamplerProbe(page, blockMs, phase) {
  await page.evaluate(
    ({ duration, hook, proofPhase }) => {
      const sampler = window.__e6Sampler;
      if (!sampler) throw new Error("E6_SAMPLER_NOT_INSTALLED");
      sampler.redProofTraces = [];
      window[hook] = () => {
        const startedAt = performance.now();
        const targetAt = startedAt + duration;
        while (performance.now() < targetAt) {}
        sampler.redProofTraces.push({
          phase: proofPhase,
          startedAt,
          endedAt: performance.now(),
        });
      };
    },
    {
      duration: blockMs,
      proofPhase: phase,
      hook:
        phase === "before-post"
          ? "__e6BeforeSamplerPostMessage"
          : "__e6AfterSamplerPostMessage",
    },
  );
}

export function redProofReceipt(evidence, options) {
  const expectedServiceMs = options.redBlockMs + E6_BUSY_PROBE_CADENCE_MS;
  const minimumAcceptedServiceMs =
    expectedServiceMs - E6_BUSY_PROBE_CADENCE_MS / 2;
  const proof = assertSyntheticProof(evidence, {
    expectedBusyMs: expectedServiceMs,
    redBlockMs: options.redBlockMs,
    phase: options.phase,
  });
  const budget = scoreBusyBudget(proof.summary.p95, E6_BUSY_BUDGET_MS);
  const minimumInjectedBlockMs = Math.min(
    ...proof.redProofTraces.map(
      ({ startedAt, endedAt }) => endedAt - startedAt,
    ),
  );
  return {
    label: "SYNTHETIC_NOT_A_BENCHMARK",
    sourceKind: "synthetic",
    benchmarkEligible: false,
    proof: {
      injectedBlockMs: options.redBlockMs,
      cadenceMs: E6_BUSY_PROBE_CADENCE_MS,
      expectedServiceMs,
      minimumAcceptedServiceMs,
      phase: options.phase,
      traceCount: proof.redProofTraces.length,
      minimumInjectedBlockMs,
    },
    busy: proof.summary,
    budget,
  };
}

export function previewEnvironment(
  env,
  replayBaseUrl,
  runtime,
  controlledHome = env.HOME ?? "/tmp",
) {
  const path = runtime
    ? [...new Set([
        dirname(runtime.node.executablePath),
        dirname(runtime.bun.executablePath),
        "/usr/bin",
        "/bin",
      ])].join(delimiter)
    : env.PATH;
  return {
    PATH: path,
    HOME: controlledHome,
    XDG_CONFIG_HOME: join(controlledHome, ".config"),
    XDG_CONFIG_DIRS: join(controlledHome, ".config-empty"),
    TMPDIR: env.TMPDIR ?? "/tmp",
    LANG: env.LANG ?? "C.UTF-8",
    CI: "1",
    NO_COLOR: "1",
    PUBLIC_VITALS_ENABLED: "false",
    PUBLIC_V1_BASE: replayBaseUrl,
    PUBLIC_SITE_ORIGIN: "http://127.0.0.1:4217",
    PUBLIC_INDEXING: "false",
  };
}

export async function assertNoProductionEnvironmentFiles(
  webDirectory = webPaths.webDirectory,
  repositoryRoot = webPaths.repositoryRoot,
) {
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    try {
      await lstat(join(webDirectory, name));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    fail(`E6_BUILD_ENVIRONMENT_FILE_FORBIDDEN name=${name}`);
  }
  let current = resolve(webDirectory);
  const boundary = resolve(repositoryRoot);
  while (true) {
    for (const name of ["bunfig.toml", ".bunfig.toml"]) {
      try {
        await lstat(join(current, name));
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      fail(`E6_BUILD_BUN_CONFIG_FORBIDDEN path=${join(current, name)}`);
    }
    if (current === boundary) break;
    const parent = dirname(current);
    if (parent === current || !current.startsWith(`${boundary}/`)) {
      fail("E6_BUILD_DIRECTORY_INVALID");
    }
    current = parent;
  }
}

export async function buildPreviewAssets({
  webDirectory = webPaths.webDirectory,
  repositoryRoot = webPaths.repositoryRoot,
  runtime,
  runtimeEnv,
  execute = runManagedProcess,
} = {}) {
  await assertNoProductionEnvironmentFiles(webDirectory, repositoryRoot);
  await execute(runtime.bun.executablePath, ["run", "--shell=bun", "build"], {
    cwd: webDirectory,
    env: runtimeEnv,
  });
  await assertNoProductionEnvironmentFiles(webDirectory, repositoryRoot);
}

export function assertExpectedIdentity({
  benchmarkEligible,
  actualHead,
  expectedHead,
  actualRecordingDigest,
  expectedRecordingDigest,
  actualAttemptMarkerDigest,
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
    if (!/^[a-f\d]{64}$/u.test(actualAttemptMarkerDigest ?? ""))
      fail("E6_IDENTITY_ATTEMPT_MARKER_DIGEST_INVALID");
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
  return {
    head: actualHead,
    recordingDigest: actualRecordingDigest,
    ...(benchmarkEligible
      ? { attemptMarkerDigest: actualAttemptMarkerDigest }
      : {}),
  };
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

export function buildBenchmarkRawResult({
  completedUtc,
  measurementStartMarker,
  environment,
  runtime,
  arm,
} = {}) {
  return assertMeasurementRawResult({
    schema: 1,
    kind: "E6_MEASURE_RESULT",
    completedUtc,
    measurementStartDigest: measurementStartMarker.measurementStartDigest,
    label: "BENCHMARK",
    sourceKind: "live",
    sourceBase: environment.recording.metadata.sourceBase,
    provider: environment.recording.metadata.provider,
    benchmarkEligible: true,
    portsChecked: PREVIEW_PORTS,
    windowMs: environment.options.plan.windowMs,
    previewUrl: environment.previewUrl,
    fingerprint: environment.fingerprint,
    identity: environment.identity,
    runtime,
    attempt: environment.recording.metadata.attempt,
    scale: environment.recording.metadata.scale,
    arms: [arm],
  });
}

export function assertNaturalPollMargin({
  servedGeneratedUtc,
  manifest,
  windowMs,
  nowMs = Date.now(),
} = {}) {
  const ttlSeconds = manifest?.files?.live?.ttl_s;
  const ttlMs = ttlSeconds * 1000;
  const servedMs = Date.parse(servedGeneratedUtc);
  const alignmentAgeMs = nowMs - servedMs;
  const safetyMs = (ttlMs - windowMs) / 2;
  const remainingAfterWindowMs = ttlMs - alignmentAgeMs - windowMs;
  if (
    !Number.isFinite(ttlSeconds) ||
    ttlSeconds <= 0 ||
    ![ttlMs, servedMs, nowMs, windowMs].every(Number.isFinite) ||
    windowMs <= 0 ||
    ttlMs <= windowMs ||
    alignmentAgeMs < 0 ||
    remainingAfterWindowMs <= safetyMs
  ) {
    fail("E6_NATURAL_POLL_MARGIN_INVALID");
  }
  return {
    checkedUtc: new Date(nowMs).toISOString(),
    ttlMs,
    alignmentAgeMs,
    safetyMs,
    remainingAfterWindowMs,
  };
}

export async function installFingerprintVerification(page, fingerprint) {
  await page.route(`${fingerprint.origin}/_app/immutable/**`, async (route) => {
    const response = await route.fetch();
    const bytes = await response.body();
    assertServedAssetBytes(fingerprint, route.request().url(), bytes);
    await route.fulfill({ response, body: bytes });
  });
}

export async function closeMeasuredContext(context, vitalsAttempts, complete) {
  await context.close();
  if (complete) assertNoVitalsRequests(vitalsAttempts);
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
  assertReady = () => {},
}) {
  assertNaturalPollMargin({
    servedGeneratedUtc,
    manifest,
    windowMs,
    nowMs: now(),
  });
  assertReplayVehicleRequests(stats(), vehiclePath, alignedReplay, 0);
  await assertReady();
  const assertPublicationAllowed = () => {
    const readiness = assertReady();
    assertNaturalPollMargin({
      servedGeneratedUtc,
      manifest,
      windowMs,
      nowMs: now(),
    });
    assertReplayVehicleRequests(stats(), vehiclePath, alignedReplay, 0);
    return readiness;
  };
  await start(assertPublicationAllowed);
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
      const receipt = redProofReceipt(await readSampler(arm.page), {
        ...options,
        phase,
      });
      phases.push({
        phase,
        traceCount: receipt.proof.traceCount,
        minimumInjectedBlockMs: receipt.proof.minimumInjectedBlockMs,
        busy: receipt.busy,
        budget: receipt.budget,
      });
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
      minimumAcceptedServiceMs:
        options.redBlockMs + E6_BUSY_PROBE_CADENCE_MS / 2,
    },
    phases,
  };
}

async function measureArm(
  browser,
  options,
  environment,
  {
    prepareSamplerStart = async () => {},
    assertSamplerReady = () => {},
    claimSamplerStart = async () => null,
  } = {},
) {
  if (
    typeof prepareSamplerStart !== "function" ||
    typeof assertSamplerReady !== "function" ||
    typeof claimSamplerStart !== "function"
  ) {
    fail("E6_MEASUREMENT_START_CALLBACK_INVALID");
  }
  const plan = options.plan;
  const arm = await createArmContext(browser, {
    rate: plan.rate,
    storage: {
      "transit:motion-mode": plan.mode,
      "transit:controls-rail": "false",
    },
  });
  let result;
  let vitalsAttempts;
  let measurementStartMarker;
  try {
    await installSampler(arm.page);
    vitalsAttempts = await observeForbiddenVitals(arm.page);
    await installFingerprintVerification(arm.page, environment.fingerprint);
    const navigation = await arm.page.goto(environment.previewUrl, {
      waitUntil: "networkidle",
    });
    if (!navigation) fail("E6_FINGERPRINT_BROWSER_HTML_MISSING");
    assertServedHtmlBytes(environment.fingerprint, await navigation.body());
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
    await prepareSamplerStart();
    const startBoundary = await startMeasurementWindow({
      start: async (assertPublicationAllowed) => {
        measurementStartMarker = await claimSamplerStart(
          assertPublicationAllowed,
        );
        await startSampler(arm.page, options.durationMs);
      },
      stats: () => environment.replay.stats(),
      alignedReplay,
      vehiclePath,
      servedGeneratedUtc: alignmentDelivery.delivery.servedGeneratedUtc,
      manifest: environment.recording.payloads.get("manifest.json"),
      windowMs: options.durationMs,
      assertReady: () => {
        const readiness = assertSamplerReady();
        assertNoVitalsRequests(vitalsAttempts);
        return readiness;
      },
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
    const armResult = {
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
      eventTimingSupported: evidence.eventTimingSupported,
      percentileMethod: PERCENTILE_METHOD,
      interactionTiming: interactionBudget,
      budgets: { busy: busyBudget, interaction: interactionBudget },
      verdict,
      scored: true,
    };
    result = { arm: armResult, measurementStartMarker };
  } finally {
    await closeMeasuredContext(arm.context, vitalsAttempts, result !== undefined);
  }
  return result;
}

async function startPreview(replayBaseUrl, runtime, env) {
  const webDirectory = webPaths.webDirectory;
  const runtimeHome = await mkdtemp(join(tmpdir(), "transit-e6-runtime-"));
  await mkdir(join(runtimeHome, ".config"), { mode: 0o700 });
  await mkdir(join(runtimeHome, ".config-empty"), { mode: 0o700 });
  const runtimeEnv = previewEnvironment(
    env,
    replayBaseUrl,
    runtime,
    runtimeHome,
  );
  let child;
  try {
    await buildPreviewAssets({ webDirectory, runtime, runtimeEnv });
    child = startManagedProcess(
      runtime.bun.executablePath,
      [
        "run",
        "--shell=bun",
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
    previewRuntimeHomes.set(child, runtimeHome);
    await waitForHttp("http://127.0.0.1:4217/", { child });
    return child;
  } catch (error) {
    await stopPreview(child);
    if (!child) await rm(runtimeHome, { recursive: true, force: true });
    throw error;
  }
}

async function stopPreview(child) {
  const runtimeHome = child && previewRuntimeHomes.get(child);
  try {
    await stopManagedProcess(child);
  } finally {
    if (child) previewRuntimeHomes.delete(child);
    if (runtimeHome) await rm(runtimeHome, { recursive: true, force: true });
  }
}

async function readPreviewFingerprint({ previewUrl, head }) {
  const response = await fetch(previewUrl, { redirect: "error" });
  if (!response.ok) fail(`E6_PREVIEW_FETCH_FAILED status=${response.status}`);
  return fingerprintServedBuild({
    head,
    origin: new URL(previewUrl).origin,
    html: await response.text(),
    clientRoot: webPaths.clientRoot,
  });
}

async function settleCleanupOperations(operations) {
  const results = await Promise.allSettled(
    operations.map((operation) => Promise.resolve().then(operation)),
  );
  return results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
}

async function failEnvironmentStart(error, cleanupOperations) {
  const cleanupErrors = await settleCleanupOperations(cleanupOperations);
  if (cleanupErrors.length > 0) {
    const primaryMessage = error instanceof Error ? error.message : String(error);
    const cleanupMessage = cleanupErrors
      .map((cleanupError) =>
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError),
      )
      .join("|");
    throw new AggregateError(
      [error, ...cleanupErrors],
      `E6_ENVIRONMENT_START_CLEANUP_FAILED primary=${primaryMessage} cleanup=${cleanupMessage}`,
      { cause: error },
    );
  }
  throw error;
}

function cleanupResourceOnce(resource, operation) {
  if (resource == null) return Promise.resolve();
  let cleanup = resourceCleanupPromises.get(resource);
  if (!cleanup) {
    cleanup = operationPromise(() => operation(resource));
    resourceCleanupPromises.set(resource, cleanup);
  }
  return cleanup;
}

export async function cleanupMeasurementRun(
  resources = {},
  {
    closeBrowser = (browser) => browser.close(),
    stopPreview: stopPreviewResource = stopPreview,
    closeReplay = (replay) => replay.close(),
  } = {},
) {
  const { browser, preview, replay } = resources;
  const cleanupErrors = await settleCleanupOperations([
    ...(browser
      ? [() => cleanupResourceOnce(browser, closeBrowser)]
      : []),
    ...(preview
      ? [() => cleanupResourceOnce(preview, stopPreviewResource)]
      : []),
    ...(replay ? [() => cleanupResourceOnce(replay, closeReplay)] : []),
  ]);
  if (cleanupErrors.length === 0) return;

  const hasPrimaryError = Object.prototype.hasOwnProperty.call(
    resources,
    "primaryError",
  );
  const errors = hasPrimaryError
    ? [resources.primaryError, ...cleanupErrors]
    : cleanupErrors;
  throw new AggregateError(
    errors,
    `E6_MEASUREMENT_CLEANUP_FAILED count=${cleanupErrors.length}`,
    { cause: hasPrimaryError ? resources.primaryError : cleanupErrors[0] },
  );
}

function operationPromise(operation) {
  try {
    return Promise.resolve(operation());
  } catch (error) {
    return Promise.reject(error);
  }
}

export function installMeasurementSignalHandlers({
  processTarget = process,
  getResources = () => ({}),
  getRunCompletion = () => Promise.resolve(),
  requestShutdown = requestManagedProcessShutdown,
  cleanupRun = cleanupMeasurementRun,
  reportError = (error) => process.stderr.write(`${error.message}\n`),
  exit = (code) => process.exit(code),
} = {}) {
  const exitCodes = { SIGINT: 130, SIGTERM: 143 };
  let shutdownPromise;

  const handleSignal = (signal) => {
    if (shutdownPromise) return shutdownPromise;
    const managedShutdown = operationPromise(() => requestShutdown());
    const resourceCleanup = operationPromise(() => cleanupRun(getResources()));
    const runCompletion = operationPromise(() => getRunCompletion());
    shutdownPromise = Promise.allSettled([
      managedShutdown,
      resourceCleanup,
      runCompletion,
    ]).then((results) => {
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length > 0) {
        const error = new AggregateError(
          errors,
          `E6_SIGNAL_SHUTDOWN_FAILED signal=${signal}`,
        );
        try {
          reportError(error);
        } catch {}
      }
      exit(exitCodes[signal]);
    });
    return shutdownPromise;
  };

  const handlers = Object.fromEntries(
    Object.keys(exitCodes).map((signal) => [
      signal,
      () => handleSignal(signal),
    ]),
  );
  for (const [signal, handler] of Object.entries(handlers)) {
    processTarget.on(signal, handler);
  }
  return {
    dispose() {
      for (const [signal, handler] of Object.entries(handlers)) {
        processTarget.removeListener(signal, handler);
      }
    },
    get requested() {
      return shutdownPromise !== undefined;
    },
    handleSignal,
    waitForShutdown: () => shutdownPromise ?? Promise.resolve(),
  };
}

export async function startEnvironment(
  options,
  runtime,
  env,
  adapters = {},
) {
  const resources = adapters.resources;
  const run = {
    readDryHead: async () => {
      const { stdout } = await execFileAsync(
        "/usr/bin/git",
        ["--no-replace-objects", "rev-parse", "HEAD"],
        { cwd: fileURLToPath(new URL("../../", import.meta.url)) },
      );
      return stdout.trim();
    },
    assertPorts: assertPortsAvailable,
    startReplay: startReplayServer,
    startPreview,
    readFingerprint: readPreviewFingerprint,
    stopPreview,
    assertActive: async () => {},
    ...adapters,
  };
  const recording = options.dryRun
    ? createSyntheticRecording()
    : options.recordingDirectory
      ? await loadRecording(options.recordingDirectory)
      : fail("E6_RECORDING_REQUIRED provide --recording or E6_RECORDING_DIR");
  validateRecordingSnapshot(recording, {
    purpose: options.dryRun ? "dry-run" : "benchmark",
  });
  let gitIdentity;
  let marker;
  let actualHead;
  if (options.dryRun) {
    actualHead = await run.readDryHead();
  } else {
    gitIdentity = await readPublicGitIdentity();
    actualHead = gitIdentity.head;
    marker = await loadAttemptMarker({
      gitCommonDirectory: gitIdentity.gitCommonDirectory,
    });
    assertAttemptMarkerBinding({
      metadata: recording.metadata,
      marker,
      identity: gitIdentity,
      recordingDirectory: options.recordingDirectory,
    });
  }
  const actualRecordingDigest =
    recording.recordingDigest ?? recordingContentDigest(recording);
  const identity = assertExpectedIdentity({
    benchmarkEligible: recording.metadata.benchmarkEligible === true,
    actualHead,
    expectedHead: options.expectedHead,
    actualRecordingDigest,
    expectedRecordingDigest: options.expectedRecordingDigest,
    actualAttemptMarkerDigest: marker?.attemptMarkerDigest,
  });
  if (gitIdentity) identity.tree = gitIdentity.tree;
  await run.assertActive();
  await run.assertPorts(PREVIEW_PORTS);
  await run.assertActive();
  const replay = await run.startReplay(recording, { port: 4218 });
  if (resources) resources.replay = replay;
  let preview;
  try {
    await run.assertActive();
    preview = await run.startPreview(replay.baseUrl, runtime, env);
    if (resources) resources.preview = preview;
    await run.assertActive();
    const previewUrl = "http://127.0.0.1:4217/map";
    const fingerprint = await run.readFingerprint({
      previewUrl,
      head: actualHead,
    });
    await run.assertActive();
    return {
      options,
      recording,
      replay,
      preview,
      previewUrl,
      fingerprint,
      identity,
      gitIdentity,
      marker,
    };
  } catch (error) {
    await failEnvironmentStart(error, [
      () => cleanupResourceOnce(preview, run.stopPreview),
      () => cleanupResourceOnce(replay, (resource) => resource.close()),
    ]);
  }
}

export async function runBenchmarkLifecycle(
  {
    options,
    runtime,
    environment,
    env,
    resources,
    assertActive = () => {},
  },
  adapters = {},
) {
  const run = {
    assertPreclaim: assertMeasurementPreclaimReady,
    readPublicIdentity: readPublicGitIdentity,
    readLocalIdentity: readLocalGitIdentity,
    assertIdentity: assertGitIdentityUnchanged,
    assertProcess: assertManagedProcessRunning,
    assertBuildInputs: assertNoProductionEnvironmentFiles,
    recheckRuntime: recheckBenchmarkRuntime,
    buildStart: buildMeasurementStart,
    claimStart: claimMeasurementStartMarker,
    launchBrowser: launchChromium,
    assertBrowserVersion: assertBrowserRuntimeVersion,
    measure: measureArm,
    readFingerprint: readPreviewFingerprint,
    assertFingerprint: assertSameServedBuildFingerprint,
    buildRawResult: buildBenchmarkRawResult,
    writeResult: writeMeasurementRawResult,
    loadCompleted: loadCompletedMeasurement,
    now: () => new Date().toISOString(),
    assertActive,
    ...adapters,
  };
  const initialIdentity = environment.gitIdentity;
  run.assertActive();
  await run.assertPreclaim({
    gitCommonDirectory: initialIdentity.gitCommonDirectory,
    recordingDirectory: options.recordingDirectory,
    expectedRecordingDigest: environment.identity.recordingDigest,
  });
  let currentIdentity = await run.readPublicIdentity();
  run.assertIdentity(initialIdentity, currentIdentity);
  run.assertProcess(environment.preview);
  await run.recheckRuntime(runtime, {
    chromeExecutablePath: runtime.chrome.executablePath,
    env,
  });
  await run.assertBuildInputs();
  run.assertActive();
  let browser;
  try {
    browser = await run.launchBrowser({
      executablePath: runtime.chrome.executablePath,
    });
    if (resources) resources.browser = browser;
    run.assertActive();
    run.assertBrowserVersion(await browser.version(), runtime);
    const { arm, measurementStartMarker } = await run.measure(
      browser,
      options,
      environment,
      {
        prepareSamplerStart: async () => {
          const preclaimIdentity = await run.readPublicIdentity();
          run.assertIdentity(currentIdentity, preclaimIdentity);
          currentIdentity = preclaimIdentity;
          run.assertProcess(environment.preview);
          run.assertIdentity(
            currentIdentity,
            await run.readLocalIdentity(),
          );
          await run.recheckRuntime(runtime, {
            chromeExecutablePath: runtime.chrome.executablePath,
            env,
          });
          await run.assertBuildInputs();
          await run.assertPreclaim({
            gitCommonDirectory: currentIdentity.gitCommonDirectory,
            recordingDirectory: options.recordingDirectory,
            expectedRecordingDigest: environment.identity.recordingDigest,
          });
        },
        assertSamplerReady: () => {
          run.assertActive();
          run.assertProcess(environment.preview);
        },
        claimSamplerStart: (assertPublicationAllowed) =>
          run.claimStart({
            gitCommonDirectory: currentIdentity.gitCommonDirectory,
            measurementStart: run.buildStart({
              startedUtc: run.now(),
              identity: currentIdentity,
              attemptMarker: environment.marker,
              recordingDigest: environment.identity.recordingDigest,
              recordingDirectory: options.recordingDirectory,
              plan: options.plan,
              runtime,
              assetFingerprint: environment.fingerprint.fingerprint,
            }),
            assertPublicationAllowed,
          }),
      },
    );
    if (!measurementStartMarker) fail("E6_MEASUREMENT_START_MARKER_MISSING");
    run.assertProcess(environment.preview);
    run.assertFingerprint(
      environment.fingerprint,
      await run.readFingerprint({
        previewUrl: environment.previewUrl,
        head: environment.identity.head,
      }),
    );
    await run.assertBuildInputs();
    await run.recheckRuntime(runtime, {
      chromeExecutablePath: runtime.chrome.executablePath,
      env,
    });
    run.assertIdentity(currentIdentity, await run.readLocalIdentity());
    const stored = await run.writeResult({
      gitCommonDirectory: currentIdentity.gitCommonDirectory,
      recordingDirectory: options.recordingDirectory,
      beforePublish: async () => {
        await run.assertBuildInputs();
        await run.recheckRuntime(runtime, {
          chromeExecutablePath: runtime.chrome.executablePath,
          env,
        });
        run.assertIdentity(currentIdentity, await run.readLocalIdentity());
      },
      rawResult: run.buildRawResult({
        completedUtc: run.now(),
        measurementStartMarker,
        environment,
        runtime,
        arm,
      }),
    });
    const completed = await run.loadCompleted({
      gitCommonDirectory: currentIdentity.gitCommonDirectory,
      recordingDirectory: options.recordingDirectory,
    });
    if (completed.result.rawResultDigest !== stored.rawResultDigest) {
      fail("E6_MEASUREMENT_FINAL_RELOAD_MISMATCH");
    }
    return completed;
  } finally {
    await cleanupMeasurementRun({ browser });
  }
}

function usage() {
  return "Usage: node tools/e6/e6-measure.mjs [--expected-head SHA] [--expected-recording-digest SHA256] [--duration-ms N] [--dry-run] [--red-proof] | --validate-result <recording-directory>";
}

function assertMeasurementRunActive(isShutdownRequested) {
  if (isShutdownRequested()) fail("E6_SIGNAL_SHUTDOWN_REQUESTED");
}

export async function main(
  args = process.argv.slice(2),
  env = process.env,
  { resources = {}, isShutdownRequested = () => false } = {},
) {
  const options = parseArgs(args, env);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (options.validateResult) {
    const completed = await validateStoredMeasurement(
      options.recordingDirectory,
    );
    print({
      kind: "E6_MEASURE_RESULT_VALIDATION",
      recordingDigest: completed.recordingDigest,
      measurementStartDigest:
        completed.measurementStartMarker.measurementStartDigest,
      resultDigest: completed.result.rawResultDigest,
      verdict: completed.result.verdict,
      passed: completed.result.passed,
    });
    return measurementExitCode({
      passed: completed.result.passed,
      validation: true,
    });
  }
  let preview;
  let replay;
  let browser;
  let primaryError;
  let hasPrimaryError = false;
  try {
    if (options.redProof) {
      assertMeasurementRunActive(isShutdownRequested);
      browser = await launchChromium();
      resources.browser = browser;
      assertMeasurementRunActive(isShutdownRequested);
      const result = await measureRedProof(browser, options);
      print({ kind: "E6_RED_PROOF_RESULT", ...result });
      return result.phases.every(({ budget }) => !budget.passed) ? 0 : 1;
    }
    if (!options.dryRun) assertCleanBenchmarkEnvironment(env);
    assertMeasurementRunActive(isShutdownRequested);
    const runtime = await preflightBenchmarkRuntime({
      chromeExecutablePath: resolveChromeExecutable(env),
      env,
    });
    assertMeasurementRunActive(isShutdownRequested);
    const environment = await startEnvironment(options, runtime, env, {
      resources,
      assertActive: () =>
        assertMeasurementRunActive(isShutdownRequested),
    });
    preview = environment.preview;
    replay = environment.replay;
    resources.preview = preview;
    resources.replay = replay;
    if (!options.dryRun) {
      const completed = await runBenchmarkLifecycle({
        options,
        runtime,
        environment,
        env,
        resources,
        assertActive: () =>
          assertMeasurementRunActive(isShutdownRequested),
      });
      print(completed.result.rawResult);
      return measurementExitCode({ passed: completed.result.passed });
    }
    await recheckBenchmarkRuntime(runtime, {
      chromeExecutablePath: runtime.chrome.executablePath,
      env,
    });
    assertMeasurementRunActive(isShutdownRequested);
    browser = await launchChromium({
      executablePath: runtime.chrome.executablePath,
    });
    resources.browser = browser;
    assertMeasurementRunActive(isShutdownRequested);
    assertBrowserRuntimeVersion(await browser.version(), runtime);
    const { arm } = await measureArm(browser, options, environment);
    print({
      kind: "E6_MEASURE_RESULT",
      label: "SYNTHETIC_DRY_RUN_NOT_A_BENCHMARK",
      sourceKind: environment.recording.metadata.sourceKind,
      benchmarkEligible: false,
      portsChecked: PREVIEW_PORTS,
      windowMs: options.durationMs,
      previewUrl: environment.previewUrl,
      fingerprint: environment.fingerprint,
      identity: environment.identity,
      runtime,
      attempt: null,
      scale: environment.recording.metadata.scale,
      arms: [arm],
    });
    return arm.verdict.passed ? 0 : 1;
  } catch (error) {
    primaryError = error;
    hasPrimaryError = true;
    throw error;
  } finally {
    await cleanupMeasurementRun({
      browser: resources.browser ?? browser,
      preview: resources.preview ?? preview,
      replay: resources.replay ?? replay,
      ...(hasPrimaryError ? { primaryError } : {}),
    });
  }
}

export function runMeasurementCli({
  args = process.argv.slice(2),
  env = process.env,
  processTarget = process,
  runMain = main,
  installSignals = installMeasurementSignalHandlers,
  signalOptions = {},
  writeError = (error) =>
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    ),
} = {}) {
  const resources = {};
  let settleRunCompletion;
  const runCompletion = new Promise((resolve) => {
    settleRunCompletion = resolve;
  });
  let runPromise;
  const signalController = installSignals({
    processTarget,
    getResources: () => resources,
    getRunCompletion: () => runCompletion,
    ...signalOptions,
  });
  runPromise = operationPromise(() =>
    runMain(args, env, {
      resources,
      isShutdownRequested: () => signalController.requested,
    }),
  );
  runPromise.then(settleRunCompletion, settleRunCompletion);
  const completion = runPromise.then(
    (code) => {
      if (signalController.requested) return;
      signalController.dispose();
      processTarget.exitCode = code;
    },
    (error) => {
      if (signalController.requested) return;
      signalController.dispose();
      writeError(error);
      processTarget.exitCode = 1;
    },
  );
  return { completion, resources, runPromise, signalController };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMeasurementCli();
}
