import assert from "node:assert/strict";
import test from "node:test";
import { serveSnapshot } from "../src/snapshot-response.js";

const KEY = "v1/stm/manifest.json";
const request = (init) => new Request(`https://data.yesid.dev/${KEY}`, init);
const object = (extra = {}) => ({
  body: "data",
  httpEtag: '"rev-7"',
  size: 4,
  writeHttpMetadata(headers) {
    headers.set("cache-control", "public, max-age=30");
  },
  ...extra,
});

test("HEAD without a head binding uses get but never sends Range or a body", async () => {
  const response = await serveSnapshot(
    request({ method: "HEAD", headers: { range: "bytes=0-1" } }),
    {
      get: async (key, options) => {
        assert.equal(key, KEY);
        assert.equal(options.range, undefined);
        return object();
      },
    },
    KEY,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});

test("conditional HEAD ignores Range and preserves validators", async () => {
  const response = await serveSnapshot(
    request({
      method: "HEAD",
      headers: {
        "if-none-match": '"rev-7"',
        range: "bytes=999-1000",
      },
    }),
    {
      head: async () => {
        throw new Error("conditional HEAD must use get");
      },
      get: async (_key, options) => {
        assert.equal(options.range, undefined);
        return object({ body: null });
      },
    },
    KEY,
  );
  assert.equal(response.status, 304);
  assert.equal(response.headers.get("etag"), '"rev-7"');
});

test("empty Range behaves as a whole-object read", async () => {
  const response = await serveSnapshot(
    request({ headers: { range: "" } }),
    {
      get: async (_key, options) => {
        assert.equal(options.range, undefined);
        return object();
      },
    },
    KEY,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "data");
});

test("optional size cannot produce malformed Content-Range", async () => {
  const response = await serveSnapshot(
    request({ headers: { range: "bytes=0-1" } }),
    {
      get: async () =>
        object({ range: { offset: 0, length: 2 }, size: undefined }),
    },
    KEY,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.has("content-range"), false);
});

test("unrelated R2 errors propagate even with a Range request", async () => {
  await assert.rejects(
    serveSnapshot(
      request({ headers: { range: "bytes=0-1" } }),
      {
        get: async () => {
          throw new Error("R2 unavailable");
        },
      },
      KEY,
    ),
    /R2 unavailable/,
  );
});

test("invalid uploaded date cannot satisfy If-Unmodified-Since before If-None-Match", async () => {
  const response = await serveSnapshot(
    request({
      headers: {
        "if-unmodified-since": "Wed, 15 Jul 2026 12:00:01 GMT",
        "if-none-match": '"rev-7"',
      },
    }),
    { get: async () => object({ body: null, uploaded: new Date(NaN) }) },
    KEY,
  );
  assert.equal(response.status, 412);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
