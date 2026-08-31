#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";

const WRANGLER_VERSION = "4.100.0";
const CONTENT_TYPE = "application/octet-stream";
const DEFAULT_COMMAND_TIMEOUT_MS = 180_000;
const DEFAULT_TERMINATION_GRACE_MS = 5_000;

let activeChild = null;
let externalTerminationTimer;
let pendingTerminationSignal = null;

function terminate(child, signal) {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  child.kill(signal);
}

function recordTermination(signal) {
  pendingTerminationSignal ??= signal;
  process.exitCode = 1;
  if (activeChild) {
    const child = activeChild;
    terminate(child, "SIGTERM");
    clearTimeout(externalTerminationTimer);
    externalTerminationTimer = setTimeout(() => {
      if (activeChild === child) terminate(child, "SIGKILL");
    }, terminationGraceMs());
    externalTerminationTimer.unref();
  }
}

process.on("SIGINT", () => recordTermination("SIGINT"));
process.on("SIGTERM", () => recordTermination("SIGTERM"));

function required(value, name) {
  if (!value?.trim()) throw new Error(`Missing --${name}`);
  return value;
}

function commandTimeoutMs() {
  const value = Number(
    process.env.WRANGLER_TIMEOUT_MS ?? DEFAULT_COMMAND_TIMEOUT_MS,
  );
  if (!Number.isSafeInteger(value) || value < 50 || value > 600_000) {
    throw new Error(
      "WRANGLER_TIMEOUT_MS must be an integer between 50 and 600000",
    );
  }
  return value;
}

function terminationGraceMs() {
  const value = Number(
    process.env.TERMINATION_GRACE_MS ?? DEFAULT_TERMINATION_GRACE_MS,
  );
  if (!Number.isSafeInteger(value) || value < 50 || value > 30_000) {
    throw new Error(
      "TERMINATION_GRACE_MS must be an integer between 50 and 30000",
    );
  }
  return value;
}

function consumeTerminationSignal() {
  const signal = pendingTerminationSignal;
  pendingTerminationSignal = null;
  return signal;
}

function throwIfTerminationRequested() {
  const signal = consumeTerminationSignal();
  if (signal) throw new Error(`received ${signal}`);
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const waitingSignal = consumeTerminationSignal();
    if (waitingSignal) {
      rejectRun(new Error(`received ${waitingSignal}`));
      return;
    }
    const timeoutMs = commandTimeoutMs();
    const child = spawn(command, args, { detached: true, stdio: "inherit" });
    activeChild = child;
    let settled = false;
    let timedOut = false;
    let forceKillTimer;
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate(child, "SIGTERM");
      forceKillTimer = setTimeout(
        () => terminate(child, "SIGKILL"),
        terminationGraceMs(),
      );
      forceKillTimer.unref();
    }, timeoutMs);
    timeout.unref();

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceKillTimer);
      clearTimeout(externalTerminationTimer);
      if (activeChild === child) activeChild = null;
      if (error) rejectRun(error);
      else resolveRun();
    }

    child.once("error", finish);
    child.once("close", (code, signal) => {
      const terminationSignal = consumeTerminationSignal();
      if (terminationSignal) {
        finish(new Error(`received ${terminationSignal}`));
      } else if (timedOut) {
        finish(new Error(`${command} timed out after ${timeoutMs}ms`));
      } else if (code === 0) {
        finish();
      } else {
        finish(
          new Error(
            `${command} exited with code ${code} signal ${signal ?? "none"}`,
          ),
        );
      }
    });
  });
}

async function fileIdentity(path) {
  const file = await stat(path);
  if (!file.isFile()) throw new Error(`${path} is not a regular file`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { bytes: file.size, sha256: hash.digest("hex") };
}

function assertSame(actual, expected, label) {
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
    throw new Error(
      `${label} mismatch: expected ${expected.bytes} bytes sha256 ${expected.sha256}, ` +
        `got ${actual.bytes} bytes sha256 ${actual.sha256}`,
    );
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function wranglerCommand(args) {
  const override = process.env.WRANGLER_BIN?.trim();
  return override
    ? { command: override, args }
    : { command: "bunx", args: [`wrangler@${WRANGLER_VERSION}`, ...args] };
}

async function wrangler(args) {
  const invocation = wranglerCommand(args);
  await run(invocation.command, invocation.args);
}

async function getObject(objectPath, file) {
  await wrangler([
    "r2",
    "object",
    "get",
    objectPath,
    `--file=${file}`,
    "--remote",
  ]);
}

async function putObject(objectPath, file) {
  await wrangler([
    "r2",
    "object",
    "put",
    objectPath,
    `--file=${file}`,
    `--content-type=${CONTENT_TYPE}`,
    "--remote",
  ]);
}

async function main() {
  const { values } = parseArgs({
    options: {
      bucket: { type: "string" },
      key: { type: "string" },
      "backup-key": { type: "string" },
      "new-file": { type: "string" },
      receipt: { type: "string" },
    },
  });
  const bucket = required(values.bucket, "bucket");
  const stableKey = required(values.key, "key");
  const backupKey = required(values["backup-key"], "backup-key");
  const newFile = required(values["new-file"], "new-file");
  const receiptPath = required(values.receipt, "receipt");
  if (backupKey === stableKey)
    throw new Error("Backup key must differ from the stable key");

  const stableObject = `${bucket}/${stableKey}`;
  const backupObject = `${bucket}/${backupKey}`;
  const work = await mkdtemp(join(tmpdir(), "transit-basemap-r2-"));
  let transactionError;
  try {
    const previousFile = join(work, "previous.pmtiles");
    const backupReadback = join(work, "backup-readback.pmtiles");
    const stableReadback = join(work, "stable-readback.pmtiles");

    await getObject(stableObject, previousFile);
    const before = await fileIdentity(previousFile);
    const after = await fileIdentity(newFile);
    if (after.bytes === 0) throw new Error("New basemap is empty");

    await putObject(backupObject, previousFile);
    await getObject(backupObject, backupReadback);
    assertSame(await fileIdentity(backupReadback), before, "backup readback");

    try {
      await putObject(stableObject, newFile);
      await getObject(stableObject, stableReadback);
      assertSame(await fileIdentity(stableReadback), after, "stable readback");
      throwIfTerminationRequested();

      const receipt = {
        schema_version: 1,
        bucket,
        stable_key: stableKey,
        backup_key: backupKey,
        before,
        after,
      };
      await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
        flag: "wx",
      });
      console.log(`[refresh-basemap-r2] ${JSON.stringify(receipt)}`);
    } catch (replacementError) {
      try {
        await putObject(stableObject, previousFile);
        await getObject(stableObject, stableReadback);
        assertSame(
          await fileIdentity(stableReadback),
          before,
          "restored stable readback",
        );
      } catch (restoreError) {
        throw new Error(
          `Stable replacement failed: ${errorMessage(replacementError)}; ` +
            `RESTORE FAILED: ${errorMessage(restoreError)}`,
        );
      }
      throw new Error(
        `Stable replacement failed: ${errorMessage(replacementError)}; ` +
          "previous object restored and verified",
      );
    }
  } catch (error) {
    transactionError = error;
  }
  try {
    await rm(work, { recursive: true, force: true });
  } catch (cleanupError) {
    if (transactionError) {
      throw new Error(
        `${errorMessage(transactionError)}; TEMP CLEANUP FAILED: ${errorMessage(cleanupError)}`,
        { cause: transactionError },
      );
    }
    throw cleanupError;
  }
  if (transactionError) throw transactionError;
}

main().catch((error) => {
  console.error("[refresh-basemap-r2] failed:", error);
  process.exitCode = 1;
});
