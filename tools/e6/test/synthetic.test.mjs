import assert from "node:assert/strict";
import test from "node:test";

import { validateRecordingSnapshot } from "../lib/recording.mjs";
import { createSyntheticRecording } from "../lib/synthetic.mjs";

test("builds a complete schema-shaped dry-run fleet with warmable route geometry", () => {
  const recording = createSyntheticRecording({
    now: () => Date.parse("2026-08-10T12:00:00.000Z"),
  });
  const validation = validateRecordingSnapshot(recording, {
    purpose: "dry-run",
  });

  assert.equal(recording.metadata.sourceKind, "synthetic");
  assert.equal(recording.metadata.benchmarkEligible, false);
  assert.equal(validation.vehicles, 3_424);
  assert.equal(validation.activeRoutes, 182);
  assert.equal(validation.files, 192);
  assert.equal(validation.vehicleTicks, 2);
  assert.deepEqual(
    recording.payloads.get("manifest.json").bbox,
    [-74.05, 45.35, -73.35, 45.72],
  );
  assert.equal(
    recording.payloads.get("live/network.json").vehicles_in_service,
    3_424,
  );

  const vehicle = recording.payloads.get("live/vehicles.json").vehicles[0];
  const nextVehicle = recording.payloads.get("recording/vehicle-tick-1.json")
    .vehicles[0];
  assert.equal(vehicle.speed_kmh > 0, true);
  assert.notEqual(nextVehicle.lon, vehicle.lon);
  const route = recording.payloads.get(`static/routes/${vehicle.route}.json`);
  assert.equal(route.directions[0].shape.type, "LineString");
  assert.equal(route.directions[0].shape.coordinates.length >= 2, true);
});

test("synthetic dry-run data can never be accepted as a benchmark recording", () => {
  assert.throws(
    () => validateRecordingSnapshot(createSyntheticRecording()),
    /E6_CAPTURE_NOT_ELIGIBLE sourceKind=synthetic/u,
  );
});
