#!/usr/bin/env node
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  assertNoVitalsRequests,
  createArmContext,
  launchChromium,
  observeForbiddenVitals,
  runTrustedInteractions,
  waitForMapReady,
} from "./lib/browser.mjs";
import {
  assertPortsAvailable,
  startManagedProcess,
  stopManagedProcess,
  waitForHttp,
} from "./lib/process.mjs";
import {
  assertSamplerEvidence,
  assertSyntheticProof,
  installSampler,
  readSampler,
  startSampler,
} from "./lib/sampler.mjs";
import {
  PERCENTILE_METHOD,
  scoreArmVerdict,
  scoreBusyBudget,
  scoreInteractionBudget,
} from "./lib/stats.mjs";
import { assertAllArmsScored, buildMeasurementPlan } from "./lib/config.mjs";
import { loadRecording, recordingContentDigest } from "./lib/files.mjs";
import { fingerprintServedBuild } from "./lib/fingerprint.mjs";
import { validateRecordingSnapshot } from "./lib/recording.mjs";
import { startReplayServer } from "./lib/replay.mjs";
import { createSyntheticRecording } from "./lib/synthetic.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_DURATION_MS = 20_000;
const BUDGET_MS = 8;
const PREVIEW_PORTS = [4217, 4218, 4219, 4220, 4221, 4222, 4223];
export const webPaths = Object.freeze({
  webDirectory: fileURLToPath(new URL("../../apps/web/", import.meta.url)),
  clientRoot: fileURLToPath(
    new URL("../../apps/web/.svelte-kit/output/client", import.meta.url),
  ),
});

export function defaultPreviewUrl() {
  return "http://127.0.0.1:4217/map";
}

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
    url: env.E6_URL ?? null,
    recordingDirectory: env.E6_RECORDING_DIR ?? null,
    durationMs: numberOption(
      env.E6_DURATION_MS ?? DEFAULT_DURATION_MS,
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
    if (arg === "--url") options.url = value();
    else if (arg === "--recording") options.recordingDirectory = value();
    else if (arg === "--mode") value();
    else if (arg === "--rate") value();
    else if (arg === "--interactions") value();
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
    options.durationMs !== DEFAULT_DURATION_MS
  ) {
    fail(`E6_BENCHMARK_WINDOW_REQUIRED windowMs=${DEFAULT_DURATION_MS}`);
  }
  if (options.url) {
    const url = new URL(options.url);
    if (!["http:", "https:"].includes(url.protocol))
      fail(`E6_URL_INVALID ${options.url}`);
  }
  return options;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function blockImmediatelyAfterSamplerPost(page, blockMs) {
  await page.evaluate((duration) => {
    window.__e6AfterSamplerPostMessage = () => {
      const until = performance.now() + duration;
      while (performance.now() < until) {}
    };
  }, blockMs);
}

export function redProofReceipt(evidence, options) {
  const proof = assertSyntheticProof(evidence, {
    expectedBlockMs: options.redBlockMs,
    toleranceMs: options.redToleranceMs,
  });
  const budget = scoreBusyBudget(proof.summary.p95, BUDGET_MS);
  return {
    label: "SYNTHETIC_NOT_A_BENCHMARK",
    sourceKind: "synthetic",
    benchmarkEligible: false,
    proof: {
      expectedBlockMs: options.redBlockMs,
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

export async function runEvidenceWindow({ start, wait, runActions, read }) {
  for (const [name, value] of Object.entries({
    start,
    wait,
    runActions,
    read,
  })) {
    if (typeof value !== "function") fail(`E6_EVIDENCE_WINDOW_INVALID ${name}`);
  }
  await start();
  await wait();
  const actions = await runActions();
  const evidence = await read();
  return { actions, evidence };
}

export function bindRawEvidence({ busy, interactions } = {}) {
  if (!Array.isArray(busy) || !Array.isArray(interactions)) {
    fail("E6_RAW_EVIDENCE_INVALID");
  }
  return {
    busySamples: [...busy],
    eventTimingEntries: interactions.map((entry) => ({ ...entry })),
    percentileMethod: PERCENTILE_METHOD,
  };
}

async function measureRedProof(browser, options) {
  const arm = await createArmContext(browser, { rate: 1 });
  try {
    await installSampler(arm.page);
    await arm.page.goto(
      'data:text/html,<button aria-label="red proof blocker">red proof blocker</button>',
      { waitUntil: "load" },
    );
    await arm.page.getByRole("button", { name: "red proof blocker" }).click();
    await blockImmediatelyAfterSamplerPost(arm.page, options.redBlockMs);
    await startSampler(arm.page);
    await new Promise((resolve) => setTimeout(resolve, options.durationMs));
    const evidence = await readSampler(arm.page);
    return redProofReceipt(evidence, options);
  } finally {
    await arm.context.close();
  }
}

async function measureArm(browser, options, armPlan, environment) {
  const arm = await createArmContext(browser, {
    rate: armPlan.rate,
    storage: {
      "transit:motion-mode": armPlan.mode,
      "transit:controls-rail": "false",
    },
  });
  try {
    await installSampler(arm.page);
    const vitalsAttempts = await observeForbiddenVitals(arm.page);
    await arm.page.goto(environment.previewUrl, { waitUntil: "networkidle" });
    await waitForMapReady(arm.page);
    const measured = await runEvidenceWindow({
      start: () => startSampler(arm.page),
      wait: () =>
        new Promise((resolve) => setTimeout(resolve, options.durationMs)),
      runActions: () =>
        runTrustedInteractions(arm.page, {
          interactions: options.plan.interactions,
        }),
      read: () => readSampler(arm.page),
    });
    const evidence = assertSamplerEvidence(measured.evidence, {
      requireInteraction: true,
    });
    assertNoVitalsRequests(vitalsAttempts);
    const interactionBudget = scoreInteractionBudget(evidence.interactions, {
      requiredInteractions: options.plan.interactions,
    });
    const busyBudget = scoreBusyBudget(evidence.summary.p95, BUDGET_MS);
    const verdict = scoreArmVerdict({
      busyP95Ms: evidence.summary.p95,
      interactionP95Ms: interactionBudget.p95Ms,
      requestedActions: options.plan.interactions,
      completedActions: measured.actions.length,
    });
    const rawEvidence = bindRawEvidence(evidence);
    const benchmarkEligible =
      environment.recording.metadata.benchmarkEligible === true;
    return {
      label: benchmarkEligible
        ? "BENCHMARK"
        : "SYNTHETIC_DRY_RUN_NOT_A_BENCHMARK",
      sourceKind: environment.recording.metadata.sourceKind,
      benchmarkEligible,
      id: armPlan.id,
      mode: armPlan.mode,
      rate: armPlan.rate,
      fleetVehicles: armPlan.fleetVehicles,
      actions: measured.actions,
      forbiddenVitalsRequests: 0,
      busy: evidence.summary,
      ...rawEvidence,
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
    const previewUrl = options.url ?? defaultPreviewUrl();
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
  return "Usage: node tools/e6/e6-measure.mjs [--url URL] [--mode raw] [--rate 1] [--fleet-vehicles 3424] [--interactions N] [--expected-head SHA] [--expected-recording-digest SHA256] [--duration-ms N] [--dry-run] [--red-proof]";
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
      return result.budget.passed ? 1 : 0;
    }
    const environment = await startEnvironment(options);
    preview = environment.preview;
    replay = environment.replay;
    browser = await launchChromium();
    const arms = [];
    for (const arm of options.plan.arms)
      arms.push(await measureArm(browser, options, arm, environment));
    assertAllArmsScored(options.plan, arms);
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
      arms,
    });
    return arms.every((arm) => arm.verdict.passed) ? 0 : 1;
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
