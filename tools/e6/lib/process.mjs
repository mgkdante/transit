import { createServer } from "node:net";
import { spawn } from "node:child_process";

const processFailures = new WeakMap();
const managedProcessGroups = new WeakMap();
const managedProcesses = new Set();

let managedProcessShutdownRequested = false;
let managedProcessShutdownPromise;

const DEFAULT_TERM_GRACE_MS = 1_000;
const DEFAULT_KILL_WAIT_MS = 1_000;
const PROCESS_POLL_INTERVAL_MS = 20;

function invalidPort(port) {
  return !Number.isInteger(port) || port < 1 || port > 65535;
}

export async function assertPortsAvailable(
  ports,
  { host = "127.0.0.1", createServerFn = createServer } = {},
) {
  if (!Array.isArray(ports) || ports.some(invalidPort))
    throw new Error("E6_PORT_INVALID");
  for (const port of ports) {
    await new Promise((resolve, reject) => {
      const server = createServerFn();
      server.once("error", (error) => {
        if (error?.code === "EADDRINUSE")
          reject(new Error(`E6_PORT_IN_USE port=${port}`));
        else reject(error);
      });
      server.listen(port, host, () => server.close(resolve));
    });
  }
}

export function startManagedProcess(
  command,
  args,
  { cwd, env = process.env } = {},
) {
  if (managedProcessShutdownRequested) {
    throw new Error("E6_PROCESS_SHUTDOWN_REQUESTED");
  }
  const child = spawn(command, args, {
    cwd,
    detached: true,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  managedProcesses.add(child);
  if (Number.isInteger(child.pid) && child.pid > 0) {
    managedProcessGroups.set(child, child.pid);
  }
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.once("error", (error) => processFailures.set(child, error));
  return child;
}

export function assertManagedProcessRunning(child) {
  if (
    !child ||
    processFailures.has(child) ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    const cause = processFailures.get(child);
    throw new Error(
      `E6_PROCESS_EXITED code=${String(child?.exitCode)} signal=${String(child?.signalCode)}${cause ? ` cause=${cause.message}` : ""}`,
    );
  }
  return child;
}

function processGroupExists(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function signalProcessGroup(processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessGroupExit(
  processGroupId,
  timeoutMs,
  pollIntervalMs,
) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(processGroupId)) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return false;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)),
    );
  }
  return true;
}

async function waitForDirectChildExit(child, timeoutMs) {
  if (
    child.exitCode !== null ||
    child.signalCode !== null ||
    processFailures.has(child)
  ) {
    return true;
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => finish(false), timeoutMs);
    const finish = (exited) => {
      clearTimeout(timeout);
      child.off("exit", onExit);
      child.off("error", onError);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const onError = () => finish(true);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

function closeChildPipes(child) {
  child.stdin?.destroy();
  child.stdout?.destroy();
  child.stderr?.destroy();
}

function waitForDirectChildResult(child) {
  const failure = processFailures.get(child);
  if (failure) return Promise.reject(failure);
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({
      exitCode: child.exitCode,
      signalCode: child.signalCode,
    });
  }

  return new Promise((resolve, reject) => {
    const onError = (error) => {
      child.off("exit", onExit);
      reject(error);
    };
    const onExit = (exitCode, signalCode) => {
      child.off("error", onError);
      resolve({ exitCode, signalCode });
    };
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

export async function stopManagedProcess(
  child,
  {
    signal = "SIGTERM",
    graceMs = DEFAULT_TERM_GRACE_MS,
    killWaitMs = DEFAULT_KILL_WAIT_MS,
    pollIntervalMs = PROCESS_POLL_INTERVAL_MS,
  } = {},
) {
  if (!child) return;

  const processGroupId = managedProcessGroups.get(child);
  if (!processGroupId || process.platform === "win32") {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
      if (!(await waitForDirectChildExit(child, graceMs))) {
        child.kill("SIGKILL");
        if (!(await waitForDirectChildExit(child, killWaitMs))) {
          closeChildPipes(child);
          throw new Error(`E6_PROCESS_STOP_TIMEOUT pid=${String(child.pid)}`);
        }
      }
    }
    closeChildPipes(child);
    managedProcesses.delete(child);
    return;
  }

  if (processGroupExists(processGroupId)) {
    signalProcessGroup(processGroupId, signal);
    let groupExited = await waitForProcessGroupExit(
      processGroupId,
      graceMs,
      pollIntervalMs,
    );
    if (!groupExited && signal !== "SIGKILL") {
      signalProcessGroup(processGroupId, "SIGKILL");
      groupExited = await waitForProcessGroupExit(
        processGroupId,
        killWaitMs,
        pollIntervalMs,
      );
    }
    if (!groupExited) {
      closeChildPipes(child);
      throw new Error(`E6_PROCESS_GROUP_STOP_TIMEOUT pgid=${processGroupId}`);
    }
  }
  managedProcessGroups.delete(child);

  if (!(await waitForDirectChildExit(child, killWaitMs))) {
    closeChildPipes(child);
    throw new Error(`E6_PROCESS_REAP_TIMEOUT pid=${String(child.pid)}`);
  }
  closeChildPipes(child);
  managedProcesses.delete(child);
}

export function requestManagedProcessShutdown(stopOptions) {
  managedProcessShutdownRequested = true;
  if (managedProcessShutdownPromise) return managedProcessShutdownPromise;

  const stops = [...managedProcesses].map((child) =>
    stopManagedProcess(child, stopOptions),
  );
  managedProcessShutdownPromise = Promise.allSettled(stops).then((results) => {
    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, "E6_PROCESS_SHUTDOWN_FAILED");
    }
  });
  return managedProcessShutdownPromise;
}

export async function runManagedProcess(
  command,
  args,
  { cwd, env = process.env, stopOptions } = {},
) {
  const child = startManagedProcess(command, args, { cwd, env });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  let result;
  try {
    result = await waitForDirectChildResult(child);
  } finally {
    await stopManagedProcess(child, stopOptions);
  }

  if (result.exitCode !== 0) {
    const error = new Error(
      `E6_PROCESS_FAILED code=${String(result.exitCode)} signal=${String(result.signalCode)}`,
    );
    Object.assign(error, {
      code: result.exitCode,
      signal: result.signalCode,
      stdout,
      stderr,
    });
    throw error;
  }
  return { stdout, stderr };
}

export async function waitForHttp(
  url,
  { timeoutMs = 20_000, intervalMs = 200, child } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child) assertManagedProcessRunning(child);
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.ok || response.status === 304) {
        if (child) assertManagedProcessRunning(child);
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `E6_HTTP_READY_TIMEOUT url=${url} cause=${lastError?.message ?? "unknown"}`,
  );
}
