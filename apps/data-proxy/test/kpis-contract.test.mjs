import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import worker from "../src/worker.js";
import {
  __resetKpisCachesForTests,
  LIVE_TTL_SECONDS,
  RETRY_AFTER_S,
  SNAPSHOT_STALE_S,
} from "../src/kpis.js";
import {
  KPI_COLD_RETRY_AFTER,
  KPI_FRESHNESS_LIMIT_S,
  KPI_LIVE_TTL_S,
} from "../../../contracts/kpis-v1.js";

// Byte-identical examples are the handoff to yesid.dev's consumer suite.
const { examples } = JSON.parse(
  await readFile(
    new URL("../../../contracts/kpis-v1.examples.json", import.meta.url),
    "utf8",
  ),
);
for (const example of examples) {
  test(`producer matches shared v1 example: ${example.name}`, async (t) => {
    __resetKpisCachesForTests();
    t.mock.method(Date, "now", () => Date.parse("2026-11-04T12:00:05Z"));
    const body = example.body;
    const routes = body.topRoutes ?? [];
    const docs = {
      "v1/stm/live/vehicles.json": {
        generated_utc: body.snapshotAt,
        vehicles: [
          ...routes.flatMap((r) =>
            Array.from({ length: r.vehicles }, () => ({ route: r.route })),
          ),
          ...(body.vehicles === 10 ? [{ route: null }] : []),
        ],
      },
      "v1/stm/live/trips.json": {
        generated_utc: body.snapshotAt,
        trips: Object.fromEntries([
          ...routes
            .filter((r) => r.avgDelayS !== null)
            .map((r) => [
              r.route,
              { route: r.route, delay_min: r.avgDelayS / 60 },
            ]),
          // One unassigned trip keeps the worked aggregate at 120 seconds.
          [
            "unassigned",
            { route: null, delay_min: example.name === "live" ? 4 : 3 },
          ],
        ]),
      },
      "v1/stm/live/network.json": {
        generated_utc: body.snapshotAt,
        coverage_pct: 97,
      },
      "v1/stm/static/routes_index.json": {
        routes: Array.from({ length: 6 }, (_, i) => ({
          id: String(i),
          type: 3,
        })),
      },
    };
    if (example.name === "no-route-with-delay")
      docs["v1/stm/live/trips.json"].trips = {
        unassigned: { route: null, delay_min: 2 },
      };
    if (example.name === "empty-network")
      docs["v1/stm/live/trips.json"].trips = {};
    if (example.name === "nullable-lanes")
      for (const key of [
        "v1/stm/live/trips.json",
        "v1/stm/live/network.json",
        "v1/stm/static/routes_index.json",
      ])
        delete docs[key];
    if (example.status === 503) delete docs["v1/stm/live/vehicles.json"];
    const response = await worker.fetch(
      new Request("https://transit.yesid.dev/api/v1/kpis"),
      {
        SNAPSHOTS: {
          get: async (key) =>
            docs[key] ? { json: async () => docs[key] } : null,
        },
      },
      { waitUntil() {} },
    );
    assert.equal(response.status, example.status);
    for (const [key, value] of Object.entries(example.headers))
      assert.equal(response.headers.get(key), value);
    assert.deepEqual(await response.json(), body);
  });
}

test("KPI v1 contract timing matches the endpoint's live TTL", () => {
  assert.equal(KPI_LIVE_TTL_S, LIVE_TTL_SECONDS);
  assert.equal(KPI_COLD_RETRY_AFTER, RETRY_AFTER_S);
  assert.equal(KPI_FRESHNESS_LIMIT_S, SNAPSHOT_STALE_S);
});
