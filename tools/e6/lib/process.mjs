import { createServer } from "node:net";
import { spawn } from "node:child_process";

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
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  return child;
}

export async function stopManagedProcess(child, { signal = "SIGTERM" } = {}) {
  if (!child || child.exitCode !== null || child.killed) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill(signal);
  });
}

export async function waitForHttp(
  url,
  { timeoutMs = 20_000, intervalMs = 200 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.ok || response.status === 304) return response;
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
