import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadRecording,
  recordingContentDigest,
  writeRecording,
} from "../lib/files.mjs";

test("canonical recording identity changes when benchmark metadata is tampered", () => {
  const metadata = {
    schema: 1,
    kind: "e6-recording",
    sourceKind: "live",
    provider: "stm",
    captureLabel: "weekday-rush",
    capturedUtc: "2026-08-17T12:00:00.000Z",
  };
  const payloads = new Map([
    [
      "live/vehicles.json",
      { generated_utc: "2026-08-17T12:00:00.000Z", vehicles: [] },
    ],
  ]);
  const original = recordingContentDigest({ metadata, payloads });
  const tampered = recordingContentDigest({
    metadata: { ...metadata, captureLabel: "hidden-window" },
    payloads,
  });

  assert.match(original, /^[a-f\d]{64}$/u);
  assert.notEqual(tampered, original);
});

test("round-trips payloads and verifies their byte digests", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "e6-recording-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const metadata = {
    schema: 1,
    kind: "e6-recording",
    sourceKind: "live",
    provider: "stm",
    capturedUtc: "2026-08-08T12:00:00.000Z",
  };
  const payloads = new Map([
    [
      "manifest.json",
      { files: { live: { generated_utc: "2026-08-08T12:00:00.000Z" } } },
    ],
    [
      "live/vehicles.json",
      { generated_utc: "2026-08-08T12:00:00.000Z", vehicles: [] },
    ],
  ]);

  await writeRecording(directory, { metadata, payloads });
  const loaded = await loadRecording(directory);
  assert.equal(loaded.metadata.files.length, 2);
  assert.deepEqual(
    loaded.payloads.get("live/vehicles.json"),
    payloads.get("live/vehicles.json"),
  );

  const stored = JSON.parse(
    await readFile(join(directory, "recording.json"), "utf8"),
  );
  assert.match(stored.files[0].sha256, /^[a-f\d]{64}$/u);
});

test("refuses a recording whose stored payload bytes were changed", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "e6-recording-tamper-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeRecording(directory, {
    metadata: {
      schema: 1,
      kind: "e6-recording",
      sourceKind: "live",
      provider: "stm",
      capturedUtc: "2026-08-08T12:00:00.000Z",
    },
    payloads: new Map([
      [
        "live/vehicles.json",
        { generated_utc: "2026-08-08T12:00:00.000Z", vehicles: [] },
      ],
    ]),
  });
  await writeFile(
    join(directory, "payloads/live/vehicles.json"),
    '{"vehicles":[]}\n',
  );
  await assert.rejects(
    () => loadRecording(directory),
    /E6_RECORDING_DIGEST_MISMATCH/u,
  );
});
