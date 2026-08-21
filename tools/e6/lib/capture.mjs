import {
  B2_FLEET_CONTRACT as FLEET,
  codePointCompare,
} from "./fleet-contract.mjs";
import {
  E6_PROVIDER,
  E6_SOURCE_BASE,
  evaluateCaptureGate,
  validateRecordingSnapshot,
} from "./recording.mjs";
import {
  assertAttempt,
  attemptMarkerDigest as digestAttempt,
} from "./attempt.mjs";

const LIVE_DEFAULTS = {
  vehicles: "live/vehicles.json",
  trips: "live/trips.json",
  stop_departures: "live/stop_departures.json",
  alerts: "live/alerts.json",
  network: "live/network.json",
};
const VEHICLE_TICK_1_PATH = "recording/vehicle-tick-1.json";

export function scaleVehicleTick(payload, { tick } = {}) {
  if (!Array.isArray(payload?.vehicles)) {
    throw new Error(`E6_SOURCE_FLEET_INVALID tick=${String(tick)}`);
  }
  const byIdentity = new Map();
  for (const vehicle of payload.vehicles) {
    const identity = vehicle?.id;
    if (typeof identity !== "string" || identity.trim().length === 0) {
      throw new Error(`E6_SOURCE_IDENTITY_INVALID tick=${String(tick)}`);
    }
    if (byIdentity.has(identity)) {
      throw new Error(
        `E6_SOURCE_IDENTITY_DUPLICATE tick=${String(tick)} id=${identity}`,
      );
    }
    byIdentity.set(identity, vehicle);
  }
  if (byIdentity.size < FLEET.baseVehicles) {
    throw new Error(
      `E6_SOURCE_FLEET_TOO_THIN distinct=${byIdentity.size} minimum=${FLEET.baseVehicles}`,
    );
  }
  const sourceIdentities = [...byIdentity.keys()].sort(codePointCompare);
  const selectedBaseIdentities = sourceIdentities.slice(0, FLEET.baseVehicles);
  const vehicles = selectedBaseIdentities.flatMap((sourceIdentity) =>
    Array.from({ length: FLEET.scaleLanes }, (_, scaleLane) => ({
      ...byIdentity.get(sourceIdentity),
      id: `${sourceIdentity}::b2-lane-${scaleLane + 1}`,
      source_identity: sourceIdentity,
      scale_lane: scaleLane,
    })),
  );
  if (
    vehicles.length !== FLEET.fleetVehicles ||
    new Set(vehicles.map(({ id }) => id)).size !== FLEET.fleetVehicles
  ) {
    throw new Error(`E6_FLEET_SCALE_COLLISION tick=${String(tick)}`);
  }
  return {
    payload: { ...payload, vehicles },
    audit: {
      tick,
      sourceCount: byIdentity.size,
      sourceIdentities,
      selectedBaseIdentities,
      identityOrder: FLEET.identityOrder,
      baseVehicles: FLEET.baseVehicles,
      lanes: FLEET.scaleLanes,
      fleetVehicles: FLEET.fleetVehicles,
    },
  };
}

function relativePointer(value, fallback) {
  const pointer =
    typeof value === "string" && value.length > 0 ? value : fallback;
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(pointer) || pointer.startsWith("/")) {
    throw new Error(`E6_RECORDING_UNREPLAYABLE absolute pointer ${pointer}`);
  }
  return pointer;
}

function prefixPointer(value, fallback) {
  const pointer = relativePointer(value, fallback);
  return pointer.endsWith("/") ? pointer : `${pointer}/`;
}

function activeRouteIdsFor(vehiclesPayload) {
  if (!Array.isArray(vehiclesPayload?.vehicles)) {
    throw new Error("E6_RECORDING_SOURCE_INVALID manifest or vehicles payload");
  }
  return [
    ...new Set(
      vehiclesPayload.vehicles
        .map((vehicle) => vehicle?.route)
        .filter((id) => typeof id === "string" && id.length > 0),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

export function buildCapturePlan(manifest, ...vehiclePayloads) {
  if (!manifest?.files?.live || vehiclePayloads.length === 0) {
    throw new Error("E6_RECORDING_SOURCE_INVALID manifest or vehicles payload");
  }
  const live = manifest.files.live;
  const staticFiles = manifest.files.static ?? {};
  const language = manifest.default_lang || "en";
  const labelPath = relativePointer(
    manifest.labels?.[language],
    `labels/${language}.json`,
  );
  const routePrefix = prefixPointer(
    staticFiles.routes_prefix,
    "static/routes/",
  );
  const paths = {
    labels: labelPath,
    vehicles: relativePointer(live.vehicles, LIVE_DEFAULTS.vehicles),
    trips: relativePointer(live.trips, LIVE_DEFAULTS.trips),
    stopDepartures: relativePointer(
      live.stop_departures,
      LIVE_DEFAULTS.stop_departures,
    ),
    alerts: relativePointer(live.alerts, LIVE_DEFAULTS.alerts),
    network: relativePointer(live.network, LIVE_DEFAULTS.network),
    routesIndex: relativePointer(
      staticFiles.routes_index,
      "static/routes_index.json",
    ),
    stopsIndex: relativePointer(
      staticFiles.stops_index,
      "static/stops_index.json",
    ),
  };
  const vehicleTicks = vehiclePayloads.map((payload) => ({
    vehicles: payload.vehicles.length,
    activeRoutes: activeRouteIdsFor(payload).length,
  }));
  const activeRouteIds = [
    ...new Set(
      vehiclePayloads.flatMap((payload) => activeRouteIdsFor(payload)),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const requiredPaths = [
    "manifest.json",
    paths.labels,
    paths.vehicles,
    paths.trips,
    paths.stopDepartures,
    paths.alerts,
    paths.network,
    paths.routesIndex,
    paths.stopsIndex,
    ...activeRouteIds.map(
      (id) => `${routePrefix}${encodeURIComponent(id)}.json`,
    ),
  ];
  return {
    language,
    routePrefix,
    activeRouteIds,
    requiredPaths,
    paths,
    vehicleTicks,
  };
}

function sourceUrl(sourceBase, provider, path) {
  const base = sourceBase.endsWith("/") ? sourceBase : `${sourceBase}/`;
  return new URL(`${encodeURIComponent(provider)}/${path}`, base).href;
}

async function fetchJson(fetchFn, url, path) {
  let response;
  try {
    response = await fetchFn(url, { headers: { accept: "application/json" } });
  } catch (error) {
    throw new Error(
      `E6_RECORDING_FETCH_FAILED path=${path} error=${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `E6_RECORDING_FETCH_FAILED path=${path} status=${response.status}`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`E6_RECORDING_FETCH_INVALID_JSON path=${path}`);
  }
}

async function fetchPaths(paths, limit, work) {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, paths.length) },
    async () => {
      while (cursor < paths.length) {
        const index = cursor;
        cursor += 1;
        await work(paths[index]);
      }
    },
  );
  await Promise.all(workers);
}

export function captureIntervalMs(manifest) {
  const ttlSeconds = manifest?.files?.live?.ttl_s;
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("E6_RECORDING_TTL_INVALID");
  }
  return (Math.max(ttlSeconds, 30) + 5) * 1000;
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function captureRecording({
  sourceBase = E6_SOURCE_BASE,
  provider = E6_PROVIDER,
  fetchFn = fetch,
  now = Date.now,
  wait = defaultWait,
  concurrency = 8,
  captureLabel,
  attempt,
  attemptMarkerDigest,
}) {
  if (typeof sourceBase !== "string" || !/^https?:\/\//iu.test(sourceBase)) {
    throw new Error("E6_RECORDING_SOURCE_BASE_INVALID");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new Error("E6_RECORDING_CONCURRENCY_INVALID");
  }
  if (typeof wait !== "function") throw new Error("E6_RECORDING_WAIT_INVALID");
  try {
    assertAttempt(attempt);
  } catch {
    throw new Error("E6_ATTEMPT_METADATA_INVALID");
  }
  if (
    attemptMarkerDigest !== digestAttempt(attempt) ||
    sourceBase.replace(/\/+$/u, "") !== E6_SOURCE_BASE ||
    provider !== E6_PROVIDER ||
    captureLabel !== "weekday-rush"
  ) {
    throw new Error("E6_ATTEMPT_METADATA_INVALID");
  }
  const manifest = await fetchJson(
    fetchFn,
    sourceUrl(sourceBase, provider, "manifest.json"),
    "manifest.json",
  );
  const vehiclesPath = relativePointer(
    manifest?.files?.live?.vehicles,
    LIVE_DEFAULTS.vehicles,
  );
  const vehicleTick0 = await fetchJson(
    fetchFn,
    sourceUrl(sourceBase, provider, vehiclesPath),
    vehiclesPath,
  );
  await wait(captureIntervalMs(manifest));
  const vehicleTick1 = await fetchJson(
    fetchFn,
    sourceUrl(sourceBase, provider, vehiclesPath),
    vehiclesPath,
  );
  const plan = buildCapturePlan(manifest, vehicleTick0, vehicleTick1);
  const scaledTicks = [vehicleTick0, vehicleTick1].map((payload, tick) =>
    scaleVehicleTick(payload, { tick }),
  );
  const requiredPaths = [...plan.requiredPaths, VEHICLE_TICK_1_PATH];
  const payloads = new Map([
    ["manifest.json", manifest],
    [vehiclesPath, scaledTicks[0].payload],
    [VEHICLE_TICK_1_PATH, scaledTicks[1].payload],
  ]);
  const remaining = requiredPaths.filter((path) => !payloads.has(path));
  await fetchPaths(remaining, concurrency, async (path) => {
    payloads.set(
      path,
      await fetchJson(fetchFn, sourceUrl(sourceBase, provider, path), path),
    );
  });
  const capturedUtc = new Date(now()).toISOString();
  const captureGate = evaluateCaptureGate({
    sourceKind: "live",
    capturedUtc,
    label: captureLabel,
  });
  const selectedRouteCounts = scaledTicks.map(
    ({ payload }) => activeRouteIdsFor(payload).length,
  );
  const metadata = {
    schema: 1,
    kind: "e6-recording",
    sourceKind: "live",
    benchmarkEligible: captureGate.eligible,
    label: captureLabel ?? "unlabeled-live-capture",
    sourceBase: sourceBase.replace(/\/+$/u, ""),
    provider,
    capturedUtc,
    captureGate,
    attempt,
    attemptMarkerDigest,
    language: plan.language,
    requiredPaths,
    routePrefix: plan.routePrefix,
    paths: plan.paths,
    vehicleTickPaths: [vehiclesPath, VEHICLE_TICK_1_PATH],
    scale: {
      baseVehicles: FLEET.baseVehicles,
      lanes: FLEET.scaleLanes,
      fleetVehicles: FLEET.fleetVehicles,
      identityOrder: FLEET.identityOrder,
      ticks: scaledTicks.map(({ audit }) => audit),
    },
    counts: {
      vehicles: FLEET.fleetVehicles,
      activeRoutes: new Set(
        scaledTicks.flatMap(({ payload }) => activeRouteIdsFor(payload)),
      ).size,
      files: payloads.size,
      vehicleTicks: selectedRouteCounts.map((activeRoutes) => ({
        vehicles: FLEET.fleetVehicles,
        activeRoutes,
      })),
    },
  };
  const recording = { metadata, payloads };
  validateRecordingSnapshot(recording, { purpose: "capture" });
  return recording;
}
