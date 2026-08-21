import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import {
  assertAttempt,
  assertAttemptMarkerIdentity,
  assertAttemptMarkerRecording,
  attemptMarkerDigest,
  loadAttemptMarker,
} from "./attempt.mjs";
import { expectedTrustedActionNames } from "./browser.mjs";
import { E6_PROVIDER, E6_SOURCE_BASE } from "./capture-gate.mjs";
import { buildMeasurementPlan } from "./config.mjs";
import {
  assertDurableMarkerAbsent,
  canonicalJsonBytes,
  canonicalJsonDigest,
  durableMarkerPath,
  loadDurableMarker,
  publishDurableMarker,
  syncDurableDirectory,
} from "./durable-marker.mjs";
import { loadRecording, recordingContentDigest } from "./files.mjs";
import { assertServedBuildFingerprint } from "./fingerprint.mjs";
import { assertPublicGitIdentity } from "./identity.mjs";
import { validateRecordingSnapshot } from "./recording.mjs";
import { assertBenchmarkRuntimeReceipt } from "./runtime.mjs";
import { assertSamplerEvidence } from "./sampler.mjs";
import {
  PERCENTILE_METHOD,
  scoreArmVerdict,
  scoreBusyBudget,
  scoreInteractionBudget,
} from "./stats.mjs";

export const E6_MEASUREMENT_START_FILENAME =
  "b2-2026-08-24-measurement-start-1.json";
export const E6_MEASUREMENT_RAW_RESULT_FILENAME = "e6-measure-result.json";

const SHA_40 = /^[a-f\d]{40}$/u;
const SHA_256 = /^[a-f\d]{64}$/u;
const MAXIMUM_RAW_RESULT_BYTES = 16 * 1024 * 1024;

function fail(code) {
  throw new Error(code);
}

function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function isIsoInstant(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function sameValue(left, right) {
  return canonicalJsonBytes(left).equals(canonicalJsonBytes(right));
}

function assertFixedPlan(plan) {
  const fixed = buildMeasurementPlan();
  if (!exactKeys(plan, Object.keys(fixed)) || !sameValue(plan, fixed))
    fail("E6_MEASUREMENT_PLAN_INVALID");
  return plan;
}

export function assertMeasurementStart(start) {
  if (
    !exactKeys(start, [
      "schema",
      "startedUtc",
      "attemptMarkerDigest",
      "recording",
      "head",
      "tree",
      "plan",
      "runtime",
      "assetFingerprint",
    ]) ||
    start.schema !== 1 ||
    !isIsoInstant(start.startedUtc) ||
    !SHA_256.test(start.attemptMarkerDigest ?? "") ||
    !exactKeys(start.recording, ["basename", "digest"]) ||
    !start.recording.basename ||
    basename(start.recording.basename) !== start.recording.basename ||
    !SHA_256.test(start.recording.digest ?? "") ||
    !SHA_40.test(start.head ?? "") ||
    !SHA_40.test(start.tree ?? "") ||
    !SHA_256.test(start.assetFingerprint ?? "")
  ) {
    fail("E6_MEASUREMENT_START_INVALID");
  }
  assertFixedPlan(start.plan);
  try {
    assertBenchmarkRuntimeReceipt(start.runtime);
  } catch {
    fail("E6_MEASUREMENT_START_INVALID");
  }
  return start;
}

export function measurementStartDigest(start) {
  return canonicalJsonDigest(assertMeasurementStart(start));
}

export function measurementStartMarkerPath(gitCommonDirectory) {
  return durableMarkerPath(gitCommonDirectory, E6_MEASUREMENT_START_FILENAME);
}

function startReceipt(loaded) {
  return {
    measurementStart: loaded.value,
    measurementStartDigest: loaded.digest,
    markerPath: loaded.markerPath,
  };
}

function assertStartReceipt(marker) {
  if (
    !marker ||
    measurementStartDigest(marker.measurementStart) !==
      marker.measurementStartDigest
  ) {
    fail("E6_MEASUREMENT_START_MARKER_INVALID");
  }
  return marker;
}

function assertStartAttemptBinding(start, marker) {
  if (
    start.attemptMarkerDigest !== marker?.attemptMarkerDigest ||
    start.head !== marker?.attempt?.head ||
    start.tree !== marker?.attempt?.tree ||
    start.recording.basename !== marker?.attempt?.recordingBasename ||
    Date.parse(start.startedUtc) < Date.parse(marker?.attempt?.consumedUtc)
  ) {
    fail("E6_MEASUREMENT_ATTEMPT_MISMATCH");
  }
  return start;
}

export function buildMeasurementStart({
  startedUtc,
  identity,
  attemptMarker,
  recordingDigest,
  recordingDirectory,
  plan = buildMeasurementPlan(),
  runtime,
  assetFingerprint,
} = {}) {
  assertPublicGitIdentity(identity);
  assertAttemptMarkerIdentity({ marker: attemptMarker, identity });
  if (
    attemptMarker?.attemptMarkerDigest !==
    attemptMarkerDigest(attemptMarker?.attempt)
  ) {
    fail("E6_MEASUREMENT_ATTEMPT_MISMATCH");
  }
  const start = assertMeasurementStart({
    schema: 1,
    startedUtc,
    attemptMarkerDigest: attemptMarker.attemptMarkerDigest,
    recording: {
      basename: basename(resolve(recordingDirectory)),
      digest: recordingDigest,
    },
    head: identity.head,
    tree: identity.tree,
    plan,
    runtime,
    assetFingerprint,
  });
  assertStartAttemptBinding(start, attemptMarker);
  return start;
}

export async function claimMeasurementStartMarker({
  measurementStart,
  gitCommonDirectory,
  assertPublicationAllowed,
} = {}) {
  if (typeof assertPublicationAllowed !== "function") {
    fail("E6_MEASUREMENT_PUBLICATION_ADMISSION_INVALID");
  }
  const start = assertMeasurementStart(measurementStart);
  assertStartAttemptBinding(
    start,
    await loadAttemptMarker({ gitCommonDirectory }),
  );
  return startReceipt(
    await publishDurableMarker({
      gitCommonDirectory,
      filename: E6_MEASUREMENT_START_FILENAME,
      value: start,
      validate: assertMeasurementStart,
      alreadyConsumedCode: "E6_MEASUREMENT_ALREADY_STARTED",
      invalidCode: "E6_MEASUREMENT_START_MARKER_INVALID",
      assertPublicationAllowed,
    }),
  );
}

async function loadCanonicalMeasurementState({ gitCommonDirectory } = {}) {
  const loaded = await loadDurableMarker({
    gitCommonDirectory,
    filename: E6_MEASUREMENT_START_FILENAME,
    validate: assertMeasurementStart,
    invalidCode: "E6_MEASUREMENT_START_MARKER_INVALID",
  });
  const attemptMarker = await loadAttemptMarker({ gitCommonDirectory });
  assertStartAttemptBinding(loaded.value, attemptMarker);
  return {
    measurementStartMarker: startReceipt(loaded),
    attemptMarker,
  };
}

function assertCanonicalMeasurementStateUnchanged(before, after) {
  if (
    before.measurementStartMarker.measurementStartDigest !==
      after.measurementStartMarker.measurementStartDigest ||
    !sameValue(
      before.measurementStartMarker.measurementStart,
      after.measurementStartMarker.measurementStart,
    ) ||
    before.attemptMarker.attemptMarkerDigest !==
      after.attemptMarker.attemptMarkerDigest ||
    !sameValue(before.attemptMarker.attempt, after.attemptMarker.attempt)
  ) {
    fail("E6_MEASUREMENT_LIFECYCLE_CHANGED");
  }
  return after;
}

export async function loadMeasurementStartMarker({ gitCommonDirectory } = {}) {
  return (await loadCanonicalMeasurementState({ gitCommonDirectory }))
    .measurementStartMarker;
}

function recomputeArm(arm, plan) {
  if (
    !exactKeys(arm, [
      "label",
      "sourceKind",
      "sourceBase",
      "provider",
      "benchmarkEligible",
      "id",
      "mode",
      "rate",
      "fleetVehicles",
      "actions",
      "tickObservation",
      "refreshEvidence",
      "pollAlignment",
      "replay",
      "forbiddenVitalsRequests",
      "busy",
      "busySamples",
      "busyProbes",
      "busyProbeCadenceMs",
      "windowStartedAt",
      "stopRequestedAt",
      "requestedWindowMs",
      "observedWindowMs",
      "workloadCompletedAt",
      "eventTimingSupported",
      "eventTimingEntries",
      "percentileMethod",
      "interactionTiming",
      "budgets",
      "verdict",
      "scored",
    ]) ||
    arm.label !== "BENCHMARK" ||
    arm.sourceKind !== "live" ||
    arm.sourceBase !== E6_SOURCE_BASE ||
    arm.provider !== E6_PROVIDER ||
    arm.benchmarkEligible !== true ||
    arm.forbiddenVitalsRequests !== 0
  ) {
    fail("E6_MEASUREMENT_RAW_RESULT_INVALID");
  }
  assertArmReplayEvidence(arm, plan);
  if (
    arm?.id !== plan.id ||
    arm.mode !== plan.mode ||
    arm.rate !== plan.rate ||
    arm.fleetVehicles !== plan.fleetVehicles ||
    arm.scored !== true ||
    arm.eventTimingSupported !== true ||
    !sameValue(arm.actions, expectedTrustedActionNames(plan.interactions))
  ) {
    fail("E6_MEASUREMENT_RAW_RESULT_INVALID");
  }
  const evidence = assertSamplerEvidence(
    {
      busyProbes: arm.busyProbes,
      busyProbeCadenceMs: arm.busyProbeCadenceMs,
      windowStartedAt: arm.windowStartedAt,
      stopRequestedAt: arm.stopRequestedAt,
      workloadCompletedAt: arm.workloadCompletedAt,
      interactions: arm.eventTimingEntries,
      eventTimingSupported: arm.eventTimingSupported,
    },
    { requireInteraction: true, requiredWindowMs: plan.windowMs },
  );
  const busy = scoreBusyBudget(evidence.summary.p95, plan.busyBudgetMs);
  const interaction = scoreInteractionBudget(evidence.interactions, {
    requiredInteractions: plan.interactions,
    budgetMs: plan.interactionBudgetMs,
  });
  const verdict = scoreArmVerdict({
    busyPassed: busy.passed,
    interactionPassed: interaction.passed,
    requestedActions: plan.interactions,
    completedActions: arm.actions.length,
  });
  if (
    !sameValue(arm.busySamples, evidence.busy) ||
    !sameValue(arm.busy, evidence.summary) ||
    arm.requestedWindowMs !== evidence.requestedWindowMs ||
    arm.observedWindowMs !== evidence.observedWindowMs ||
    arm.percentileMethod !== PERCENTILE_METHOD ||
    !sameValue(arm.interactionTiming, interaction) ||
    !sameValue(arm.budgets, { busy, interaction }) ||
    !sameValue(arm.verdict, verdict)
  ) {
    fail("E6_MEASUREMENT_RAW_RESULT_INVALID");
  }
  return verdict;
}

function assertIso(value) {
  if (!isIsoInstant(value)) fail("E6_MEASUREMENT_RAW_RESULT_INVALID");
  return value;
}

function assertArmReplayEvidence(arm, plan) {
  const poll = arm.pollAlignment;
  if (
    !exactKeys(poll, [
      "checkedUtc",
      "ttlMs",
      "alignmentAgeMs",
      "safetyMs",
      "remainingAfterWindowMs",
    ]) ||
    !isIsoInstant(poll.checkedUtc) ||
    ![
      poll.ttlMs,
      poll.alignmentAgeMs,
      poll.safetyMs,
      poll.remainingAfterWindowMs,
    ].every(Number.isFinite) ||
    poll.ttlMs <= plan.windowMs ||
    poll.alignmentAgeMs < 0 ||
    poll.safetyMs !== (poll.ttlMs - plan.windowMs) / 2 ||
    poll.remainingAfterWindowMs !==
      poll.ttlMs - poll.alignmentAgeMs - plan.windowMs ||
    poll.remainingAfterWindowMs <= poll.safetyMs
  ) {
    fail("E6_MEASUREMENT_RAW_RESULT_INVALID");
  }
  const tick = arm.tickObservation;
  if (
    !exactKeys(tick, ["initialTickKey", "observedTickKeys"]) ||
    !Array.isArray(tick.observedTickKeys) ||
    tick.observedTickKeys.length !== 2
  ) {
    fail("E6_MEASUREMENT_RAW_RESULT_INVALID");
  }
  const ticks = [tick.initialTickKey, ...tick.observedTickKeys].map(assertIso);
  if (
    new Set(ticks).size !== ticks.length ||
    ticks.some(
      (value, index) =>
        index > 0 && Date.parse(value) <= Date.parse(ticks[index - 1]),
    ) ||
    poll.alignmentAgeMs !==
      Date.parse(poll.checkedUtc) - Date.parse(tick.initialTickKey)
  ) {
    fail("E6_MEASUREMENT_RAW_RESULT_INVALID");
  }
  if (!Array.isArray(arm.refreshEvidence) || arm.refreshEvidence.length !== 2) {
    fail("E6_MEASUREMENT_RAW_RESULT_INVALID");
  }
  const replay = arm.replay;
  if (
    !exactKeys(replay, [
      "vehicleEndpoint",
      "vehicleTicks",
      "vehicleDeliveries",
    ]) ||
    !exactKeys(replay.vehicleEndpoint, ["path", "served"]) ||
    typeof replay.vehicleEndpoint.path !== "string" ||
    !replay.vehicleEndpoint.path ||
    replay.vehicleEndpoint.served !== 2 ||
    !Array.isArray(replay.vehicleTicks) ||
    replay.vehicleTicks.length !== 2 ||
    !Array.isArray(replay.vehicleDeliveries) ||
    replay.vehicleDeliveries.length !== 2
  ) {
    fail("E6_MEASUREMENT_RAW_RESULT_INVALID");
  }
  const paths = [];
  for (const [index, evidence] of arm.refreshEvidence.entries()) {
    const replayTick = replay.vehicleTicks[index];
    const replayDelivery = replay.vehicleDeliveries[index];
    if (
      !exactKeys(evidence, ["request", "delivery", "processed"]) ||
      !exactKeys(evidence.request, ["path", "served"]) ||
      !exactKeys(evidence.delivery, ["recordedPath", "servedGeneratedUtc"]) ||
      !exactKeys(evidence.processed, ["tickKey", "vehicleCount"]) ||
      !exactKeys(replayTick, ["path", "served"]) ||
      !exactKeys(replayDelivery, ["recordedPath", "servedGeneratedUtc"]) ||
      evidence.request.path !== replay.vehicleEndpoint.path ||
      evidence.request.served !== 1 ||
      evidence.processed.tickKey !== tick.observedTickKeys[index] ||
      evidence.processed.vehicleCount !== plan.fleetVehicles ||
      evidence.delivery.servedGeneratedUtc !== tick.observedTickKeys[index] ||
      replayTick.path !== evidence.delivery.recordedPath ||
      replayTick.served !== 1 ||
      !sameValue(replayDelivery, evidence.delivery)
    ) {
      fail("E6_MEASUREMENT_RAW_RESULT_INVALID");
    }
    paths.push(evidence.delivery.recordedPath);
  }
  if (new Set(paths).size !== 2) fail("E6_MEASUREMENT_RAW_RESULT_INVALID");
}

export function assertMeasurementRawResult(rawResult) {
  try {
    const plan = buildMeasurementPlan();
    const arm = rawResult?.arms?.[0];
    if (
      !exactKeys(rawResult, [
        "schema",
        "kind",
        "completedUtc",
        "measurementStartDigest",
        "label",
        "sourceKind",
        "sourceBase",
        "provider",
        "benchmarkEligible",
        "portsChecked",
        "windowMs",
        "previewUrl",
        "fingerprint",
        "identity",
        "runtime",
        "attempt",
        "scale",
        "arms",
      ]) ||
      rawResult.schema !== 1 ||
      rawResult.kind !== "E6_MEASURE_RESULT" ||
      !isIsoInstant(rawResult.completedUtc) ||
      !SHA_256.test(rawResult.measurementStartDigest ?? "") ||
      rawResult.label !== "BENCHMARK" ||
      rawResult.sourceKind !== "live" ||
      rawResult.sourceBase !== E6_SOURCE_BASE ||
      rawResult.provider !== E6_PROVIDER ||
      rawResult.benchmarkEligible !== true ||
      !sameValue(rawResult.portsChecked, [4217, 4218]) ||
      rawResult.windowMs !== plan.windowMs ||
      rawResult.previewUrl !== "http://127.0.0.1:4217/map" ||
      !exactKeys(rawResult.identity, [
        "head",
        "tree",
        "recordingDigest",
        "attemptMarkerDigest",
      ]) ||
      !SHA_40.test(rawResult.identity.head ?? "") ||
      !SHA_40.test(rawResult.identity.tree ?? "") ||
      !SHA_256.test(rawResult.identity.recordingDigest ?? "") ||
      !SHA_256.test(rawResult.identity.attemptMarkerDigest ?? "") ||
      !rawResult.scale ||
      typeof rawResult.scale !== "object" ||
      Array.isArray(rawResult.scale) ||
      !Array.isArray(rawResult.arms) ||
      rawResult.arms.length !== 1
    ) {
      fail("E6_MEASUREMENT_RAW_RESULT_INVALID");
    }
    assertBenchmarkRuntimeReceipt(rawResult.runtime);
    assertServedBuildFingerprint(rawResult.fingerprint);
    if (
      rawResult.fingerprint.head !== rawResult.identity.head ||
      rawResult.fingerprint.origin !== "http://127.0.0.1:4217"
    ) {
      fail("E6_MEASUREMENT_RAW_RESULT_INVALID");
    }
    assertAttempt(rawResult.attempt);
    if (
      attemptMarkerDigest(rawResult.attempt) !==
      rawResult.identity.attemptMarkerDigest
    ) {
      fail("E6_MEASUREMENT_RAW_RESULT_INVALID");
    }
    recomputeArm(arm, plan);
    return rawResult;
  } catch {
    fail("E6_MEASUREMENT_RAW_RESULT_INVALID");
  }
}

export function measurementRawResultDigest(rawResult) {
  return canonicalJsonDigest(assertMeasurementRawResult(rawResult));
}

export function measurementRawResultPath(recordingDirectory) {
  if (
    typeof recordingDirectory !== "string" ||
    !isAbsolute(recordingDirectory) ||
    resolve(recordingDirectory) !== recordingDirectory
  ) {
    fail("E6_MEASUREMENT_RECORDING_DIRECTORY_INVALID");
  }
  return join(recordingDirectory, E6_MEASUREMENT_RAW_RESULT_FILENAME);
}

export async function assertMeasurementRawResultReady(recordingDirectory) {
  const path = measurementRawResultPath(recordingDirectory);
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return path;
    throw error;
  }
  fail("E6_MEASUREMENT_RAW_RESULT_EXISTS");
}

export async function assertMeasurementOutputsReady({
  gitCommonDirectory,
  recordingDirectory,
} = {}) {
  await assertRecordingDirectory(recordingDirectory);
  await assertMeasurementRawResultReady(recordingDirectory);
  await assertDurableMarkerAbsent({
    gitCommonDirectory,
    filename: E6_MEASUREMENT_START_FILENAME,
    existsCode: "E6_MEASUREMENT_ALREADY_STARTED",
  });
}

function publicationOperation(operations, name, fallback) {
  const operation = operations?.[name] ?? fallback;
  if (typeof operation !== "function") {
    fail("E6_MEASUREMENT_RAW_RESULT_PUBLICATION_FAILED");
  }
  return operation;
}

async function probeRawResultPublication(
  recordingDirectory,
  publicationOperations,
) {
  const openFile = publicationOperation(publicationOperations, "open", open);
  const linkFile = publicationOperation(publicationOperations, "link", link);
  const unlinkFile = publicationOperation(
    publicationOperations,
    "unlink",
    unlink,
  );
  const syncDirectory = publicationOperation(
    publicationOperations,
    "syncDirectory",
    syncDurableDirectory,
  );
  const token = randomUUID();
  const source = join(
    recordingDirectory,
    `.${token}.measurement-publication-probe-source`,
  );
  const target = join(
    recordingDirectory,
    `.${token}.measurement-publication-probe-link`,
  );
  let handle;
  let sourceCreated = false;
  let targetCreated = false;
  try {
    handle = await openFile(
      source,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
      0o600,
    );
    sourceCreated = true;
    await handle.chmod(0o600);
    await handle.writeFile("e6-measurement-publication-probe\n");
    await handle.sync();
    const sourceStats = await handle.stat();
    if (
      !sourceStats.isFile() ||
      sourceStats.nlink !== 1 ||
      (sourceStats.mode & 0o777) !== 0o600
    ) {
      fail("E6_MEASUREMENT_RAW_RESULT_PUBLICATION_FAILED");
    }
    await handle.close();
    handle = undefined;

    await linkFile(source, target);
    targetCreated = true;
    await syncDirectory(recordingDirectory);
    try {
      await linkFile(source, target);
      fail("E6_MEASUREMENT_RAW_RESULT_PUBLICATION_FAILED");
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    await unlinkFile(target);
    targetCreated = false;
    await unlinkFile(source);
    sourceCreated = false;
    await syncDirectory(recordingDirectory);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("E6_")) {
      throw error;
    }
    if (["ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes(error?.code)) {
      fail("E6_MEASUREMENT_RAW_RESULT_PUBLICATION_UNSUPPORTED");
    }
    fail("E6_MEASUREMENT_RAW_RESULT_PUBLICATION_FAILED");
  } finally {
    await handle?.close().catch(() => {});
    if (targetCreated) await unlinkFile(target).catch(() => {});
    if (sourceCreated) await unlinkFile(source).catch(() => {});
    if (targetCreated || sourceCreated) {
      await syncDirectory(recordingDirectory).catch(() => {});
    }
  }
}

export async function assertMeasurementPreclaimReady({
  gitCommonDirectory,
  recordingDirectory,
  expectedRecordingDigest,
  publicationOperations,
} = {}) {
  await assertMeasurementOutputsReady({
    gitCommonDirectory,
    recordingDirectory,
  });
  const beforeProbe = await loadPreclaimState({
    gitCommonDirectory,
    recordingDirectory,
    expectedRecordingDigest,
  });
  await probeRawResultPublication(recordingDirectory, publicationOperations);
  await assertMeasurementOutputsReady({
    gitCommonDirectory,
    recordingDirectory,
  });
  const afterProbe = await loadPreclaimState({
    gitCommonDirectory,
    recordingDirectory,
    expectedRecordingDigest,
  });
  if (
    beforeProbe.recording.recordingDigest !==
      afterProbe.recording.recordingDigest ||
    beforeProbe.attemptMarker.attemptMarkerDigest !==
      afterProbe.attemptMarker.attemptMarkerDigest ||
    !sameValue(
      beforeProbe.attemptMarker.attempt,
      afterProbe.attemptMarker.attempt,
    )
  ) {
    fail("E6_MEASUREMENT_PRECLAIM_STATE_CHANGED");
  }
  return {
    recordingDigest: afterProbe.recording.recordingDigest,
    attemptMarkerDigest: afterProbe.attemptMarker.attemptMarkerDigest,
  };
}

async function loadPreclaimState({
  gitCommonDirectory,
  recordingDirectory,
  expectedRecordingDigest,
}) {
  const attemptMarker = await loadAttemptMarker({ gitCommonDirectory });
  const recording = await loadRecording(recordingDirectory);
  validateRecordingSnapshot(recording, { purpose: "benchmark" });
  assertAttemptMarkerRecording({
    metadata: recording.metadata,
    marker: attemptMarker,
    recordingDirectory,
  });
  if (
    !SHA_256.test(expectedRecordingDigest ?? "") ||
    recording.recordingDigest !== expectedRecordingDigest
  ) {
    fail("E6_MEASUREMENT_RECORDING_MISMATCH");
  }
  return { recording, attemptMarker };
}

async function assertRecordingDirectory(recordingDirectory) {
  const stats = await lstat(recordingDirectory);
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    (stats.mode & 0o777) !== 0o700
  )
    fail("E6_MEASUREMENT_RECORDING_DIRECTORY_INVALID");
}

function rawReceipt(rawResult, rawResultPath) {
  const derivedVerdict = recomputeArm(
    rawResult.arms[0],
    buildMeasurementPlan(),
  );
  return {
    rawResult,
    rawResultDigest: measurementRawResultDigest(rawResult),
    rawResultBasename: E6_MEASUREMENT_RAW_RESULT_FILENAME,
    rawResultPath,
    verdict: derivedVerdict.verdict,
    passed: derivedVerdict.passed,
  };
}

export async function loadMeasurementRawResult({
  recordingDirectory,
  measurementStartMarker,
} = {}) {
  const path = measurementRawResultPath(recordingDirectory);
  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    const stats = await handle.stat();
    if (
      !stats.isFile() ||
      (stats.mode & 0o777) !== 0o600 ||
      stats.size < 2 ||
      stats.size > MAXIMUM_RAW_RESULT_BYTES
    ) {
      fail("E6_MEASUREMENT_RAW_RESULT_INVALID");
    }
    const bytes = await handle.readFile();
    const value = JSON.parse(bytes.toString("utf8"));
    assertMeasurementRawResult(value);
    if (!bytes.equals(canonicalJsonBytes(value)))
      fail("E6_MEASUREMENT_RAW_RESULT_INVALID");
    return assertRawBinding(rawReceipt(value, path), measurementStartMarker);
  } catch {
    fail("E6_MEASUREMENT_RAW_RESULT_INVALID");
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

export async function writeMeasurementRawResult({
  gitCommonDirectory,
  recordingDirectory,
  rawResult,
  beforePublish = async () => {},
} = {}) {
  assertMeasurementRawResult(rawResult);
  const rawResultBytes = canonicalJsonBytes(rawResult);
  if (rawResultBytes.byteLength > MAXIMUM_RAW_RESULT_BYTES) {
    fail("E6_MEASUREMENT_RAW_RESULT_TOO_LARGE");
  }
  const path = measurementRawResultPath(recordingDirectory);
  await assertRecordingDirectory(recordingDirectory);
  const canonicalState = await loadCanonicalMeasurementState({
    gitCommonDirectory,
  });
  const { measurementStartMarker } = canonicalState;
  const result = assertRawBinding(
    rawReceipt(rawResult, path),
    measurementStartMarker,
  );
  const recording = await loadRecording(recordingDirectory);
  assertCompletedMeasurementBinding({
    recording,
    recordingDirectory,
    measurementStartMarker,
    result,
  });
  const temporary = join(
    recordingDirectory,
    `.${randomUUID()}.measurement-result.tmp`,
  );
  let handle;
  let temporaryCreated = false;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
      0o600,
    );
    temporaryCreated = true;
    await handle.chmod(0o600);
    await handle.writeFile(rawResultBytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await beforePublish();
    const sealedRecording = await loadRecording(recordingDirectory);
    assertCompletedMeasurementBinding({
      recording: sealedRecording,
      recordingDirectory,
      measurementStartMarker,
      result,
    });
    const sealState = assertCanonicalMeasurementStateUnchanged(
      canonicalState,
      await loadCanonicalMeasurementState({ gitCommonDirectory }),
    );
    assertRawBinding(result, sealState.measurementStartMarker);
    assertCompletedMeasurementBinding({
      recording: sealedRecording,
      recordingDirectory,
      measurementStartMarker: sealState.measurementStartMarker,
      result,
    });
    try {
      await link(temporary, path);
    } catch (error) {
      if (error?.code === "EEXIST") fail("E6_MEASUREMENT_RAW_RESULT_EXISTS");
      throw error;
    }
    await syncDurableDirectory(dirname(path));
    const loaded = await loadMeasurementRawResult({
      recordingDirectory,
      measurementStartMarker,
    });
    if (!sameValue(loaded.rawResult, rawResult))
      fail("E6_MEASUREMENT_RAW_RESULT_INVALID");
    return loaded;
  } catch (error) {
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (temporaryCreated) {
      const removed = await unlink(temporary)
        .then(() => true)
        .catch(() => false);
      if (removed)
        await syncDurableDirectory(recordingDirectory).catch(() => {});
    }
  }
}

function assertRawBinding(receipt, marker) {
  const start = assertStartReceipt(marker).measurementStart;
  const raw = receipt?.rawResult;
  if (
    !receipt ||
    measurementRawResultDigest(raw) !== receipt.rawResultDigest ||
    receipt.rawResultBasename !== E6_MEASUREMENT_RAW_RESULT_FILENAME ||
    raw.measurementStartDigest !== marker.measurementStartDigest ||
    Date.parse(raw.completedUtc) < Date.parse(start.startedUtc) ||
    raw.identity.head !== start.head ||
    raw.identity.tree !== start.tree ||
    raw.identity.recordingDigest !== start.recording.digest ||
    raw.identity.attemptMarkerDigest !== start.attemptMarkerDigest ||
    Date.parse(raw.arms[0].pollAlignment.checkedUtc) <
      Date.parse(start.startedUtc) ||
    Date.parse(raw.arms[0].pollAlignment.checkedUtc) -
      Date.parse(start.startedUtc) >
      5_000 ||
    Date.parse(raw.arms[0].pollAlignment.checkedUtc) >
      Date.parse(raw.arms[0].tickObservation.observedTickKeys[0]) ||
    Date.parse(raw.arms[0].pollAlignment.checkedUtc) >
      Date.parse(raw.completedUtc) ||
    Date.parse(raw.arms[0].tickObservation.initialTickKey) >
      Date.parse(start.startedUtc) ||
    raw.arms[0].tickObservation.observedTickKeys.some(
      (tick) =>
        Date.parse(tick) < Date.parse(start.startedUtc) ||
        Date.parse(tick) > Date.parse(raw.completedUtc),
    ) ||
    raw.fingerprint.fingerprint !== start.assetFingerprint ||
    !sameValue(raw.runtime, start.runtime) ||
    !sameValue(
      {
        id: raw.arms[0].id,
        mode: raw.arms[0].mode,
        rate: raw.arms[0].rate,
        fleetVehicles: raw.arms[0].fleetVehicles,
      },
      {
        id: start.plan.id,
        mode: start.plan.mode,
        rate: start.plan.rate,
        fleetVehicles: start.plan.fleetVehicles,
      },
    )
  ) {
    fail("E6_MEASUREMENT_RAW_RESULT_MISMATCH");
  }
  return receipt;
}

function assertCompletedMeasurementBinding({
  recording,
  recordingDirectory,
  measurementStartMarker,
  result,
}) {
  validateRecordingSnapshot(recording, { purpose: "benchmark" });
  const start = assertStartReceipt(measurementStartMarker).measurementStart;
  const raw = result.rawResult;
  const arm = raw.arms[0];
  const recordingDigest =
    recording.recordingDigest ?? recordingContentDigest(recording);
  const expectedVehiclePaths = recording.metadata.vehicleTickPaths;
  const expectedVehicleEndpoint = recording.metadata.paths?.vehicles;
  const expectedTtlMs =
    Number(recording.payloads.get("manifest.json")?.files?.live?.ttl_s) * 1000;
  if (
    basename(resolve(recordingDirectory)) !== start.recording.basename ||
    recordingDigest !== start.recording.digest ||
    Date.parse(recording.metadata.capturedUtc) > Date.parse(start.startedUtc) ||
    Date.parse(raw.completedUtc) - Date.parse(start.startedUtc) <
      start.plan.windowMs ||
    attemptMarkerDigest(recording.metadata.attempt) !==
      start.attemptMarkerDigest ||
    !sameValue(recording.metadata.attempt, raw.attempt) ||
    !sameValue(recording.metadata.scale, raw.scale) ||
    recording.metadata.sourceKind !== raw.sourceKind ||
    recording.metadata.sourceBase !== raw.sourceBase ||
    recording.metadata.provider !== raw.provider ||
    recording.metadata.label !== "weekday-rush" ||
    arm.replay.vehicleEndpoint.path !== expectedVehicleEndpoint ||
    !sameValue(
      arm.replay.vehicleTicks.map(({ path }) => path),
      expectedVehiclePaths,
    ) ||
    arm.pollAlignment.ttlMs !== expectedTtlMs
  ) {
    fail("E6_MEASUREMENT_RECORDING_MISMATCH");
  }
  return { recordingDigest, measurementStartMarker, result };
}

export async function loadCompletedMeasurement({
  gitCommonDirectory,
  recordingDirectory,
} = {}) {
  await assertRecordingDirectory(recordingDirectory);
  const recording = await loadRecording(recordingDirectory);
  const measurementStartMarker = await loadMeasurementStartMarker({
    gitCommonDirectory,
  });
  const result = await loadMeasurementRawResult({
    recordingDirectory,
    measurementStartMarker,
  });
  return assertCompletedMeasurementBinding({
    recording,
    recordingDirectory,
    measurementStartMarker,
    result,
  });
}
