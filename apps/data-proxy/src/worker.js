// transit-data-proxy — read-only Cloudflare Worker serving the public /v1
// snapshot contract from the transit-snapshots R2 bucket on the route
// transit.yesid.dev/data/* (slice-9.1.1p).
//
// Contract: GET/HEAD only; Content-Type and Cache-Control written at publish
// time (db/src/transit_ops/snapshots/storage.py) pass through unchanged via
// writeHttpMetadata; errors are never cacheable (no-store); CORS is wide open
// (public read-only data) so the slice-9.2 app can fetch the canonical host
// directly from any dev or prod origin. data.yesid.dev stays untouched as the
// fallback origin — this worker never writes to the bucket.

// Only keys under v1/ are servable; the URL prefix /data/ is stripped to map
// onto bucket keys (e.g. /data/v1/stm/manifest.json -> v1/stm/manifest.json).
const KEY_PREFIX = "/data/";
const SERVABLE_PREFIX = "/data/v1/";

const CORS_HEADERS = { "access-control-allow-origin": "*" };

const PREFLIGHT_HEADERS = {
  ...CORS_HEADERS,
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "If-None-Match, If-Modified-Since",
  "access-control-max-age": "86400",
};

function errorResponse(status, extraHeaders = {}) {
  // no-store: a transient 404/405 must never stick in any browser or
  // intermediary cache in front of the 30 s live tier.
  return new Response(null, {
    status,
    headers: { ...CORS_HEADERS, "cache-control": "no-store", ...extraHeaders },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: PREFLIGHT_HEADERS });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return errorResponse(405, { allow: "GET, HEAD, OPTIONS" });
    }

    const { pathname } = new URL(request.url);
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

    const object =
      request.method === "HEAD"
        ? await env.SNAPSHOTS.head(key)
        : await env.SNAPSHOTS.get(key, { onlyIf: request.headers });
    if (object === null) {
      return errorResponse(404);
    }

    const headers = new Headers(CORS_HEADERS);
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);

    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    if (object.body === undefined || object.body === null) {
      // onlyIf precondition failed (If-None-Match matched) — R2 returns the
      // object metadata without a body.
      return new Response(null, { status: 304, headers });
    }
    return new Response(object.body, { status: 200, headers });
  },
};
