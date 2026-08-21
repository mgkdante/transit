import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import {
  link as hardlink,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  attemptMarkerDigest,
  buildAttempt,
  claimAttemptMarker,
} from "../lib/attempt.mjs";
import { expectedTrustedActionNames } from "../lib/browser.mjs";
import { buildMeasurementPlan } from "../lib/config.mjs";
import {
  canonicalJsonBytes,
  E6_DURABLE_MARKER_DIRECTORY,
} from "../lib/durable-marker.mjs";
import { recordingContentDigest, writeRecording } from "../lib/files.mjs";
import {
  assertMeasurementPreclaimReady,
  assertMeasurementOutputsReady,
  assertMeasurementRawResult,
  buildMeasurementStart,
  claimMeasurementStartMarker,
  loadCompletedMeasurement,
  loadMeasurementRawResult,
  loadMeasurementStartMarker,
  measurementRawResultPath,
  measurementStartMarkerPath,
  writeMeasurementRawResult,
} from "../lib/measurement-attempt.mjs";
import { evaluateCaptureGate } from "../lib/recording.mjs";
import { createSyntheticRecording } from "../lib/synthetic.mjs";
import {
  busySummary,
  scoreArmVerdict,
  scoreBusyBudget,
  scoreInteractionBudget,
} from "../lib/stats.mjs";

const HEAD = "4fcb603aa2d600d97061c26ee010a7212555dced";
const TREE = "45892764d7c65708a9c56467d444999ea2ca0d4b";
const RECORDING_DIGEST = "a".repeat(64);
const ASSET_FINGERPRINT = "b".repeat(64);

function allowPublication() {}

function fingerprint(pathPadding = "") {
  const htmlSha256 = "c".repeat(64);
  const path = `/_app/immutable/${pathPadding}entry/app.js`;
  const assets = [
    {
      path,
      url: `http://127.0.0.1:4217${path}`,
      sha256: "d".repeat(64),
    },
  ];
  return {
    head: HEAD,
    origin: "http://127.0.0.1:4217",
    htmlSha256,
    assetCount: 1,
    fingerprint: createHash("sha256")
      .update(`html:${htmlSha256}\n${assets[0].path}:${assets[0].sha256}`)
      .digest("hex"),
    assets,
  };
}

function runtime() {
  return Object.fromEntries(
    [
      ["node", "24.15.0"],
      ["bun", "1.3.11"],
      ["chrome", "148.0.7778.178"],
    ].map(([engine, version], index) => [
      engine,
      {
        engine,
        version,
        executablePath: `/opt/e6/${engine}`,
        binary: {
          device: 1,
          inode: index + 1,
          sizeBytes: 100 + index,
          modifiedMs: 1_000 + index,
        },
      },
    ]),
  );
}

function identity(gitCommonDirectory) {
  return {
    head: HEAD,
    tree: TREE,
    publicMainHead: HEAD,
    publicMainTree: TREE,
    remote: "https://github.com/mgkdante/transit.git",
    gitCommonDirectory,
    status: "",
  };
}

function recordingDirectory(root) {
  return join(root, "peak-20260824T120000Z");
}

async function attemptMarker(root) {
  return claimAttemptMarker({
    gitCommonDirectory: root,
    attempt: buildAttempt({
      consumedUtc: "2026-08-24T12:00:00.000Z",
      identity: identity(root),
      recordingDirectory: recordingDirectory(root),
    }),
  });
}

function buildStart(
  root,
  marker,
  startedUtc = "2026-08-24T12:01:00.000Z",
  recordingDigest = RECORDING_DIGEST,
  served = fingerprint(),
) {
  return buildMeasurementStart({
    startedUtc,
    identity: identity(root),
    attemptMarker: marker,
    recordingDigest,
    recordingDirectory: recordingDirectory(root),
    runtime: runtime(),
    assetFingerprint: served.fingerprint,
  });
}

function fixedProbes(serviceMs = 4) {
  const probes = [];
  let scheduledAt = 0;
  while (scheduledAt < 20_000) {
    const sampledAt = scheduledAt + serviceMs;
    probes.push({ scheduledAt, postedAt: scheduledAt, sampledAt });
    scheduledAt = sampledAt;
  }
  return probes;
}

function rawResult(
  startMarker,
  attempt,
  verdictName = "PASS",
  served = fingerprint(),
) {
  const start = startMarker.measurementStart;
  const plan = buildMeasurementPlan();
  const busyProbes = fixedProbes();
  const busySamples = busyProbes.map(
    ({ scheduledAt, sampledAt }) => sampledAt - scheduledAt,
  );
  const eventTimingEntries = Array.from(
    { length: plan.interactions },
    (_, index) => ({
      interactionId: index + 1,
      duration: verdictName === "PASS" ? 100 : 250,
    }),
  );
  const busy = busySummary(busySamples);
  const busyBudget = scoreBusyBudget(busy.p95, plan.busyBudgetMs);
  const interactionBudget = scoreInteractionBudget(eventTimingEntries, {
    requiredInteractions: plan.interactions,
    budgetMs: plan.interactionBudgetMs,
  });
  const actions = expectedTrustedActionNames(plan.interactions);
  const verdict = scoreArmVerdict({
    busyPassed: busyBudget.passed,
    interactionPassed: interactionBudget.passed,
    requestedActions: plan.interactions,
    completedActions: actions.length,
  });
  assert.equal(verdict.verdict, verdictName);
  return {
    schema: 1,
    kind: "E6_MEASURE_RESULT",
    completedUtc: "2026-08-24T12:02:00.000Z",
    measurementStartDigest: startMarker.measurementStartDigest,
    label: "BENCHMARK",
    sourceKind: "live",
    sourceBase: "https://data.yesid.dev/v1",
    provider: "stm",
    benchmarkEligible: true,
    portsChecked: [4217, 4218],
    windowMs: plan.windowMs,
    previewUrl: "http://127.0.0.1:4217/map",
    identity: {
      head: start.head,
      tree: start.tree,
      recordingDigest: start.recording.digest,
      attemptMarkerDigest: start.attemptMarkerDigest,
    },
    fingerprint: served,
    runtime: start.runtime,
    attempt,
    scale: { fixture: true },
    arms: [
      {
        label: "BENCHMARK",
        sourceKind: "live",
        sourceBase: "https://data.yesid.dev/v1",
        provider: "stm",
        benchmarkEligible: true,
        id: plan.id,
        mode: plan.mode,
        rate: plan.rate,
        fleetVehicles: plan.fleetVehicles,
        scored: true,
        actions,
        tickObservation: {
          initialTickKey: "2026-08-24T12:00:59.000Z",
          observedTickKeys: [
            "2026-08-24T12:01:11.000Z",
            "2026-08-24T12:01:12.000Z",
          ],
        },
        refreshEvidence: [
          {
            request: { path: "live/vehicles.json", served: 1 },
            delivery: {
              recordedPath: "live/vehicles.json",
              servedGeneratedUtc: "2026-08-24T12:01:11.000Z",
            },
            processed: {
              tickKey: "2026-08-24T12:01:11.000Z",
              vehicleCount: plan.fleetVehicles,
            },
          },
          {
            request: { path: "live/vehicles.json", served: 1 },
            delivery: {
              recordedPath: "recording/vehicle-tick-1.json",
              servedGeneratedUtc: "2026-08-24T12:01:12.000Z",
            },
            processed: {
              tickKey: "2026-08-24T12:01:12.000Z",
              vehicleCount: plan.fleetVehicles,
            },
          },
        ],
        pollAlignment: {
          checkedUtc: "2026-08-24T12:01:00.000Z",
          ttlMs: 30_000,
          alignmentAgeMs: 1_000,
          safetyMs: 5_000,
          remainingAfterWindowMs: 9_000,
        },
        replay: {
          vehicleEndpoint: { path: "live/vehicles.json", served: 2 },
          vehicleTicks: [
            { path: "live/vehicles.json", served: 1 },
            { path: "recording/vehicle-tick-1.json", served: 1 },
          ],
          vehicleDeliveries: [
            {
              recordedPath: "live/vehicles.json",
              servedGeneratedUtc: "2026-08-24T12:01:11.000Z",
            },
            {
              recordedPath: "recording/vehicle-tick-1.json",
              servedGeneratedUtc: "2026-08-24T12:01:12.000Z",
            },
          ],
        },
        forbiddenVitalsRequests: 0,
        busy,
        busySamples,
        busyProbes,
        busyProbeCadenceMs: 4,
        windowStartedAt: 0,
        stopRequestedAt: plan.windowMs,
        requestedWindowMs: plan.windowMs,
        observedWindowMs: plan.windowMs,
        workloadCompletedAt: plan.windowMs - 1,
        eventTimingSupported: true,
        eventTimingEntries,
        percentileMethod: "r7-linear-interpolation",
        interactionTiming: interactionBudget,
        budgets: { busy: busyBudget, interaction: interactionBudget },
        verdict,
      },
    ],
  };
}

async function prepared(root, verdict = "PASS", served = fingerprint()) {
  const attempt = await attemptMarker(root);
  const recording = liveRecording(attempt);
  await writeRecording(recordingDirectory(root), recording);
  const start = await claimMeasurementStartMarker({
    gitCommonDirectory: root,
    assertPublicationAllowed: allowPublication,
    measurementStart: buildStart(
      root,
      attempt,
      "2026-08-24T12:01:00.000Z",
      recordingContentDigest(recording),
      served,
    ),
  });
  const result = rawResult(start, attempt.attempt, verdict, served);
  result.scale = recording.metadata.scale;
  return { attempt, start, result };
}

function liveRecording(marker) {
  const recording = createSyntheticRecording({
    now: () => Date.parse("2026-08-24T12:00:00.000Z"),
  });
  Object.assign(recording.metadata, {
    sourceKind: "live",
    sourceBase: "https://data.yesid.dev/v1",
    label: "weekday-rush",
    purpose: "benchmark",
    benchmarkEligible: true,
    attempt: marker.attempt,
    attemptMarkerDigest: attemptMarkerDigest(marker.attempt),
  });
  recording.metadata.captureGate = evaluateCaptureGate({
    sourceKind: "live",
    capturedUtc: recording.metadata.capturedUtc,
    label: "weekday-rush",
  });
  return recording;
}

test("concurrent worktrees publish exactly one complete measurement start", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-measure-start-race-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const attempt = await attemptMarker(root);
  const candidates = [
    buildStart(root, attempt),
    buildStart(root, attempt, "2026-08-24T12:01:01.000Z"),
  ];
  const results = await Promise.allSettled(
    candidates.map((measurementStart) =>
      claimMeasurementStartMarker({
        measurementStart,
        gitCommonDirectory: root,
        assertPublicationAllowed: allowPublication,
      }),
    ),
  );
  assert.equal(
    results.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  assert.match(
    results.find(({ status }) => status === "rejected").reason.message,
    /E6_MEASUREMENT_ALREADY_STARTED/u,
  );
  const loaded = await loadMeasurementStartMarker({ gitCommonDirectory: root });
  assert.equal(
    (await stat(measurementStartMarkerPath(root))).mode & 0o777,
    0o600,
  );
  assert.match(loaded.measurementStartDigest, /^[a-f\d]{64}$/u);
});

test("measurement start admission aborts after temp preparation but before the canonical link", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-measure-start-admission-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const attempt = await attemptMarker(root);
  const markerDirectory = join(root, E6_DURABLE_MARKER_DIRECTORY);
  const markerPath = measurementStartMarkerPath(root);
  let admissionObserved = false;

  await assert.rejects(
    claimMeasurementStartMarker({
      gitCommonDirectory: root,
      measurementStart: buildStart(root, attempt),
      assertPublicationAllowed: () => {
        admissionObserved = true;
        assert.equal(existsSync(markerPath), false);
        assert.equal(
          readdirSync(markerDirectory).filter((name) =>
            name.endsWith(".marker.tmp"),
          ).length,
          1,
        );
        throw new Error("E6_TEST_SHUTDOWN_REQUESTED");
      },
    }),
    /E6_TEST_SHUTDOWN_REQUESTED/u,
  );

  assert.equal(admissionObserved, true);
  assert.equal(existsSync(markerPath), false);
  assert.deepEqual(
    readdirSync(markerDirectory).filter((name) =>
      name.endsWith(".marker.tmp"),
    ),
    [],
  );
});

test("measurement start admission links when synchronously allowed and rejects invalid admission", async (context) => {
  const admittedRoot = await mkdtemp(
    join(tmpdir(), "e6-measure-start-admitted-"),
  );
  const invalidRoot = await mkdtemp(
    join(tmpdir(), "e6-measure-start-invalid-admission-"),
  );
  const thenableRoot = await mkdtemp(
    join(tmpdir(), "e6-measure-start-thenable-admission-"),
  );
  context.after(() =>
    Promise.all(
      [admittedRoot, invalidRoot, thenableRoot].map((root) =>
        rm(root, { recursive: true, force: true }),
      ),
    ),
  );

  const admittedAttempt = await attemptMarker(admittedRoot);
  let admitted = false;
  const receipt = await claimMeasurementStartMarker({
    gitCommonDirectory: admittedRoot,
    measurementStart: buildStart(admittedRoot, admittedAttempt),
    assertPublicationAllowed: () => {
      admitted = true;
    },
  });
  assert.equal(admitted, true);
  assert.equal(receipt.markerPath, measurementStartMarkerPath(admittedRoot));
  assert.equal(existsSync(receipt.markerPath), true);

  const invalidAttempt = await attemptMarker(invalidRoot);
  await assert.rejects(
    claimMeasurementStartMarker({
      gitCommonDirectory: invalidRoot,
      measurementStart: buildStart(invalidRoot, invalidAttempt),
    }),
    /E6_MEASUREMENT_PUBLICATION_ADMISSION_INVALID/u,
  );
  assert.equal(existsSync(measurementStartMarkerPath(invalidRoot)), false);

  const thenableAttempt = await attemptMarker(thenableRoot);
  await assert.rejects(
    claimMeasurementStartMarker({
      gitCommonDirectory: thenableRoot,
      measurementStart: buildStart(thenableRoot, thenableAttempt),
      assertPublicationAllowed: () => Promise.resolve(),
    }),
    /E6_DURABLE_MARKER_PUBLICATION_ADMISSION_INVALID/u,
  );
  assert.equal(existsSync(measurementStartMarkerPath(thenableRoot)), false);
  assert.deepEqual(
    readdirSync(join(thenableRoot, E6_DURABLE_MARKER_DIRECTORY)).filter(
      (name) => name.endsWith(".marker.tmp"),
    ),
    [],
  );
});

test("one atomic full result is the terminal PASS receipt", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-measure-pass-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const value = await prepared(root);
  const written = await writeMeasurementRawResult({
    gitCommonDirectory: root,
    recordingDirectory: recordingDirectory(root),
    rawResult: value.result,
  });
  assert.equal(written.verdict, "PASS");
  await assert.rejects(
    writeMeasurementRawResult({
      gitCommonDirectory: root,
      recordingDirectory: recordingDirectory(root),
      rawResult: value.result,
    }),
    /E6_MEASUREMENT_RAW_RESULT_EXISTS/u,
  );
  const loaded = await loadMeasurementRawResult({
    recordingDirectory: recordingDirectory(root),
    measurementStartMarker: value.start,
  });
  assert.equal(loaded.rawResultDigest, written.rawResultDigest);
  assert.equal(
    (await stat(measurementRawResultPath(recordingDirectory(root)))).mode &
      0o777,
    0o600,
  );
});

test("historical completion reloads and binds the canonical recording", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-measure-recording-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const attempt = await attemptMarker(root);
  const recording = liveRecording(attempt);
  await writeRecording(recordingDirectory(root), recording);
  const start = await claimMeasurementStartMarker({
    gitCommonDirectory: root,
    assertPublicationAllowed: allowPublication,
    measurementStart: buildStart(
      root,
      attempt,
      "2026-08-24T12:01:00.000Z",
      recordingContentDigest(recording),
    ),
  });
  const result = rawResult(start, attempt.attempt);
  result.scale = recording.metadata.scale;
  await writeMeasurementRawResult({
    gitCommonDirectory: root,
    recordingDirectory: recordingDirectory(root),
    rawResult: result,
  });
  const completed = await loadCompletedMeasurement({
    gitCommonDirectory: root,
    recordingDirectory: recordingDirectory(root),
  });
  assert.equal(completed.result.verdict, "PASS");

  const linked = join(root, "recording-link");
  await symlink(recordingDirectory(root), linked, "dir");
  await assert.rejects(
    loadCompletedMeasurement({
      gitCommonDirectory: root,
      recordingDirectory: linked,
    }),
    /E6_MEASUREMENT_RECORDING_DIRECTORY_INVALID/u,
  );
  await unlink(join(recordingDirectory(root), "payloads", "manifest.json"));
  await assert.rejects(
    loadCompletedMeasurement({
      gitCommonDirectory: root,
      recordingDirectory: recordingDirectory(root),
    }),
    /E6_RECORDING_DIGEST_MISMATCH|ENOENT/u,
  );
});

test("raw publication validates the full recording and time chain before linking", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-measure-prepublish-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const attempt = await attemptMarker(root);
  const recording = liveRecording(attempt);
  await writeRecording(recordingDirectory(root), recording);
  const start = await claimMeasurementStartMarker({
    gitCommonDirectory: root,
    assertPublicationAllowed: allowPublication,
    measurementStart: buildStart(
      root,
      attempt,
      "2026-08-24T12:01:00.000Z",
      recordingContentDigest(recording),
    ),
  });
  const result = rawResult(start, attempt.attempt);
  result.scale = recording.metadata.scale;
  result.completedUtc = "2026-08-24T12:01:00.001Z";
  const arm = result.arms[0];
  arm.tickObservation.observedTickKeys = [
    "2026-08-24T12:01:00.000Z",
    "2026-08-24T12:01:00.001Z",
  ];
  for (const [index, tick] of arm.tickObservation.observedTickKeys.entries()) {
    arm.refreshEvidence[index].delivery.servedGeneratedUtc = tick;
    arm.refreshEvidence[index].processed.tickKey = tick;
    arm.replay.vehicleDeliveries[index].servedGeneratedUtc = tick;
  }
  await assert.rejects(
    writeMeasurementRawResult({
      gitCommonDirectory: root,
      recordingDirectory: recordingDirectory(root),
      rawResult: result,
    }),
    /E6_MEASUREMENT_RECORDING_MISMATCH/u,
  );
  await assert.rejects(
    stat(measurementRawResultPath(recordingDirectory(root))),
    { code: "ENOENT" },
  );
});

test("a final seal-time check can abort before the raw hardlink", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-measure-seal-race-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const value = await prepared(root);
  await assert.rejects(
    writeMeasurementRawResult({
      gitCommonDirectory: root,
      recordingDirectory: recordingDirectory(root),
      rawResult: value.result,
      beforePublish: async () => {
        throw new Error("E6_TEST_SEAL_IDENTITY_DRIFT");
      },
    }),
    /E6_TEST_SEAL_IDENTITY_DRIFT/u,
  );
  await assert.rejects(
    stat(measurementRawResultPath(recordingDirectory(root))),
    { code: "ENOENT" },
  );
});

test("recording drift during the seal callback aborts before the raw hardlink", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-measure-recording-race-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const value = await prepared(root);
  await assert.rejects(
    writeMeasurementRawResult({
      gitCommonDirectory: root,
      recordingDirectory: recordingDirectory(root),
      rawResult: value.result,
      beforePublish: async () => {
        await writeFile(
          join(recordingDirectory(root), "payloads", "manifest.json"),
          "{}\n",
        );
      },
    }),
    /E6_RECORDING_(?:DIGEST_MISMATCH|INVALID)/u,
  );
  await assert.rejects(
    stat(measurementRawResultPath(recordingDirectory(root))),
    { code: "ENOENT" },
  );
});

test("caller state cannot seal after either canonical lifecycle marker changes", async (context) => {
  for (const changed of ["start", "attempt"]) {
    const root = await mkdtemp(
      join(tmpdir(), `e6-measure-canonical-${changed}-`),
    );
    context.after(() => rm(root, { recursive: true, force: true }));
    const value = await prepared(root);
    await assert.rejects(
      writeMeasurementRawResult({
        gitCommonDirectory: root,
        recordingDirectory: recordingDirectory(root),
        measurementStartMarker: value.start,
        rawResult: value.result,
        beforePublish: async () => {
          const receipt = structuredClone(
            changed === "start" ? value.start : value.attempt,
          );
          if (changed === "start") {
            receipt.measurementStart.assetFingerprint = "e".repeat(64);
          } else {
            receipt.attempt.consumedUtc = "2026-08-24T12:00:01.000Z";
          }
          await writeFile(
            changed === "start"
              ? measurementStartMarkerPath(root)
              : value.attempt.markerPath,
            canonicalJsonBytes(
              changed === "start" ? receipt.measurementStart : receipt.attempt,
            ),
          );
        },
      }),
      /E6_MEASUREMENT_(?:START_MARKER_INVALID|ATTEMPT_MISMATCH|LIFECYCLE_CHANGED)/u,
    );
    await assert.rejects(
      stat(measurementRawResultPath(recordingDirectory(root))),
      { code: "ENOENT" },
    );
  }
});

test("a valid raw result above 16 MiB is rejected before publication", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-measure-oversized-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const value = await prepared(
    root,
    "PASS",
    fingerprint("x".repeat(8 * 1024 * 1024)),
  );
  assert.doesNotThrow(() => assertMeasurementRawResult(value.result));
  assert.ok(canonicalJsonBytes(value.result).byteLength > 16 * 1024 * 1024);
  await assert.rejects(
    writeMeasurementRawResult({
      gitCommonDirectory: root,
      recordingDirectory: recordingDirectory(root),
      rawResult: value.result,
    }),
    /E6_MEASUREMENT_RAW_RESULT_TOO_LARGE/u,
  );
  await assert.rejects(
    stat(measurementRawResultPath(recordingDirectory(root))),
    { code: "ENOENT" },
  );
});

test("raw PASS claims cannot hide failing primitives or the wrong action order", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-measure-recompute-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const value = await prepared(root);
  const attacks = [
    (raw) => {
      raw.arms[0].busyProbes = fixedProbes(12);
    },
    (raw) => {
      raw.arms[0].eventTimingEntries[0].duration = 250;
    },
    (raw) => {
      [raw.arms[0].actions[0], raw.arms[0].actions[1]] = [
        raw.arms[0].actions[1],
        raw.arms[0].actions[0],
      ];
    },
    (raw) => (raw.arms[0].forbiddenVitalsRequests = 1),
    (raw) => delete raw.arms[0].tickObservation,
    (raw) => (raw.arms[0].pollAlignment.remainingAfterWindowMs = 4_999),
    (raw) => (raw.arms[0].replay.vehicleEndpoint.served = 1),
    (raw) => (raw.arms[0].refreshEvidence[1].processed.vehicleCount = 3_423),
    (raw) => (raw.fingerprint.assets[0].sha256 = "0".repeat(64)),
    (raw) => delete raw.sourceBase,
  ];
  for (const attack of attacks) {
    const raw = structuredClone(value.result);
    attack(raw);
    assert.throws(
      () => assertMeasurementRawResult(raw),
      /E6_MEASUREMENT_RAW_RESULT_INVALID/u,
    );
  }
});

test("a recomputed metric FAIL is immutable terminal evidence", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-measure-fail-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const value = await prepared(root, "FAIL");
  const receipt = await writeMeasurementRawResult({
    gitCommonDirectory: root,
    recordingDirectory: recordingDirectory(root),
    rawResult: value.result,
  });
  assert.equal(receipt.verdict, "FAIL");
  assert.equal(
    (
      await loadMeasurementRawResult({
        recordingDirectory: recordingDirectory(root),
        measurementStartMarker: value.start,
      })
    ).verdict,
    "FAIL",
  );
});

test("malformed and symlink start markers stay consumed", async (context) => {
  for (const kind of ["malformed", "symlink"]) {
    const root = await mkdtemp(join(tmpdir(), `e6-measure-start-${kind}-`));
    context.after(() => rm(root, { recursive: true, force: true }));
    const attempt = await attemptMarker(root);
    const start = buildStart(root, attempt);
    const path = measurementStartMarkerPath(root);
    if (kind === "malformed") {
      await claimMeasurementStartMarker({
        measurementStart: start,
        gitCommonDirectory: root,
        assertPublicationAllowed: allowPublication,
      });
      await writeFile(path, "{}\n");
    } else {
      const target = join(root, "untouched");
      await writeFile(target, "untouched\n");
      await symlink(target, path);
    }
    await assert.rejects(
      claimMeasurementStartMarker({
        measurementStart: start,
        gitCommonDirectory: root,
        assertPublicationAllowed: allowPublication,
      }),
      /E6_MEASUREMENT_ALREADY_STARTED/u,
    );
    await assert.rejects(
      loadMeasurementStartMarker({ gitCommonDirectory: root }),
      /E6_MEASUREMENT_START_(?:MARKER_)?INVALID/u,
    );
  }
});

test("preflight refuses either occupied lifecycle object before an arm", async (context) => {
  for (const occupied of ["start", "result"]) {
    const root = await mkdtemp(join(tmpdir(), `e6-measure-ready-${occupied}-`));
    context.after(() => rm(root, { recursive: true, force: true }));
    const directory = recordingDirectory(root);
    await mkdir(directory, { mode: 0o700 });
    const attempt = await attemptMarker(root);
    if (occupied === "start") {
      await claimMeasurementStartMarker({
        gitCommonDirectory: root,
        measurementStart: buildStart(root, attempt),
        assertPublicationAllowed: allowPublication,
      });
    } else {
      await symlink(join(root, "missing"), measurementRawResultPath(directory));
    }
    await assert.rejects(
      assertMeasurementOutputsReady({
        gitCommonDirectory: root,
        recordingDirectory: directory,
      }),
      occupied === "start"
        ? /E6_MEASUREMENT_ALREADY_STARTED/u
        : /E6_MEASUREMENT_RAW_RESULT_EXISTS/u,
    );
  }
});

test("preclaim reloads the canonical recording and reversibly proves publication", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-measure-preclaim-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const attempt = await attemptMarker(root);
  const recording = liveRecording(attempt);
  await writeRecording(recordingDirectory(root), recording);
  const expectedRecordingDigest = recordingContentDigest(recording);

  const receipt = await assertMeasurementPreclaimReady({
    gitCommonDirectory: root,
    recordingDirectory: recordingDirectory(root),
    expectedRecordingDigest,
  });

  assert.equal(receipt.recordingDigest, expectedRecordingDigest);
  assert.equal(receipt.attemptMarkerDigest, attempt.attemptMarkerDigest);
  assert.deepEqual(
    (await readdir(recordingDirectory(root))).filter((name) =>
      name.includes("measurement-publication-probe"),
    ),
    [],
  );
  await assert.rejects(stat(measurementStartMarkerPath(root)), {
    code: "ENOENT",
  });
  await assert.rejects(
    stat(measurementRawResultPath(recordingDirectory(root))),
    { code: "ENOENT" },
  );
});

test("preclaim rejects a stale digest or deleted canonical recording without starting", async (context) => {
  for (const failure of ["stale", "deleted"]) {
    const root = await mkdtemp(
      join(tmpdir(), `e6-measure-preclaim-${failure}-`),
    );
    context.after(() => rm(root, { recursive: true, force: true }));
    const attempt = await attemptMarker(root);
    const recording = liveRecording(attempt);
    await writeRecording(recordingDirectory(root), recording);
    const expectedRecordingDigest = recordingContentDigest(recording);
    if (failure === "deleted") {
      await unlink(join(recordingDirectory(root), "recording.json"));
    }

    await assert.rejects(
      assertMeasurementPreclaimReady({
        gitCommonDirectory: root,
        recordingDirectory: recordingDirectory(root),
        expectedRecordingDigest:
          failure === "stale" ? "f".repeat(64) : expectedRecordingDigest,
      }),
      failure === "stale"
        ? /E6_MEASUREMENT_RECORDING_MISMATCH/u
        : /E6_RECORDING_METADATA_INVALID/u,
    );
    await assert.rejects(stat(measurementStartMarkerPath(root)), {
      code: "ENOENT",
    });
    await assert.rejects(
      stat(measurementRawResultPath(recordingDirectory(root))),
      { code: "ENOENT" },
    );
  }
});

test("preclaim rejects unsupported or failing publication and removes probes", async (context) => {
  for (const failure of ["unsupported", "unlink"]) {
    const root = await mkdtemp(
      join(tmpdir(), `e6-measure-publication-${failure}-`),
    );
    context.after(() => rm(root, { recursive: true, force: true }));
    const attempt = await attemptMarker(root);
    const recording = liveRecording(attempt);
    await writeRecording(recordingDirectory(root), recording);
    let unlinkCalls = 0;
    const publicationOperations =
      failure === "unsupported"
        ? {
            link: async () => {
              const error = new Error("hardlinks unsupported");
              error.code = "ENOTSUP";
              throw error;
            },
          }
        : {
            unlink: async (path) => {
              unlinkCalls += 1;
              if (unlinkCalls === 1) {
                const error = new Error("unlink failed");
                error.code = "EIO";
                throw error;
              }
              return unlink(path);
            },
          };

    await assert.rejects(
      assertMeasurementPreclaimReady({
        gitCommonDirectory: root,
        recordingDirectory: recordingDirectory(root),
        expectedRecordingDigest: recordingContentDigest(recording),
        publicationOperations,
      }),
      failure === "unsupported"
        ? /E6_MEASUREMENT_RAW_RESULT_PUBLICATION_UNSUPPORTED/u
        : /E6_MEASUREMENT_RAW_RESULT_PUBLICATION_FAILED/u,
    );
    assert.deepEqual(
      (await readdir(recordingDirectory(root))).filter((name) =>
        name.includes("measurement-publication-probe"),
      ),
      [],
    );
    await assert.rejects(stat(measurementStartMarkerPath(root)), {
      code: "ENOENT",
    });
    await assert.rejects(
      stat(measurementRawResultPath(recordingDirectory(root))),
      { code: "ENOENT" },
    );
  }
});

test("preclaim reloads canonical state after the publication probe", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-measure-probe-drift-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const attempt = await attemptMarker(root);
  const recording = liveRecording(attempt);
  await writeRecording(recordingDirectory(root), recording);
  let mutated = false;

  await assert.rejects(
    assertMeasurementPreclaimReady({
      gitCommonDirectory: root,
      recordingDirectory: recordingDirectory(root),
      expectedRecordingDigest: recordingContentDigest(recording),
      publicationOperations: {
        link: async (source, target) => {
          await hardlink(source, target);
          if (!mutated) {
            mutated = true;
            await writeFile(
              join(recordingDirectory(root), "payloads", "manifest.json"),
              "{}\n",
            );
          }
        },
      },
    }),
    /E6_RECORDING_(?:DIGEST_MISMATCH|INVALID)/u,
  );
  assert.equal(mutated, true);
  await assert.rejects(stat(measurementStartMarkerPath(root)), {
    code: "ENOENT",
  });
  await assert.rejects(
    stat(measurementRawResultPath(recordingDirectory(root))),
    { code: "ENOENT" },
  );
});

test("terminal result binding rejects a different start and malformed bytes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-measure-binding-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const value = await prepared(root);
  const forged = structuredClone(value.result);
  forged.measurementStartDigest = "d".repeat(64);
  await assert.rejects(
    writeMeasurementRawResult({
      gitCommonDirectory: root,
      recordingDirectory: recordingDirectory(root),
      rawResult: forged,
    }),
    /E6_MEASUREMENT_RAW_RESULT_MISMATCH/u,
  );
  await writeFile(measurementRawResultPath(recordingDirectory(root)), "{}\n", {
    mode: 0o600,
  });
  await assert.rejects(
    loadMeasurementRawResult({
      recordingDirectory: recordingDirectory(root),
      measurementStartMarker: value.start,
    }),
    /E6_MEASUREMENT_RAW_RESULT_INVALID/u,
  );
  assert.equal(
    await readFile(measurementRawResultPath(recordingDirectory(root)), "utf8"),
    "{}\n",
  );
});
