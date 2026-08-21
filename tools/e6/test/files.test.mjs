import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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
  const root = await mkdtemp(join(tmpdir(), "e6-recording-"));
  const directory = join(root, "recording");
  context.after(() => rm(root, { recursive: true, force: true }));
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

test("persists canonical regular files with private permissions", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-recording-canonical-"));
  const directory = join(root, "recording");
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeRecording(directory, {
    metadata: { zeta: 2, alpha: 1 },
    payloads: new Map([["sample.json", { zeta: 2, alpha: 1 }]]),
  });

  const payloadPath = join(directory, "payloads/sample.json");
  assert.equal(
    await readFile(payloadPath, "utf8"),
    '{\n  "alpha": 1,\n  "zeta": 2\n}\n',
  );
  const payloadStats = await stat(payloadPath);
  assert.equal(payloadStats.isFile(), true);
  assert.equal(payloadStats.mode & 0o777, 0o600);

  const metadataPath = join(directory, "recording.json");
  const metadataStats = await stat(metadataPath);
  assert.equal(metadataStats.isFile(), true);
  assert.equal(metadataStats.mode & 0o777, 0o600);
});

test("returns the independently reloaded and verified receipt", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-recording-reload-"));
  const directory = join(root, "recording");
  context.after(() => rm(root, { recursive: true, force: true }));
  const metadata = { schema: 1, nested: { source: "live" } };

  const receipt = await writeRecording(directory, {
    metadata,
    payloads: new Map([["sample.json", { ok: true }]]),
  });

  assert.notEqual(receipt.nested, metadata.nested);
  metadata.nested.source = "mutated-after-write";
  assert.equal(receipt.nested.source, "live");
});

test("never exposes a partial final directory when assembly fails", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-recording-partial-"));
  const directory = join(root, "recording");
  context.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    writeRecording(directory, {
      metadata: { schema: 1 },
      payloads: new Map([
        ["a-valid.json", { ok: true }],
        ["z/../../invalid.json", { ok: false }],
      ]),
    }),
    /E6_RECORDING_PATH_INVALID/u,
  );
  await assert.rejects(lstat(directory), { code: "ENOENT" });
});

test("refuses to replace an existing final output", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-recording-existing-"));
  const directory = join(root, "recording");
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(directory);
  await writeFile(join(directory, "owner.txt"), "preserve\n");

  await assert.rejects(
    writeRecording(directory, {
      metadata: { schema: 1 },
      payloads: new Map([["sample.json", { ok: true }]]),
    }),
    /E6_RECORDING_OUTPUT_EXISTS/u,
  );
  assert.equal(
    await readFile(join(directory, "owner.txt"), "utf8"),
    "preserve\n",
  );
});

test("refuses a recording whose stored payload bytes were changed", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-recording-tamper-"));
  const directory = join(root, "recording");
  context.after(() => rm(root, { recursive: true, force: true }));
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
