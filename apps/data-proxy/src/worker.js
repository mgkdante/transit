// transit-data-proxy — read-only Cloudflare Worker serving the public /v1
// snapshot contract from the transit-snapshots R2 bucket on the route
// transit.yesid.dev/data/* (slice-9.1.1p), plus the aggregated public KPI
// endpoint on transit.yesid.dev/api/v1/* (src/kpis.js).
//
// Contract: GET/HEAD only; Content-Type and Cache-Control written at publish
// time (db/src/transit_ops/snapshots/storage.py) pass through unchanged via
// writeHttpMetadata; errors are never cacheable (no-store); CORS is wide open
// (public read-only data) so the slice-9.2 app can fetch the canonical host
// directly from any dev or prod origin. data.yesid.dev stays untouched as the
// fallback origin — this worker never writes to the bucket.
import { CORS_HEADERS, PREFLIGHT_HEADERS } from "./cors.js";
import { serveKpis } from "./kpis.js";

// Only keys under v1/ are servable; the URL prefix /data/ is stripped to map
// onto bucket keys (e.g. /data/v1/stm/manifest.json -> v1/stm/manifest.json).
const KEY_PREFIX = "/data/";
const SERVABLE_PREFIX = "/data/v1/";

const KPIS_PATH = "/api/v1/kpis";
const API_PREFIX = "/api/v1/";

function errorResponse(status, extraHeaders = {}) {
  // no-store: a transient 404/405 must never stick in any browser or
  // intermediary cache in front of the 30 s live tier.
  return new Response(null, {
    status,
    headers: { ...CORS_HEADERS, "cache-control": "no-store", ...extraHeaders },
  });
}

function ifMatchSatisfied(value, httpEtag) {
  return (
    value.trim() === "*" ||
    value.split(",").some((candidate) => candidate.trim() === httpEtag)
  );
}

function ifUnmodifiedSinceSatisfied(value, uploaded) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return true;
  return uploaded instanceof Date && uploaded.getTime() <= timestamp;
}

function failedConditionalStatus(headers, object) {
  const ifMatch = headers.get("if-match");
  if (ifMatch !== null) {
    if (!ifMatchSatisfied(ifMatch, object.httpEtag)) return 412;
  } else {
    const ifUnmodifiedSince = headers.get("if-unmodified-since");
    if (
      ifUnmodifiedSince !== null &&
      !ifUnmodifiedSinceSatisfied(ifUnmodifiedSince, object.uploaded)
    ) {
      return 412;
    }
  }

  return headers.has("if-none-match") || headers.has("if-modified-since")
    ? 304
    : 412;
}

function hasConditionalHeaders(headers) {
  return (
    headers.has("if-match") ||
    headers.has("if-none-match") ||
    headers.has("if-modified-since") ||
    headers.has("if-unmodified-since")
  );
}

function isR2InvalidRange(error) {
  return error instanceof Error && /\(10039\)\s*$/.test(error.message);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: PREFLIGHT_HEADERS });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return errorResponse(405, { allow: "GET, HEAD, OPTIONS" });
    }

    const { pathname } = new URL(request.url);
    if (pathname === KPIS_PATH) {
      return serveKpis(request, env, ctx);
    }
    if (pathname.startsWith(API_PREFIX)) {
      // The /api/v1/* zone route lands here for paths this worker doesn't
      // define yet — a clean, uncacheable 404 (never the web app's HTML).
      return errorResponse(404);
    }
    if (!pathname.startsWith(SERVABLE_PREFIX)) {
      return errorResponse(404);
    }

    let key;
    try {
      key = decodeURIComponent(pathname.slice(KEY_PREFIX.length));
    } catch {
      return errorResponse(404); // malformed percent-encoding
    }
    if (key.includes("..")) {
      // URL() normalizes literal dot-segments; this guards the encoded form.
      return errorResponse(404);
    }

    // Range support (pmtiles partial reads): forward the client Range header to
    // R2 so it returns just the requested byte slice plus the object's
    // .range ({offset,length}) and .size. HEAD never carries a body/range.
    const rangeHeader =
      request.method === "GET" ? request.headers.get("range") : null;
    const conditionalHead =
      request.method === "HEAD" && hasConditionalHeaders(request.headers);
    let object;
    try {
      if (request.method === "HEAD" && !conditionalHead) {
        object = await env.SNAPSHOTS.head(key);
      } else {
        const getOptions = { onlyIf: request.headers };
        if (rangeHeader) getOptions.range = request.headers;
        object = await env.SNAPSHOTS.get(key, getOptions);
      }
    } catch (error) {
      if (rangeHeader && isR2InvalidRange(error)) {
        return errorResponse(416, { "accept-ranges": "bytes" });
      }
      throw error;
    }
    if (object === null) {
      return errorResponse(404);
    }

    const headers = new Headers(CORS_HEADERS);
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    // Advertise byte-range support on every readable response.
    headers.set("accept-ranges", "bytes");

    if (request.method === "HEAD") {
      if (
        conditionalHead &&
        (object.body === undefined || object.body === null)
      ) {
        const status = failedConditionalStatus(request.headers, object);
        if (status === 412) headers.set("cache-control", "no-store");
        return new Response(null, { status, headers });
      }
      return new Response(null, { status: 200, headers });
    }
    if (object.body === undefined || object.body === null) {
      const status = failedConditionalStatus(request.headers, object);
      if (status === 412) headers.set("cache-control", "no-store");
      return new Response(null, { status, headers });
    }
    // A satisfied Range request → 206 Partial Content with Content-Range.
    if (rangeHeader && object.range) {
      const offset = object.range.offset ?? 0;
      const length = object.range.length ?? object.size - offset;
      headers.set(
        "content-range",
        `bytes ${offset}-${offset + length - 1}/${object.size}`,
      );
      headers.set("content-length", String(length));
      return new Response(object.body, { status: 206, headers });
    }
    return new Response(object.body, { status: 200, headers });
  },
};
