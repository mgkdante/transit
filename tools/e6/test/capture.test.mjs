import assert from "node:assert/strict";
import test from "node:test";

import { buildCapturePlan, captureRecording } from "../lib/capture.mjs";

function routeId(index) {
  return `route-${String(index + 1).padStart(3, "0")}`;
}

function sourceFleet(routeOffset = 0) {
  return Array.from({ length: 856 }, (_, index) => ({
    id: `source-${String(index + 1).padStart(4, "0")}`,
    route: routeId((index + routeOffset) % 182),
  }));
}

function capturePayloads(manifest, routeIds) {
  const generated = "2026-08-17T12:00:00.000Z";
  const payloads = new Map([
    ["manifest.json", manifest],
    ["labels/en.json", { generated_utc: generated, labels: {} }],
    ["live/trips.json", { generated_utc: generated, trips: {} }],
    ["live/stop_departures.json", { generated_utc: generated, stops: {} }],
    ["live/alerts.json", { generated_utc: generated, alerts: [] }],
    ["live/network.json", { generated_utc: generated }],
    [
      "static/routes_index.json",
      { generated_utc: generated, routes: routeIds.map((id) => ({ id })) },
    ],
    ["static/stops_index.json", { generated_utc: generated, stops: [] }],
  ]);
  for (const id of routeIds) {
    payloads.set(`static/routes/${id}.json`, {
      generated_utc: generated,
      id,
      directions: [],
    });
  }
  return payloads;
}

test("derives five live families and one route file per distinct active route", () => {
  const manifest = {
    provider: "stm",
    default_lang: "en",
    labels: { en: "labels/en.json" },
    files: {
      live: {
        generated_utc: "2026-08-17T12:00:00.000Z",
        vehicles: "live/v.json",
      },
      static: {
        routes_index: "static/route-catalogue.json",
        stops_index: "static/stop-catalogue.json",
        routes_prefix: "static/route-files/",
      },
    },
  };
  const vehicles = {
    vehicles: [
      { id: "1", route: "24" },
      { id: "2", route: "24" },
      { id: "3", route: "A/B" },
      { id: "4", route: null },
    ],
  };
  const plan = buildCapturePlan(manifest, vehicles);
  assert.deepEqual(plan.activeRouteIds, ["24", "A/B"]);
  assert.equal(plan.routePrefix, "static/route-files/");
  assert.deepEqual(plan.requiredPaths, [
    "manifest.json",
    "labels/en.json",
    "live/v.json",
    "live/trips.json",
    "live/stop_departures.json",
    "live/alerts.json",
    "live/network.json",
    "static/route-catalogue.json",
    "static/stop-catalogue.json",
    "static/route-files/24.json",
    "static/route-files/A%2FB.json",
  ]);
});

test("captures two manifest-derived ticks and scales each exact deterministic fleet", async () => {
  const generated = "2026-08-17T12:00:00.000Z";
  const routeIds = Array.from({ length: 182 }, (_, index) => routeId(index));
  const manifest = {
    provider: "stm",
    default_lang: "en",
    labels: { en: "labels/en.json" },
    files: {
      live: { generated_utc: generated },
      static: {
        routes_index: "static/routes_index.json",
        stops_index: "static/stops_index.json",
        routes_prefix: "static/routes/",
      },
    },
  };
  const payloads = capturePayloads(manifest, routeIds);
  const sourceTick = { generated_utc: generated, vehicles: sourceFleet() };
  const requested = [];
  let vehicleFetches = 0;
  const recording = await captureRecording({
    sourceBase: "https://data.example/v1",
    provider: "stm",
    fetchFn: async (url) => {
      const path = new URL(url).pathname.replace("/v1/stm/", "");
      requested.push(path);
      const payload =
        path === "live/vehicles.json"
          ? (vehicleFetches += 1) && sourceTick
          : payloads.get(path);
      return payload
        ? new Response(JSON.stringify(payload), { status: 200 })
        : new Response("not found", { status: 404 });
    },
    wait: async () => {},
    now: () => Date.parse("2026-08-17T12:00:02.000Z"),
    captureLabel: "weekday-rush",
  });
  assert.equal(recording.metadata.counts.files, 192);
  assert.equal(recording.metadata.counts.vehicles, 3_424);
  assert.equal(recording.metadata.counts.activeRoutes, 182);
  assert.equal(recording.metadata.benchmarkEligible, true);
  assert.equal(recording.metadata.scale.ticks[0].sourceCount, 856);
  assert.deepEqual(recording.metadata.vehicleTickPaths, [
    "live/vehicles.json",
    "recording/vehicle-tick-1.json",
  ]);
  assert.equal(new Set(requested).size, 191);
  assert.equal(requested.length, 192);
  assert.equal(vehicleFetches, 2);
});

test("captures the second tick after manifest cadence and fetches the route union", async () => {
  const generated = "2026-08-17T12:00:00.000Z";
  const routeIds = Array.from({ length: 183 }, (_, index) => routeId(index));
  const manifest = {
    default_lang: "en",
    labels: { en: "labels/en.json" },
    files: {
      live: { generated_utc: generated, ttl_s: 30 },
      static: { routes_prefix: "static/routes/" },
    },
  };
  const tick0 = { generated_utc: generated, vehicles: sourceFleet(0) };
  const tick1 = {
    generated_utc: generated,
    vehicles: sourceFleet(0).map((vehicle, index) => ({
      ...vehicle,
      route: routeIds[(index % 182) + 1],
    })),
  };
  const payloads = capturePayloads(manifest, routeIds);
  let vehicleFetches = 0;
  const waits = [];
  const recording = await captureRecording({
    sourceBase: "https://data.example/v1",
    fetchFn: async (url) => {
      const path = new URL(url).pathname.replace("/v1/stm/", "");
      const payload =
        path === "live/vehicles.json"
          ? [tick0, tick1][vehicleFetches++]
          : payloads.get(path);
      return new Response(JSON.stringify(payload), { status: 200 });
    },
    wait: async (milliseconds) => waits.push(milliseconds),
    now: () => Date.parse("2026-08-17T12:00:02.000Z"),
    captureLabel: "weekday-rush",
  });
  assert.deepEqual(waits, [35_000]);
  assert.deepEqual(recording.metadata.counts.vehicleTicks, [
    { vehicles: 3_424, activeRoutes: 182 },
    { vehicles: 3_424, activeRoutes: 182 },
  ]);
  assert.equal(recording.metadata.counts.activeRoutes, 183);
  assert.equal(
    recording.payloads.get("recording/vehicle-tick-1.json").vehicles.length,
    3_424,
  );
  assert.equal(vehicleFetches, 2);
});

test("fails closed when any planned family returns a non-success status", async () => {
  const fetchFn = async (url) => {
    if (new URL(url).pathname.endsWith("/manifest.json")) {
      return new Response(
        JSON.stringify({
          provider: "stm",
          labels: { en: "labels/en.json" },
          files: {
            live: { generated_utc: "2026-08-17T12:00:00.000Z" },
            static: {},
          },
        }),
        { status: 200 },
      );
    }
    return new Response("down", { status: 503 });
  };
  await assert.rejects(
    () =>
      captureRecording({
        sourceBase: "https://data.example/v1",
        provider: "stm",
        fetchFn,
        captureLabel: "weekday-rush",
      }),
    /E6_RECORDING_FETCH_FAILED path=live\/vehicles\.json status=503/u,
  );
});
