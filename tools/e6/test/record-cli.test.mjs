import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../e6-record.mjs";
import {
  attemptMarkerDigest,
  attemptMarkerPath,
  buildAttempt,
  claimAttemptMarker,
} from "../lib/attempt.mjs";
import { writeRecording } from "../lib/files.mjs";
import { evaluateCaptureGate } from "../lib/recording.mjs";
import { createSyntheticRecording } from "../lib/synthetic.mjs";

function output() {
  let text = "";
  return { write: (value) => (text += value), value: () => text };
}

function completeRecording(
  recordingDirectory = "/tmp/peak-20260824T120000Z",
  gitCommonDirectory = "/tmp/e6-git-common",
  consumedUtc = "2026-08-24T12:00:00.000Z",
  claimed,
) {
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
  const attempt =
    claimed?.attempt ??
    buildAttempt({
      consumedUtc,
      identity: exactMainIdentity(gitCommonDirectory),
      recordingDirectory,
    });
  recording.metadata.attempt = attempt;
  recording.metadata.attemptMarkerDigest =
    claimed?.attemptMarkerDigest ?? attemptMarkerDigest(attempt);
  return recording;
}

const B2_HEAD = "4fcb603aa2d600d97061c26ee010a7212555dced";
const B2_TREE = "45892764d7c65708a9c56467d444999ea2ca0d4b";

function exactMainIdentity(gitCommonDirectory) {
  return {
    head: B2_HEAD,
    tree: B2_TREE,
    publicMainHead: B2_HEAD,
    publicMainTree: B2_TREE,
    remote: "https://github.com/mgkdante/transit.git",
    gitCommonDirectory,
    status: "",
  };
}

function localIdentity(gitCommonDirectory) {
  const { head, tree, status } = exactMainIdentity(gitCommonDirectory);
  return { head, tree, status, gitCommonDirectory };
}

async function captureFixture(context, name) {
  const root = await mkdtemp(join(tmpdir(), `${name}-`));
  context.after(() => rm(root, { recursive: true, force: true }));
  const gitCommonDirectory = join(root, "git-common");
  await mkdir(gitCommonDirectory, { mode: 0o700 });
  return {
    root,
    directory: join(root, "recording"),
    gitCommonDirectory,
    identity: async () => exactMainIdentity(gitCommonDirectory),
  };
}

async function invokeCapture(
  fixture,
  {
    now = () => Date.parse("2026-08-24T12:00:00.000Z"),
    readIdentity = fixture.identity,
    readLocalIdentity = fixture.identity,
    capture,
    directory = fixture.directory,
    environment = {},
  } = {},
) {
  const stdout = output();
  const stderr = output();
  const status = await runCli({
    args: ["capture"],
    env: {
      E6_CAPTURE_LABEL: "weekday-rush",
      E6_RECORDING_DIR: directory,
      ...environment,
    },
    stdout,
    stderr,
    now,
    readIdentity,
    readLocalIdentity,
    capture,
  });
  return { status, stdout: stdout.value(), stderr: stderr.value() };
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

test("runtime injection fails before capture or attempt consumption", async (context) => {
  const fixture = await captureFixture(context, "e6-attempt-runtime-env");
  let captureCalls = 0;
  const result = await invokeCapture(fixture, {
    environment: { NODE_OPTIONS: "--require=/tmp/evil.cjs" },
    capture: async () => {
      captureCalls += 1;
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /E6_RUNTIME_ENVIRONMENT_INVALID name=NODE_OPTIONS/u);
  assert.equal(captureCalls, 0);
  await assert.rejects(readFile(attemptMarkerPath(fixture.gitCommonDirectory)), {
    code: "ENOENT",
  });
});

test("validates a complete recording from disk and returns bound B2 identity", async (context) => {
  const fixture = await captureFixture(context, "e6-record-cli");
  const capture = await invokeCapture(fixture, {
    capture: async ({ attempt, attemptMarkerDigest }) =>
      completeRecording(
        fixture.directory,
        fixture.gitCommonDirectory,
        attempt.consumedUtc,
        { attempt, attemptMarkerDigest },
      ),
  });
  assert.equal(capture.status, 0);
  assert.equal(capture.stderr, "");
  const captureReceipt = JSON.parse(capture.stdout);
  assert.equal(captureReceipt.command, "capture");
  assert.equal(
    captureReceipt.attemptMarkerDigest,
    captureReceipt.attempt.markerDigest,
  );

  const stdout = output();
  const stderr = output();
  const status = await runCli({
    args: ["--validate", fixture.directory],
    stdout,
    stderr,
    readCommonDirectory: async () => fixture.gitCommonDirectory,
    readLocalIdentity: async () => {
      throw new Error("historical validation must not read current identity");
    },
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
  assert.equal(receipt.attempt.head, captureReceipt.attempt.head);
  assert.equal(receipt.attemptMarkerDigest, captureReceipt.attemptMarkerDigest);
  assert.match(receipt.recordingDigest, /^[a-f\d]{64}$/u);
  assert.equal(receipt.scale.ticks[0].selectedBaseIdentities.length, 856);
});

test("validation rejects a recording bound to a different durable attempt", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-record-marker-mismatch-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "recording");
  const gitCommonDirectory = join(root, "git-common");
  await mkdir(gitCommonDirectory, { mode: 0o700 });
  const durable = completeRecording(directory, gitCommonDirectory);
  await claimAttemptMarker({
    attempt: durable.metadata.attempt,
    gitCommonDirectory,
  });
  await writeRecording(
    directory,
    completeRecording(
      directory,
      gitCommonDirectory,
      "2026-08-24T11:59:59.999Z",
    ),
  );
  const stderr = output();

  const status = await runCli({
    args: ["--validate", directory],
    stdout: output(),
    stderr,
    readCommonDirectory: async () => gitCommonDirectory,
  });
  assert.equal(status, 1);
  assert.equal(stderr.value(), "E6_ATTEMPT_MARKER_MISMATCH\n");
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
    const root = await mkdtemp(join(tmpdir(), "e6-record-cli-source-"));
    const directory = join(root, "recording");
    context.after(() => rm(root, { recursive: true, force: true }));
    const recording = completeRecording(directory);
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

test("capture consumes the shared B2 attempt before network work and never releases it", async (context) => {
  const fixture = await captureFixture(context, "e6-attempt-cli");
  const path = attemptMarkerPath(fixture.gitCommonDirectory);
  let captureCalls = 0;
  const capture = async ({ attempt, attemptMarkerDigest }) => {
    captureCalls += 1;
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), attempt);
    assert.match(attemptMarkerDigest, /^[a-f\d]{64}$/u);
    throw new Error("E6_TEST_CAPTURE_FAILURE");
  };
  const first = await invokeCapture(fixture, { capture });
  assert.equal(first.status, 1);
  assert.equal(first.stdout, "");
  assert.equal(first.stderr, "E6_TEST_CAPTURE_FAILURE\n");
  assert.equal(captureCalls, 1);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const consumedBytes = await readFile(path);
  const validation = output();
  assert.equal(
    await runCli({
      args: ["--validate-attempt"],
      stdout: validation,
      stderr: output(),
      readCommonDirectory: async () => fixture.gitCommonDirectory,
      readLocalIdentity: async () => {
        throw new Error("historical validation must not read current identity");
      },
    }),
    0,
  );
  assert.equal(
    JSON.parse(validation.value()).attemptMarkerDigest,
    attemptMarkerDigest(JSON.parse(consumedBytes)),
  );

  const second = await invokeCapture(fixture, {
    now: () => Date.parse("2026-08-24T12:01:00.000Z"),
    capture,
  });
  assert.equal(second.status, 1);
  assert.match(second.stderr, /E6_ATTEMPT_ALREADY_CONSUMED/u);
  assert.equal(captureCalls, 1);
  assert.deepEqual(await readFile(path), consumedBytes);
});

test("capture refuses an existing output before consuming the B2 attempt", async (context) => {
  const fixture = await captureFixture(context, "e6-attempt-output");
  await mkdir(fixture.directory);
  let captureCalls = 0;
  const result = await invokeCapture(fixture, {
    capture: async () => {
      captureCalls += 1;
      throw new Error("E6_TEST_CAPTURE_CALLED");
    },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stderr, "E6_RECORDING_OUTPUT_EXISTS\n");
  assert.equal(captureCalls, 0);
  await assert.rejects(readFile(attemptMarkerPath(fixture.gitCommonDirectory)), {
    code: "ENOENT",
  });
});

test("capture requires a durable existing output parent before consuming", async (context) => {
  const fixture = await captureFixture(context, "e6-attempt-parent");
  let captureCalls = 0;
  const result = await invokeCapture(fixture, {
    directory: join(fixture.root, "missing-parent", "recording"),
    capture: async () => {
      captureCalls += 1;
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /E6_RECORDING_PARENT_INVALID/u);
  assert.equal(captureCalls, 0);
  await assert.rejects(readFile(attemptMarkerPath(fixture.gitCommonDirectory)), {
    code: "ENOENT",
  });
});

test("capture proves the output parent is writable before consuming", async (context) => {
  const fixture = await captureFixture(context, "e6-attempt-parent-write");
  await chmod(fixture.root, 0o500);
  let result;
  try {
    result = await invokeCapture(fixture, {
      capture: async () => {
        throw new Error("E6_TEST_CAPTURE_CALLED");
      },
    });
  } finally {
    await chmod(fixture.root, 0o700);
  }
  assert.equal(result.status, 1);
  assert.match(result.stderr, /E6_RECORDING_PARENT_INVALID/u);
  await assert.rejects(
    readFile(attemptMarkerPath(fixture.gitCommonDirectory)),
    { code: "ENOENT" },
  );
});

test("crossing the window boundary after durable consumption burns the attempt without capture", async (context) => {
  const fixture = await captureFixture(context, "e6-attempt-boundary");
  const instants = [
    Date.parse("2026-08-24T12:59:59.999Z"),
    Date.parse("2026-08-24T13:00:00.000Z"),
  ];
  let captureCalls = 0;
  const result = await invokeCapture(fixture, {
    now: () => instants.shift() ?? Date.parse("2026-08-24T13:00:00.000Z"),
    capture: async () => {
      captureCalls += 1;
      throw new Error("E6_TEST_CAPTURE_CALLED");
    },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stderr, "E6_ATTEMPT_WINDOW_EXPIRED_AFTER_CONSUMPTION\n");
  assert.equal(captureCalls, 0);
  assert.equal(
    JSON.parse(
      await readFile(
        attemptMarkerPath(fixture.gitCommonDirectory),
        "utf8",
      ),
    )
      .consumedUtc,
    "2026-08-24T12:59:59.999Z",
  );
});

test("local HEAD moving during public preflight does not consume the attempt", async (context) => {
  const fixture = await captureFixture(context, "e6-attempt-preclaim-race");
  const before = exactMainIdentity(fixture.gitCommonDirectory);
  const after = {
    ...localIdentity(fixture.gitCommonDirectory),
    head: "0".repeat(40),
  };
  let captureCalls = 0;
  const result = await invokeCapture(fixture, {
    readIdentity: async () => before,
    readLocalIdentity: async () => after,
    capture: async () => {
      captureCalls += 1;
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /E6_IDENTITY_CHANGED_AFTER_ATTEMPT_CONSUMPTION/u);
  assert.equal(captureCalls, 0);
  await assert.rejects(
    readFile(attemptMarkerPath(fixture.gitCommonDirectory)),
    { code: "ENOENT" },
  );
});

test("local HEAD moving after durable consumption burns the attempt without capture", async (context) => {
  const fixture = await captureFixture(context, "e6-attempt-main-race");
  const before = exactMainIdentity(fixture.gitCommonDirectory);
  const after = {
    ...before,
    head: "0".repeat(40),
  };
  let captureCalls = 0;
  let localReads = 0;
  const result = await invokeCapture(fixture, {
    readIdentity: async () => before,
    readLocalIdentity: async () =>
      localReads++ === 0 ? localIdentity(fixture.gitCommonDirectory) : after,
    capture: async () => {
      captureCalls += 1;
      throw new Error("E6_TEST_CAPTURE_CALLED");
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /E6_IDENTITY_CHANGED_AFTER_ATTEMPT_CONSUMPTION/u);
  assert.equal(captureCalls, 0);
  assert.equal(
    JSON.parse(
      await readFile(
        attemptMarkerPath(fixture.gitCommonDirectory),
        "utf8",
      ),
    )
      .head,
    B2_HEAD,
  );
});

test("identity drift during capture burns the attempt without sealing a recording", async (context) => {
  const fixture = await captureFixture(context, "e6-attempt-capture-race");
  const before = exactMainIdentity(fixture.gitCommonDirectory);
  const after = { ...localIdentity(fixture.gitCommonDirectory), status: " M tools/e6/e6-record.mjs\n" };
  let reads = 0;
  const result = await invokeCapture(fixture, {
    readIdentity: async () => before,
    readLocalIdentity: async () =>
      reads++ < 2 ? localIdentity(fixture.gitCommonDirectory) : after,
    capture: async ({ attempt, attemptMarkerDigest }) => {
      const recording = completeRecording(
        fixture.directory,
        fixture.gitCommonDirectory,
      );
      recording.metadata.attempt = attempt;
      recording.metadata.attemptMarkerDigest = attemptMarkerDigest;
      return recording;
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /E6_IDENTITY_WORKTREE_DIRTY/u);
  await assert.rejects(readFile(join(fixture.directory, "recording.json")), {
    code: "ENOENT",
  });
  assert.equal(
    JSON.parse(
      await readFile(attemptMarkerPath(fixture.gitCommonDirectory), "utf8"),
    ).head,
    B2_HEAD,
  );
});

test("identity drift during durable sealing leaves no final recording", async (context) => {
  const fixture = await captureFixture(context, "e6-attempt-seal-race");
  const before = exactMainIdentity(fixture.gitCommonDirectory);
  const after = {
    ...localIdentity(fixture.gitCommonDirectory),
    status: " M tools/e6/e6-record.mjs\n",
  };
  let reads = 0;
  const result = await invokeCapture(fixture, {
    readIdentity: async () => before,
    readLocalIdentity: async () =>
      reads++ < 3 ? localIdentity(fixture.gitCommonDirectory) : after,
    capture: async ({ attempt, attemptMarkerDigest }) => {
      const recording = completeRecording(
        fixture.directory,
        fixture.gitCommonDirectory,
      );
      recording.metadata.attempt = attempt;
      recording.metadata.attemptMarkerDigest = attemptMarkerDigest;
      return recording;
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /E6_IDENTITY_WORKTREE_DIRTY/u);
  await assert.rejects(readFile(join(fixture.directory, "recording.json")), {
    code: "ENOENT",
  });
});

test("window and exact-main preflight failures neither consume nor capture", async (context) => {
  for (const [name, nowMs, mutateIdentity, error] of [
    [
      "before-window",
      Date.parse("2026-08-24T09:59:59.999Z"),
      (value) => value,
      /E6_ATTEMPT_WINDOW_INVALID/u,
    ],
    [
      "at-window-end",
      Date.parse("2026-08-24T13:00:00.000Z"),
      (value) => value,
      /E6_ATTEMPT_WINDOW_INVALID/u,
    ],
    [
      "dirty",
      Date.parse("2026-08-24T12:00:00.000Z"),
      (value) => ({ ...value, status: " M tools/e6/e6-record.mjs\n" }),
      /E6_IDENTITY_WORKTREE_DIRTY/u,
    ],
    [
      "not-public-main",
      Date.parse("2026-08-24T12:00:00.000Z"),
      (value) => ({ ...value, publicMainHead: "0".repeat(40) }),
      /E6_IDENTITY_PUBLIC_MAIN_MISMATCH/u,
    ],
  ]) {
    const fixture = await captureFixture(context, `e6-attempt-${name}`);
    let captureCalls = 0;
    const result = await invokeCapture(fixture, {
      now: () => nowMs,
      readIdentity: async () =>
        mutateIdentity(exactMainIdentity(fixture.gitCommonDirectory)),
      capture: async () => {
        captureCalls += 1;
      },
    });
    assert.equal(result.status, 1, name);
    assert.match(result.stderr, error, name);
    assert.equal(captureCalls, 0, name);
    await assert.rejects(
      readFile(attemptMarkerPath(fixture.gitCommonDirectory)),
      { code: "ENOENT" },
      name,
    );
  }
});

test("capture cannot seal an attempt whose completed recording is outside the window", async (context) => {
  const fixture = await captureFixture(context, "e6-attempt-late-recording");
  const result = await invokeCapture(fixture, {
    capture: async ({ attempt, attemptMarkerDigest }) => {
      const recording = completeRecording(
        fixture.directory,
        fixture.gitCommonDirectory,
      );
      recording.metadata.attempt = attempt;
      recording.metadata.attemptMarkerDigest = attemptMarkerDigest;
      recording.metadata.capturedUtc = "2026-08-24T13:00:00.000Z";
      recording.metadata.captureGate = evaluateCaptureGate({
        sourceKind: "live",
        capturedUtc: recording.metadata.capturedUtc,
        label: "weekday-rush",
      });
      recording.metadata.benchmarkEligible = false;
      return recording;
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /E6_CAPTURE_NOT_ELIGIBLE/u);
  await assert.rejects(readFile(join(fixture.directory, "recording.json")), {
    code: "ENOENT",
  });
  assert.equal(
    JSON.parse(
      await readFile(attemptMarkerPath(fixture.gitCommonDirectory), "utf8"),
    ).consumedUtc,
    "2026-08-24T12:00:00.000Z",
  );
});
