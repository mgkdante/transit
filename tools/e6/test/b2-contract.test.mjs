import assert from "node:assert/strict";
import test from "node:test";

import * as browser from "../lib/browser.mjs";
import * as capture from "../lib/capture.mjs";
import * as config from "../lib/config.mjs";
import * as files from "../lib/files.mjs";
import * as measure from "../e6-measure.mjs";
import * as recording from "../lib/recording.mjs";
import * as stats from "../lib/stats.mjs";
import { createSyntheticRecording } from "../lib/synthetic.mjs";

function sourceVehicles(count, { reverse = false } = {}) {
  const vehicles = Array.from({ length: count }, (_, index) => ({
    id: `source-${String(index + 1).padStart(4, "0")}`,
    route: `route-${String((index % 182) + 1).padStart(3, "0")}`,
    lat: 45.5,
    lon: -73.6,
  }));
  return reverse ? vehicles.reverse() : vehicles;
}

function requireFunction(module, name) {
  assert.equal(typeof module[name], "function", `${name} must be exported`);
  return module[name];
}

test("selects exactly 856 source identities in code-point order and creates four stable lanes", () => {
  const scaleVehicleTick = requireFunction(capture, "scaleVehicleTick");
  const first = scaleVehicleTick(
    { vehicles: sourceVehicles(900, { reverse: true }) },
    { tick: 0 },
  );
  const second = scaleVehicleTick(
    { vehicles: sourceVehicles(900, { reverse: true }) },
    { tick: 0 },
  );

  assert.equal(first.payload.vehicles.length, 3_424);
  assert.equal(new Set(first.payload.vehicles.map(({ id }) => id)).size, 3_424);
  assert.deepEqual(first, second);
  assert.equal(first.audit.sourceCount, 900);
  assert.equal(first.audit.selectedBaseIdentities.length, 856);
  assert.deepEqual(first.audit.selectedBaseIdentities.slice(0, 2), [
    "source-0001",
    "source-0002",
  ]);
  assert.equal(first.audit.identityOrder, "vehicle.id code-point ascending");
  assert.equal(first.audit.lanes, 4);
  assert.equal(first.audit.fleetVehicles, 3_424);
  assert.deepEqual(
    first.payload.vehicles
      .filter(({ source_identity: id }) => id === "source-0001")
      .map(({ scale_lane: lane }) => lane),
    [0, 1, 2, 3],
  );
});

test("refuses thin, empty, missing, and duplicate source identities before scaling", () => {
  const scaleVehicleTick = requireFunction(capture, "scaleVehicleTick");
  assert.throws(
    () => scaleVehicleTick({ vehicles: sourceVehicles(855) }, { tick: 0 }),
    /E6_SOURCE_FLEET_TOO_THIN distinct=855 minimum=856/u,
  );
  for (const invalid of ["", "   ", null, undefined]) {
    const vehicles = sourceVehicles(856);
    vehicles[0] = { ...vehicles[0], id: invalid };
    assert.throws(
      () => scaleVehicleTick({ vehicles }, { tick: 0 }),
      /E6_SOURCE_IDENTITY_INVALID/u,
    );
  }
  const duplicate = sourceVehicles(856);
  duplicate[1] = { ...duplicate[1], id: duplicate[0].id };
  assert.throws(
    () => scaleVehicleTick({ vehicles: duplicate }, { tick: 0 }),
    /E6_SOURCE_IDENTITY_DUPLICATE/u,
  );
});

test("synthetic replay has exactly 3,424 unique vehicles in both ticks but is never eligible", () => {
  const synthetic = createSyntheticRecording({
    now: () => Date.parse("2026-08-15T12:00:00.000Z"),
  });
  const result = recording.validateRecordingSnapshot(synthetic, {
    purpose: "dry-run",
  });
  assert.equal(result.vehicles, 3_424);
  assert.equal(result.vehicleTicks, 2);
  for (const path of synthetic.metadata.vehicleTickPaths) {
    const vehicles = synthetic.payloads.get(path).vehicles;
    assert.equal(vehicles.length, 3_424);
    assert.equal(new Set(vehicles.map(({ id }) => id)).size, 3_424);
  }
  assert.equal(synthetic.metadata.sourceKind, "synthetic");
  assert.equal(synthetic.metadata.benchmarkEligible, false);
  assert.equal(synthetic.metadata.label, "SYNTHETIC_DRY_RUN_NOT_A_BENCHMARK");
});

test("fleet validation fails closed on count, identity, declaration, scale, and tick corruption", () => {
  const valid = createSyntheticRecording({
    now: () => Date.parse("2026-08-15T12:00:00.000Z"),
  });
  const corruptions = [
    [
      "count",
      (copy) =>
        copy.payloads.get(copy.metadata.vehicleTickPaths[0]).vehicles.pop(),
      /E6_FLEET_COUNT_MISMATCH/u,
    ],
    [
      "empty identity",
      (copy) =>
        (copy.payloads.get(copy.metadata.vehicleTickPaths[0]).vehicles[0].id =
          ""),
      /E6_FLEET_IDENTITY_INVALID/u,
    ],
    [
      "duplicate identity",
      (copy) => {
        const vehicles = copy.payloads.get(
          copy.metadata.vehicleTickPaths[0],
        ).vehicles;
        vehicles[1].id = vehicles[0].id;
      },
      /E6_FLEET_IDENTITY_DUPLICATE/u,
    ],
    [
      "declared count",
      (copy) => (copy.metadata.counts.vehicles = 3_423),
      /E6_RECORDING_COUNT_MISMATCH/u,
    ],
    [
      "tick metadata",
      (copy) => (copy.metadata.counts.vehicleTicks[1].vehicles = 3_423),
      /E6_RECORDING_COUNT_MISMATCH/u,
    ],
    [
      "scale metadata",
      (copy) => (copy.metadata.scale.fleetVehicles = 3_423),
      /E6_SCALE_METADATA_INVALID/u,
    ],
  ];
  for (const [name, mutate, expected] of corruptions) {
    const copy = structuredClone(valid);
    copy.payloads = new Map(copy.payloads);
    mutate(copy);
    assert.throws(
      () => recording.validateRecordingSnapshot(copy, { purpose: "dry-run" }),
      expected,
      name,
    );
  }
});

test("preview forces the vitals collector off and any attempted beacon fails the arm", async () => {
  const previewEnvironment = requireFunction(measure, "previewEnvironment");
  const observeForbiddenVitals = requireFunction(
    browser,
    "observeForbiddenVitals",
  );
  const assertNoVitalsRequests = requireFunction(
    browser,
    "assertNoVitalsRequests",
  );
  assert.equal(
    previewEnvironment({ PUBLIC_VITALS_ENABLED: "true" }, "http://replay/v1")
      .PUBLIC_VITALS_ENABLED,
    "false",
  );
  const routes = [];
  const page = { route: async (...args) => routes.push(args) };
  const attempts = await observeForbiddenVitals(page);
  assert.deepEqual(attempts, []);
  assert.equal(routes[0][0], "**/api/vitals");
  await routes[0][1]({
    request: () => ({ url: () => "/api/vitals" }),
    abort: async () => {},
  });
  assert.throws(
    () => assertNoVitalsRequests(attempts),
    /E6_VITALS_REQUEST_FORBIDDEN/u,
  );
});

test("Event Timing groups by interactionId maximum and enforces its strict independent budget", () => {
  const scoreInteractionBudget = requireFunction(
    stats,
    "scoreInteractionBudget",
  );
  const grouped = scoreInteractionBudget(
    [
      { interactionId: 11, duration: 40 },
      { interactionId: 11, duration: 90 },
      { interactionId: 22, duration: 199.9 },
    ],
    {
      requiredInteractions: 2,
      budgetMs: config.E6_INTERACTION_BUDGET_MS,
    },
  );
  assert.deepEqual(grouped.values, [90, 199.9]);
  assert.equal(grouped.distinctInteractions, 2);
  assert.equal(grouped.percentileMethod, "r7-linear-interpolation");
  assert.equal(grouped.passed, true);
  assert.equal(
    scoreInteractionBudget(
      [
        { interactionId: 1, duration: 200 },
        { interactionId: 2, duration: 200 },
      ],
      {
        requiredInteractions: 2,
        budgetMs: config.E6_INTERACTION_BUDGET_MS,
      },
    ).passed,
    false,
  );
  const notAMaxBudget = scoreInteractionBudget(
    Array.from({ length: 20 }, (_, index) => ({
      interactionId: index + 1,
      duration: index === 19 ? 200 : 0,
    })),
    {
      requiredInteractions: 20,
      budgetMs: config.E6_INTERACTION_BUDGET_MS,
    },
  );
  assert.equal(notAMaxBudget.p95Ms, 10.000000000000142);
  assert.equal(notAMaxBudget.passed, true);
  assert.equal(
    scoreInteractionBudget([{ interactionId: 1, duration: 199.999 }], {
      requiredInteractions: 1,
      budgetMs: config.E6_INTERACTION_BUDGET_MS,
    }).passed,
    true,
  );
  assert.equal(
    scoreInteractionBudget([{ interactionId: 1, duration: 200 }], {
      requiredInteractions: 1,
      budgetMs: config.E6_INTERACTION_BUDGET_MS,
    }).passed,
    false,
  );
  assert.throws(
    () =>
      scoreInteractionBudget([{ interactionId: 1, duration: 1 }], {
        requiredInteractions: 1,
      }),
    /E6_EVENT_TIMING_BUDGET_INVALID/u,
  );
});

test("binds each processed tick to exactly one ordered public replay delivery", () => {
  const assertVehicleDelivery = requireFunction(
    measure,
    "assertVehicleDelivery",
  );
  const before = {
    served: { "live/vehicles.json": 4 },
    vehicleDeliveries: [
      { recordedPath: "old", servedGeneratedUtc: "2026-08-24T10:00:00Z" },
    ],
  };
  const after = {
    served: { "live/vehicles.json": 5 },
    vehicleDeliveries: [
      ...before.vehicleDeliveries,
      {
        recordedPath: "recording/vehicle-tick-1.json",
        servedGeneratedUtc: "2026-08-24T10:00:30Z",
      },
    ],
  };
  assert.deepEqual(
    assertVehicleDelivery({
      before,
      after,
      vehiclePath: "live/vehicles.json",
      observedTickKey: "2026-08-24T10:00:30Z",
      vehicleCount: 3_424,
      expectedVehicleCount: 3_424,
    }),
    {
      request: { path: "live/vehicles.json", served: 1 },
      delivery: {
        recordedPath: "recording/vehicle-tick-1.json",
        servedGeneratedUtc: "2026-08-24T10:00:30Z",
      },
      processed: {
        tickKey: "2026-08-24T10:00:30Z",
        vehicleCount: 3_424,
      },
    },
  );
  assert.throws(
    () =>
      assertVehicleDelivery({
        before,
        after,
        vehiclePath: "live/vehicles.json",
        observedTickKey: "2026-08-24T10:00:31Z",
        vehicleCount: 3_424,
        expectedVehicleCount: 3_424,
      }),
    /E6_VEHICLE_DELIVERY_MISMATCH/u,
  );
});

test("requires the fixed window to finish well before the next natural poll", () => {
  const assertNaturalPollMargin = requireFunction(
    measure,
    "assertNaturalPollMargin",
  );
  assert.deepEqual(
    assertNaturalPollMargin({
      servedGeneratedUtc: "2026-08-24T10:00:00.000Z",
      manifest: { files: { live: { ttl_s: 30 } } },
      windowMs: 20_000,
      nowMs: Date.parse("2026-08-24T10:00:01.000Z"),
    }),
    {
      checkedUtc: "2026-08-24T10:00:01.000Z",
      ttlMs: 30_000,
      alignmentAgeMs: 1_000,
      safetyMs: 5_000,
      remainingAfterWindowMs: 9_000,
    },
  );
  assert.equal(
    assertNaturalPollMargin({
      servedGeneratedUtc: "2026-08-24T10:00:00.000Z",
      manifest: { files: { live: { ttl_s: 60 } } },
      windowMs: 20_000,
      nowMs: Date.parse("2026-08-24T10:00:01.000Z"),
    }).ttlMs,
    60_000,
  );
  for (const changes of [
    { nowMs: Date.parse("2026-08-24T10:00:06.000Z") },
    { manifest: { files: { live: { ttl_s: 20 } } } },
    { manifest: { files: { live: {} } } },
  ]) {
    assert.throws(
      () =>
        assertNaturalPollMargin({
          servedGeneratedUtc: "2026-08-24T10:00:00.000Z",
          manifest: { files: { live: { ttl_s: 30 } } },
          windowMs: 20_000,
          nowMs: Date.parse("2026-08-24T10:00:01.000Z"),
          ...changes,
        }),
      /E6_NATURAL_POLL_MARGIN_INVALID/u,
    );
  }
});

test("starts from the immutable aligned replay boundary and then checks the real poll margin", async () => {
  const startMeasurementWindow = requireFunction(
    measure,
    "startMeasurementWindow",
  );
  const servedGeneratedUtc = "2026-08-24T10:00:00.000Z";
  const manifest = { files: { live: { ttl_s: 30 } } };
  const vehiclePath = "live/vehicles.json";
  const alignedReplay = { served: { [vehiclePath]: 1 } };
  let nowMs = Date.parse("2026-08-24T10:00:01.000Z");
  let currentReplay = alignedReplay;
  let ready = true;
  const input = {
    stats: () => currentReplay,
    alignedReplay,
    vehiclePath,
    servedGeneratedUtc,
    manifest,
    windowMs: 20_000,
    now: () => nowMs,
    assertReady: () => {
      if (!ready) throw new Error("E6_TEST_PRECLAIM_NOT_READY");
    },
  };

  nowMs = Date.parse("2026-08-24T10:00:06.000Z");
  let starts = 0;
  await assert.rejects(
    startMeasurementWindow({
      ...input,
      start: async () => {
        starts += 1;
      },
    }),
    /E6_NATURAL_POLL_MARGIN_INVALID/u,
  );
  assert.equal(starts, 0);

  nowMs = Date.parse("2026-08-24T10:00:01.000Z");
  currentReplay = { served: { [vehiclePath]: 2 } };
  await assert.rejects(
    startMeasurementWindow({
      ...input,
      start: async () => {
        starts += 1;
      },
    }),
    /E6_REPLAY_VEHICLE_REQUEST_COUNT expected=0 actual=1/u,
  );
  assert.equal(starts, 0);

  currentReplay = alignedReplay;
  ready = false;
  await assert.rejects(
    startMeasurementWindow({
      ...input,
      start: async () => {
        starts += 1;
      },
    }),
    /E6_TEST_PRECLAIM_NOT_READY/u,
  );
  assert.equal(starts, 0);
  ready = true;

  nowMs = Date.parse("2026-08-24T10:00:01.000Z");
  await assert.rejects(
    startMeasurementWindow({
      ...input,
      start: async () => {
        nowMs = Date.parse("2026-08-24T10:00:06.000Z");
      },
    }),
    /E6_NATURAL_POLL_MARGIN_INVALID/u,
  );

  nowMs = Date.parse("2026-08-24T10:00:01.000Z");
  await assert.rejects(
    startMeasurementWindow({
      ...input,
      start: async () => {
        nowMs = Date.parse("2026-08-24T10:00:02.000Z");
        currentReplay = { served: { [vehiclePath]: 2 } };
      },
    }),
    /E6_REPLAY_VEHICLE_REQUEST_COUNT expected=0 actual=1/u,
  );

  currentReplay = alignedReplay;
  nowMs = Date.parse("2026-08-24T10:00:01.000Z");
  const started = await startMeasurementWindow({
    ...input,
    start: async () => {
      nowMs = Date.parse("2026-08-24T10:00:04.000Z");
    },
  });
  assert.equal(started.replay, alignedReplay);
  assert.equal(started.pollAlignment.alignmentAgeMs, 4_000);
});

test("Event Timing fails closed on missing, malformed, zero-ID, and insufficient evidence", () => {
  const scoreInteractionBudget = requireFunction(
    stats,
    "scoreInteractionBudget",
  );
  const cases = [
    [[], /E6_EVENT_TIMING_MISSING/u],
    [[{ interactionId: 0, duration: 10 }], /E6_EVENT_TIMING_ID_INVALID/u],
    [[{ interactionId: 1.5, duration: 10 }], /E6_EVENT_TIMING_ID_INVALID/u],
    [[{ interactionId: 1, duration: -1 }], /E6_EVENT_TIMING_DURATION_INVALID/u],
    [
      [{ interactionId: 1, duration: Number.NaN }],
      /E6_EVENT_TIMING_DURATION_INVALID/u,
    ],
    [[{ interactionId: 1, duration: 10 }], /E6_EVENT_TIMING_COUNT_MISMATCH/u],
  ];
  for (const [entries, expected] of cases) {
    assert.throws(
      () =>
        scoreInteractionBudget(entries, {
          requiredInteractions: 2,
          budgetMs: config.E6_INTERACTION_BUDGET_MS,
        }),
      expected,
    );
  }
});

test("arm verdict requires both budgets and every requested action", () => {
  const scoreArmVerdict = requireFunction(stats, "scoreArmVerdict");
  assert.equal(
    scoreArmVerdict({
      busyPassed: true,
      interactionPassed: true,
      requestedActions: 13,
      completedActions: 13,
    }).verdict,
    "PASS",
  );
  for (const input of [
    {
      busyPassed: false,
      interactionPassed: true,
      requestedActions: 13,
      completedActions: 13,
    },
    {
      busyPassed: true,
      interactionPassed: false,
      requestedActions: 13,
      completedActions: 13,
    },
    {
      busyPassed: true,
      interactionPassed: true,
      requestedActions: 13,
      completedActions: 12,
    },
  ]) {
    assert.equal(scoreArmVerdict(input).verdict, "FAIL");
  }
});

test("only the exact August 24 Toronto weekday-rush live capture is benchmark eligible", () => {
  const evaluateCaptureGate = requireFunction(recording, "evaluateCaptureGate");
  const monday = evaluateCaptureGate({
    sourceKind: "live",
    capturedUtc: "2026-08-24T12:34:56.000Z",
    label: "weekday-rush",
  });
  assert.deepEqual(monday, {
    eligible: true,
    label: "weekday-rush",
    timeZone: "America/Toronto",
    capturedUtc: "2026-08-24T12:34:56.000Z",
    localDate: "2026-08-24",
    localTime: "08:34:56",
    weekday: "Monday",
  });
  for (const input of [
    {
      sourceKind: "live",
      capturedUtc: "2026-08-17T12:34:56.000Z",
      label: "weekday-rush",
    },
    {
      sourceKind: "live",
      capturedUtc: "2026-08-24T12:34:56.000Z",
      label: "rush",
    },
    {
      sourceKind: "synthetic",
      capturedUtc: "2026-08-24T12:34:56.000Z",
      label: "weekday-rush",
    },
  ]) {
    assert.equal(evaluateCaptureGate(input).eligible, false);
  }
  for (const [capturedUtc, eligible] of [
    ["2026-08-24T03:59:59.999Z", false],
    ["2026-08-24T04:00:00.000Z", false],
    ["2026-08-24T09:59:59.999Z", false],
    ["2026-08-24T10:00:00.000Z", true],
    ["2026-08-24T12:59:59.999Z", true],
    ["2026-08-24T13:00:00.000Z", false],
    ["2026-08-25T03:59:59.999Z", false],
    ["2026-08-25T04:00:00.000Z", false],
  ]) {
    assert.equal(
      evaluateCaptureGate({
        sourceKind: "live",
        capturedUtc,
        label: "weekday-rush",
      }).eligible,
      eligible,
      capturedUtc,
    );
  }
});

test("recording validation retains the 182-active-route floor", () => {
  const value = createSyntheticRecording({ now: () => 1_723_726_800_000 });
  for (const path of value.metadata.vehicleTickPaths) {
    for (const vehicle of value.payloads.get(path).vehicles) {
      if (vehicle.route === "e6-182") vehicle.route = "e6-181";
    }
  }
  value.metadata.counts.activeRoutes = 181;
  value.metadata.counts.vehicleTicks = value.metadata.counts.vehicleTicks.map(
    (tick) => ({ ...tick, activeRoutes: 181 }),
  );
  assert.throws(
    () => recording.validateRecordingSnapshot(value, { purpose: "dry-run" }),
    /E6_RECORDING_TOO_THIN activeRoutes=181 minimum=182/u,
  );
});

test("recording identity is recomputed from canonical content and exact expectations fail closed", () => {
  const recordingContentDigest = requireFunction(
    files,
    "recordingContentDigest",
  );
  const assertExpectedIdentity = requireFunction(
    measure,
    "assertExpectedIdentity",
  );
  const assertCleanGitStatus = requireFunction(measure, "assertCleanGitStatus");
  const value = createSyntheticRecording({ now: () => 1_723_726_800_000 });
  const digest = recordingContentDigest(value);
  assert.doesNotThrow(() => assertCleanGitStatus(""));
  assert.throws(
    () => assertCleanGitStatus(" M tools/e6/e6-measure.mjs\n"),
    /E6_IDENTITY_WORKTREE_DIRTY/u,
  );
  assert.match(digest, /^[a-f\d]{64}$/u);
  const markerDigest = "1".repeat(64);
  const changed = structuredClone(value);
  changed.payloads = new Map(changed.payloads);
  changed.payloads.get(changed.metadata.vehicleTickPaths[0]).vehicles[0].lon +=
    0.0001;
  assert.notEqual(recordingContentDigest(changed), digest);
  assert.deepEqual(
    assertExpectedIdentity({
      benchmarkEligible: true,
      actualHead: "abc",
      expectedHead: "abc",
      actualRecordingDigest: digest,
      expectedRecordingDigest: digest,
      actualAttemptMarkerDigest: markerDigest,
    }),
    {
      head: "abc",
      recordingDigest: digest,
      attemptMarkerDigest: markerDigest,
    },
  );
  for (const input of [
    {
      benchmarkEligible: true,
      actualHead: "abc",
      actualRecordingDigest: digest,
    },
    {
      benchmarkEligible: true,
      actualHead: "abc",
      expectedHead: "def",
      actualRecordingDigest: digest,
      expectedRecordingDigest: digest,
    },
    {
      benchmarkEligible: true,
      actualHead: "abc",
      expectedHead: "abc",
      actualRecordingDigest: digest,
      expectedRecordingDigest: "0".repeat(64),
      actualAttemptMarkerDigest: markerDigest,
    },
    {
      benchmarkEligible: true,
      actualHead: "abc",
      expectedHead: "abc",
      actualRecordingDigest: digest,
      expectedRecordingDigest: digest,
    },
  ]) {
    assert.throws(() => assertExpectedIdentity(input), /E6_IDENTITY_/u);
  }
  assert.doesNotThrow(() =>
    assertExpectedIdentity({
      benchmarkEligible: false,
      actualHead: "abc",
      actualRecordingDigest: digest,
    }),
  );
});
