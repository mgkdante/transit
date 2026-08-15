import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  extractServedEntryUrls,
  fingerprintServedBuild,
} from "../lib/fingerprint.mjs";

const origin = "http://127.0.0.1:4217";
const svelteKitHtml = await readFile(
  new URL("./__fixtures__/sveltekit-inline-entry.html", import.meta.url),
  "utf8",
);
const servedAssets = new Map([
  [
    "/_app/immutable/chunks/runtime.Cc3.js",
    Buffer.from('export const runtime = "fixture";\n', "utf8"),
  ],
  [
    "/_app/immutable/entry/app.DWBBhcsq.js",
    Buffer.from('export const app = "fixture";\n', "utf8"),
  ],
  [
    "/_app/immutable/entry/start.DC4Ug1m_.js",
    Buffer.from('export const start = "fixture";\n', "utf8"),
  ],
]);

test("extracts every immutable asset path from raw SvelteKit HTML", () => {
  assert.deepEqual(extractServedEntryUrls(svelteKitHtml, origin), [
    `${origin}/_app/immutable/chunks/runtime.Cc3.js`,
    `${origin}/_app/immutable/entry/app.DWBBhcsq.js`,
    `${origin}/_app/immutable/entry/start.DC4Ug1m_.js`,
  ]);
});

test("returns the canonical fingerprint for byte-identical served assets", async (context) => {
  const clientRoot = await mkdtemp(join(tmpdir(), "e6-client-"));
  context.after(() => rm(clientRoot, { recursive: true, force: true }));
  for (const [path, bytes] of servedAssets) {
    const diskPath = join(clientRoot, path);
    await mkdir(join(diskPath, ".."), { recursive: true });
    await writeFile(diskPath, bytes);
  }
  const receipt = await fingerprintServedBuild({
    head: "abc123",
    origin,
    html: svelteKitHtml,
    clientRoot,
    fetchFn: async (url) =>
      new Response(servedAssets.get(new URL(url).pathname), { status: 200 }),
  });
  assert.equal(receipt.head, "abc123");
  assert.equal(receipt.origin, origin);
  assert.equal(receipt.assetCount, 3);
  assert.equal(
    receipt.fingerprint,
    "7399abc04e5129c3ee43c026c9cb69434465ca6cc54735bb2976e3a01ff99746",
  );
  assert.deepEqual(receipt.assets, [
    {
      path: "/_app/immutable/chunks/runtime.Cc3.js",
      url: `${origin}/_app/immutable/chunks/runtime.Cc3.js`,
      sha256:
        "3a2d41063bc08ec161c224066b1ca976465c13efc537f08078c873b16dfdacb1",
    },
    {
      path: "/_app/immutable/entry/app.DWBBhcsq.js",
      url: `${origin}/_app/immutable/entry/app.DWBBhcsq.js`,
      sha256:
        "376c645e38f7d6c7a3383b4885f8b3027241cb3f9cc8f1569574af347f86fb0c",
    },
    {
      path: "/_app/immutable/entry/start.DC4Ug1m_.js",
      url: `${origin}/_app/immutable/entry/start.DC4Ug1m_.js`,
      sha256:
        "f2de8069bf33f64210306ae21cf58843c31c3ba2a22ad3952c3a385d5d02a85d",
    },
  ]);
});

test("fails closed for an empty immutable asset set", async () => {
  await assert.rejects(
    () =>
      fingerprintServedBuild({
        head: "abc123",
        origin,
        html: "<html><head></head></html>",
        clientRoot: "/unused",
      }),
    /E6_FINGERPRINT_NO_ENTRY_ASSETS/u,
  );
});

test("rejects a served asset when one byte differs from the local build", async (context) => {
  const clientRoot = await mkdtemp(join(tmpdir(), "e6-client-mismatch-"));
  context.after(() => rm(clientRoot, { recursive: true, force: true }));
  for (const [path, bytes] of servedAssets) {
    const diskPath = join(clientRoot, path);
    await mkdir(join(diskPath, ".."), { recursive: true });
    await writeFile(diskPath, bytes);
  }
  await assert.rejects(
    () =>
      fingerprintServedBuild({
        head: "abc123",
        origin,
        html: svelteKitHtml,
        clientRoot,
        fetchFn: async (url) => {
          const path = new URL(url).pathname;
          const bytes = servedAssets.get(path);
          return new Response(
            path === "/_app/immutable/entry/app.DWBBhcsq.js"
              ? Buffer.concat([bytes, Buffer.from([0])])
              : bytes,
            { status: 200 },
          );
        },
      }),
    /E6_FINGERPRINT_MISMATCH path=\/_app\/immutable\/entry\/app\.DWBBhcsq\.js/u,
  );
});
