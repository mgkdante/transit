import assert from "node:assert/strict";
import { existsSync, linkSync, readdirSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  canonicalJsonBytes,
  E6_DURABLE_MARKER_DIRECTORY,
  loadDurableMarker,
  publishDurableMarker,
  syncDurableDirectory,
} from "../lib/durable-marker.mjs";

const FILENAME = "b2-test.json";

function load(gitCommonDirectory) {
  return loadDurableMarker({
    gitCommonDirectory,
    filename: FILENAME,
    validate: (value) => {
      if (value?.schema !== 1) throw new Error("E6_TEST_MARKER_INVALID");
    },
    invalidCode: "E6_TEST_MARKER_INVALID",
  });
}

function publish(gitCommonDirectory, overrides = {}) {
  return publishDurableMarker({
    gitCommonDirectory,
    filename: FILENAME,
    value: { schema: 1 },
    validate: (value) => {
      if (value?.schema !== 1) throw new Error("E6_TEST_MARKER_INVALID");
    },
    alreadyConsumedCode: "E6_TEST_MARKER_CONSUMED",
    invalidCode: "E6_TEST_MARKER_INVALID",
    ...overrides,
  });
}

test("admission and the canonical marker link execute in one synchronous stack", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-durable-sync-link-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const canonical = join(root, E6_DURABLE_MARKER_DIRECTORY, FILENAME);
  const events = [];

  const receipt = await publish(root, {
    assertPublicationAllowed: () => {
      events.push("admission");
      queueMicrotask(() => events.push("yielded"));
    },
    linkCanonical: (temporary, markerPath) => {
      events.push("link");
      assert.deepEqual(events, ["admission", "link"]);
      assert.equal(existsSync(temporary), true);
      assert.equal(existsSync(markerPath), false);
      linkSync(temporary, markerPath);
      assert.equal(existsSync(markerPath), true);
    },
  });

  assert.equal(receipt.markerPath, canonical);
  assert.deepEqual(events.slice(0, 2), ["admission", "link"]);
});

test("an asynchronous canonical marker link seam fails closed", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-durable-async-link-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const markerDirectory = join(root, E6_DURABLE_MARKER_DIRECTORY);
  const canonical = join(markerDirectory, FILENAME);

  await assert.rejects(
    publish(root, {
      assertPublicationAllowed: () => {},
      linkCanonical: () => Promise.resolve(),
    }),
    /E6_DURABLE_MARKER_LINK_INVALID/u,
  );
  assert.equal(existsSync(canonical), false);
  assert.deepEqual(
    readdirSync(markerDirectory).filter((name) =>
      name.endsWith(".marker.tmp"),
    ),
    [],
  );
});

test("load and directory sync reject a symlinked or non-private marker parent", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-durable-parent-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const targetCommon = join(root, "target-common");
  const targetDirectory = join(targetCommon, E6_DURABLE_MARKER_DIRECTORY);
  await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(targetDirectory, FILENAME),
    canonicalJsonBytes({ schema: 1 }),
    { mode: 0o600 },
  );

  const symlinkCommon = join(root, "symlink-common");
  await mkdir(symlinkCommon);
  const symlinkDirectory = join(symlinkCommon, E6_DURABLE_MARKER_DIRECTORY);
  await symlink(targetDirectory, symlinkDirectory);

  const publicCommon = join(root, "public-common");
  const publicDirectory = join(publicCommon, E6_DURABLE_MARKER_DIRECTORY);
  await mkdir(publicDirectory, { recursive: true, mode: 0o700 });
  await chmod(publicDirectory, 0o755);
  await writeFile(
    join(publicDirectory, FILENAME),
    canonicalJsonBytes({ schema: 1 }),
    { mode: 0o600 },
  );

  const [symlinkLoad, publicLoad, symlinkSync] = await Promise.allSettled([
    load(symlinkCommon),
    load(publicCommon),
    syncDurableDirectory(symlinkDirectory),
  ]);
  assert.equal(symlinkLoad.status, "rejected");
  assert.match(symlinkLoad.reason.message, /E6_TEST_MARKER_INVALID/u);
  assert.equal(publicLoad.status, "rejected");
  assert.match(publicLoad.reason.message, /E6_TEST_MARKER_INVALID/u);
  assert.equal(symlinkSync.status, "rejected");
});
