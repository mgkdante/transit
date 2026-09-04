import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";

const SCRIPT = fileURLToPath(
  new URL("./refresh-basemap-r2.mjs", import.meta.url),
);
const STABLE_KEY = "transit-snapshots/v1/stm/static/basemap/montreal.pmtiles";
const BACKUP_KEY =
  "transit-snapshots/v1/stm/static/basemap/backups/test-before.pmtiles";
const HELPER_GUARD_TIMEOUT_MS = 8_000;
const temporaryDirectories = [];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function makeFakeWrangler(root) {
  const executable = join(root, "fake-wrangler.mjs");
  await writeFile(
    executable,
    `#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const operation = args[2];
const objectPath = args[3];
if (process.env.FAKE_R2_IGNORE_SIGTERM === '1') process.on('SIGTERM', () => {});
const fileFlag = args.find((value) => value.startsWith('--file='));
if (
  args[0] !== 'r2' ||
  args[1] !== 'object' ||
  !['get', 'put'].includes(operation) ||
  !fileFlag ||
  !args.includes('--remote') ||
  (operation === 'put' && !args.includes('--content-type=application/octet-stream'))
) {
  console.error('unexpected fake Wrangler arguments', JSON.stringify(args));
  process.exit(2);
}
const file = fileFlag.slice('--file='.length);
const object = join(process.env.FAKE_R2_ROOT, objectPath);
const statePath = join(
  process.env.FAKE_R2_ROOT,
  '.fake-wrangler-state',
  Buffer.from(operation + ':' + objectPath).toString('base64url'),
);
await mkdir(dirname(statePath), { recursive: true });
const count = Number(await readFile(statePath, 'utf8').catch(() => '0')) + 1;
await writeFile(statePath, String(count));
const operationDelayMs = Number(process.env.FAKE_R2_OPERATION_DELAY_MS ?? '0');
if (operationDelayMs > 0) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, operationDelayMs));
}
if (
  operation === 'put' &&
  process.env.FAKE_R2_FAIL_PUT_KEY === objectPath &&
  Number(process.env.FAKE_R2_FAIL_PUT_NUMBER) === count
) {
  console.error('forced fake Wrangler put failure');
  process.exit(23);
}
if (operation === 'get') {
  const corruptGetNumbers = (process.env.FAKE_R2_CORRUPT_GET_NUMBERS ?? process.env.FAKE_R2_CORRUPT_GET_NUMBER ?? '')
    .split(',')
    .filter(Boolean)
    .map(Number);
  if (
    process.env.FAKE_R2_CORRUPT_GET_KEY === objectPath &&
    corruptGetNumbers.includes(count)
  ) {
    await writeFile(file, 'forced corrupt readback');
  } else {
    await copyFile(object, file);
  }
} else {
  await mkdir(dirname(object), { recursive: true });
  await copyFile(file, object);
  if (
    process.env.FAKE_R2_FAIL_PUT_AFTER_COPY_KEY === objectPath &&
    Number(process.env.FAKE_R2_FAIL_PUT_AFTER_COPY_NUMBER) === count
  ) {
    console.error('forced fake Wrangler failure after committed put');
    process.exit(24);
  }
  if (
    process.env.FAKE_R2_HANG_PUT_AFTER_COPY_KEY === objectPath &&
    Number(process.env.FAKE_R2_HANG_PUT_AFTER_COPY_NUMBER) === count
  ) {
    await new Promise(() => setInterval(() => {}, 1_000));
  }
}
`,
  );
  await chmod(executable, 0o755);
  return executable;
}

async function waitForBytes(path, expected) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const bytes = await readFile(path).catch(() => null);
    if (bytes?.equals(expected)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function fakeOperationCount(fixture, operation, objectPath) {
  const statePath = join(
    fixture.root,
    ".fake-wrangler-state",
    Buffer.from(`${operation}:${objectPath}`).toString("base64url"),
  );
  return Number(await readFile(statePath, "utf8"));
}

async function runHelper(
  fixture,
  extraEnv = {},
  { signalAfterCommit = null } = {},
) {
  const child = spawn(
    process.execPath,
    [
      SCRIPT,
      "--bucket=transit-snapshots",
      "--key=v1/stm/static/basemap/montreal.pmtiles",
      "--backup-key=v1/stm/static/basemap/backups/test-before.pmtiles",
      `--new-file=${fixture.newFile}`,
      `--receipt=${fixture.receipt}`,
    ],
    {
      env: {
        ...process.env,
        FAKE_R2_ROOT: fixture.root,
        WRANGLER_BIN: fixture.wrangler,
        ...extraEnv,
      },
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const signal = signalAfterCommit
    ? waitForBytes(fixture.stable, fixture.newBytes).then(() =>
        child.kill(signalAfterCommit),
      )
    : Promise.resolve();
  let guardKilled = false;
  const guard = setTimeout(() => {
    guardKilled = true;
    spawnSync("pkill", ["-KILL", "-P", String(child.pid)]);
    process.kill(-child.pid, "SIGKILL");
  }, HELPER_GUARD_TIMEOUT_MS);
  const code = await new Promise((resolveExit) =>
    child.once("close", resolveExit),
  );
  clearTimeout(guard);
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  await signal;
  return { code, stderr, guardKilled };
}

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "transit-r2-transaction-"));
  temporaryDirectories.push(root);
  const fixture = {
    root,
    wrangler: await makeFakeWrangler(root),
    stable: join(root, STABLE_KEY),
    backup: join(root, BACKUP_KEY),
    newFile: join(root, "new.pmtiles"),
    receipt: join(root, "receipt.json"),
    previousBytes: Buffer.from("previous immutable basemap"),
    newBytes: Buffer.from("new verified basemap"),
  };
  await mkdir(dirname(fixture.stable), { recursive: true });
  await writeFile(fixture.stable, fixture.previousBytes);
  await writeFile(fixture.newFile, fixture.newBytes);
  return fixture;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("basemap R2 replacement", () => {
  it("backs up and verifies the previous object before replacing the stable key", async () => {
    const fixture = await makeFixture();
    const result = await runHelper(fixture);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.guardKilled, false);
    assert.deepEqual(await readFile(fixture.stable), fixture.newBytes);
    assert.deepEqual(await readFile(fixture.backup), fixture.previousBytes);
    assert.deepEqual(JSON.parse(await readFile(fixture.receipt, "utf8")), {
      schema_version: 1,
      bucket: "transit-snapshots",
      stable_key: "v1/stm/static/basemap/montreal.pmtiles",
      backup_key: "v1/stm/static/basemap/backups/test-before.pmtiles",
      before: {
        bytes: fixture.previousBytes.byteLength,
        sha256: sha256(fixture.previousBytes),
      },
      after: {
        bytes: fixture.newBytes.byteLength,
        sha256: sha256(fixture.newBytes),
      },
    });
  });

  it("leaves the stable object untouched when backup verification fails", async () => {
    const fixture = await makeFixture();
    const result = await runHelper(fixture, {
      FAKE_R2_CORRUPT_GET_KEY: BACKUP_KEY,
      FAKE_R2_CORRUPT_GET_NUMBER: "1",
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /backup readback mismatch/u);
    assert.deepEqual(await readFile(fixture.stable), fixture.previousBytes);
  });

  it("restores and verifies the previous object when stable verification fails", async () => {
    const fixture = await makeFixture();
    const result = await runHelper(fixture, {
      FAKE_R2_CORRUPT_GET_KEY: STABLE_KEY,
      FAKE_R2_CORRUPT_GET_NUMBER: "2",
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /stable readback mismatch/u);
    assert.match(result.stderr, /previous object restored and verified/u);
    assert.deepEqual(await readFile(fixture.stable), fixture.previousBytes);
    assert.deepEqual(await readFile(fixture.backup), fixture.previousBytes);
  });

  it("restores after a stable put reports failure with an uncertain remote outcome", async () => {
    const fixture = await makeFixture();
    const result = await runHelper(fixture, {
      FAKE_R2_FAIL_PUT_AFTER_COPY_KEY: STABLE_KEY,
      FAKE_R2_FAIL_PUT_AFTER_COPY_NUMBER: "1",
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /exited with code 24/u);
    assert.match(result.stderr, /previous object restored and verified/u);
    assert.deepEqual(await readFile(fixture.stable), fixture.previousBytes);
  });

  it("times out a committed stable put while rollback headroom remains", async () => {
    const fixture = await makeFixture();
    const result = await runHelper(fixture, {
      FAKE_R2_HANG_PUT_AFTER_COPY_KEY: STABLE_KEY,
      FAKE_R2_HANG_PUT_AFTER_COPY_NUMBER: "1",
      FAKE_R2_OPERATION_DELAY_MS: "150",
      WRANGLER_TIMEOUT_MS: "1000",
    });

    assert.equal(result.guardKilled, false);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /timed out/u);
    assert.match(result.stderr, /previous object restored and verified/u);
    assert.equal(await fakeOperationCount(fixture, "put", BACKUP_KEY), 1);
    assert.equal(await fakeOperationCount(fixture, "get", BACKUP_KEY), 1);
    assert.equal(await fakeOperationCount(fixture, "put", STABLE_KEY), 2);
    assert.equal(await fakeOperationCount(fixture, "get", STABLE_KEY), 2);
    assert.deepEqual(await readFile(fixture.stable), fixture.previousBytes);
  });

  it("force-stops a signal-resistant PUT and compensates after SIGTERM", async () => {
    const fixture = await makeFixture();
    const result = await runHelper(
      fixture,
      {
        FAKE_R2_HANG_PUT_AFTER_COPY_KEY: STABLE_KEY,
        FAKE_R2_HANG_PUT_AFTER_COPY_NUMBER: "1",
        FAKE_R2_IGNORE_SIGTERM: "1",
        TERMINATION_GRACE_MS: "100",
      },
      { signalAfterCommit: "SIGTERM" },
    );

    assert.equal(result.guardKilled, false);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /received SIGTERM/u);
    assert.match(result.stderr, /previous object restored and verified/u);
    assert.deepEqual(await readFile(fixture.stable), fixture.previousBytes);
  });

  it("compensates a committed stable put when the runner sends SIGINT", async () => {
    const fixture = await makeFixture();
    const result = await runHelper(
      fixture,
      {
        FAKE_R2_HANG_PUT_AFTER_COPY_KEY: STABLE_KEY,
        FAKE_R2_HANG_PUT_AFTER_COPY_NUMBER: "1",
      },
      { signalAfterCommit: "SIGINT" },
    );

    assert.equal(result.guardKilled, false);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /received SIGINT/u);
    assert.match(result.stderr, /previous object restored and verified/u);
    assert.deepEqual(await readFile(fixture.stable), fixture.previousBytes);
  });

  it("reports both the primary failure and a failed restore", async () => {
    const fixture = await makeFixture();
    const result = await runHelper(fixture, {
      FAKE_R2_CORRUPT_GET_KEY: STABLE_KEY,
      FAKE_R2_CORRUPT_GET_NUMBER: "2",
      FAKE_R2_FAIL_PUT_KEY: STABLE_KEY,
      FAKE_R2_FAIL_PUT_NUMBER: "2",
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /stable readback mismatch/u);
    assert.match(result.stderr, /RESTORE FAILED/u);
  });

  it("treats a mismatched restore readback as a restore failure", async () => {
    const fixture = await makeFixture();
    const result = await runHelper(fixture, {
      FAKE_R2_CORRUPT_GET_KEY: STABLE_KEY,
      FAKE_R2_CORRUPT_GET_NUMBERS: "2,3",
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /stable readback mismatch/u);
    assert.match(result.stderr, /RESTORE FAILED/u);
    assert.match(result.stderr, /restored stable readback mismatch/u);
  });
});
