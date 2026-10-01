import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("tracked workspace inputs resolve with a frozen lock on the current host", () => {
  const version = spawnSync("bun", ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(
    version.stdout.trim(),
    readFileSync(join(root, ".bun-version"), "utf8").trim(),
  );
  const tracked = spawnSync(
    "git",
    [
      "ls-files",
      "-z",
      "--",
      "package.json",
      "bun.lock",
      "apps/*/package.json",
      "apps/web/vendor/design/*/package.json",
      "patches/*",
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  assert.equal(tracked.status, 0, tracked.stderr);
  const scratch = mkdtempSync(join(tmpdir(), "transit-frozen-install-"));
  try {
    for (const path of tracked.stdout.split("\0").filter(Boolean)) {
      const destination = join(scratch, path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(root, path), destination);
    }
    const original = readFileSync(join(scratch, "bun.lock"));
    const install = spawnSync(
      "bun",
      ["install", "--frozen-lockfile", "--lockfile-only", "--ignore-scripts"],
      { cwd: scratch, encoding: "utf8", timeout: 60_000, windowsHide: true },
    );
    assert.equal(
      install.status,
      0,
      `${install.error ?? ""}\n${install.stdout}\n${install.stderr}`,
    );
    assert.deepEqual(readFileSync(join(scratch, "bun.lock")), original);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
