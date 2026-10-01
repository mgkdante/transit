// Public snapshots retain object metadata; errors use no-store. The bucket is read-only.
import { CORS_HEADERS, PREFLIGHT_HEADERS } from "./cors.js";
import { serveKpis } from "./kpis.js";
import { serveSnapshot } from "./snapshot-response.js";

const KEY_PREFIX = "/data/";
const SERVABLE_PREFIX = "/data/v1/";

const KPIS_PATH = "/api/v1/kpis";
const API_PREFIX = "/api/v1/";
const RETIRED_STO_PREFIX = "/data/v1/sto/";

function errorResponse(status, extraHeaders = {}) {
  // Do not cache transient errors.
  return new Response(null, {
    status,
    headers: { ...CORS_HEADERS, "cache-control": "no-store", ...extraHeaders },
  });
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
    let decodedPathname;
    try {
      decodedPathname = decodeURIComponent(pathname);
    } catch {
      return errorResponse(404);
    }
    if (decodedPathname.startsWith(RETIRED_STO_PREFIX)) {
      return errorResponse(410);
    }
    if (decodedPathname === KPIS_PATH) {
      return serveKpis(request, env, ctx);
    }
    if (decodedPathname.startsWith(API_PREFIX)) {
      // Undefined API routes return an uncacheable 404.
      return errorResponse(404);
    }
    if (!decodedPathname.startsWith(SERVABLE_PREFIX)) {
      return errorResponse(404);
    }

    const key = decodedPathname.slice(KEY_PREFIX.length);
    if (key.includes("..")) {
      return errorResponse(404);
    }

    const response = await serveSnapshot(request, env.SNAPSHOTS, key);
    if (response === null) return errorResponse(404);
    for (const [name, value] of Object.entries(CORS_HEADERS))
      response.headers.set(name, value);
    return response;
  },
};
