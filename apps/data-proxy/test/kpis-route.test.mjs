import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/worker.js";

function stamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function makeEnv() {
  const generatedUtc = stamp();
  const documents = new Map([
    [
      "v1/stm/live/vehicles.json",
      { generated_utc: generatedUtc, vehicles: [{ id: "v1", route: "24" }] },
    ],
    [
      "v1/stm/live/trips.json",
      { generated_utc: generatedUtc, trips: { t1: { route: "24", delay_min: 1 } } },
    ],
    ["v1/stm/live/network.json", { generated_utc: generatedUtc, coverage_pct: 80 }],
    ["v1/stm/static/routes_index.json", { routes: [{ route_id: "24", type: 3 }] }],
  ]);

  return {
    SNAPSHOTS: {
      async get(key) {
        const document = documents.get(key);
        return document === undefined ? null : { json: async () => document };
      },
    },
  };
}

test("GET /api/v1/kpis stays routed to the JSON worker contract", async () => {
  const response = await worker.fetch(
    new Request("https://transit.yesid.dev/api/v1/kpis", {
      headers: { Origin: "https://yesid.dev" },
    }),
    makeEnv(),
    { waitUntil() {} },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  const payload = await response.json();
  assert.equal(payload.vehicles, 1);
  assert.equal(payload.routesLive, 1);
  assert.equal(payload.routesTotal, 1);
  assert.deepEqual(payload.topRoutes, [{ route: "24", vehicles: 1, avgDelayS: 60 }]);
});
