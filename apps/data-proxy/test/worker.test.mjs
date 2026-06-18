// Behavioral suite for the transit-data-proxy Worker (slice-9.1.1p).
// Zero-dependency: node:test + node:assert/strict + global Request/Response
// (Node >= 18). R2 binding is faked below — runtime divergence is covered by
// the live smoke gate (smoke.sh).
import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/worker.js";

const BASE = "https://transit.yesid.dev";

class FakeR2Object {
  constructor({ body, etag, contentType, cacheControl, size, range }) {
    this.body = body;
    this.etag = etag;
    this.contentType = contentType;
    this.cacheControl = cacheControl;
    // R2 exposes the total object size and, for a range read, the resolved
    // {offset,length} slice. Default size to the (string) body length.
    this.size = size ?? (typeof body === "string" ? body.length : undefined);
    this.range = range;
  }

  get httpEtag() {
    return `"${this.etag}"`;
  }

  writeHttpMetadata(headers) {
    headers.set("content-type", this.contentType);
    headers.set("cache-control", this.cacheControl);
  }

  withoutBody() {
    return new FakeR2Object({
      body: undefined,
      etag: this.etag,
      contentType: this.contentType,
      cacheControl: this.cacheControl,
      size: this.size,
    });
  }
}

class FakeR2Bucket {
  constructor(objects) {
    this.objects = new Map(Object.entries(objects));
  }

  async head(key) {
    const object = this.objects.get(key);
    return object ? object.withoutBody() : null;
  }

  async get(key, options = {}) {
    const object = this.objects.get(key);
    if (!object) return null;
    const onlyIf = options.onlyIf;
    const ifNoneMatch =
      onlyIf instanceof Headers ? onlyIf.get("if-none-match") : (onlyIf?.etagDoesNotMatch ?? null);
    if (ifNoneMatch !== null && ifNoneMatch.replaceAll('"', "") === object.etag) {
      // Precondition failed: the runtime returns R2Object (headers, no body).
      return object.withoutBody();
    }
    // Range read: R2 accepts the request Headers and returns the byte slice
    // plus a resolved .range. Parse a single `bytes=start-end` range.
    const range = options.range;
    const rangeHeader = range instanceof Headers ? range.get("range") : null;
    if (rangeHeader && typeof object.body === "string") {
      const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
      if (match) {
        const offset = Number(match[1]);
        const end = match[2] === "" ? object.size - 1 : Number(match[2]);
        const length = end - offset + 1;
        return new FakeR2Object({
          body: object.body.slice(offset, end + 1),
          etag: object.etag,
          contentType: object.contentType,
          cacheControl: object.cacheControl,
          size: object.size,
          range: { offset, length },
        });
      }
    }
    return object;
  }
}

function makeEnv() {
  return {
    SNAPSHOTS: new FakeR2Bucket({
      "v1/stm/manifest.json": new FakeR2Object({
        body: '{"provider":"stm"}',
        etag: "manifest-rev-7",
        contentType: "application/json",
        cacheControl: "public, max-age=30",
      }),
      "v1/stm/static/routes_index.json": new FakeR2Object({
        body: '{"routes":[]}',
        etag: "routes-rev-7",
        contentType: "application/json",
        cacheControl: "public, max-age=604800",
      }),
      // 200-byte basemap archive for the Range/206 cases (slice-9.3).
      "v1/stm/static/basemap/montreal.pmtiles": new FakeR2Object({
        body: "P".repeat(200),
        etag: "basemap-rev-1",
        contentType: "application/octet-stream",
        cacheControl: "public, max-age=2592000",
      }),
    }),
  };
}

function fetchWorker(path, init = {}) {
  return worker.fetch(new Request(`${BASE}${path}`, init), makeEnv());
}

test("GET /data/v1 key returns 200 with passthrough content-type and cache-control", async () => {
  const response = await fetchWorker("/data/v1/stm/manifest.json");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("cache-control"), "public, max-age=30");
  assert.equal(response.headers.get("etag"), '"manifest-rev-7"');
  assert.equal(await response.text(), '{"provider":"stm"}');
});

test("GET missing key returns 404", async () => {
  const response = await fetchWorker("/data/v1/stm/definitely-missing.json");
  assert.equal(response.status, 404);
});

test("GET path outside /data/v1 returns 404", async () => {
  for (const path of ["/data/secrets.txt", "/data/", "/healthz", "/v1/stm/manifest.json"]) {
    const response = await fetchWorker(path);
    assert.equal(response.status, 404, `expected 404 for ${path}`);
  }
});

test("POST returns 405 with Allow GET, HEAD, OPTIONS", async () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const response = await fetchWorker("/data/v1/stm/manifest.json", { method });
    assert.equal(response.status, 405, `expected 405 for ${method}`);
    assert.equal(response.headers.get("allow"), "GET, HEAD, OPTIONS");
  }
});

test("HEAD returns 200 with headers and empty body", async () => {
  const response = await fetchWorker("/data/v1/stm/manifest.json", { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("cache-control"), "public, max-age=30");
  assert.equal(response.headers.get("etag"), '"manifest-rev-7"');
  assert.equal(await response.text(), "");
});

test("If-None-Match matching etag returns 304", async () => {
  const response = await fetchWorker("/data/v1/stm/manifest.json", {
    headers: { "if-none-match": '"manifest-rev-7"' },
  });
  assert.equal(response.status, 304);
  assert.equal(response.headers.get("etag"), '"manifest-rev-7"');
  assert.equal(await response.text(), "");
});

test("GET response carries Access-Control-Allow-Origin star", async () => {
  const response = await fetchWorker("/data/v1/stm/static/routes_index.json");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
});

test("OPTIONS preflight returns 204 with CORS headers", async () => {
  const response = await fetchWorker("/data/v1/stm/manifest.json", { method: "OPTIONS" });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-methods"), "GET, HEAD, OPTIONS");
  assert.equal(
    response.headers.get("access-control-allow-headers"),
    "If-None-Match, If-Modified-Since, Range",
  );
  assert.equal(
    response.headers.get("access-control-expose-headers"),
    "Content-Range, Content-Length, Accept-Ranges, ETag",
  );
  assert.equal(response.headers.get("access-control-max-age"), "86400");
  assert.equal(await response.text(), "");
});

test("GET with Range returns 206 with Content-Range + Accept-Ranges (pmtiles)", async () => {
  const response = await fetchWorker("/data/v1/stm/static/basemap/montreal.pmtiles", {
    headers: { Range: "bytes=0-99" },
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 0-99/200");
  assert.equal(response.headers.get("content-length"), "100");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal((await response.text()).length, 100);
});

test("GET without Range still returns 200 with full body + Accept-Ranges", async () => {
  const response = await fetchWorker("/data/v1/stm/static/basemap/montreal.pmtiles");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-range"), null);
  assert.equal((await response.text()).length, 200);
});

test("HEAD advertises Accept-Ranges", async () => {
  const response = await fetchWorker("/data/v1/stm/static/basemap/montreal.pmtiles", {
    method: "HEAD",
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(await response.text(), "");
});

test("malformed percent-encoding returns 404", async () => {
  const response = await fetchWorker("/data/v1/stm/%zz.json");
  assert.equal(response.status, 404);
});

test("percent-encoded path traversal returns 404", async () => {
  const response = await fetchWorker("/data/v1/%2e%2e/stm/manifest.json");
  assert.equal(response.status, 404);
});

test("error responses are not cacheable and still carry CORS", async () => {
  const missing = await fetchWorker("/data/v1/stm/definitely-missing.json");
  assert.equal(missing.headers.get("cache-control"), "no-store");
  assert.equal(missing.headers.get("access-control-allow-origin"), "*");

  const rejected = await fetchWorker("/data/v1/stm/manifest.json", { method: "POST" });
  assert.equal(rejected.headers.get("cache-control"), "no-store");
  assert.equal(rejected.headers.get("access-control-allow-origin"), "*");

  // Success responses must keep the object's own Cache-Control, never no-store.
  const ok = await fetchWorker("/data/v1/stm/manifest.json");
  assert.notEqual(ok.headers.get("cache-control"), "no-store");
});
