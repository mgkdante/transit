import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import worker from "../src/worker.js";
import { __resetKpisCachesForTests } from "../src/kpis.js";

const catalog = { providers: [{ id: "stm" }, { id: "octranspo" }] };
function bucket() {
  const stamp = new Date().toISOString();
  const docs = new Map([["v1/providers.json", catalog]]);
  for (const [provider, route, count, delay, coverage] of [
    ["stm", "24", 2, 1, 80],
    ["octranspo", "88", 1, 3, 60],
  ]) {
    docs.set(`v1/${provider}/live/vehicles.json`, {
      generated_utc: stamp,
      vehicles: Array.from({ length: count }, (_, i) => ({
        id: String(i),
        route,
      })),
    });
    docs.set(`v1/${provider}/live/trips.json`, {
      generated_utc: stamp,
      trips: { t: { route, delay_min: delay } },
    });
    docs.set(`v1/${provider}/live/network.json`, {
      generated_utc: stamp,
      coverage_pct: coverage,
    });
    docs.set(`v1/${provider}/static/routes_index.json`, {
      routes: Array.from({ length: count }, () => ({ type: 3 })),
    });
  }
  const reads = [];
  return {
    docs,
    reads,
    async get(key) {
      reads.push(key);
      return docs.has(key) ? { json: async () => docs.get(key) } : null;
    },
  };
}
function fetchKpis(storage, query = "", method = "GET") {
  return worker.fetch(
    new Request(`https://transit.yesid.dev/api/v1/kpis${query}`, { method }),
    { SNAPSHOTS: storage },
    { waitUntil() {} },
  );
}
beforeEach(__resetKpisCachesForTests);
for (const provider of ["stm", "octranspo"]) {
  test(`${provider} selects its own snapshot and route total`, async () => {
    const storage = bucket();
    const response = await fetchKpis(storage, `?provider=${provider}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.vehicles, provider === "stm" ? 2 : 1);
    assert.equal(body.routesTotal, provider === "stm" ? 2 : 1);
    assert.equal(body.avgDelayS, provider === "stm" ? 60 : 180);
    assert.equal(body.coverage, provider === "stm" ? 0.8 : 0.6);
    assert.equal(body.topRoutes[0].route, provider === "stm" ? "24" : "88");
    assert.ok(
      storage.reads.every(
        (key) =>
          key === "v1/providers.json" || key.startsWith(`v1/${provider}/`),
      ),
    );
  });
}
test("default stays STM and concurrent providers never share in-flight or memo results", async () => {
  const storage = bucket();
  const responses = await Promise.all([
    fetchKpis(storage),
    fetchKpis(storage, "?provider=octranspo"),
  ]);
  assert.deepEqual(
    await Promise.all(responses.map(async (r) => (await r.json()).vehicles)),
    [2, 1],
  );
  assert.equal(
    (await (await fetchKpis(storage, "?provider=stm")).json()).vehicles,
    2,
  );
  assert.equal(
    (await (await fetchKpis(storage, "?provider=octranspo")).json()).vehicles,
    1,
  );
});
for (const provider of ["unknown", "", "../stm", "STM", "sto"]) {
  test(`unknown provider ${JSON.stringify(provider)} returns uncacheable 404`, async () => {
    const storage = bucket();
    const response = await fetchKpis(
      storage,
      `?provider=${encodeURIComponent(provider)}`,
    );
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(await response.text(), "");
    assert.ok(storage.reads.every((key) => key === "v1/providers.json"));
  });
}
test("a cold provider cannot reuse another provider's warm core or failure cooldown", async () => {
  const storage = bucket();
  storage.docs.delete("v1/octranspo/live/vehicles.json");
  assert.equal((await fetchKpis(storage, "?provider=octranspo")).status, 503);
  assert.equal((await fetchKpis(storage)).status, 200);
  assert.equal((await fetchKpis(storage, "?provider=octranspo")).status, 503);
});
test("edge entries stay separate across isolate resets", async (t) => {
  const cache = new Map();
  const previous = globalThis.caches;
  t.after(() => {
    if (previous === undefined) delete globalThis.caches;
    else globalThis.caches = previous;
  });
  globalThis.caches = {
    default: {
      match: async (key) => cache.get(key)?.clone(),
      put: async (key, value) => cache.set(key, value),
    },
  };
  const storage = bucket();
  await fetchKpis(storage);
  await fetchKpis(storage, "?provider=octranspo");
  assert.equal(cache.size, 2);
  __resetKpisCachesForTests();
  storage.docs.delete("v1/stm/live/vehicles.json");
  storage.docs.delete("v1/octranspo/live/vehicles.json");
  for (const [provider, expected] of [
    ["stm", 2],
    ["octranspo", 1],
  ]) {
    const response = await fetchKpis(storage, `?provider=${provider}`);
    assert.equal(response.headers.get("x-kpis-cache"), "hit");
    assert.equal((await response.json()).vehicles, expected);
  }
});

for (const missing of [true, false]) {
  test(`catalog ${missing ? "missing" : "malformed"} fails closed for explicit selection`, async () => {
    const storage = bucket();
    if (missing) storage.docs.delete("v1/providers.json");
    else storage.docs.set("v1/providers.json", {});
    assert.equal((await fetchKpis(storage, "?provider=octranspo")).status, 503);
    assert.ok(storage.reads.every((key) => key === "v1/providers.json"));
    assert.equal((await fetchKpis(storage)).status, 200);
  });
}
test("catalog membership is authoritative and refreshed at the live cadence", async (t) => {
  const storage = bucket();
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  assert.equal((await fetchKpis(storage, "?provider=octranspo")).status, 200);
  const reads = storage.reads.length;
  await fetchKpis(storage, "?provider=octranspo");
  assert.equal(storage.reads.length, reads);
  storage.docs.set("v1/providers.json", { providers: [{ id: "stm" }] });
  now += 20_000;
  assert.equal((await fetchKpis(storage, "?provider=octranspo")).status, 404);
});
for (const provider of ["stm", "octranspo"]) {
  test(`${provider} accepts vehicles without trip, stop or occupancy and supports HEAD`, async () => {
    const storage = bucket();
    storage.docs.set(`v1/${provider}/live/vehicles.json`, {
      generated_utc: new Date().toISOString(),
      vehicles: [{ id: "unassigned" }],
    });
    const body = await (
      await fetchKpis(storage, `?provider=${provider}`)
    ).json();
    assert.equal(body.vehicles, 1);
    assert.equal(body.routesLive, 0);
    assert.deepEqual(body.topRoutes, []);
    const head = await fetchKpis(storage, `?provider=${provider}`, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  });
}
