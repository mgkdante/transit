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

test("the only measurement plan is raw, 3,424 vehicles, rate 1, with no hidden throttle", () => {
  assert.deepEqual(config.buildMeasurementPlan(), {
    mode: "raw",
    rate: 1,
    fleetVehicles: 3_424,
    interactions: 13,
    windowMs: 20_000,
    busyBudgetMs: 8,
    interactionBudgetMs: 200,
    arms: [
      {
        id: "raw@3424-unthrottled",
        mode: "raw",
        rate: 1,
        fleetVehicles: 3_424,
      },
    ],
  });
  const rejected = [
    { env: { E6_MODE: "smooth" } },
    { env: { E6_RATE: "4" } },
    { env: { E6_FLEET_VEHICLES: "856" } },
    { env: { E6_CPU_THROTTLE_RATE: "1" } },
    { argv: ["--mode", "smooth"] },
    { argv: ["--rate", "2"] },
    { argv: ["--fleet-vehicles", "3423"] },
    { argv: ["--cpu-throttle", "1"] },
  ];
  for (const options of rejected) {
    assert.throws(
      () => config.buildMeasurementPlan(options),
      /E6_BINDING_ARM_REQUIRED/u,
    );
  }
});

test("arm creation sends zero CDP CPU-throttling commands, including at rate 1", async () => {
  const calls = [];
  const page = {
    context: () => ({
      newCDPSession: async () => ({
        send: async (...args) => calls.push(args),
      }),
    }),
  };
  const context = {
    addInitScript: async () => {},
    newPage: async () => page,
  };
  const arm = await browser.createArmContext(
    { newContext: async () => context },
    { rate: 1, storage: { "transit:motion-mode": "raw" } },
  );
  assert.equal(arm.page, page);
  assert.equal(
    calls.filter(([command]) => command === "Emulation.setCPUThrottlingRate")
      .length,
    0,
  );
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
    { requiredInteractions: 2 },
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
      { requiredInteractions: 2 },
    ).passed,
    false,
  );
  const notAMaxBudget = scoreInteractionBudget(
    Array.from({ length: 20 }, (_, index) => ({
      interactionId: index + 1,
      duration: index === 19 ? 200 : 0,
    })),
    { requiredInteractions: 20 },
  );
  assert.equal(notAMaxBudget.p95Ms, 10.000000000000142);
  assert.equal(notAMaxBudget.passed, true);
  assert.equal(
    scoreInteractionBudget([{ interactionId: 1, duration: 199.999 }], {
      requiredInteractions: 1,
    }).passed,
    true,
  );
  assert.equal(
    scoreInteractionBudget([{ interactionId: 1, duration: 200 }], {
      requiredInteractions: 1,
    }).passed,
    false,
  );
});

test("arm receipts retain raw busy and Event Timing entries for independent recomputation", () => {
  const bindRawEvidence = requireFunction(measure, "bindRawEvidence");
  const busy = [1, 2, 8];
  const interactions = [
    { interactionId: 1, duration: 20 },
    { interactionId: 1, duration: 40 },
    { interactionId: 2, duration: 80 },
  ];
  const bound = bindRawEvidence({ busy, interactions });
  assert.deepEqual(bound, {
    busySamples: busy,
    eventTimingEntries: interactions,
    percentileMethod: "r7-linear-interpolation",
  });
  assert.notEqual(bound.busySamples, busy);
  assert.notEqual(bound.eventTimingEntries, interactions);
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
    [[{ interactionId: 1, duration: 10 }], /E6_EVENT_TIMING_INSUFFICIENT/u],
  ];
  for (const [entries, expected] of cases) {
    assert.throws(
      () => scoreInteractionBudget(entries, { requiredInteractions: 2 }),
      expected,
    );
  }
});

test("arm verdict requires both budgets and every requested action", () => {
  const scoreArmVerdict = requireFunction(stats, "scoreArmVerdict");
  assert.equal(
    scoreArmVerdict({
      busyP95Ms: 8,
      interactionP95Ms: 199.9,
      requestedActions: 13,
      completedActions: 13,
    }).verdict,
    "PASS",
  );
  for (const input of [
    {
      busyP95Ms: 8.01,
      interactionP95Ms: 100,
      requestedActions: 13,
      completedActions: 13,
    },
    {
      busyP95Ms: 8,
      interactionP95Ms: 200,
      requestedActions: 13,
      completedActions: 13,
    },
    {
      busyP95Ms: 8,
      interactionP95Ms: 100,
      requestedActions: 13,
      completedActions: 12,
    },
  ]) {
    assert.equal(scoreArmVerdict(input).verdict, "FAIL");
  }
});

test("trusted actions execute while Event Timing is active and evidence is read only afterward", async () => {
  const runEvidenceWindow = requireFunction(measure, "runEvidenceWindow");
  const order = [];
  const result = await runEvidenceWindow({
    start: async () => order.push("start"),
    wait: async () => order.push("wait"),
    runActions: async () => {
      order.push("actions");
      return ["a", "b"];
    },
    read: async () => {
      order.push("read");
      return { interactions: [{ interactionId: 1, duration: 20 }] };
    },
  });
  assert.deepEqual(order, ["start", "wait", "actions", "read"]);
  assert.deepEqual(result.actions, ["a", "b"]);
});

test("only the exact Monday Toronto weekday-rush live capture is benchmark eligible", () => {
  const evaluateCaptureGate = requireFunction(recording, "evaluateCaptureGate");
  const monday = evaluateCaptureGate({
    sourceKind: "live",
    capturedUtc: "2026-08-17T12:34:56.000Z",
    label: "weekday-rush",
  });
  assert.deepEqual(monday, {
    eligible: true,
    label: "weekday-rush",
    timeZone: "America/Toronto",
    capturedUtc: "2026-08-17T12:34:56.000Z",
    localDate: "2026-08-17",
    weekday: "Monday",
  });
  for (const input of [
    {
      sourceKind: "live",
      capturedUtc: "2026-08-15T12:34:56.000Z",
      label: "weekday-rush",
    },
    {
      sourceKind: "live",
      capturedUtc: "2026-08-17T12:34:56.000Z",
      label: "rush",
    },
    {
      sourceKind: "synthetic",
      capturedUtc: "2026-08-17T12:34:56.000Z",
      label: "weekday-rush",
    },
  ]) {
    assert.equal(evaluateCaptureGate(input).eligible, false);
  }
  for (const [capturedUtc, eligible] of [
    ["2026-08-17T03:59:59.999Z", false],
    ["2026-08-17T04:00:00.000Z", true],
    ["2026-08-18T03:59:59.999Z", true],
    ["2026-08-18T04:00:00.000Z", false],
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
  const value = createSyntheticRecording({ now: () => 1_723_726_800_000 });
  const digest = recordingContentDigest(value);
  assert.match(digest, /^[a-f\d]{64}$/u);
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
    }),
    { head: "abc", recordingDigest: digest },
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
