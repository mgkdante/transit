import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  evaluateCaptureGate,
} from "./capture-gate.mjs";
import {
  canonicalJsonBytes,
  canonicalJsonDigest,
  durableMarkerPath,
  loadDurableMarker,
  publishDurableMarker,
} from "./durable-marker.mjs";
import { assertLocalGitIdentity, assertPublicGitIdentity } from "./identity.mjs";

export const E6_ATTEMPT_MARKER_FILENAME = "b2-2026-08-24-attempt-1.json";

function fail(message) {
  throw new Error(message);
}

function exactKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expected].sort())
  );
}

export function captureRuntime(versions = process.versions) {
  const runtime = versions.bun
    ? { engine: "bun", version: versions.bun }
    : { engine: "node", version: versions.node };
  if (
    (runtime.engine === "bun" && runtime.version === "1.3.11") ||
    (runtime.engine === "node" && runtime.version === "24.15.0")
  ) {
    return runtime;
  }
  fail("E6_ATTEMPT_RUNTIME_INVALID");
}

function assertRuntime(runtime) {
  if (!exactKeys(runtime, ["engine", "version"])) {
    fail("E6_ATTEMPT_RUNTIME_INVALID");
  }
  if (runtime.engine === "bun") return captureRuntime({ bun: runtime.version });
  if (runtime.engine === "node") return captureRuntime({ node: runtime.version });
  fail("E6_ATTEMPT_RUNTIME_INVALID");
}

export function assertAttempt(attempt) {
  if (
    !exactKeys(attempt, [
      "schema",
      "consumedUtc",
      "runtime",
      "head",
      "tree",
      "recordingBasename",
    ]) ||
    attempt.schema !== 1 ||
    !/^[a-f\d]{40}$/u.test(attempt.head ?? "") ||
    !/^[a-f\d]{40}$/u.test(attempt.tree ?? "") ||
    typeof attempt.recordingBasename !== "string" ||
    !attempt.recordingBasename ||
    basename(attempt.recordingBasename) !== attempt.recordingBasename
  ) {
    fail("E6_ATTEMPT_MARKER_INVALID");
  }
  try {
    assertRuntime(attempt.runtime);
  } catch {
    fail("E6_ATTEMPT_RUNTIME_INVALID");
  }
  const gate = evaluateCaptureGate({
    sourceKind: "live",
    capturedUtc: attempt.consumedUtc,
    label: "weekday-rush",
  });
  if (!gate.eligible) {
    fail("E6_ATTEMPT_WINDOW_INVALID");
  }
  return attempt;
}

export function attemptMarkerDigest(attempt) {
  return canonicalJsonDigest(assertAttempt(attempt));
}

export function attemptMarkerPath(gitCommonDirectory) {
  return durableMarkerPath(gitCommonDirectory, E6_ATTEMPT_MARKER_FILENAME);
}

export async function assertRecordingOutputReady(recordingDirectory) {
  const directory = resolve(recordingDirectory);
  try {
    await lstat(directory);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    let parent;
    try {
      let current = dirname(directory);
      while (true) {
        parent = await open(
          current,
          constants.O_RDONLY |
            (constants.O_DIRECTORY ?? 0) |
            (constants.O_NOFOLLOW ?? 0) |
            (constants.O_NONBLOCK ?? 0),
        );
        const stats = await parent.stat();
        if (!stats.isDirectory()) fail("E6_RECORDING_PARENT_INVALID");
        await parent.sync();
        await parent.close();
        parent = undefined;
        const ancestor = dirname(current);
        if (ancestor === current) break;
        current = ancestor;
      }
      const probePath = join(
        dirname(directory),
        `.e6-output-probe-${randomUUID()}`,
      );
      let probe;
      let probeCreated = false;
      try {
        probe = await open(
          probePath,
          constants.O_CREAT |
            constants.O_EXCL |
            constants.O_WRONLY |
            (constants.O_NOFOLLOW ?? 0) |
            (constants.O_NONBLOCK ?? 0),
          0o600,
        );
        probeCreated = true;
        await probe.writeFile("e6\n");
        await probe.sync();
      } finally {
        await probe?.close().catch(() => {});
        if (probeCreated) await unlink(probePath);
      }
      parent = await open(
        dirname(directory),
        constants.O_RDONLY |
          (constants.O_DIRECTORY ?? 0) |
          (constants.O_NOFOLLOW ?? 0) |
          (constants.O_NONBLOCK ?? 0),
      );
      await parent.sync();
      await parent.close();
      parent = undefined;
      return directory;
    } catch (parentError) {
      if (
        parentError instanceof Error &&
        parentError.message.startsWith("E6_")
      ) {
        throw parentError;
      }
      fail("E6_RECORDING_PARENT_INVALID");
    } finally {
      await parent?.close().catch(() => {});
    }
  }
  fail("E6_RECORDING_OUTPUT_EXISTS");
}

export function assertAttemptExecutionWindow(attempt, nowMs) {
  assertAttempt(attempt);
  const currentUtc = new Date(nowMs).toISOString();
  const gate = evaluateCaptureGate({
    sourceKind: "live",
    capturedUtc: currentUtc,
    label: "weekday-rush",
  });
  if (!gate.eligible || Date.parse(currentUtc) < Date.parse(attempt.consumedUtc)) {
    fail("E6_ATTEMPT_WINDOW_EXPIRED_AFTER_CONSUMPTION");
  }
  return gate;
}

export function buildAttempt({
  consumedUtc,
  identity,
  recordingDirectory,
  runtime = captureRuntime(),
} = {}) {
  assertPublicGitIdentity(identity);
  const captureGate = evaluateCaptureGate({
    sourceKind: "live",
    capturedUtc: consumedUtc,
    label: "weekday-rush",
  });
  if (!captureGate.eligible) {
    fail(
      `E6_ATTEMPT_WINDOW_INVALID localDate=${captureGate.localDate} localTime=${captureGate.localTime}`,
    );
  }
  assertRuntime(runtime);
  const recordingBasename = basename(resolve(recordingDirectory));
  if (!recordingBasename || recordingBasename === ".") {
    fail("E6_ATTEMPT_RECORDING_DIRECTORY_INVALID");
  }
  return assertAttempt({
    schema: 1,
    consumedUtc,
    runtime,
    head: identity.head,
    tree: identity.tree,
    recordingBasename,
  });
}

function markerReceipt(loaded) {
  return {
    attempt: loaded.value,
    attemptMarkerDigest: loaded.digest,
    markerPath: loaded.markerPath,
  };
}

export async function claimAttemptMarker({ attempt, gitCommonDirectory } = {}) {
  return markerReceipt(
    await publishDurableMarker({
      gitCommonDirectory,
      filename: E6_ATTEMPT_MARKER_FILENAME,
      value: assertAttempt(attempt),
      validate: assertAttempt,
      alreadyConsumedCode: "E6_ATTEMPT_ALREADY_CONSUMED",
      invalidCode: "E6_ATTEMPT_MARKER_INVALID",
    }),
  );
}

export async function loadAttemptMarker({ gitCommonDirectory } = {}) {
  return markerReceipt(
    await loadDurableMarker({
      gitCommonDirectory,
      filename: E6_ATTEMPT_MARKER_FILENAME,
      validate: assertAttempt,
      invalidCode: "E6_ATTEMPT_MARKER_INVALID",
    }),
  );
}

export function assertAttemptMarkerIdentity({ marker, identity } = {}) {
  assertLocalGitIdentity(identity);
  const hasPublicIdentity = "publicMainHead" in identity;
  if (hasPublicIdentity) assertPublicGitIdentity(identity);
  if (
    !marker ||
    marker.attempt.head !== identity.head ||
    marker.attempt.tree !== identity.tree
  ) {
    fail("E6_ATTEMPT_MARKER_MISMATCH");
  }
  return marker;
}

export function assertAttemptMarkerBinding({
  metadata,
  marker,
  identity,
  recordingDirectory,
} = {}) {
  assertAttemptMarkerIdentity({ marker, identity });
  return assertAttemptMarkerRecording({
    metadata,
    marker,
    recordingDirectory,
    identity,
  });
}

export function assertAttemptMarkerRecording({
  metadata,
  marker,
  recordingDirectory,
  identity,
} = {}) {
  try {
    assertAttempt(metadata?.attempt);
  } catch {
    fail("E6_ATTEMPT_MARKER_MISMATCH");
  }
  if (
    !canonicalJsonBytes(marker.attempt).equals(
      canonicalJsonBytes(metadata.attempt),
    ) ||
    marker.attemptMarkerDigest !== metadata.attemptMarkerDigest ||
    (identity && metadata.attempt.head !== identity.head) ||
    (identity && metadata.attempt.tree !== identity.tree) ||
    metadata.attempt.recordingBasename !== basename(resolve(recordingDirectory))
  ) {
    fail("E6_ATTEMPT_MARKER_MISMATCH");
  }
  return {
    markerDigest: marker.attemptMarkerDigest,
    consumedUtc: marker.attempt.consumedUtc,
    head: marker.attempt.head,
    tree: marker.attempt.tree,
    recordingBasename: marker.attempt.recordingBasename,
    runtime: marker.attempt.runtime,
  };
}
