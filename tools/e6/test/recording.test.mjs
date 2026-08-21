import assert from "node:assert/strict";
import test from "node:test";

import { attemptMarkerDigest, buildAttempt } from "../lib/attempt.mjs";
import {
  createStampAdvancer,
  evaluateCaptureGate,
  validateRecordingSnapshot,
} from "../lib/recording.mjs";
import { createSyntheticRecording } from "../lib/synthetic.mjs";

function completeRecording({ sourceKind = "live" } = {}) {
  const recording = createSyntheticRecording({
    now: () => Date.parse("2026-08-24T12:00:00.000Z"),
  });
  recording.metadata.sourceKind = sourceKind;
  if (sourceKind === "live") {
    recording.metadata.sourceBase = "https://data.yesid.dev/v1";
    recording.metadata.label = "weekday-rush";
    recording.metadata.captureGate = evaluateCaptureGate({
      sourceKind,
      capturedUtc: recording.metadata.capturedUtc,
      label: recording.metadata.label,
    });
    recording.metadata.benchmarkEligible = true;
    const head = "4fcb603aa2d600d97061c26ee010a7212555dced";
    const tree = "45892764d7c65708a9c56467d444999ea2ca0d4b";
    const attempt = buildAttempt({
      consumedUtc: "2026-08-24T12:00:00.000Z",
      identity: {
        head,
        tree,
        publicMainHead: head,
        publicMainTree: tree,
        remote: "https://github.com/mgkdante/transit.git",
        gitCommonDirectory: "/tmp/e6-git-common",
        status: "",
      },
      recordingDirectory: "/tmp/peak-20260824T120000Z",
    });
    recording.metadata.attempt = attempt;
    recording.metadata.attemptMarkerDigest = attemptMarkerDigest(attempt);
  }
  return recording;
}

test("accepts an exact live B2 fleet using counts derived from payloads", () => {
  const receipt = validateRecordingSnapshot(completeRecording());
  assert.equal(receipt.sourceKind, "live");
  assert.equal(receipt.benchmarkEligible, true);
  assert.equal(receipt.vehicles, 3_424);
  assert.equal(receipt.activeRoutes, 182);
  assert.equal(receipt.files, 192);
  assert.equal(receipt.baseVehicles, 856);
  assert.equal(receipt.scaleLanes, 4);
  assert.equal(receipt.fleetVehicles, 3_424);
  assert.equal(receipt.completeRouteFiles, 182);
  assert.equal(receipt.vehicleTicks, 2);
  assert.equal(receipt.attempt.head, recordingHead());
});

function recordingHead() {
  return "4fcb603aa2d600d97061c26ee010a7212555dced";
}

test("refuses eligible live evidence with missing or tampered attempt metadata", () => {
  for (const mutate of [
    (metadata) => delete metadata.attempt,
    (metadata) => (metadata.attemptMarkerDigest = "0".repeat(64)),
    (metadata) => (metadata.attempt.head = "0".repeat(40)),
  ]) {
    const recording = completeRecording();
    mutate(recording.metadata);
    assert.throws(
      () => validateRecordingSnapshot(recording),
      /E6_ATTEMPT_METADATA_INVALID/u,
    );
  }
});

test("refuses an attempt consumed after the recorded capture instant", () => {
  const recording = completeRecording();
  const attempt = {
    ...recording.metadata.attempt,
    consumedUtc: "2026-08-24T12:00:00.001Z",
  };
  recording.metadata.attempt = attempt;
  recording.metadata.attemptMarkerDigest = attemptMarkerDigest(attempt);
  assert.throws(
    () => validateRecordingSnapshot(recording),
    /E6_ATTEMPT_METADATA_INVALID/u,
  );
});

test("refuses a first tick with any count other than exactly 3,424", () => {
  const recording = completeRecording();
  recording.payloads.get("live/vehicles.json").vehicles.pop();
  assert.throws(
    () => validateRecordingSnapshot(recording),
    /E6_FLEET_COUNT_MISMATCH tick=0 actual=3423 expected=3424/u,
  );
});

test("refuses a second tick with any count other than exactly 3,424", () => {
  const recording = completeRecording();
  recording.payloads.get("recording/vehicle-tick-1.json").vehicles.pop();
  assert.throws(
    () => validateRecordingSnapshot(recording),
    /E6_FLEET_COUNT_MISMATCH tick=1 actual=3423 expected=3424/u,
  );
});

for (const { name, mutate, error } of [
  {
    name: "missing",
    mutate: (firstTick) => delete firstTick.generated_utc,
    error: /E6_VEHICLE_TICK_GENERATED_UTC_INVALID tick=0/u,
  },
  {
    name: "malformed",
    mutate: (firstTick) => (firstTick.generated_utc = "not-an-instant"),
    error: /E6_VEHICLE_TICK_GENERATED_UTC_INVALID tick=0/u,
  },
  {
    name: "calendar-invalid",
    mutate: (firstTick) => (firstTick.generated_utc = "2026-02-30T12:00:00Z"),
    error: /E6_VEHICLE_TICK_GENERATED_UTC_INVALID tick=0/u,
  },
  {
    name: "equal",
    mutate: (firstTick, secondTick) =>
      (secondTick.generated_utc = firstTick.generated_utc),
    error: /E6_VEHICLE_TICK_GENERATED_UTC_NOT_INCREASING tick=1/u,
  },
  {
    name: "decreasing",
    mutate: (firstTick, secondTick) =>
      (secondTick.generated_utc = "2026-08-24T11:59:54.999Z"),
    error: /E6_VEHICLE_TICK_GENERATED_UTC_NOT_INCREASING tick=1/u,
  },
]) {
  test(`refuses ${name} vehicle tick generated_utc values`, () => {
    const recording = completeRecording();
    const [firstPath, secondPath] = recording.metadata.vehicleTickPaths;
    mutate(
      recording.payloads.get(firstPath),
      recording.payloads.get(secondPath),
    );
    assert.throws(() => validateRecordingSnapshot(recording), error);
  });
}

for (const { name, mutate } of [
  {
    name: "before the authorized window",
    mutate: (firstTick) =>
      (firstTick.generated_utc = "2026-08-24T09:59:59.999Z"),
  },
  {
    name: "at the excluded window end",
    mutate: (_firstTick, secondTick) =>
      (secondTick.generated_utc = "2026-08-24T13:00:00.000Z"),
  },
]) {
  test(`refuses an eligible source tick ${name}`, () => {
    const recording = completeRecording();
    const [firstPath, secondPath] = recording.metadata.vehicleTickPaths;
    mutate(
      recording.payloads.get(firstPath),
      recording.payloads.get(secondPath),
    );
    for (const purpose of ["capture", "benchmark"]) {
      assert.throws(
        () => validateRecordingSnapshot(recording, { purpose }),
        /E6_VEHICLE_TICK_CAPTURE_WINDOW_INVALID/u,
        purpose,
      );
    }
  });
}

test("refuses an eligible recording whose manifest is outside the capture window", () => {
  const recording = completeRecording();
  recording.payloads.get("manifest.json").files.live.generated_utc =
    "2026-08-24T09:59:59.999Z";
  for (const purpose of ["capture", "benchmark"]) {
    assert.throws(
      () => validateRecordingSnapshot(recording, { purpose }),
      /E6_MANIFEST_CAPTURE_WINDOW_INVALID/u,
      purpose,
    );
  }
});

test("validates against manifest-derived vehicle and route-index paths", () => {
  const recording = completeRecording();
  const vehicles = recording.payloads.get("live/vehicles.json");
  const routesIndex = recording.payloads.get("static/routes_index.json");
  recording.payloads.delete("live/vehicles.json");
  recording.payloads.delete("static/routes_index.json");
  recording.payloads.set("live/current-vehicles.json", vehicles);
  recording.payloads.set("static/catalog/routes.json", routesIndex);
  recording.metadata.requiredPaths = recording.metadata.requiredPaths
    .filter(
      (path) =>
        path !== "live/vehicles.json" && path !== "static/routes_index.json",
    )
    .concat(["live/current-vehicles.json", "static/catalog/routes.json"]);
  recording.metadata.paths = {
    vehicles: "live/current-vehicles.json",
    routesIndex: "static/catalog/routes.json",
  };
  recording.metadata.vehicleTickPaths[0] = "live/current-vehicles.json";

  assert.equal(validateRecordingSnapshot(recording).vehicles, 3_424);
});

test("refuses an incomplete route-family recording", () => {
  const recording = completeRecording();
  recording.payloads.delete("static/routes/e6-182.json");
  recording.metadata.counts.files -= 1;
  assert.throws(
    () => validateRecordingSnapshot(recording),
    /E6_RECORDING_INCOMPLETE missing route files: e6-182/u,
  );
});

test("refuses a recording that omits a live family from its required-path claim", () => {
  const recording = completeRecording();
  recording.payloads.delete("live/trips.json");
  recording.metadata.requiredPaths = recording.metadata.requiredPaths.filter(
    (path) => path !== "live/trips.json",
  );
  recording.metadata.counts.files -= 1;
  assert.throws(
    () => validateRecordingSnapshot(recording),
    /E6_RECORDING_INCOMPLETE missing required files: live\/trips\.json/u,
  );
});

test("refuses synthetic data for a benchmark measurement", () => {
  assert.throws(
    () => validateRecordingSnapshot(createSyntheticRecording()),
    /E6_CAPTURE_NOT_ELIGIBLE sourceKind=synthetic/u,
  );
});

test("pins live recordings to the settled STM source", () => {
  for (const [field, value] of [
    ["sourceBase", "https://example.test/v1"],
    ["provider", "other"],
  ]) {
    const recording = completeRecording();
    recording.metadata[field] = value;
    assert.throws(
      () => validateRecordingSnapshot(recording),
      /E6_RECORDING_SOURCE_INVALID/u,
    );
  }
  const recording = completeRecording();
  recording.payloads.get("manifest.json").provider = "other";
  assert.throws(
    () => validateRecordingSnapshot(recording),
    /E6_RECORDING_SOURCE_INVALID/u,
  );
});

test("live recording requires an explicit positive numeric manifest TTL", () => {
  for (const ttl of [undefined, null, "30", 0, -1, Number.NaN]) {
    const recording = completeRecording();
    if (ttl === undefined) {
      delete recording.payloads.get("manifest.json").files.live.ttl_s;
    } else {
      recording.payloads.get("manifest.json").files.live.ttl_s = ttl;
    }
    assert.throws(
      () => validateRecordingSnapshot(recording),
      /E6_RECORDING_TTL_INVALID/u,
    );
  }
});

test("advances every ISO stamp by one payload-relative delta", () => {
  const advance = createStampAdvancer({
    now: () => Date.parse("2026-08-10T12:00:00.000Z"),
  });
  const shifted = advance({
    generated_utc: "2026-08-08T12:00:00.000Z",
    updated_utc: "2026-08-08T11:59:55.000Z",
    nested: { eta_utc: "2026-08-08T12:05:00.000Z", label: "2026-08-08" },
    periods: [{ start_utc: "2026-08-08T11:00:00.000Z" }, { end_utc: null }],
  });
  assert.equal(shifted.generated_utc, "2026-08-10T12:00:00.000Z");
  assert.equal(shifted.updated_utc, "2026-08-10T11:59:55.000Z");
  assert.equal(shifted.nested.eta_utc, "2026-08-10T12:05:00.000Z");
  assert.equal(shifted.nested.label, "2026-08-08");
  assert.equal(shifted.periods[0].start_utc, "2026-08-10T11:00:00.000Z");
  assert.equal(shifted.periods[1].end_utc, null);
});

test("refuses non-real or unknown UTC offsets at the capture gate", () => {
  for (const capturedUtc of [
    "2026-08-25T00:01:00.000+14:01",
    "2026-08-25T09:59:00.000+23:59",
    "2026-08-24T10:00:00.000-00:00",
  ]) {
    assert.throws(
      () =>
        evaluateCaptureGate({
          sourceKind: "live",
          capturedUtc,
          label: "weekday-rush",
        }),
      /E6_CAPTURE_INSTANT_INVALID/u,
      capturedUtc,
    );
  }
  assert.equal(
    evaluateCaptureGate({
      sourceKind: "live",
      capturedUtc: "2026-08-25T00:00:00.000+14:00",
      label: "weekday-rush",
    }).eligible,
    true,
  );
});

test("refuses calendar-invalid replay anchors and nested instants", () => {
  const advance = createStampAdvancer({
    now: () => Date.parse("2026-08-10T12:00:00.000Z"),
  });
  assert.throws(
    () => advance({ generated_utc: "2026-02-30T12:00:00Z" }),
    /E6_RECORDING_TIMESTAMP_INVALID/u,
  );
  assert.throws(
    () =>
      advance({
        generated_utc: "2026-08-08T12:00:00Z",
        nested: { eta_utc: "2026-02-30T12:00:00Z" },
      }),
    /E6_RECORDING_TIMESTAMP_INVALID/u,
  );
});

test("keeps generated stamps monotonic when two serves share a wall-clock millisecond", () => {
  const advance = createStampAdvancer({
    now: () => Date.parse("2026-08-10T12:00:00.000Z"),
  });
  const payload = { generated_utc: "2026-08-08T12:00:00.000Z" };
  assert.equal(advance(payload).generated_utc, "2026-08-10T12:00:00.000Z");
  assert.equal(advance(payload).generated_utc, "2026-08-10T12:00:00.001Z");
});
