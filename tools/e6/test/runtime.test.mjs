import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertBrowserRuntimeVersion,
  assertCleanBenchmarkEnvironment,
  preflightBenchmarkRuntime,
  recheckBenchmarkRuntime,
} from "../lib/runtime.mjs";

test("binding paths reject ambient runtime injection", () => {
  assert.equal(assertCleanBenchmarkEnvironment({ PATH: "/bin" }).PATH, "/bin");
  for (const name of [
    "NODE_OPTIONS",
    "NODE_PATH",
    "LD_PRELOAD",
    "BUN_OPTIONS",
    "BUN_CONFIG_PRELOAD",
  ]) {
    assert.throws(
      () => assertCleanBenchmarkEnvironment({ [name]: "injected" }),
      new RegExp(`E6_RUNTIME_ENVIRONMENT_INVALID name=${name}`, "u"),
    );
  }
  assert.throws(
    () => assertCleanBenchmarkEnvironment({}, ["-r./evil.cjs"]),
    /E6_RUNTIME_ARGUMENT_INVALID argument=-r\.\/evil\.cjs/u,
  );
});

const PATHS = Object.freeze({
  node: "/opt/runtime/node",
  bun: "/opt/runtime/bun",
  chrome: "/opt/runtime/google-chrome",
});

function offlineBoundaries({ versions = {} } = {}) {
  const outputs = {
    [PATHS.node]: versions.node ?? "v24.15.0\n",
    [PATHS.bun]: versions.bun ?? "1.3.11\n",
    [PATHS.chrome]: versions.chrome ?? "Google Chrome 148.0.7778.178 \n",
  };
  return {
    execPath: "/shim/node",
    chromeExecutablePath: "/shim/chrome",
    env: { PATH: "/fixture/bin" },
    resolveExecutable: async (name) => {
      assert.equal(name, "bun");
      return "/shim/bun";
    },
    realpath: async (path) => {
      if (path === "/shim/node") return PATHS.node;
      if (path === "/shim/bun") return PATHS.bun;
      if (path === "/shim/chrome") return PATHS.chrome;
      throw new Error(`unexpected path ${path}`);
    },
    stat: async () => ({
      dev: 8,
      ino: 42,
      size: 1024,
      mtimeMs: 1_777_777_777_000,
      isFile: () => true,
    }),
    runCommand: async (executable, args) => {
      assert.deepEqual(args, ["--version"]);
      return { stdout: outputs[executable] };
    },
  };
}

test("preflight proves the exact Node, Bun, and Chrome binaries before an arm", async () => {
  const receipt = await preflightBenchmarkRuntime(offlineBoundaries());

  assert.deepEqual(receipt, {
    node: {
      engine: "node",
      version: "24.15.0",
      executablePath: PATHS.node,
      binary: {
        device: 8,
        inode: 42,
        sizeBytes: 1024,
        modifiedMs: 1_777_777_777_000,
      },
    },
    bun: {
      engine: "bun",
      version: "1.3.11",
      executablePath: PATHS.bun,
      binary: {
        device: 8,
        inode: 42,
        sizeBytes: 1024,
        modifiedMs: 1_777_777_777_000,
      },
    },
    chrome: {
      engine: "chrome",
      version: "148.0.7778.178",
      executablePath: PATHS.chrome,
      binary: {
        device: 8,
        inode: 42,
        sizeBytes: 1024,
        modifiedMs: 1_777_777_777_000,
      },
    },
  });
  assert.equal(Object.isFrozen(receipt), true);
  for (const runtime of Object.values(receipt)) {
    assert.equal(Object.isFrozen(runtime), true);
    assert.equal(Object.isFrozen(runtime.binary), true);
  }
});

test("recheck rejects a binary replaced after preflight even at the same version", async () => {
  const before = await preflightBenchmarkRuntime(offlineBoundaries());
  const boundaries = offlineBoundaries();
  boundaries.stat = async () => ({
    dev: 8,
    ino: 99,
    size: 1024,
    mtimeMs: 1_777_777_777_000,
    isFile: () => true,
  });

  await assert.rejects(
    recheckBenchmarkRuntime(before, boundaries),
    /E6_RUNTIME_CHANGED engine=node/u,
  );
});

test("preflight reports a missing Bun from PATH before Chrome is inspected", async () => {
  const boundaries = offlineBoundaries();
  let chromeInspected = false;
  boundaries.resolveExecutable = async () => {
    throw new Error("not found");
  };
  boundaries.realpath = async (path) => {
    if (path === "/shim/chrome") chromeInspected = true;
    return path === "/shim/node" ? PATHS.node : PATHS.chrome;
  };

  await assert.rejects(
    preflightBenchmarkRuntime(boundaries),
    /E6_RUNTIME_BUN_MISSING/u,
  );
  assert.equal(chromeInspected, false);
});

test("preflight rejects every wrong or missing pinned version", async () => {
  const cases = [
    ["node", { node: "v24.14.0\n" }, /E6_RUNTIME_NODE_VERSION_INVALID/u],
    ["bun", { bun: "1.3.13\n" }, /E6_RUNTIME_BUN_VERSION_INVALID/u],
    [
      "chrome",
      { chrome: "Google Chrome 148.0.7778.179\n" },
      /E6_RUNTIME_CHROME_VERSION_INVALID/u,
    ],
    ["missing", { node: "\n" }, /actual=missing/u],
  ];
  for (const [, versions, expected] of cases) {
    await assert.rejects(
      preflightBenchmarkRuntime(offlineBoundaries({ versions })),
      expected,
    );
  }
});

test("preflight resolves Bun from the supplied PATH before pinning its real binary", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-runtime-path-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const bunShim = join(root, "bun");
  await writeFile(bunShim, "fixture\n");
  await chmod(bunShim, 0o755);
  const boundaries = offlineBoundaries();
  delete boundaries.resolveExecutable;
  boundaries.env = { PATH: root };
  boundaries.realpath = async (path) => {
    if (path === bunShim) return PATHS.bun;
    if (path === "/shim/node") return PATHS.node;
    if (path === "/shim/chrome") return PATHS.chrome;
    throw new Error(`unexpected path ${path}`);
  };

  const receipt = await preflightBenchmarkRuntime(boundaries);
  assert.equal(receipt.bun.executablePath, PATHS.bun);
});

test("the launched browser must report the exact preflight Chrome version", () => {
  assert.equal(
    assertBrowserRuntimeVersion("148.0.7778.178", {
      chrome: { version: "148.0.7778.178" },
    }),
    "148.0.7778.178",
  );
  assert.throws(
    () =>
      assertBrowserRuntimeVersion("Chrome/148.0.7778.178", {
        chrome: { version: "148.0.7778.178" },
      }),
    /E6_RUNTIME_CHROME_BROWSER_VERSION_INVALID/u,
  );
});
