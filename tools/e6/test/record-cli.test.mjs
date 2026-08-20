import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../e6-record.mjs";
import { writeRecording } from "../lib/files.mjs";
import { evaluateCaptureGate } from "../lib/recording.mjs";
import { createSyntheticRecording } from "../lib/synthetic.mjs";

function output() {
  let text = "";
  return { write: (value) => (text += value), value: () => text };
}

function completeRecording() {
  const recording = createSyntheticRecording({
    now: () => Date.parse("2026-08-24T12:00:00.000Z"),
  });
  recording.metadata.sourceKind = "live";
  recording.metadata.sourceBase = "https://data.yesid.dev/v1";
  recording.metadata.label = "weekday-rush";
  recording.metadata.captureGate = evaluateCaptureGate({
    sourceKind: "live",
    capturedUtc: recording.metadata.capturedUtc,
    label: recording.metadata.label,
  });
  recording.metadata.benchmarkEligible = true;
  return recording;
}

test("prints the exact deterministic proof that 855 sources cannot make the B2 fleet", async () => {
  const stdout = output();
  const stderr = output();
  const status = await runCli({
    args: ["--prove-thin-refusal"],
    stdout,
    stderr,
  });
  assert.equal(status, 0);
  assert.equal(stderr.value(), "");
  assert.equal(
    stdout.value(),
    "E6_THIN_REFUSAL_PROVED distinctSourceVehicles=855 minimumSourceVehicles=856 targetFleetVehicles=3424\n",
  );
});

test("validates a complete recording from disk and returns bound B2 identity", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "e6-record-cli-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeRecording(directory, completeRecording());

  const stdout = output();
  const stderr = output();
  const status = await runCli({
    args: ["--validate", directory],
    stdout,
    stderr,
  });
  assert.equal(status, 0);
  assert.equal(stderr.value(), "");
  const receipt = JSON.parse(stdout.value());
  assert.equal(receipt.command, "validate");
  assert.equal(receipt.sourceKind, "live");
  assert.equal(receipt.sourceBase, "https://data.yesid.dev/v1");
  assert.equal(receipt.provider, "stm");
  assert.equal(receipt.vehicles, 3_424);
  assert.equal(receipt.activeRoutes, 182);
  assert.equal(receipt.files, 192);
  assert.equal(receipt.vehicleTicks, 2);
  assert.equal(receipt.completeRouteFiles, 182);
  assert.equal(receipt.baseVehicles, 856);
  assert.equal(receipt.scaleLanes, 4);
  assert.equal(receipt.fleetVehicles, 3_424);
  assert.equal(receipt.benchmarkEligible, true);
  assert.match(receipt.recordingDigest, /^[a-f\d]{64}$/u);
  assert.equal(receipt.scale.ticks[0].selectedBaseIdentities.length, 856);
});

test("validation refuses live evidence outside the settled source contract", async (context) => {
  for (const { mutate, error } of [
    {
      mutate: (recording) =>
        (recording.metadata.sourceBase = "https://example.test/v1"),
      error: "E6_RECORDING_SOURCE_INVALID\n",
    },
    {
      mutate: (recording) => {
        const [first, second] = recording.metadata.vehicleTickPaths;
        recording.payloads.get(first).generated_utc =
          "2026-08-24T09:00:00.000Z";
        recording.payloads.get(second).generated_utc =
          "2026-08-24T09:00:01.000Z";
      },
      error: "E6_VEHICLE_TICK_CAPTURE_WINDOW_INVALID tick=0\n",
    },
    {
      mutate: (recording) =>
        (recording.payloads.get("manifest.json").files.live.generated_utc =
          "2026-08-24T09:59:59.999Z"),
      error: "E6_MANIFEST_CAPTURE_WINDOW_INVALID\n",
    },
  ]) {
    const directory = await mkdtemp(join(tmpdir(), "e6-record-cli-source-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const recording = completeRecording();
    mutate(recording);
    await writeRecording(directory, recording);
    const stdout = output();
    const stderr = output();
    const status = await runCli({
      args: ["--validate", directory],
      stdout,
      stderr,
    });
    assert.equal(status, 1);
    assert.equal(stdout.value(), "");
    assert.equal(stderr.value(), error);
  }
});

test("capture CLI requires the explicit weekday-rush label before network work", async () => {
  const stdout = output();
  const stderr = output();
  const status = await runCli({
    args: ["capture"],
    env: { E6_RECORDING_DIR: "/not-created" },
    stdout,
    stderr,
  });
  assert.equal(status, 1);
  assert.equal(stderr.value(), "E6_CAPTURE_LABEL_REQUIRED weekday-rush\n");
});
