import {
  B2_BASE_VEHICLES,
  B2_FLEET_VEHICLES,
  B2_IDENTITY_ORDER,
  B2_SCALE_LANES,
  scaleVehicleTick,
} from "./capture.mjs";
import { evaluateCaptureGate } from "./recording.mjs";

const ROUTE_COUNT = 182;
const VEHICLE_TICK_1_PATH = "recording/vehicle-tick-1.json";
const BASE_PATHS = [
  "manifest.json",
  "labels/en.json",
  "live/vehicles.json",
  "live/trips.json",
  "live/stop_departures.json",
  "live/alerts.json",
  "live/network.json",
  "static/routes_index.json",
  "static/stops_index.json",
  VEHICLE_TICK_1_PATH,
];

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function routeId(index) {
  return `e6-${String(index + 1).padStart(3, "0")}`;
}

function routeGeometry(index) {
  const row = Math.floor(index / 14);
  const column = index % 14;
  const lat = 45.405 + row * 0.021;
  const lon = -73.98 + column * 0.043;
  return {
    lat,
    lon,
    coordinates: [
      [lon - 0.018, lat],
      [lon, lat],
      [lon + 0.018, lat],
    ],
  };
}

export function createSyntheticRecording({ now = Date.now } = {}) {
  const nowMs = now();
  if (!Number.isFinite(nowMs)) throw new Error("E6_SYNTHETIC_CLOCK_INVALID");
  const generatedUtc = iso(nowMs - 5_000);
  const reportedUtc = iso(nowMs - 10_000);
  const nextGeneratedUtc = iso(nowMs - 4_000);
  const nextReportedUtc = iso(nowMs - 9_000);
  const etaUtc = iso(nowMs + 5 * 60_000);
  const activeRouteIds = Array.from({ length: ROUTE_COUNT }, (_, index) =>
    routeId(index),
  );
  const routeEntries = activeRouteIds.map((id, index) => ({
    id,
    short: String(index + 1),
    long: `Synthetic peak route ${index + 1}`,
    type: 3,
    color: "009EE0",
    reliability: false,
  }));
  const stops = activeRouteIds.map((id, index) => {
    const geometry = routeGeometry(index);
    return {
      id: `stop-${id}`,
      name: `Synthetic stop ${index + 1}`,
      lat: geometry.lat,
      lon: geometry.lon,
      code: String(10_000 + index),
      mode: "bus",
      routes: [id],
    };
  });
  const sourceVehicles = Array.from(
    { length: B2_BASE_VEHICLES },
    (_, index) => {
      const routeIndex = index % ROUTE_COUNT;
      const id = activeRouteIds[routeIndex];
      const geometry = routeGeometry(routeIndex);
      const offset = ((Math.floor(index / ROUTE_COUNT) - 2) * 0.0025) / 4;
      return {
        id: `vehicle-${String(index + 1).padStart(4, "0")}`,
        lat: geometry.lat,
        lon: geometry.lon + offset,
        status: ["on_time", "late", "early", "severe"][index % 4],
        updated_utc: generatedUtc,
        reported_utc: reportedUtc,
        route: id,
        trip: `trip-${index + 1}`,
        next_stop: `stop-${id}`,
        bearing: 90,
        speed_kmh: 30,
        delay_min: index % 4,
        occupancy: ["empty", "many_seats", "few_seats", "standing"][index % 4],
      };
    },
  );
  const nextSourceVehicles = sourceVehicles.map((vehicle) => ({
    ...vehicle,
    lon: vehicle.lon + 0.0005,
    updated_utc: nextGeneratedUtc,
    reported_utc: nextReportedUtc,
  }));
  const scaledTicks = [sourceVehicles, nextSourceVehicles].map(
    (vehicles, tick) =>
      scaleVehicleTick(
        {
          generated_utc: tick === 0 ? generatedUtc : nextGeneratedUtc,
          vehicles,
        },
        { tick },
      ),
  );
  const vehicles = scaledTicks[0].payload.vehicles;
  const nextVehicles = scaledTicks[1].payload.vehicles;
  const trips = Object.fromEntries(
    vehicles.map((vehicle) => [
      vehicle.trip,
      {
        status: vehicle.status,
        route: vehicle.route,
        delay_min: vehicle.delay_min,
        stops: [
          {
            stop: vehicle.next_stop,
            eta_utc: etaUtc,
            delay_min: vehicle.delay_min,
          },
        ],
      },
    ]),
  );
  const departures = Object.fromEntries(
    stops.map((stop, index) => [
      stop.id,
      [
        {
          eta_utc: etaUtc,
          route: activeRouteIds[index],
          trip: `trip-${index + 1}`,
          delay_min: index % 4,
        },
      ],
    ]),
  );
  const payloads = new Map([
    [
      "manifest.json",
      {
        provider: "stm",
        display_name: "STM synthetic E6 dry run",
        short_name: "STM",
        city: "Montréal",
        bbox: [-74.05, 45.35, -73.35, 45.72],
        attribution: "Synthetic E6 fixture; not live data",
        dataset_version: "e6-dry-run-1",
        labels: { en: "labels/en.json" },
        files: {
          live: { generated_utc: generatedUtc, ttl_s: 30 },
          static: {
            generated_utc: generatedUtc,
            routes_index: "static/routes_index.json",
            routes_prefix: "static/routes/",
            stops_index: "static/stops_index.json",
            basemap: null,
            ttl_s: 86_400,
          },
        },
        surfaces: ["live_map"],
        capabilities: { live_map: "enabled" },
        basemap: null,
        default_lang: "en",
        tz: "America/Toronto",
      },
    ],
    [
      "labels/en.json",
      {
        generated_utc: generatedUtc,
        labels: {
          on_time: "On time",
          late: "Late",
          early: "Early",
          severe: "Severe delay",
          unknown: "Unknown",
        },
      },
    ],
    ["live/vehicles.json", { generated_utc: generatedUtc, vehicles }],
    [
      VEHICLE_TICK_1_PATH,
      { generated_utc: nextGeneratedUtc, vehicles: nextVehicles },
    ],
    ["live/trips.json", { generated_utc: generatedUtc, trips }],
    [
      "live/stop_departures.json",
      { generated_utc: generatedUtc, stops: departures },
    ],
    ["live/alerts.json", { generated_utc: generatedUtc, alerts: [] }],
    [
      "live/network.json",
      {
        generated_utc: generatedUtc,
        vehicles_in_service: B2_FLEET_VEHICLES,
        on_time_pct: 50,
        status_dist: {
          early: 856,
          on_time: 856,
          late: 856,
          severe: 856,
          unknown: 0,
        },
        delay_p50_min: 1,
        delay_p90_min: 3,
        non_responding: 0,
        feed_freshness_s: 5,
        coverage_pct: 100,
      },
    ],
    [
      "static/routes_index.json",
      { generated_utc: generatedUtc, routes: routeEntries },
    ],
    ["static/stops_index.json", { generated_utc: generatedUtc, stops }],
  ]);
  for (let index = 0; index < ROUTE_COUNT; index += 1) {
    const id = activeRouteIds[index];
    const geometry = routeGeometry(index);
    payloads.set(`static/routes/${id}.json`, {
      generated_utc: generatedUtc,
      id,
      long: `Synthetic peak route ${index + 1}`,
      type: 3,
      directions: [
        {
          dir: 0,
          headsign: `Synthetic terminus ${index + 1}`,
          shape: { type: "LineString", coordinates: geometry.coordinates },
          stops: [
            { id: `stop-${id}`, seq: 1, name: `Synthetic stop ${index + 1}` },
          ],
        },
      ],
    });
  }
  const requiredPaths = [
    ...BASE_PATHS,
    ...activeRouteIds.map((id) => `static/routes/${id}.json`),
  ];
  const capturedUtc = iso(nowMs);
  const captureGate = evaluateCaptureGate({
    sourceKind: "synthetic",
    capturedUtc,
    label: "SYNTHETIC_DRY_RUN_NOT_A_BENCHMARK",
  });
  return {
    metadata: {
      schema: 1,
      kind: "e6-recording",
      sourceKind: "synthetic",
      benchmarkEligible: false,
      label: "SYNTHETIC_DRY_RUN_NOT_A_BENCHMARK",
      purpose: "dry-run",
      provider: "stm",
      capturedUtc,
      captureGate,
      language: "en",
      requiredPaths,
      routePrefix: "static/routes/",
      paths: { vehicles: "live/vehicles.json" },
      vehicleTickPaths: ["live/vehicles.json", VEHICLE_TICK_1_PATH],
      scale: {
        baseVehicles: B2_BASE_VEHICLES,
        lanes: B2_SCALE_LANES,
        fleetVehicles: B2_FLEET_VEHICLES,
        identityOrder: B2_IDENTITY_ORDER,
        ticks: scaledTicks.map(({ audit }) => audit),
      },
      counts: {
        vehicles: B2_FLEET_VEHICLES,
        activeRoutes: ROUTE_COUNT,
        files: payloads.size,
        vehicleTicks: [
          { vehicles: B2_FLEET_VEHICLES, activeRoutes: ROUTE_COUNT },
          { vehicles: B2_FLEET_VEHICLES, activeRoutes: ROUTE_COUNT },
        ],
      },
    },
    payloads,
  };
}
