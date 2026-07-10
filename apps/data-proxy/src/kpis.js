// GET /api/v1/kpis — tiny public network-KPI endpoint for yesid.dev.
//
// v1 contract (field names FROZEN; breaking changes go to /api/v2/kpis):
//   { snapshotAt, freshnessS, vehicles, avgDelayS, coverage,
//     routesLive, routesTotal, topRoutes: [{ route, vehicles, avgDelayS }] }
// Honesty clauses (documented deviations from the illustrative example):
//   * number fields are NULLABLE — a degraded source nulls its fields rather
//     than fabricating (avgDelayS/topRoutes[].avgDelayS <- trips.json,
//     coverage <- network.json, routesTotal <- routes_index.json);
//   * topRoutes is UP TO 5 — overnight service can run fewer live routes;
//   * routesTotal counts trackable (bus, GTFS type 3) routes — métro is never
//     in the live vehicle feed, so including it would cap routesLive/routesTotal
//     below 1 forever.
//
// Sources — the live snapshot tier the pipeline already publishes to R2 every
// LIVE_CADENCE_MS (manifest files.live.ttl_s = 30 s):
//   live/vehicles.json        -> vehicles, routesLive, topRoutes[].vehicles (ANCHOR)
//   live/trips.json           -> avgDelayS (mean across tracked trips, ×60 from delay_min)
//   live/network.json         -> coverage (coverage_pct / 100)
//   static/routes_index.json  -> routesTotal
//
// Freshness doctrine: every source is gated on ITS OWN generated_utc — the
// three live files are separate 30 s R2 writes, so one lane can stall while
// another advances (partial publish). vehicles.json is the anchor: stale or
// missing -> the pipeline is cold -> 503 + Retry-After, never fabricated
// numbers. A stale trips/network lane nulls only its fields. snapshotAt is the
// anchor stamp; freshnessS is computed at serve time on EVERY request and is
// never cached. Stale = older than SNAPSHOT_STALE_S (3× cadence — the
// site-wide threshold); stamps >90 s in the FUTURE are treated as unusable so
// pipeline clock skew cannot pin freshnessS at 0 while the feed dies.
import { CORS_HEADERS } from "./cors.js";

const PROVIDER = "stm";
const LIVE_CADENCE_MS = 30_000;
const SNAPSHOT_STALE_S = 90;
const RETRY_AFTER_S = "30"; // one pipeline cycle
const ROUTES_INDEX_TTL_MS = 3_600_000; // static tier republishes daily
// Negative cache for failed/cold rebuilds: bounds R2 read amplification (the
// 1.5 MB trips.json in particular) to one attempt per window per isolate while
// the pipeline is down, and bounds post-recovery 503s to the same window.
const FAILURE_TTL_MS = 10_000;
// Synthetic Cache API key carrying the core across isolate recycles. Never
// publicly routable: the worker's zone routes cover only /data/* and /api/v1/*.
const EDGE_CACHE_KEY = "https://transit.yesid.dev/__kpis/core-v1";

// Per-isolate memo + a coalescing in-flight rebuild, so a burst of
// cache-expired requests costs one set of R2 reads, not N.
let coreMemo = null; // { fetchedAtMs, core }
let coreInFlight = null; // Promise<core|null>
let routesTotalMemo = null; // { fetchedAtMs, value }
let lastBuildFailureAtMs = 0;

export function __resetKpisCachesForTests() {
  coreMemo = null;
  coreInFlight = null;
  routesTotalMemo = null;
  lastBuildFailureAtMs = 0;
}

async function readJson(env, key) {
  const object = await env.SNAPSHOTS.get(key);
  if (object === null || object === undefined) return null;
  try {
    return await object.json();
  } catch {
    return null; // truncated/garbled object — treat as absent, never crash the endpoint
  }
}

function parseUtcMs(iso) {
  return typeof iso === "string" ? Date.parse(iso) : NaN;
}

// A source stamp is usable when it parses and sits within the staleness
// threshold on BOTH sides of now (the future bound defuses forward clock skew).
function stampUsable(stampMs, nowMs) {
  return (
    Number.isFinite(stampMs) &&
    nowMs - stampMs < SNAPSHOT_STALE_S * 1000 &&
    stampMs - nowMs <= SNAPSHOT_STALE_S * 1000
  );
}

function snapshotAgeS(core, nowMs) {
  const ms = parseUtcMs(core.snapshotAt);
  return Number.isFinite(ms) ? Math.floor((nowMs - ms) / 1000) : Infinity;
}

async function routesTotal(env, nowMs) {
  if (routesTotalMemo !== null && nowMs - routesTotalMemo.fetchedAtMs < ROUTES_INDEX_TTL_MS) {
    return routesTotalMemo.value;
  }
  const index = await readJson(env, `v1/${PROVIDER}/static/routes_index.json`);
  // Route totals move on GTFS edition flips, not minute-to-minute: if the
  // index is transiently unreadable, last-known-good beats null.
  if (!Array.isArray(index?.routes)) return routesTotalMemo?.value ?? null;
  const typed = index.routes.filter((route) => typeof route?.type === "number");
  const value =
    typed.length > 0 ? typed.filter((route) => route.type === 3).length : index.routes.length;
  routesTotalMemo = { fetchedAtMs: nowMs, value };
  return value;
}

async function buildCore(env) {
  const base = `v1/${PROVIDER}/live`;
  const [vehiclesDoc, tripsDoc, networkDoc] = await Promise.all([
    readJson(env, `${base}/vehicles.json`),
    readJson(env, `${base}/trips.json`),
    readJson(env, `${base}/network.json`),
  ]);
  const nowMs = Date.now();

  // Anchor gate: no fresh vehicle snapshot means the pipeline is cold.
  const vehicles = Array.isArray(vehiclesDoc?.vehicles) ? vehiclesDoc.vehicles : null;
  const vehiclesStampMs = parseUtcMs(vehiclesDoc?.generated_utc);
  if (vehicles === null || !stampUsable(vehiclesStampMs, nowMs)) return null;

  // Per-source gates: a stalled lane nulls its own fields, never the payload.
  const tripsFresh = stampUsable(parseUtcMs(tripsDoc?.generated_utc), nowMs);
  const networkFresh = stampUsable(parseUtcMs(networkDoc?.generated_utc), nowMs);

  const vehiclesByRoute = new Map();
  for (const vehicle of vehicles) {
    const route = typeof vehicle?.route === "string" && vehicle.route !== "" ? vehicle.route : null;
    if (route === null) continue;
    vehiclesByRoute.set(route, (vehiclesByRoute.get(route) ?? 0) + 1);
  }

  const trips =
    tripsFresh && tripsDoc?.trips && typeof tripsDoc.trips === "object"
      ? Object.values(tripsDoc.trips)
      : [];
  let delaySumS = 0;
  let delayCount = 0;
  const delayByRoute = new Map(); // route -> { sumS, count }
  for (const trip of trips) {
    if (typeof trip?.delay_min !== "number" || !Number.isFinite(trip.delay_min)) continue;
    const delayS = trip.delay_min * 60;
    delaySumS += delayS;
    delayCount += 1;
    const route = typeof trip.route === "string" && trip.route !== "" ? trip.route : null;
    if (route === null) continue;
    const acc = delayByRoute.get(route) ?? { sumS: 0, count: 0 };
    acc.sumS += delayS;
    acc.count += 1;
    delayByRoute.set(route, acc);
  }

  const topRoutes = [...vehiclesByRoute.entries()]
    .sort(([routeA, countA], [routeB, countB]) => countB - countA || routeA.localeCompare(routeB))
    .slice(0, 5)
    .map(([route, count]) => {
      const delay = delayByRoute.get(route);
      return {
        route,
        vehicles: count,
        avgDelayS:
          delay !== undefined && delay.count > 0 ? Math.round(delay.sumS / delay.count) : null,
      };
    });

  const coveragePct =
    networkFresh &&
    typeof networkDoc?.coverage_pct === "number" &&
    Number.isFinite(networkDoc.coverage_pct)
      ? networkDoc.coverage_pct
      : null;

  return {
    // Whole-second UTC stamp (freshnessS is integer seconds; sub-second
    // publisher stamps must not leak fractional seconds into the contract).
    snapshotAt: new Date(vehiclesStampMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
    vehicles: vehicles.length,
    avgDelayS: delayCount > 0 ? Math.round(delaySumS / delayCount) : null,
    coverage: coveragePct === null ? null : coveragePct / 100,
    routesLive: vehiclesByRoute.size,
    routesTotal: await routesTotal(env, nowMs),
    topRoutes,
  };
}

async function edgeCacheRead() {
  const cache = globalThis.caches?.default;
  if (!cache) return null; // absent under node:test — memo + R2 still serve
  try {
    const hit = await cache.match(EDGE_CACHE_KEY);
    if (!hit) return null;
    const entry = await hit.json();
    return typeof entry?.fetchedAtMs === "number" && entry.core ? entry : null;
  } catch {
    return null;
  }
}

async function edgeCacheWrite(entry) {
  const cache = globalThis.caches?.default;
  if (!cache) return;
  try {
    await cache.put(
      EDGE_CACHE_KEY,
      new Response(JSON.stringify(entry), {
        headers: {
          "content-type": "application/json",
          // Retention bound only; freshness decisions come from entry.fetchedAtMs.
          "cache-control": `max-age=${SNAPSHOT_STALE_S}`,
        },
      }),
    );
  } catch {
    // best-effort layer
  }
}

function refreshCore(env) {
  if (coreInFlight === null) {
    coreInFlight = (async () => {
      try {
        const core = await buildCore(env);
        if (core === null) {
          lastBuildFailureAtMs = Date.now();
        } else {
          lastBuildFailureAtMs = 0;
          const entry = { fetchedAtMs: Date.now(), core };
          coreMemo = entry;
          await edgeCacheWrite(entry);
        }
        return core;
      } catch (error) {
        lastBuildFailureAtMs = Date.now();
        throw error;
      } finally {
        coreInFlight = null;
      }
    })();
  }
  return coreInFlight;
}

async function getCore(env, waitUntil) {
  const nowMs = Date.now();
  let entry = coreMemo;
  if (entry === null) {
    const fromEdge = await edgeCacheRead();
    // A concurrent rebuild may have filled the memo during the await — never
    // let an older edge entry clobber a newer memo entry.
    if (fromEdge !== null && (coreMemo === null || fromEdge.fetchedAtMs > coreMemo.fetchedAtMs)) {
      coreMemo = fromEdge;
    }
    entry = coreMemo;
  }
  if (entry !== null && snapshotAgeS(entry.core, nowMs) < SNAPSHOT_STALE_S) {
    if (nowMs - entry.fetchedAtMs < LIVE_CADENCE_MS) {
      return { core: entry.core, cacheState: "hit" };
    }
    // Expired cache, snapshot not yet cold: stale-while-revalidate keeps p95
    // at cache speed while the rebuild rides in the background. waitUntil pins
    // the shared rebuild to this request so a client disconnect can't abort it
    // under coalesced followers.
    if (nowMs - lastBuildFailureAtMs >= FAILURE_TTL_MS) {
      const revalidation = refreshCore(env);
      waitUntil(revalidation.catch(() => {}));
    }
    return { core: entry.core, cacheState: "stale" };
  }
  // No usable entry (cold isolate, or the cached snapshot aged out — R2 may
  // still hold a fresh one). Negative-cache failures so a cold pipeline can't
  // amplify into per-request R2 reads.
  if (nowMs - lastBuildFailureAtMs < FAILURE_TTL_MS) return null;
  const rebuild = refreshCore(env);
  waitUntil(rebuild.catch(() => {}));
  const core = await rebuild.catch(() => null);
  return core === null ? null : { core, cacheState: "miss" };
}

function unavailable() {
  return new Response(
    JSON.stringify({
      error: "pipeline_cold",
      detail: `live snapshot missing or older than ${SNAPSHOT_STALE_S}s`,
    }),
    {
      status: 503,
      headers: {
        ...CORS_HEADERS,
        "access-control-expose-headers": "Retry-After",
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "retry-after": RETRY_AFTER_S,
      },
    },
  );
}

export async function serveKpis(request, env, ctx) {
  const waitUntil = ctx?.waitUntil
    ? ctx.waitUntil.bind(ctx)
    : (promise) => {
        Promise.resolve(promise).catch(() => {});
      };
  const result = await getCore(env, waitUntil);
  if (result === null) return unavailable();
  const freshnessS = snapshotAgeS(result.core, Date.now());
  if (freshnessS >= SNAPSHOT_STALE_S) return unavailable();

  const body = JSON.stringify({
    snapshotAt: result.core.snapshotAt,
    freshnessS: Math.max(0, freshnessS), // small clock skews clamp to 0
    vehicles: result.core.vehicles,
    avgDelayS: result.core.avgDelayS,
    coverage: result.core.coverage,
    routesLive: result.core.routesLive,
    routesTotal: result.core.routesTotal,
    topRoutes: result.core.topRoutes,
  });
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "access-control-expose-headers": "X-Kpis-Cache",
      "content-type": "application/json; charset=utf-8",
      // freshnessS is a serve-time value: keep client/shared caches out of the
      // way — the promised 30-60 s cache lives server-side (memo + Cache API,
      // keyed to the pipeline cadence).
      "cache-control": "no-store",
      "x-kpis-cache": result.cacheState,
    },
  });
}
