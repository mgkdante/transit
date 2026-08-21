import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertSameServedBuildFingerprint,
  assertServedAssetBytes,
  assertServedBuildFingerprint,
  assertServedHtmlBytes,
  extractServedEntryUrls,
  fingerprintServedBuild,
} from "../lib/fingerprint.mjs";

const origin = "http://127.0.0.1:4217";
const head = "4fcb603aa2d600d97061c26ee010a7212555dced";
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
    head,
    origin,
    html: svelteKitHtml,
    clientRoot,
    fetchFn: async (url) =>
      new Response(servedAssets.get(new URL(url).pathname), { status: 200 }),
  });
  assert.equal(receipt.head, head);
  assert.equal(receipt.origin, origin);
  assert.equal(
    receipt.htmlSha256,
    "f0e003e1bddf3e77aab796963609fcd393cd494456b22cdda9599e9c865ababd",
  );
  assert.equal(receipt.assetCount, 3);
  assert.equal(
    receipt.fingerprint,
    "95f199363a0f18ed9b24685a27ca89168253e7cf1a7635f7735df414af04be3f",
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
  assert.equal(
    assertServedHtmlBytes(receipt, Buffer.from(svelteKitHtml)),
    receipt.htmlSha256,
  );
  assert.equal(
    assertServedAssetBytes(
      receipt,
      receipt.assets[0].url,
      servedAssets.get(receipt.assets[0].path),
    ).path,
    receipt.assets[0].path,
  );
  assert.equal(assertSameServedBuildFingerprint(receipt, receipt), receipt);
  assert.throws(
    () => assertServedHtmlBytes(receipt, Buffer.from(`${svelteKitHtml} `)),
    /E6_FINGERPRINT_BROWSER_HTML_MISMATCH/u,
  );
  assert.throws(
    () => assertServedAssetBytes(receipt, receipt.assets[0].url, Buffer.from("changed")),
    /E6_FINGERPRINT_BROWSER_ASSET_MISMATCH/u,
  );
});

test("rejects coordinated fingerprint receipt tampering", async (context) => {
  const clientRoot = await mkdtemp(join(tmpdir(), "e6-client-receipt-"));
  context.after(() => rm(clientRoot, { recursive: true, force: true }));
  for (const [path, bytes] of servedAssets) {
    const diskPath = join(clientRoot, path);
    await mkdir(join(diskPath, ".."), { recursive: true });
    await writeFile(diskPath, bytes);
  }
  const receipt = await fingerprintServedBuild({
    head,
    origin,
    html: svelteKitHtml,
    clientRoot,
    fetchFn: async (url) =>
      new Response(servedAssets.get(new URL(url).pathname), { status: 200 }),
  });
  for (const mutate of [
    (value) => delete value.htmlSha256,
    (value) => (value.assetCount = 2),
    (value) => value.assets.reverse(),
    (value) => (value.assets[0].sha256 = "0".repeat(64)),
    (value) => (value.fingerprint = "0".repeat(64)),
  ]) {
    const value = structuredClone(receipt);
    mutate(value);
    assert.throws(
      () => assertServedBuildFingerprint(value),
      /E6_FINGERPRINT_RECEIPT_INVALID/u,
    );
  }
});

test("fails closed for an empty immutable asset set", async () => {
  await assert.rejects(
    () =>
      fingerprintServedBuild({
        head,
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
        head,
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
