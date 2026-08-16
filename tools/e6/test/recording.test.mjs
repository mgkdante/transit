import assert from "node:assert/strict";
import test from "node:test";

import {
  createStampAdvancer,
  evaluateCaptureGate,
  validateRecordingSnapshot,
} from "../lib/recording.mjs";
import { createSyntheticRecording } from "../lib/synthetic.mjs";

function completeRecording({ sourceKind = "live" } = {}) {
  const recording = createSyntheticRecording({
    now: () => Date.parse("2026-08-17T12:00:00.000Z"),
  });
  recording.metadata.sourceKind = sourceKind;
  if (sourceKind === "live") {
    recording.metadata.label = "weekday-rush";
    recording.metadata.captureGate = evaluateCaptureGate({
      sourceKind,
      capturedUtc: recording.metadata.capturedUtc,
      label: recording.metadata.label,
    });
    recording.metadata.benchmarkEligible = true;
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

test("keeps generated stamps monotonic when two serves share a wall-clock millisecond", () => {
  const advance = createStampAdvancer({
    now: () => Date.parse("2026-08-10T12:00:00.000Z"),
  });
  const payload = { generated_utc: "2026-08-08T12:00:00.000Z" };
  assert.equal(advance(payload).generated_utc, "2026-08-10T12:00:00.000Z");
  assert.equal(advance(payload).generated_utc, "2026-08-10T12:00:00.001Z");
});
