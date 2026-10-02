import { CORS_HEADERS } from "./cors.js";

const PROVIDER = "stm";
const LIVE_CADENCE_MS = 30_000;
const SNAPSHOT_STALE_S = 90;
const RETRY_AFTER_S = "30";
const ROUTES_INDEX_TTL_MS = 3_600_000;
const FAILURE_TTL_MS = 10_000;
const EDGE_CACHE_KEY = "https://transit.yesid.dev/__kpis/core-v3";

let coreMemo = null;
let coreInFlight = null;
let routesTotalMemo = null;
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
    return null;
  }
}

function parseUtcMs(iso) {
  return typeof iso === "string" ? Date.parse(iso) : NaN;
}

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

function meanDelaySeconds(sum, count) {
  if (count === 0) return null;
  const mean = sum / count;
  return Math.sign(mean) * Math.round(Math.abs(mean));
}

async function routesTotal(env, nowMs) {
  if (
    routesTotalMemo !== null &&
    nowMs - routesTotalMemo.fetchedAtMs < ROUTES_INDEX_TTL_MS
  ) {
    return routesTotalMemo.value;
  }
  const index = await readJson(env, `v1/${PROVIDER}/static/routes_index.json`);
  if (!Array.isArray(index?.routes)) return routesTotalMemo?.value ?? null;
  const typed = index.routes.filter((route) => typeof route?.type === "number");
  const value =
    typed.length > 0
      ? typed.filter((route) => route.type === 3).length
      : index.routes.length;
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

  const vehicles = Array.isArray(vehiclesDoc?.vehicles)
    ? vehiclesDoc.vehicles
    : null;
  const vehiclesStampMs = parseUtcMs(vehiclesDoc?.generated_utc);
  if (vehicles === null || !stampUsable(vehiclesStampMs, nowMs)) return null;

  const tripsStampMs = parseUtcMs(tripsDoc?.generated_utc);
  const networkStampMs = parseUtcMs(networkDoc?.generated_utc);
  const tripsFresh = stampUsable(tripsStampMs, nowMs);
  const networkFresh = stampUsable(networkStampMs, nowMs);

  const vehiclesByRoute = new Map();
  for (const vehicle of vehicles) {
    const route =
      typeof vehicle?.route === "string" && vehicle.route !== ""
        ? vehicle.route
        : null;
    if (route === null) continue;
    vehiclesByRoute.set(route, (vehiclesByRoute.get(route) ?? 0) + 1);
  }

  const trips =
    tripsFresh && tripsDoc?.trips && typeof tripsDoc.trips === "object"
      ? Object.values(tripsDoc.trips)
      : [];
  let delaySumS = 0;
  let delayCount = 0;
  const delayByRoute = new Map();
  for (const trip of trips) {
    if (typeof trip?.delay_min !== "number" || !Number.isFinite(trip.delay_min))
      continue;
    const delayS = trip.delay_min * 60;
    delaySumS += delayS;
    delayCount += 1;
    const route =
      typeof trip.route === "string" && trip.route !== "" ? trip.route : null;
    if (route === null) continue;
    const acc = delayByRoute.get(route) ?? { sumS: 0, count: 0 };
    acc.sumS += delayS;
    acc.count += 1;
    delayByRoute.set(route, acc);
  }

  const topRoutes = [...vehiclesByRoute.entries()]
    .sort(
      ([routeA, countA], [routeB, countB]) =>
        countB - countA || routeA.localeCompare(routeB),
    )
    .slice(0, 5)
    .map(([route, count]) => {
      const delay = delayByRoute.get(route);
      return {
        route,
        vehicles: count,
        avgDelayS:
          delay === undefined
            ? null
            : meanDelaySeconds(delay.sumS, delay.count),
      };
    });

  const coveragePct =
    networkFresh &&
    typeof networkDoc?.coverage_pct === "number" &&
    Number.isFinite(networkDoc.coverage_pct)
      ? networkDoc.coverage_pct
      : null;

  return {
    tripsStampMs,
    networkStampMs,
    snapshotAt: new Date(vehiclesStampMs)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z"),
    vehicles: vehicles.length,
    avgDelayS: meanDelaySeconds(delaySumS, delayCount),
    coverage: coveragePct === null ? null : coveragePct / 100,
    routesLive: vehiclesByRoute.size,
    routesTotal: await routesTotal(env, nowMs),
    topRoutes,
  };
}

async function edgeCacheRead() {
  const cache = globalThis.caches?.default;
  if (!cache) return null;
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
          "cache-control": `max-age=${SNAPSHOT_STALE_S}`,
        },
      }),
    );
  } catch {}
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
    if (
      fromEdge !== null &&
      (coreMemo === null || fromEdge.fetchedAtMs > coreMemo.fetchedAtMs)
    ) {
      coreMemo = fromEdge;
    }
    entry = coreMemo;
  }
  if (entry !== null && snapshotAgeS(entry.core, nowMs) < SNAPSHOT_STALE_S) {
    if (nowMs - entry.fetchedAtMs < LIVE_CADENCE_MS) {
      return { core: entry.core, cacheState: "hit" };
    }
    if (nowMs - lastBuildFailureAtMs >= FAILURE_TTL_MS) {
      const revalidation = refreshCore(env);
      waitUntil(revalidation.catch(() => {}));
    }
    return { core: entry.core, cacheState: "stale" };
  }
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
  const { core } = result;
  const nowMs = Date.now();
  const freshnessS = snapshotAgeS(core, nowMs);
  if (!stampUsable(parseUtcMs(core.snapshotAt), nowMs)) return unavailable();
  const tripsFresh = stampUsable(core.tripsStampMs, nowMs);
  const networkFresh = stampUsable(core.networkStampMs, nowMs);

  const body = JSON.stringify({
    snapshotAt: core.snapshotAt,
    freshnessS: Math.max(0, freshnessS),
    vehicles: core.vehicles,
    avgDelayS: tripsFresh ? core.avgDelayS : null,
    coverage: networkFresh ? core.coverage : null,
    routesLive: core.routesLive,
    routesTotal: core.routesTotal,
    topRoutes: tripsFresh
      ? core.topRoutes
      : core.topRoutes.map((route) => ({ ...route, avgDelayS: null })),
  });
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "access-control-expose-headers": "X-Kpis-Cache",
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-kpis-cache": result.cacheState,
    },
  });
}
