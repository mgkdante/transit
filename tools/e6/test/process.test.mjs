import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  assertManagedProcessRunning,
  assertPortsAvailable,
  runManagedProcess,
  startManagedProcess,
  stopManagedProcess,
  waitForHttp,
} from "../lib/process.mjs";

async function findAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function waitUntil(predicate, { timeoutMs = 2_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(10);
  }
  throw new Error("test condition timed out");
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function withTimeout(promise, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("operation did not finish within its bound")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function processTreeFixture(directory, port) {
  const descendantPidPath = join(directory, "descendant.pid");
  const descendantSource = `
    const { writeFileSync } = require("node:fs");
    const { createServer } = require("node:net");
    process.on("SIGTERM", () => {});
    const server = createServer();
    server.listen(Number(process.env.E6_TEST_PORT), "127.0.0.1", () => {
      writeFileSync(process.env.E6_DESCENDANT_PID_PATH, String(process.pid));
    });
    setInterval(() => {}, 1_000);
  `;
  const launcherSource = `
    const { spawn } = require("node:child_process");
    const { existsSync } = require("node:fs");
    const descendant = spawn(process.execPath, ["-e", process.env.E6_DESCENDANT_SOURCE], {
      env: process.env,
      stdio: ["ignore", "inherit", "inherit"],
    });
    const ready = setInterval(() => {
      if (!existsSync(process.env.E6_DESCENDANT_PID_PATH)) return;
      clearInterval(ready);
      descendant.unref();
      process.stdout.write("launcher complete");
    }, 10);
  `;
  return {
    descendantPidPath,
    launcherSource,
    env: {
      ...process.env,
      E6_DESCENDANT_PID_PATH: descendantPidPath,
      E6_DESCENDANT_SOURCE: descendantSource,
      E6_TEST_PORT: String(port),
    },
  };
}

async function waitForChildExit(child, timeoutMs = 3_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { exitCode: child.exitCode, signalCode: child.signalCode };
  }
  return withTimeout(
    new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (exitCode, signalCode) =>
        resolve({ exitCode, signalCode }),
      );
    }),
    timeoutMs,
  );
}

function fakeServer({ error = null } = {}) {
  let onError;
  return {
    once(event, handler) {
      if (event === "error") onError = handler;
    },
    listen(_port, _host, onListen) {
      if (error) onError(error);
      else onListen();
    },
    close(done) {
      done();
    },
  };
}

test("rejects a requested preview port when the real listen boundary reports address in use", async () => {
  await assert.rejects(
    assertPortsAvailable([4217], {
      createServerFn: () => fakeServer({ error: { code: "EADDRINUSE" } }),
    }),
    /E6_PORT_IN_USE port=4217/u,
  );
});

test("accepts every explicit port only after each injected listen boundary closes", async () => {
  let created = 0;
  await assert.doesNotReject(
    assertPortsAvailable([4217, 4218], {
      createServerFn: () => {
        created += 1;
        return fakeServer();
      },
    }),
  );
  assert.equal(created, 2);
});

test("readiness and post-arm guards reject a preview child that exited", async () => {
  const child = { exitCode: 1, signalCode: null };
  assert.throws(() => assertManagedProcessRunning(child), /E6_PROCESS_EXITED/u);
  await assert.rejects(
    waitForHttp("http://127.0.0.1:4217", { child, timeoutMs: 1 }),
    /E6_PROCESS_EXITED/u,
  );
});

test("stops the full managed process group after its launcher exits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "e6-process-tree-"));
  const port = await findAvailablePort();
  const fixture = processTreeFixture(directory, port);
  let descendantPid;
  let launcher;

  try {
    launcher = startManagedProcess(
      process.execPath,
      ["-e", fixture.launcherSource],
      { env: fixture.env },
    );
    launcher.stdout.resume();
    launcher.stderr.resume();

    await waitUntil(async () => {
      try {
        descendantPid = Number(
          await readFile(fixture.descendantPidPath, "utf8"),
        );
        return Number.isInteger(descendantPid) && descendantPid > 0;
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    });
    await waitUntil(() => launcher.exitCode !== null);
    assert.equal(processExists(descendantPid), true);
    await assert.rejects(
      assertPortsAvailable([port]),
      new RegExp(`E6_PORT_IN_USE port=${port}`, "u"),
    );

    await withTimeout(
      stopManagedProcess(launcher, { graceMs: 100, killWaitMs: 2_000 }),
      3_000,
    );

    await waitUntil(() => !processExists(descendantPid));
    await assert.doesNotReject(assertPortsAvailable([port]));
  } finally {
    if (descendantPid && processExists(descendantPid)) {
      process.kill(descendantPid, "SIGKILL");
      await waitUntil(() => !processExists(descendantPid)).catch(() => {});
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("finite managed commands clean inherited descendants before resolving", async () => {
  const directory = await mkdtemp(join(tmpdir(), "e6-managed-command-"));
  const port = await findAvailablePort();
  const fixture = processTreeFixture(directory, port);
  let descendantPid;

  try {
    const result = await withTimeout(
      runManagedProcess(process.execPath, ["-e", fixture.launcherSource], {
        env: fixture.env,
        stopOptions: { graceMs: 100, killWaitMs: 2_000 },
      }),
      3_000,
    );
    descendantPid = Number(await readFile(fixture.descendantPidPath, "utf8"));

    assert.deepEqual(result, { stdout: "launcher complete", stderr: "" });
    assert.equal(processExists(descendantPid), false);
    await assert.doesNotReject(assertPortsAvailable([port]));
  } finally {
    if (descendantPid && processExists(descendantPid)) {
      process.kill(descendantPid, "SIGKILL");
      await waitUntil(() => !processExists(descendantPid)).catch(() => {});
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("SIGTERM shutdown drains every managed group before the coordinator exits 143", async () => {
  const directory = await mkdtemp(join(tmpdir(), "e6-coordinator-shutdown-"));
  const coordinatorPath = join(directory, "coordinator.mjs");
  const coordinatorReadyPath = join(directory, "coordinator.ready");
  const port = await findAvailablePort();
  const fixture = processTreeFixture(directory, port);
  const processModuleUrl = pathToFileURL(
    join(import.meta.dirname, "../lib/process.mjs"),
  ).href;
  const coordinatorSource = `
    import { writeFileSync } from "node:fs";
    const tools = await import(process.env.E6_PROCESS_MODULE_URL);
    let launcher;
    let shuttingDown = false;
    process.once("SIGTERM", async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      try {
        const first = tools.requestManagedProcessShutdown({
          graceMs: 100,
          killWaitMs: 2_000,
        });
        const second = tools.requestManagedProcessShutdown();
        await Promise.all([first, second]);
        try {
          tools.startManagedProcess(process.execPath, ["-e", ""]);
          process.exit(70);
        } catch (error) {
          if (error?.message !== "E6_PROCESS_SHUTDOWN_REQUESTED") throw error;
        }
        process.exit(143);
      } catch (error) {
        process.stderr.write(String(error?.stack ?? error));
        process.exit(1);
      }
    });
    launcher = tools.startManagedProcess(
      process.execPath,
      ["-e", process.env.E6_LAUNCHER_SOURCE],
      { env: process.env },
    );
    launcher.stdout.resume();
    launcher.stderr.resume();
    writeFileSync(process.env.E6_COORDINATOR_READY_PATH, "ready");
    setInterval(() => {}, 1_000);
  `;
  let coordinator;
  let descendantPid;
  let coordinatorStderr = "";

  try {
    await writeFile(coordinatorPath, coordinatorSource);
    coordinator = spawn(process.execPath, [coordinatorPath], {
      env: {
        ...fixture.env,
        E6_COORDINATOR_READY_PATH: coordinatorReadyPath,
        E6_LAUNCHER_SOURCE: fixture.launcherSource,
        E6_PROCESS_MODULE_URL: processModuleUrl,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    coordinator.stderr.setEncoding("utf8");
    coordinator.stderr.on("data", (chunk) => {
      coordinatorStderr += chunk;
    });
    await waitUntil(async () => {
      try {
        await readFile(coordinatorReadyPath);
        descendantPid = Number(
          await readFile(fixture.descendantPidPath, "utf8"),
        );
        return Number.isInteger(descendantPid) && descendantPid > 0;
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    });
    assert.equal(processExists(descendantPid), true);
    await assert.rejects(
      assertPortsAvailable([port]),
      new RegExp(`E6_PORT_IN_USE port=${port}`, "u"),
    );

    coordinator.kill("SIGTERM");
    const result = await waitForChildExit(coordinator);

    assert.deepEqual(result, { exitCode: 143, signalCode: null });
    assert.equal(coordinatorStderr, "");
    await waitUntil(() => !processExists(descendantPid));
    await assert.doesNotReject(assertPortsAvailable([port]));
  } finally {
    if (
      coordinator &&
      coordinator.exitCode === null &&
      coordinator.signalCode === null
    ) {
      coordinator.kill("SIGKILL");
      await waitForChildExit(coordinator).catch(() => {});
    }
    if (descendantPid && processExists(descendantPid)) {
      process.kill(descendantPid, "SIGKILL");
      await waitUntil(() => !processExists(descendantPid)).catch(() => {});
    }
    await rm(directory, { recursive: true, force: true });
  }
});
