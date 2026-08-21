#!/usr/bin/env node

import { captureRecording, scaleVehicleTick } from "./lib/capture.mjs";
import {
  assertAttemptExecutionWindow,
  assertAttemptMarkerBinding,
  assertAttemptMarkerRecording,
  assertRecordingOutputReady,
  buildAttempt,
  claimAttemptMarker,
  loadAttemptMarker,
} from "./lib/attempt.mjs";
import {
  loadRecording,
  recordingContentDigest,
  writeRecording,
} from "./lib/files.mjs";
import { validateRecordingSnapshot } from "./lib/recording.mjs";
import { assertCleanBenchmarkEnvironment } from "./lib/runtime.mjs";
import {
  assertGitIdentityUnchanged,
  assertPublicGitIdentity,
  readGitCommonDirectory,
  readLocalGitIdentity,
  readPublicGitIdentity,
} from "./lib/identity.mjs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

function fail(message) {
  throw new Error(message);
}

function parseArgs(args) {
  if (args.length === 1 && args[0] === "--validate-attempt")
    return { command: "validate-attempt" };
  if (args.length === 1 && args[0] === "--prove-thin-refusal")
    return { command: "prove-thin-refusal" };
  if (args[0] === "--validate") {
    if (args.length !== 2 || !args[1])
      fail("E6_RECORDING_USAGE --validate requires a directory");
    return { command: "validate", directory: args[1] };
  }
  const captureArgs = args[0] === "capture" ? args.slice(1) : args;
  if (captureArgs.length === 0) return { command: "capture" };
  if (
    captureArgs.length === 2 &&
    captureArgs[0] === "--output" &&
    captureArgs[1]
  ) {
    return { command: "capture", directory: captureArgs[1] };
  }
  fail(
    "E6_RECORDING_USAGE e6-record.mjs [capture] [--output <directory>] | --validate <directory> | --validate-attempt | --prove-thin-refusal",
  );
}

function receipt(command, metadata, validation, recordingDigest) {
  return {
    command,
    sourceKind: validation.sourceKind,
    sourceBase: metadata.sourceBase,
    provider: metadata.provider,
    vehicles: validation.vehicles,
    activeRoutes: validation.activeRoutes,
    files: validation.files,
    completeRouteFiles: validation.completeRouteFiles,
    vehicleTicks: validation.vehicleTicks,
    baseVehicles: validation.baseVehicles,
    scaleLanes: validation.scaleLanes,
    fleetVehicles: validation.fleetVehicles,
    minimumActiveRoutes: validation.minimumActiveRoutes,
    benchmarkEligible: validation.benchmarkEligible,
    attempt: validation.attempt,
    attemptMarkerDigest: validation.attempt?.markerDigest ?? null,
    captureGate: validation.captureGate,
    scale: validation.scale,
    recordingDigest,
  };
}

function proveThinRefusal(stdout) {
  try {
    scaleVehicleTick(
      {
        vehicles: Array.from({ length: 855 }, (_, index) => ({
          id: `vehicle-${index + 1}`,
        })),
      },
      { tick: 0 },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "E6_SOURCE_FLEET_TOO_THIN distinct=855 minimum=856"
    ) {
      stdout.write(
        "E6_THIN_REFUSAL_PROVED distinctSourceVehicles=855 minimumSourceVehicles=856 targetFleetVehicles=3424\n",
      );
      return;
    }
    throw error;
  }
  fail("E6_THIN_REFUSAL_UNEXPECTED_ACCEPTANCE");
}

export async function runCli({
  args = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  now = Date.now,
  readIdentity = readPublicGitIdentity,
  readLocalIdentity = readLocalGitIdentity,
  readCommonDirectory = readGitCommonDirectory,
  capture = captureRecording,
} = {}) {
  try {
    const parsed = parseArgs(args);
    if (parsed.command === "prove-thin-refusal") {
      proveThinRefusal(stdout);
      return 0;
    }
    if (parsed.command === "validate-attempt") {
      const marker = await loadAttemptMarker({
        gitCommonDirectory: await readCommonDirectory(),
      });
      stdout.write(
        `${JSON.stringify({
          command: "validate-attempt",
          consumedUtc: marker.attempt.consumedUtc,
          head: marker.attempt.head,
          tree: marker.attempt.tree,
          recordingBasename: marker.attempt.recordingBasename,
          runtime: marker.attempt.runtime,
          attemptMarkerDigest: marker.attemptMarkerDigest,
        })}\n`,
      );
      return 0;
    }
    if (parsed.command === "validate") {
      const recording = await loadRecording(parsed.directory);
      const validation = validateRecordingSnapshot(recording, {
        purpose: "benchmark",
      });
      const marker = await loadAttemptMarker({
        gitCommonDirectory: await readCommonDirectory(),
      });
      assertAttemptMarkerRecording({
        metadata: recording.metadata,
        marker,
        recordingDirectory: parsed.directory,
      });
      stdout.write(
        `${JSON.stringify(receipt("validate", recording.metadata, validation, recording.recordingDigest))}\n`,
      );
      return 0;
    }
    const requestedDirectory = parsed.directory ?? env.E6_RECORDING_DIR;
    if (!requestedDirectory)
      fail("E6_RECORDING_OUTPUT_REQUIRED provide --output or E6_RECORDING_DIR");
    if (env.E6_CAPTURE_LABEL !== "weekday-rush") {
      fail("E6_CAPTURE_LABEL_REQUIRED weekday-rush");
    }
    assertCleanBenchmarkEnvironment(env);
    const directory = await assertRecordingOutputReady(requestedDirectory);
    const identity = assertPublicGitIdentity(await readIdentity());
    assertGitIdentityUnchanged(identity, await readLocalIdentity());
    const consumedUtc = new Date(now()).toISOString();
    const attempt = buildAttempt({
      consumedUtc,
      identity,
      recordingDirectory: directory,
    });
    const claimed = await claimAttemptMarker({
      attempt,
      gitCommonDirectory: identity.gitCommonDirectory,
    });
    assertGitIdentityUnchanged(identity, await readLocalIdentity());
    assertAttemptExecutionWindow(claimed.attempt, now());
    const recording = await capture({
      captureLabel: env.E6_CAPTURE_LABEL,
      now,
      attempt: claimed.attempt,
      attemptMarkerDigest: claimed.attemptMarkerDigest,
    });
    assertGitIdentityUnchanged(identity, await readLocalIdentity());
    validateRecordingSnapshot(recording, {
      purpose: "benchmark",
    });
    assertAttemptMarkerBinding({
      metadata: recording.metadata,
      marker: await loadAttemptMarker({
        gitCommonDirectory: identity.gitCommonDirectory,
      }),
      identity,
      recordingDirectory: directory,
    });
    await writeRecording(directory, recording, {
      beforeInstall: async () =>
        assertGitIdentityUnchanged(identity, await readLocalIdentity()),
    });
    const stored = await loadRecording(directory);
    const validation = validateRecordingSnapshot(stored, {
      purpose: "benchmark",
    });
    assertGitIdentityUnchanged(identity, await readLocalIdentity());
    assertAttemptMarkerBinding({
      metadata: stored.metadata,
      marker: await loadAttemptMarker({
        gitCommonDirectory: identity.gitCommonDirectory,
      }),
      identity,
      recordingDirectory: directory,
    });
    const recordingDigest = recordingContentDigest(stored);
    stdout.write(
      `${JSON.stringify(receipt("capture", stored.metadata, validation, recordingDigest))}\n`,
    );
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  process.exitCode = await runCli();
}
