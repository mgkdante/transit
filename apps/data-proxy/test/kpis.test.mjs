// Behavioral suite for GET /api/v1/kpis (src/kpis.js). Zero-dependency:
// node:test + node:assert/strict + global Request/Response. The Cache API is
// absent under node by default, so most tests exercise the memo + R2 layers;
// the edge-cache layer is exercised via a caches.default shim below.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import worker from "../src/worker.js";
import { __resetKpisCachesForTests } from "../src/kpis.js";

const BASE = "https://transit.yesid.dev";
const KPIS = "/api/v1/kpis";

// R2 fake for the kpis read path (plain get -> { json() }); counts reads so
// the caching tests can assert R2 traffic, and lets bodies be swapped mid-test.
class FakeKpisBucket {
  constructor(objects) {
    this.objects = new Map(Object.entries(objects));
    this.reads = [];
  }

  async get(key) {
    this.reads.push(key);
    const body = this.objects.get(key);
    if (body === undefined) return null;
    return { json: async () => JSON.parse(body) };
  }
}

function iso(msAgo) {
  return new Date(Date.now() - msAgo).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// 10 vehicles across 6 routes; route 10 is busiest. Route 60's vehicle has no
// usable route on one entry (null) to exercise the routesLive guard.
function liveDocs({ snapshotMsAgo = 5_000 } = {}) {
  const stamp = iso(snapshotMsAgo);
  const vehicles = [
    ...Array.from({ length: 3 }, (_, i) => ({ id: `a${i}`, route: "10", delay_min: 2 })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: `b${i}`, route: "20", delay_min: 0 })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: `c${i}`, route: "30", delay_min: -1 })),
    { id: "d0", route: "40", delay_min: 5 },
    { id: "e0", route: "50", delay_min: null },
    { id: "f0", route: null, delay_min: 1 },
  ];
  // Tracked trips outnumber vehicles (matches prod: trips.json ~2× vehicles).
  // Delays (min): 10 -> [2, 4], 20 -> [0], 30 -> [-1], 40 -> [5], 50 -> [null].
  const trips = {
    t1: { route: "10", delay_min: 2 },
    t2: { route: "10", delay_min: 4 },
    t3: { route: "20", delay_min: 0 },
    t4: { route: "30", delay_min: -1 },
    t5: { route: "40", delay_min: 5 },
    t6: { route: "50", delay_min: null },
    t7: { route: null, delay_min: 2 },
  };
  return {
    "v1/stm/live/vehicles.json": JSON.stringify({ generated_utc: stamp, vehicles }),
    "v1/stm/live/trips.json": JSON.stringify({ generated_utc: stamp, trips }),
    "v1/stm/live/network.json": JSON.stringify({ generated_utc: stamp, coverage_pct: 97 }),
    "v1/stm/static/routes_index.json": JSON.stringify({
      routes: [
        { id: "M1", type: 1 },
        { id: "M2", type: 1 },
        ...["10", "20", "30", "40", "50", "60"].map((id) => ({ id, type: 3 })),
      ],
    }),
  };
}

function makeCtx() {
  const background = [];
  return {
    background,
    waitUntil(promise) {
      background.push(Promise.resolve(promise).catch(() => {}));
    },
    async settle() {
      await Promise.all(background);
    },
  };
}

function fetchKpis(env, { method = "GET", path = KPIS } = {}) {
  const ctx = makeCtx();
  return worker.fetch(new Request(`${BASE}${path}`, { method }), env, ctx);
}

beforeEach(() => {
  __resetKpisCachesForTests();
});

test("GET /api/v1/kpis returns the frozen v1 contract with correct aggregation", async () => {
  const env = { SNAPSHOTS: new FakeKpisBucket(liveDocs()) };
  const response = await fetchKpis(env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-kpis-cache"), "miss");

  const body = await response.json();
  assert.deepEqual(Object.keys(body), [
    "snapshotAt",
    "freshnessS",
    "vehicles",
    "avgDelayS",
    "coverage",
    "routesLive",
    "routesTotal",
    "topRoutes",
  ]);
  assert.match(body.snapshotAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.ok(body.freshnessS >= 4 && body.freshnessS <= 8, `freshnessS=${body.freshnessS}`);
  assert.equal(body.vehicles, 10);
  // Trip delays with data: 2,4,0,-1,5,2 min -> mean = 2 min = 120 s.
  assert.equal(body.avgDelayS, 120);
  assert.equal(body.coverage, 0.97);
  assert.equal(body.routesLive, 5); // route null excluded
  assert.equal(body.routesTotal, 6); // buses only — métro (type 1) excluded
  assert.deepEqual(body.topRoutes, [
    { route: "10", vehicles: 3, avgDelayS: 180 },
    { route: "20", vehicles: 2, avgDelayS: 0 },
    { route: "30", vehicles: 2, avgDelayS: -60 },
    { route: "40", vehicles: 1, avgDelayS: 300 },
    { route: "50", vehicles: 1, avgDelayS: null }, // tracked, but no usable delay
  ]);
});

test("fewer than 5 live routes returns what exists, busiest first", async () => {
  const docs = liveDocs();
  docs["v1/stm/live/vehicles.json"] = JSON.stringify({
    generated_utc: iso(2_000),
    vehicles: [
      { id: "a", route: "7", delay_min: 1 },
      { id: "b", route: "7", delay_min: 1 },
      { id: "c", route: "9", delay_min: 2 },
    ],
  });
  const env = { SNAPSHOTS: new FakeKpisBucket(docs) };
  const body = await (await fetchKpis(env)).json();
  assert.equal(body.topRoutes.length, 2);
  assert.equal(body.topRoutes[0].route, "7");
});

test("second request within the cadence serves the memo — no extra R2 reads", async () => {
  const bucket = new FakeKpisBucket(liveDocs());
  const env = { SNAPSHOTS: bucket };
  const first = await fetchKpis(env);
  assert.equal(first.headers.get("x-kpis-cache"), "miss");
  const readsAfterFirst = bucket.reads.length;

  const second = await fetchKpis(env);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-kpis-cache"), "hit");
  assert.equal(bucket.reads.length, readsAfterFirst);
});

test("freshnessS is recomputed at serve time on cache hits", async () => {
  const env = { SNAPSHOTS: new FakeKpisBucket(liveDocs({ snapshotMsAgo: 40_000 })) };
  const first = await (await fetchKpis(env)).json();
  assert.ok(first.freshnessS >= 39 && first.freshnessS <= 43, `freshnessS=${first.freshnessS}`);

  const realNow = Date.now;
  Date.now = () => realNow() + 20_000; // 20 s later, still within the 30 s cache window
  try {
    const response = await fetchKpis(env);
    assert.equal(response.headers.get("x-kpis-cache"), "hit");
    const body = await response.json();
    assert.ok(body.freshnessS >= 59 && body.freshnessS <= 63, `freshnessS=${body.freshnessS}`);
  } finally {
    Date.now = realNow;
  }
});

test("expired cache serves stale and revalidates in the background (SWR)", async () => {
  const bucket = new FakeKpisBucket(liveDocs({ snapshotMsAgo: 2_000 }));
  const env = { SNAPSHOTS: bucket };
  await fetchKpis(env); // prime

  const realNow = Date.now;
  Date.now = () => realNow() + 45_000; // memo expired (45 s > 30 s), snapshot ~47 s (< 90 s)
  try {
    // A fresher snapshot lands in R2 with different numbers. liveDocs stamps
    // via the (patched) Date.now, so this is ~1 s old on the shifted clock.
    const fresher = liveDocs({ snapshotMsAgo: 1_000 });
    fresher["v1/stm/live/network.json"] = JSON.stringify({
      generated_utc: iso(1_000),
      coverage_pct: 88,
    });
    bucket.objects = new Map(Object.entries(fresher));

    const ctx = makeCtx();
    const staleResponse = await worker.fetch(new Request(`${BASE}${KPIS}`), env, ctx);
    assert.equal(staleResponse.headers.get("x-kpis-cache"), "stale");
    assert.equal((await staleResponse.json()).coverage, 0.97); // still the cached numbers
    await ctx.settle(); // background rebuild completes

    const revalidated = await fetchKpis(env);
    assert.equal(revalidated.headers.get("x-kpis-cache"), "hit");
    assert.equal((await revalidated.json()).coverage, 0.88);
  } finally {
    Date.now = realNow;
  }
});

test("failed SWR rebuilds are throttled while the stale core remains usable", async () => {
  const bucket = new FakeKpisBucket(liveDocs({ snapshotMsAgo: 2_000 }));
  const env = { SNAPSHOTS: bucket };
  await fetchKpis(env); // prime

  const realNow = Date.now;
  Date.now = () => realNow() + 45_000; // cache expired, snapshot still usable
  try {
    const broken = liveDocs({ snapshotMsAgo: 1_000 });
    delete broken["v1/stm/live/vehicles.json"];
    bucket.objects = new Map(Object.entries(broken));

    const firstCtx = makeCtx();
    const firstStale = await worker.fetch(new Request(`${BASE}${KPIS}`), env, firstCtx);
    assert.equal(firstStale.headers.get("x-kpis-cache"), "stale");
    await firstCtx.settle(); // background rebuild fails and starts the failure window
    const readsAfterFailure = bucket.reads.length;

    const secondCtx = makeCtx();
    const secondStale = await worker.fetch(new Request(`${BASE}${KPIS}`), env, secondCtx);
    assert.equal(secondStale.headers.get("x-kpis-cache"), "stale");
    await secondCtx.settle();
    assert.equal(bucket.reads.length, readsAfterFailure);
  } finally {
    Date.now = realNow;
  }
});

test("snapshot older than 90 s returns 503 with Retry-After, even from cache", async () => {
  const env = { SNAPSHOTS: new FakeKpisBucket(liveDocs({ snapshotMsAgo: 3_000 })) };
  await fetchKpis(env); // prime with a healthy snapshot

  const realNow = Date.now;
  Date.now = () => realNow() + 120_000; // pipeline stalls; cached snapshot ages out
  try {
    const response = await fetchKpis(env);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "30");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal((await response.json()).error, "pipeline_cold");
  } finally {
    Date.now = realNow;
  }
});

test("missing live vehicles snapshot returns 503 pipeline_cold", async () => {
  const docs = liveDocs();
  delete docs["v1/stm/live/vehicles.json"];
  const env = { SNAPSHOTS: new FakeKpisBucket(docs) };
  const response = await fetchKpis(env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "30");
  assert.equal((await response.json()).error, "pipeline_cold");
});

test("missing network/trips/routes_index degrade to honest nulls, not 503", async () => {
  const docs = liveDocs();
  delete docs["v1/stm/live/network.json"];
  delete docs["v1/stm/live/trips.json"];
  delete docs["v1/stm/static/routes_index.json"];
  const env = { SNAPSHOTS: new FakeKpisBucket(docs) };
  const response = await fetchKpis(env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.coverage, null);
  assert.equal(body.avgDelayS, null);
  assert.equal(body.routesTotal, null);
  assert.equal(body.vehicles, 10);
  assert.equal(body.topRoutes[0].avgDelayS, null);
});

test("HEAD /api/v1/kpis returns headers with an empty body", async () => {
  const env = { SNAPSHOTS: new FakeKpisBucket(liveDocs()) };
  const response = await fetchKpis(env, { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(await response.text(), "");
});

test("OPTIONS /api/v1/kpis returns the 204 preflight", async () => {
  const env = { SNAPSHOTS: new FakeKpisBucket(liveDocs()) };
  const response = await fetchKpis(env, { method: "OPTIONS" });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-methods"), "GET, HEAD, OPTIONS");
});

test("unknown /api/v1/* paths return an uncacheable 404", async () => {
  const env = { SNAPSHOTS: new FakeKpisBucket(liveDocs()) };
  for (const path of ["/api/v1/", "/api/v1/kpis/", "/api/v1/other", "/api/v1/kpis.json"]) {
    const response = await fetchKpis(env, { path });
    assert.equal(response.status, 404, `expected 404 for ${path}`);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("a stalled trips/network lane nulls its own fields while the fresh anchor serves", async () => {
  const docs = liveDocs();
  docs["v1/stm/live/trips.json"] = JSON.stringify({
    generated_utc: iso(2_700_000), // 45 min stale
    trips: { t: { route: "10", delay_min: 25 } },
  });
  docs["v1/stm/live/network.json"] = JSON.stringify({
    generated_utc: iso(259_200_000), // 3 days stale
    coverage_pct: 12,
  });
  const env = { SNAPSHOTS: new FakeKpisBucket(docs) };
  const response = await fetchKpis(env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.avgDelayS, null); // never the 45-min-old delays
  assert.equal(body.coverage, null); // never the 3-day-old coverage
  assert.equal(body.vehicles, 10);
  assert.equal(body.topRoutes[0].avgDelayS, null);
});

test("a stalled vehicles anchor is cold (503) even when trips are fresh", async () => {
  const docs = liveDocs();
  docs["v1/stm/live/vehicles.json"] = JSON.stringify({
    generated_utc: iso(2_700_000), // 45 min stale
    vehicles: [{ id: "a", route: "10", delay_min: 1 }],
  });
  const env = { SNAPSHOTS: new FakeKpisBucket(docs) };
  const response = await fetchKpis(env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "pipeline_cold");
});

test("a vehicles stamp far in the future is unusable — clock-skew guard", async () => {
  const env = { SNAPSHOTS: new FakeKpisBucket(liveDocs({ snapshotMsAgo: -300_000 })) };
  const response = await fetchKpis(env);
  assert.equal(response.status, 503);
});

test("cold-pipeline rebuilds are negative-cached — no per-request R2 amplification", async () => {
  const docs = liveDocs();
  delete docs["v1/stm/live/vehicles.json"];
  const bucket = new FakeKpisBucket(docs);
  const env = { SNAPSHOTS: bucket };
  assert.equal((await fetchKpis(env)).status, 503);
  const readsAfterFirst = bucket.reads.length;
  assert.equal((await fetchKpis(env)).status, 503);
  assert.equal(bucket.reads.length, readsAfterFirst); // served from the failure memo
});

test("pipeline recovery is picked up on the next rebuild window after a cold spell", async () => {
  const docs = liveDocs();
  delete docs["v1/stm/live/vehicles.json"];
  const bucket = new FakeKpisBucket(docs);
  const env = { SNAPSHOTS: bucket };
  assert.equal((await fetchKpis(env)).status, 503);

  const realNow = Date.now;
  Date.now = () => realNow() + 11_000; // past the 10 s failure memo
  try {
    bucket.objects = new Map(Object.entries(liveDocs({ snapshotMsAgo: 2_000 }))); // fresh publish
    const response = await fetchKpis(env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-kpis-cache"), "miss");
  } finally {
    Date.now = realNow;
  }
});

test("edge cache (Cache API) carries the core across isolate recycles", async () => {
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(key) {
        const kept = store.get(key);
        return kept === undefined ? undefined : kept.clone();
      },
      async put(key, response) {
        store.set(key, response);
      },
    },
  };
  try {
    const bucket = new FakeKpisBucket(liveDocs());
    const env = { SNAPSHOTS: bucket };
    await fetchKpis(env); // miss -> builds core, writes the edge cache
    __resetKpisCachesForTests(); // isolate recycle: memo gone, colo cache kept
    const readsBefore = bucket.reads.length;
    const response = await fetchKpis(env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-kpis-cache"), "hit");
    assert.equal(bucket.reads.length, readsBefore); // served from the edge cache, no R2
  } finally {
    delete globalThis.caches;
  }
});
