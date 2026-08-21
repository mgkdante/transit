import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertNoProductionEnvironmentFiles,
  buildPreviewAssets,
  cleanupMeasurementRun,
  closeMeasuredContext,
  installMeasurementSignalHandlers,
  main,
  measurementExitCode,
  previewEnvironment,
  redProofReceipt,
  runBenchmarkLifecycle,
  runMeasurementCli,
  startEnvironment,
  startMeasurementWindow,
  validateStoredMeasurement,
  webPaths,
} from "../e6-measure.mjs";
import { buildMeasurementPlan } from "../lib/config.mjs";

function redFixture({
  phase = "before-post",
  blockMs = 28,
  serviceMs = 32,
  count = 2,
} = {}) {
  const busyProbes = [];
  const redProofTraces = [];
  let scheduledAt = 0;
  for (let index = 0; index < count; index += 1) {
    const startedAt = scheduledAt + serviceMs - blockMs;
    const endedAt = startedAt + blockMs;
    const postedAt = phase === "before-post" ? endedAt : startedAt;
    const sampledAt = scheduledAt + serviceMs;
    busyProbes.push({ scheduledAt, postedAt, sampledAt });
    redProofTraces.push({ phase, startedAt, endedAt });
    scheduledAt = sampledAt;
  }
  return {
    busyProbes,
    busyProbeCadenceMs: 4,
    windowStartedAt: busyProbes[0].scheduledAt,
    stopRequestedAt: busyProbes.at(-1).sampledAt - 1,
    interactions: [],
    redProofTraces,
  };
}

test("resolves the web build and client output from tools/e6, not tools/apps", () => {
  assert.match(webPaths.webDirectory, /\/apps\/web\/?$/u);
  assert.match(
    webPaths.clientRoot,
    /\/apps\/web\/\.svelte-kit\/output\/client$/u,
  );
  assert.doesNotMatch(webPaths.webDirectory, /\/tools\/apps\//u);
});

test("preview build uses pinned runtime paths and drops ambient loader options", async (context) => {
  const runtime = {
    node: { executablePath: "/opt/node/bin/node" },
    bun: { executablePath: "/opt/bun/bin/bun" },
  };
  const environment = previewEnvironment(
    {
      PATH: "/tmp/fake-bin",
      HOME: "/home/e6",
      NODE_OPTIONS: "--require=/tmp/evil.cjs",
      PUBLIC_V1_BASE: "https://wrong.invalid/v1",
    },
    "http://127.0.0.1:4218/v1",
    runtime,
    "/tmp/e6-controlled-home",
  );
  assert.equal(environment.PATH, "/opt/node/bin:/opt/bun/bin:/usr/bin:/bin");
  assert.equal(environment.HOME, "/tmp/e6-controlled-home");
  assert.equal(environment.XDG_CONFIG_HOME, "/tmp/e6-controlled-home/.config");
  assert.equal(
    environment.XDG_CONFIG_DIRS,
    "/tmp/e6-controlled-home/.config-empty",
  );
  assert.equal("NODE_OPTIONS" in environment, false);
  assert.equal(environment.PUBLIC_V1_BASE, "http://127.0.0.1:4218/v1");

  const directory = await mkdtemp(join(tmpdir(), "e6-env-file-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, ".env.production"), "PUBLIC_V1_BASE=https://wrong.invalid\n");
  await assert.rejects(
    assertNoProductionEnvironmentFiles(directory),
    /E6_BUILD_ENVIRONMENT_FILE_FORBIDDEN name=.env.production/u,
  );
  await rm(join(directory, ".env.production"));
  await writeFile(join(directory, "bunfig.toml"), '[run]\npreload = "./evil.ts"\n');
  await assert.rejects(
    assertNoProductionEnvironmentFiles(directory, directory),
    /E6_BUILD_BUN_CONFIG_FORBIDDEN/u,
  );
  await rm(join(directory, "bunfig.toml"));
  await assert.rejects(
    buildPreviewAssets({
      webDirectory: directory,
      repositoryRoot: directory,
      runtime,
      runtimeEnv: environment,
      execute: async () => {
        await writeFile(
          join(directory, "bunfig.toml"),
          '[run]\npreload = "./late-evil.ts"\n',
        );
      },
    }),
    /E6_BUILD_BUN_CONFIG_FORBIDDEN/u,
  );
});

test("environment startup cleans preview and replay after fingerprint failure", async () => {
  const events = [];
  const primaryError = new Error("fingerprint-failed");
  const previewCleanupError = new Error("preview-cleanup-failed");
  const preview = {};

  await assert.rejects(
    startEnvironment(
      { dryRun: true },
      {},
      {},
      {
        readDryHead: async () => "head",
        assertPorts: async () => events.push("ports"),
        startReplay: async () => (
          events.push("replay-start"),
          {
            baseUrl: "http://127.0.0.1:4218/v1",
            close: async () => events.push("replay-close"),
          }
        ),
        startPreview: async () => (events.push("preview-start"), preview),
        readFingerprint: async () => {
          events.push("fingerprint");
          throw primaryError;
        },
        stopPreview: async (actualPreview) => {
          assert.equal(actualPreview, preview);
          events.push("preview-stop");
          throw previewCleanupError;
        },
      },
    ),
    (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.equal(error.cause, primaryError);
      assert.deepEqual(error.errors, [primaryError, previewCleanupError]);
      return true;
    },
  );
  assert.deepEqual(events, [
    "ports",
    "replay-start",
    "preview-start",
    "fingerprint",
    "preview-stop",
    "replay-close",
  ]);
});

test("preview startup failure preserves its error and still closes replay", async () => {
  const primaryError = new Error("preview-start-failed");
  const events = [];
  await assert.rejects(
    startEnvironment(
      { dryRun: true },
      {},
      {},
      {
        readDryHead: async () => "head",
        assertPorts: async () => {},
        startReplay: async () => ({
          baseUrl: "http://127.0.0.1:4218/v1",
          close: async () => events.push("replay-close"),
        }),
        startPreview: async () => {
          throw primaryError;
        },
        stopPreview: async () => events.push("preview-stop"),
      },
    ),
    (error) => error === primaryError,
  );
  assert.deepEqual(events, ["replay-close"]);
});

test("run cleanup attempts every resource and preserves every failure", async () => {
  const events = [];
  const primaryError = new Error("measurement-failed");
  const browserError = new Error("browser-close-failed");
  const previewError = new Error("preview-stop-failed");
  const browser = {};
  const preview = {};
  const replay = {};
  const adapters = {
    closeBrowser: async (actualBrowser) => {
      assert.equal(actualBrowser, browser);
      events.push("browser-close");
      throw browserError;
    },
    stopPreview: async (actualPreview) => {
      assert.equal(actualPreview, preview);
      events.push("preview-stop");
      throw previewError;
    },
    closeReplay: async (actualReplay) => {
      assert.equal(actualReplay, replay);
      events.push("replay-close");
    },
  };
  const assertFailure = (error) => {
    assert.equal(error instanceof AggregateError, true);
    assert.equal(error.cause, primaryError);
    assert.deepEqual(error.errors, [
      primaryError,
      browserError,
      previewError,
    ]);
    return true;
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      cleanupMeasurementRun(
        { browser, preview, replay, primaryError },
        adapters,
      ),
      assertFailure,
    );
  }
  assert.deepEqual(events, ["browser-close", "preview-stop", "replay-close"]);
});

test("signal shutdown closes admission, awaits cleanup, and exits conventionally", async () => {
  for (const [signal, exitCode, cleanupFailure] of [
    ["SIGINT", 130, null],
    ["SIGTERM", 143, new Error("resource-cleanup-failed")],
  ]) {
    const processTarget = new EventEmitter();
    const resources = { browser: {}, preview: {}, replay: {} };
    const events = [];
    let admissionClosed = false;
    const reported = [];
    const controller = installMeasurementSignalHandlers({
      processTarget,
      getResources: () => resources,
      requestShutdown: () => {
        admissionClosed = true;
        events.push("managed-shutdown");
        return Promise.resolve();
      },
      cleanupRun: async (actualResources) => {
        assert.equal(admissionClosed, true);
        assert.equal(actualResources, resources);
        events.push("resource-cleanup");
        if (cleanupFailure) throw cleanupFailure;
      },
      reportError: (error) => reported.push(error),
      exit: (code) => events.push(`exit-${code}`),
    });

    processTarget.emit(signal);
    processTarget.emit(signal);
    assert.equal(admissionClosed, true);
    assert.deepEqual(events.slice(0, 2), [
      "managed-shutdown",
      "resource-cleanup",
    ]);
    await controller.waitForShutdown();
    assert.equal(
      events.filter((event) => event === "managed-shutdown").length,
      1,
    );
    assert.equal(
      events.filter((event) => event === "resource-cleanup").length,
      1,
    );
    assert.equal(events.at(-1), `exit-${exitCode}`);
    assert.equal(reported.length, cleanupFailure ? 1 : 0);
    if (cleanupFailure) {
      assert.equal(reported[0] instanceof AggregateError, true);
      assert.deepEqual(reported[0].errors, [cleanupFailure]);
    }
    controller.dispose();
  }
});

test("signal during environment startup awaits its local cleanup before exit", async () => {
  const processTarget = new EventEmitter();
  const resources = {};
  const events = [];
  let releaseFingerprint;
  let markFingerprintStarted;
  const fingerprintStarted = new Promise((resolve) => {
    markFingerprintStarted = resolve;
  });
  const fingerprintGate = new Promise((resolve) => {
    releaseFingerprint = resolve;
  });
  const preview = {};
  const replay = {
    baseUrl: "http://127.0.0.1:4218/v1",
    close: async () => events.push("replay-close"),
  };
  let runPromise;
  const controller = installMeasurementSignalHandlers({
    processTarget,
    getResources: () => resources,
    getRunCompletion: () => runPromise,
    requestShutdown: () => {
      events.push("managed-shutdown");
      releaseFingerprint();
      return Promise.resolve();
    },
    cleanupRun: async (actualResources) => {
      assert.equal(actualResources.preview, preview);
      assert.equal(actualResources.replay, replay);
      events.push("signal-resource-cleanup");
    },
    reportError: () => events.push("reported"),
    exit: (code) => events.push(`exit-${code}`),
  });

  runPromise = startEnvironment(
    { dryRun: true },
    {},
    {},
    {
      resources,
      readDryHead: async () => "head",
      assertPorts: async () => {},
      startReplay: async () => replay,
      startPreview: async () => preview,
      readFingerprint: async () => {
        events.push("fingerprint");
        markFingerprintStarted();
        await fingerprintGate;
        throw new Error("fingerprint-interrupted");
      },
      stopPreview: async () => events.push("preview-stop"),
    },
  ).catch((error) => {
    events.push("main-settled");
    throw error;
  });
  await fingerprintStarted;
  processTarget.emit("SIGTERM");
  await controller.waitForShutdown();
  await assert.rejects(runPromise, /fingerprint-interrupted/u);

  for (const event of ["preview-stop", "replay-close", "main-settled"]) {
    assert.ok(events.indexOf(event) < events.indexOf("exit-143"), event);
  }
  assert.equal(events.filter((event) => event === "exit-143").length, 1);
  controller.dispose();
});

test("CLI installs signal shutdown before work and shares live resources", async () => {
  const processTarget = new EventEmitter();
  const events = [];
  let releaseMain;
  const mainGate = new Promise((resolve) => {
    releaseMain = resolve;
  });
  const browser = {};
  const preview = {};
  const replay = {};
  const execution = runMeasurementCli({
    processTarget,
    runMain: async (_args, _env, { resources }) => {
      events.push("main-start");
      Object.assign(resources, { browser, preview, replay });
      await mainGate;
      events.push("main-finally");
      return 0;
    },
    signalOptions: {
      requestShutdown: () => {
        events.push("managed-shutdown");
        releaseMain();
        return Promise.resolve();
      },
      cleanupRun: async (resources) => {
        assert.deepEqual(resources, { browser, preview, replay });
        events.push("resource-cleanup");
      },
      reportError: () => events.push("reported"),
      exit: (code) => events.push(`exit-${code}`),
    },
    writeError: () => events.push("write-error"),
  });

  processTarget.emit("SIGINT");
  assert.deepEqual(events.slice(0, 3), [
    "main-start",
    "managed-shutdown",
    "resource-cleanup",
  ]);
  await execution.signalController.waitForShutdown();
  await execution.completion;
  assert.ok(events.indexOf("main-finally") < events.indexOf("exit-130"));
  assert.equal(events.includes("write-error"), false);
  assert.equal(processTarget.exitCode, undefined);
});

test("an immediate signal during CLI installation still awaits the real run", async () => {
  const processTarget = new EventEmitter();
  const events = [];
  const execution = runMeasurementCli({
    processTarget,
    installSignals: (options) => {
      const controller = installMeasurementSignalHandlers({
        ...options,
        requestShutdown: () => {
          events.push("managed-shutdown");
          return Promise.resolve();
        },
        cleanupRun: async () => events.push("resource-cleanup"),
        exit: (code) => events.push(`exit-${code}`),
      });
      processTarget.emit("SIGINT");
      return controller;
    },
    runMain: async (_args, _env, { isShutdownRequested }) => {
      events.push("main-start");
      assert.equal(isShutdownRequested(), true);
      await Promise.resolve();
      events.push("main-finally");
      return 0;
    },
  });

  await execution.signalController.waitForShutdown();
  await execution.completion;
  assert.equal(events.includes("main-start"), true);
  assert.equal(events.includes("main-finally"), true);
  assert.ok(events.indexOf("main-finally") < events.indexOf("exit-130"));
});

function lifecycleFixture({
  claimError,
  armError,
  passed = true,
  claimMutation,
} = {}) {
  const events = [];
  const preclaimInputs = [];
  const writeInputs = [];
  const identity = { head: "h", tree: "t", gitCommonDirectory: "/git" };
  const vehiclePath = "/vehicles";
  const alignedReplay = { served: { [vehiclePath]: 0 } };
  const linkState = {
    active: true,
    previewAlive: true,
    replay: { served: { [vehiclePath]: 0 } },
    vitals: [],
    nowMs: Date.parse("2026-08-24T12:00:10.000Z"),
  };
  const startMarker = { measurementStartDigest: "start" };
  const result = {
    rawResultDigest: "result",
    rawResult: { verdict: passed ? "PASS" : "FAIL" },
    passed,
  };
  const browser = {
    version: async () => "148.0.7778.178",
    close: async () => events.push("browser-close"),
  };
  return {
    events,
    linkState,
    preclaimInputs,
    writeInputs,
    context: {
      options: {
        recordingDirectory: "/recording",
        plan: buildMeasurementPlan(),
      },
      runtime: {
        chrome: { executablePath: "/chrome" },
      },
      environment: {
        gitIdentity: identity,
        preview: {},
        previewUrl: "http://127.0.0.1:4217/map",
        marker: {},
        identity: { head: "h", recordingDigest: "recording" },
        fingerprint: { fingerprint: "fingerprint" },
      },
      env: {},
    },
    adapters: {
      assertPreclaim: async (input) => {
        events.push("preclaim");
        preclaimInputs.push(input);
        return {
          recordingDigest: "recording",
          attemptMarkerDigest: "attempt",
        };
      },
      readPublicIdentity: async () => (events.push("public"), identity),
      readLocalIdentity: async () => (events.push("local"), identity),
      assertIdentity: () => events.push("identity"),
      assertActive: () => {
        if (!linkState.active) throw new Error("E6_SIGNAL_SHUTDOWN_REQUESTED");
      },
      assertProcess: () => {
        events.push("process");
        if (!linkState.previewAlive) throw new Error("E6_PROCESS_EXITED");
      },
      assertBuildInputs: async () => events.push("build-inputs"),
      recheckRuntime: async () => events.push("runtime"),
      buildStart: () => (events.push("build-start"), {}),
      claimStart: async (input) => {
        events.push("marker-prep");
        claimMutation?.(linkState);
        assert.equal(typeof input.assertPublicationAllowed, "function");
        input.assertPublicationAllowed();
        events.push("claim");
        if (claimError) throw claimError;
        return startMarker;
      },
      launchBrowser: async () => (events.push("launch"), browser),
      assertBrowserVersion: () => events.push("browser-version"),
      measure: async (
        _browser,
        _options,
        _environment,
        {
          prepareSamplerStart,
          assertSamplerReady,
          claimSamplerStart,
        },
      ) => {
        events.push("arm-ready");
        await prepareSamplerStart();
        let marker;
        let readinessChecks = 0;
        await startMeasurementWindow({
          start: async (assertPublicationAllowed) => {
            marker = await claimSamplerStart(assertPublicationAllowed);
            events.push("sampler-start");
          },
          stats: () => linkState.replay,
          alignedReplay,
          vehiclePath,
          servedGeneratedUtc: "2026-08-24T12:00:00.000Z",
          manifest: { files: { live: { ttl_s: 60 } } },
          windowMs: 20_000,
          now: () => linkState.nowMs,
          assertReady: () => {
            assertSamplerReady();
            if (linkState.vitals.length > 0) {
              throw new Error("E6_VITALS_REQUEST_FORBIDDEN");
            }
            events.push(
              readinessChecks++ === 0 ? "window-ready" : "link-ready",
            );
          },
        });
        if (armError) throw armError;
        return { arm: {}, measurementStartMarker: marker };
      },
      readFingerprint: async () => (events.push("fingerprint-read"), {}),
      assertFingerprint: () => events.push("fingerprint-check"),
      buildRawResult: () => (events.push("raw-build"), {}),
      writeResult: async (input) => {
        writeInputs.push(input);
        const { beforePublish } = input;
        await beforePublish();
        events.push("publish-check", "result-write");
        return result;
      },
      loadCompleted: async () => (
        events.push("result-reload"),
        { result }
      ),
      now: () => "2026-08-24T12:00:00.000Z",
    },
  };
}

test("binding lifecycle claims immediately before sampling and seals before success", async () => {
  const fixture = lifecycleFixture();
  const completed = await runBenchmarkLifecycle(
    fixture.context,
    fixture.adapters,
  );
  assert.equal(completed.result.passed, true);
  assert.ok(
    fixture.events.indexOf("preclaim") < fixture.events.indexOf("launch"),
  );
  assert.ok(fixture.events.indexOf("launch") < fixture.events.indexOf("arm-ready"));
  assert.deepEqual(
    fixture.events.slice(
      fixture.events.indexOf("arm-ready"),
      fixture.events.indexOf("sampler-start") + 1,
    ),
    [
      "arm-ready",
      "public",
      "identity",
      "process",
      "local",
      "identity",
      "runtime",
      "build-inputs",
      "preclaim",
      "process",
      "window-ready",
      "build-start",
      "marker-prep",
      "process",
      "link-ready",
      "claim",
      "sampler-start",
    ],
  );
  assert.deepEqual(fixture.preclaimInputs, [
    {
      gitCommonDirectory: "/git",
      recordingDirectory: "/recording",
      expectedRecordingDigest: "recording",
    },
    {
      gitCommonDirectory: "/git",
      recordingDirectory: "/recording",
      expectedRecordingDigest: "recording",
    },
  ]);
  assert.equal(fixture.writeInputs.length, 1);
  assert.equal(fixture.writeInputs[0].gitCommonDirectory, "/git");
  assert.equal("measurementStartMarker" in fixture.writeInputs[0], false);
  assert.ok(
    fixture.events.indexOf("publish-check") <
      fixture.events.indexOf("result-write"),
  );
  assert.ok(
    fixture.events.indexOf("result-write") <
      fixture.events.indexOf("result-reload"),
  );
  assert.equal(fixture.events.at(-1), "browser-close");
});

test("preview death after the terminal fingerprint still seals completed evidence", async () => {
  const fixture = lifecycleFixture();
  let previewAlive = true;
  fixture.adapters.assertProcess = () => {
    fixture.events.push("process");
    if (!previewAlive) throw new Error("E6_PROCESS_EXITED");
  };
  fixture.adapters.assertFingerprint = () => {
    fixture.events.push("fingerprint-check");
    previewAlive = false;
  };

  const completed = await runBenchmarkLifecycle(
    fixture.context,
    fixture.adapters,
  );
  assert.equal(completed.result.passed, true);
  assert.equal(fixture.events.includes("result-write"), true);
  assert.equal(fixture.events.includes("result-reload"), true);
});

test("canonical preclaim failures cannot consume the measurement start", async () => {
  for (const failureAt of [1, 2]) {
    const fixture = lifecycleFixture();
    let preclaims = 0;
    fixture.adapters.assertPreclaim = async () => {
      fixture.events.push("preclaim");
      preclaims += 1;
      if (preclaims === failureAt) {
        throw new Error(
          failureAt === 1
            ? "E6_MEASUREMENT_RECORDING_MISMATCH"
            : "E6_MEASUREMENT_RAW_RESULT_PUBLICATION_UNSUPPORTED",
        );
      }
    };

    await assert.rejects(
      runBenchmarkLifecycle(fixture.context, fixture.adapters),
      failureAt === 1
        ? /E6_MEASUREMENT_RECORDING_MISMATCH/u
        : /E6_MEASUREMENT_RAW_RESULT_PUBLICATION_UNSUPPORTED/u,
    );
    assert.equal(fixture.events.includes("build-start"), false);
    assert.equal(fixture.events.includes("claim"), false);
    assert.equal(fixture.events.includes("window-ready"), false);
    assert.equal(fixture.events.includes("sampler-start"), false);
    assert.equal(fixture.events.includes("result-write"), false);
    assert.equal(
      fixture.events.includes("launch"),
      failureAt === 2,
      `failureAt=${failureAt}`,
    );
  }
});

test("link-boundary races cannot claim or start the sampler", async () => {
  for (const [name, mutate, expected] of [
    [
      "shutdown",
      (state) => {
        state.active = false;
      },
      /E6_SIGNAL_SHUTDOWN_REQUESTED/u,
    ],
    [
      "preview",
      (state) => {
        state.previewAlive = false;
      },
      /E6_PROCESS_EXITED/u,
    ],
    [
      "replay",
      (state) => {
        state.replay.served["/vehicles"] += 1;
      },
      /E6_REPLAY_VEHICLE_REQUEST_COUNT/u,
    ],
    [
      "vitals",
      (state) => {
        state.vitals.push("/api/vitals");
      },
      /E6_VITALS_REQUEST_FORBIDDEN/u,
    ],
    [
      "poll-margin",
      (state) => {
        state.nowMs = Date.parse("2026-08-24T12:00:50.000Z");
      },
      /E6_NATURAL_POLL_MARGIN_INVALID/u,
    ],
  ]) {
    const fixture = lifecycleFixture({ claimMutation: mutate });
    await assert.rejects(
      runBenchmarkLifecycle(fixture.context, fixture.adapters),
      expected,
      name,
    );
    assert.equal(fixture.events.includes("marker-prep"), true, name);
    assert.equal(fixture.events.includes("claim"), false, name);
    assert.equal(fixture.events.includes("sampler-start"), false, name);
    assert.equal(fixture.events.includes("result-write"), false, name);
  }
});

test("preview death during final preclaim cannot consume the measurement start", async () => {
  const fixture = lifecycleFixture();
  let preclaims = 0;
  let previewAlive = true;
  fixture.adapters.assertPreclaim = async () => {
    fixture.events.push("preclaim");
    preclaims += 1;
    if (preclaims === 2) previewAlive = false;
  };
  fixture.adapters.assertProcess = () => {
    fixture.events.push("process");
    if (!previewAlive) throw new Error("E6_PROCESS_EXITED");
  };

  await assert.rejects(
    runBenchmarkLifecycle(fixture.context, fixture.adapters),
    /E6_PROCESS_EXITED/u,
  );
  assert.equal(preclaims, 2);
  assert.equal(fixture.events.includes("window-ready"), false);
  assert.equal(fixture.events.includes("build-start"), false);
  assert.equal(fixture.events.includes("claim"), false);
  assert.equal(fixture.events.includes("sampler-start"), false);
});

test("claim and post-claim arm failures preserve the one-shot boundary", async () => {
  const preparation = lifecycleFixture();
  let publicReads = 0;
  preparation.adapters.readPublicIdentity = async () => {
    preparation.events.push("public");
    publicReads += 1;
    if (publicReads === 2) throw new Error("preparation-failed");
    return preparation.context.environment.gitIdentity;
  };
  await assert.rejects(
    runBenchmarkLifecycle(preparation.context, preparation.adapters),
    /preparation-failed/u,
  );
  assert.equal(preparation.events.includes("claim"), false);
  assert.equal(preparation.events.includes("sampler-start"), false);
  assert.equal(preparation.events.includes("result-write"), false);

  const losing = lifecycleFixture({ claimError: new Error("already-started") });
  await assert.rejects(
    runBenchmarkLifecycle(losing.context, losing.adapters),
    /already-started/u,
  );
  assert.equal(losing.events.includes("sampler-start"), false);
  assert.equal(losing.events.includes("result-write"), false);

  const consumed = lifecycleFixture({ armError: new Error("arm-failed") });
  await assert.rejects(
    runBenchmarkLifecycle(consumed.context, consumed.adapters),
    /arm-failed/u,
  );
  assert.ok(consumed.events.indexOf("claim") < consumed.events.indexOf("sampler-start"));
  assert.equal(consumed.events.includes("result-write"), false);
});

test("concurrent preparation produces exactly one sampler winner", async () => {
  let claimed = false;
  const fixtures = [lifecycleFixture(), lifecycleFixture()];
  for (const fixture of fixtures) {
    fixture.adapters.claimStart = async ({ assertPublicationAllowed }) => {
      fixture.events.push("marker-prep");
      assertPublicationAllowed();
      fixture.events.push("claim");
      if (claimed) throw new Error("already-started");
      claimed = true;
      await Promise.resolve();
      return { measurementStartDigest: "start" };
    };
  }
  const outcomes = await Promise.allSettled(
    fixtures.map((fixture) =>
      runBenchmarkLifecycle(fixture.context, fixture.adapters),
    ),
  );
  assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(
    fixtures.flatMap(({ events }) => events).filter((event) => event === "sampler-start").length,
    1,
  );
});

test("terminal metric FAIL is persisted but historical validation succeeds", () => {
  assert.equal(measurementExitCode({ passed: false }), 1);
  assert.equal(measurementExitCode({ passed: false, validation: true }), 0);
  assert.equal(measurementExitCode({ passed: true }), 0);
});

test("stored-result validation is historical and does not enter live runtime", async () => {
  const calls = [];
  const completed = await validateStoredMeasurement("/recording", {
    readCommonDirectory: async () => (calls.push("common"), "/git"),
    loadCompleted: async (input) => (
      calls.push("load"),
      assert.deepEqual(input, {
        gitCommonDirectory: "/git",
        recordingDirectory: "/recording",
      }),
      { result: { passed: false, verdict: "FAIL" } }
    ),
  });
  assert.equal(completed.result.verdict, "FAIL");
  assert.deepEqual(calls, ["common", "load"]);
});

test("a vitals request during context close invalidates the completed arm", async () => {
  const attempts = [];
  await assert.rejects(
    closeMeasuredContext(
      { close: async () => attempts.push("/api/vitals") },
      attempts,
      true,
    ),
    /E6_VITALS_REQUEST_FORBIDDEN/u,
  );
});

test("red proof receipt binds a measured p95 over the eight-millisecond budget to FAIL", () => {
  const receipt = redProofReceipt(
    redFixture({ blockMs: 24, serviceMs: 28, count: 4 }),
    { redBlockMs: 24, phase: "before-post" },
  );
  assert.equal(receipt.label, "SYNTHETIC_NOT_A_BENCHMARK");
  assert.equal(receipt.sourceKind, "synthetic");
  assert.equal(receipt.benchmarkEligible, false);
  assert.equal(receipt.proof.expectedServiceMs, 28);
  assert.equal(receipt.budget.verdict, "FAIL");
});

test("red proof accepts scheduler overshoot when every after-post probe ran the full blocker", () => {
  const receipt = redProofReceipt(
    redFixture({ phase: "after-post", serviceMs: 60, count: 4 }),
    { redBlockMs: 28, phase: "after-post" },
  );

  assert.equal(receipt.busy.p95, 60);
  assert.equal(receipt.proof.minimumAcceptedServiceMs, 30);
  assert.equal(receipt.proof.traceCount, 4);
  assert.equal(receipt.budget.verdict, "FAIL");
});

test("red proof rejects evidence without one blocker trace per probe", () => {
  const evidence = redFixture({ serviceMs: 60 });
  evidence.redProofTraces = [];
  assert.throws(
    () => redProofReceipt(evidence, { redBlockMs: 28, phase: "before-post" }),
    /E6_RED_PROOF_TRACE_COUNT_MISMATCH/u,
  );
});

test("red proof rejects a wrong-phase blocker masked by scheduler delay", () => {
  assert.throws(
    () =>
      redProofReceipt(redFixture({ phase: "after-post", serviceMs: 60 }), {
        redBlockMs: 28,
        phase: "before-post",
      }),
    /E6_RED_PROOF_TRACE_PHASE_MISMATCH/u,
  );
});

test("red proof rejects a truncated blocker masked by scheduler delay", () => {
  const evidence = redFixture({ serviceMs: 60 });
  evidence.redProofTraces[0].endedAt -= 1;
  assert.throws(
    () => redProofReceipt(evidence, { redBlockMs: 28, phase: "before-post" }),
    /E6_RED_PROOF_TRACE_DURATION_INVALID/u,
  );
});

test("red proof rejects blocker traces outside either probe phase", () => {
  for (const phase of ["before-post", "after-post"]) {
    const evidence = redFixture({ phase });
    if (phase === "before-post") evidence.redProofTraces[0].endedAt += 1;
    else evidence.redProofTraces[0].startedAt -= 1;
    assert.throws(
      () => redProofReceipt(evidence, { redBlockMs: 28, phase }),
      /E6_RED_PROOF_TRACE_CONTAINMENT_INVALID/u,
      phase,
    );
  }
});

test("red proof rejects blocker traces paired to the wrong probe", () => {
  const evidence = redFixture();
  evidence.redProofTraces.reverse();
  assert.throws(
    () => redProofReceipt(evidence, { redBlockMs: 28, phase: "before-post" }),
    /E6_RED_PROOF_TRACE_CONTAINMENT_INVALID/u,
  );
});

test("red proof rejects an injected block that is not itself over budget", () => {
  assert.throws(
    () =>
      redProofReceipt(redFixture({ blockMs: 4, serviceMs: 60 }), {
        redBlockMs: 4,
        phase: "before-post",
      }),
    /E6_RED_PROOF_INPUT_INVALID/u,
  );
});

test("red proof rejects samples that omit the four-millisecond probe cadence", () => {
  assert.throws(
    () =>
      redProofReceipt(redFixture({ serviceMs: 28, count: 4 }), {
        redBlockMs: 28,
        phase: "before-post",
      }),
    /E6_RED_PROOF_UNDERSHOOT/u,
  );
});

test("refuses a short duration before it can label a receipt as a benchmark", async () => {
  await assert.rejects(
    main(["--duration-ms", "10", "--recording", "/tmp/not-read"]),
    /E6_BENCHMARK_WINDOW_REQUIRED windowMs=20000/u,
  );
});

test("rejects obsolete no-op runner flags instead of pretending to honor them", async () => {
  await assert.rejects(
    main(["--url", "file:///tmp/not-a-binding-route"]),
    /E6_OPTION_UNKNOWN --url/u,
  );
  await assert.rejects(main(["--preview"]), /E6_OPTION_UNKNOWN --preview/u);
  await assert.rejects(
    main(["--replay-stats-url", "http://127.0.0.1:4218/stats"]),
    /E6_OPTION_UNKNOWN --replay-stats-url/u,
  );
  await assert.rejects(
    main(["--red-tolerance-ms", "4"]),
    /E6_OPTION_UNKNOWN --red-tolerance-ms/u,
  );
});

test("help exits successfully before any runtime or browser preflight", async () => {
  assert.equal(await main(["--help"]), 0);
});
