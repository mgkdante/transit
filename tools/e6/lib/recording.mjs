import {
  B2_FLEET_CONTRACT as FLEET,
  codePointCompare,
} from "./fleet-contract.mjs";
import {
  E6_PROVIDER,
  E6_SOURCE_BASE,
  evaluateCaptureGate,
  isCaptureWindowInstant,
  isIsoInstantString,
  parseIsoInstant,
} from "./capture-gate.mjs";
import { assertAttempt, attemptMarkerDigest } from "./attempt.mjs";

export {
  E6_PROVIDER,
  E6_SOURCE_BASE,
  evaluateCaptureGate,
} from "./capture-gate.mjs";

export const E6_MIN_ACTIVE_ROUTES = 182;

function fail(message) {
  throw new Error(message);
}

function payloadMap(value) {
  if (!(value instanceof Map))
    fail("E6_RECORDING_INVALID payloads must be a Map");
  return value;
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function recordingPath(paths, key, fallback) {
  const path = paths?.[key] ?? fallback;
  if (typeof path !== "string" || path.length === 0) {
    fail(`E6_RECORDING_INVALID ${key} path is required`);
  }
  return path;
}

function assertCaptureMetadata(metadata, purpose) {
  const actual = evaluateCaptureGate({
    sourceKind: metadata.sourceKind,
    capturedUtc: metadata.capturedUtc,
    label: metadata.label,
  });
  if (
    !metadata.captureGate ||
    typeof metadata.captureGate !== "object" ||
    Array.isArray(metadata.captureGate) ||
    Object.keys(metadata.captureGate).length !== Object.keys(actual).length ||
    Object.entries(actual).some(
      ([key, value]) => metadata.captureGate[key] !== value,
    )
  ) {
    fail("E6_CAPTURE_GATE_MISMATCH");
  }
  if (metadata.benchmarkEligible !== actual.eligible) {
    fail("E6_BENCHMARK_ELIGIBILITY_MISMATCH");
  }
  if (purpose === "benchmark" && !actual.eligible) {
    fail(
      `E6_CAPTURE_NOT_ELIGIBLE sourceKind=${String(metadata.sourceKind)} localDate=${actual.localDate} weekday=${actual.weekday} label=${String(metadata.label)}`,
    );
  }
  return actual;
}

function assertAttemptMetadata(metadata) {
  if (metadata.sourceKind !== "live") return null;
  try {
    assertAttempt(metadata.attempt);
  } catch {
    fail("E6_ATTEMPT_METADATA_INVALID");
  }
  if (
    metadata.attemptMarkerDigest !== attemptMarkerDigest(metadata.attempt) ||
    parseIsoInstant(metadata.attempt.consumedUtc) >
      parseIsoInstant(metadata.capturedUtc)
  ) {
    fail("E6_ATTEMPT_METADATA_INVALID");
  }
  return {
    markerDigest: metadata.attemptMarkerDigest,
    consumedUtc: metadata.attempt.consumedUtc,
    head: metadata.attempt.head,
    tree: metadata.attempt.tree,
    recordingBasename: metadata.attempt.recordingBasename,
    runtime: metadata.attempt.runtime,
  };
}

function assertScaleMetadata(metadata, vehicleTicks) {
  const scale = metadata.scale;
  if (
    scale?.baseVehicles !== FLEET.baseVehicles ||
    scale?.lanes !== FLEET.scaleLanes ||
    scale?.fleetVehicles !== FLEET.fleetVehicles ||
    scale?.identityOrder !== FLEET.identityOrder ||
    !Array.isArray(scale?.ticks) ||
    scale.ticks.length !== vehicleTicks.length
  ) {
    fail("E6_SCALE_METADATA_INVALID");
  }
  for (const [index, tick] of vehicleTicks.entries()) {
    const audit = scale.ticks[index];
    if (
      audit?.tick !== index ||
      audit?.baseVehicles !== FLEET.baseVehicles ||
      audit?.lanes !== FLEET.scaleLanes ||
      audit?.fleetVehicles !== FLEET.fleetVehicles ||
      audit?.identityOrder !== FLEET.identityOrder ||
      !Number.isInteger(audit?.sourceCount) ||
      audit.sourceCount < FLEET.baseVehicles ||
      !Array.isArray(audit.sourceIdentities) ||
      audit.sourceIdentities.length !== audit.sourceCount ||
      !Array.isArray(audit.selectedBaseIdentities) ||
      audit.selectedBaseIdentities.length !== FLEET.baseVehicles
    ) {
      fail(`E6_SCALE_METADATA_INVALID tick=${index}`);
    }
    const invalidSource = audit.sourceIdentities.some(
      (identity) =>
        typeof identity !== "string" || identity.trim().length === 0,
    );
    if (
      invalidSource ||
      new Set(audit.sourceIdentities).size !== audit.sourceIdentities.length ||
      JSON.stringify([...audit.sourceIdentities].sort(codePointCompare)) !==
        JSON.stringify(audit.sourceIdentities) ||
      JSON.stringify(audit.sourceIdentities.slice(0, FLEET.baseVehicles)) !==
        JSON.stringify(audit.selectedBaseIdentities)
    ) {
      fail(`E6_SCALE_METADATA_INVALID tick=${index}`);
    }
    const selected = new Set(audit.selectedBaseIdentities);
    const lanesBySource = new Map();
    for (const vehicle of tick.payload.vehicles) {
      const sourceIdentity = vehicle?.source_identity;
      const lane = vehicle?.scale_lane;
      if (
        typeof sourceIdentity !== "string" ||
        !selected.has(sourceIdentity) ||
        !Number.isInteger(lane) ||
        lane < 0 ||
        lane >= FLEET.scaleLanes ||
        vehicle.id !== `${sourceIdentity}::b2-lane-${lane + 1}`
      ) {
        fail(`E6_SCALE_METADATA_INVALID tick=${index}`);
      }
      const lanes = lanesBySource.get(sourceIdentity) ?? new Set();
      lanes.add(lane);
      lanesBySource.set(sourceIdentity, lanes);
    }
    if (
      lanesBySource.size !== FLEET.baseVehicles ||
      [...lanesBySource.values()].some(
        (lanes) => lanes.size !== FLEET.scaleLanes,
      )
    ) {
      fail(`E6_SCALE_METADATA_INVALID tick=${index}`);
    }
  }
  return scale;
}

export function validateRecordingSnapshot(
  recording,
  { purpose = "benchmark", minimumActiveRoutes = E6_MIN_ACTIVE_ROUTES } = {},
) {
  if (
    recording?.metadata?.schema !== 1 ||
    recording?.metadata?.kind !== "e6-recording"
  ) {
    fail("E6_RECORDING_INVALID expected schema=1 kind=e6-recording");
  }
  const { metadata } = recording;
  const payloads = payloadMap(recording.payloads);
  if (!["benchmark", "capture", "dry-run"].includes(purpose))
    fail(`E6_RECORDING_PURPOSE_INVALID ${String(purpose)}`);
  const captureGate = assertCaptureMetadata(metadata, purpose);
  if (
    metadata.sourceKind === "live" &&
    (metadata.sourceBase !== E6_SOURCE_BASE ||
      metadata.provider !== E6_PROVIDER ||
      payloads.get("manifest.json")?.provider !== E6_PROVIDER)
  ) {
    fail("E6_RECORDING_SOURCE_INVALID");
  }
  if (metadata.sourceKind === "live") {
    const ttlSeconds = payloads.get("manifest.json")?.files?.live?.ttl_s;
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      fail("E6_RECORDING_TTL_INVALID");
    }
  }
  const attempt = assertAttemptMetadata(metadata);
  if (
    metadata.benchmarkEligible === true &&
    !isCaptureWindowInstant(
      payloads.get("manifest.json")?.files?.live?.generated_utc,
    )
  ) {
    fail("E6_MANIFEST_CAPTURE_WINDOW_INVALID");
  }

  const paths = metadata.paths ?? {};
  const vehiclesPath = recordingPath(paths, "vehicles", "live/vehicles.json");
  const vehicleTickPaths = metadata.vehicleTickPaths;
  if (
    !Array.isArray(vehicleTickPaths) ||
    vehicleTickPaths.length !== 2 ||
    vehicleTickPaths.some(
      (path) => typeof path !== "string" || path.length === 0,
    ) ||
    vehicleTickPaths[0] !== vehiclesPath ||
    vehicleTickPaths[0] === vehicleTickPaths[1]
  ) {
    fail(
      "E6_RECORDING_INVALID vehicleTickPaths must contain two distinct paths beginning with vehicles",
    );
  }
  const requiredPaths = sortedUnique([
    ...(Array.isArray(metadata.requiredPaths) ? metadata.requiredPaths : []),
    "manifest.json",
    recordingPath(paths, "labels", `labels/${metadata.language ?? "en"}.json`),
    ...vehicleTickPaths,
    vehiclesPath,
    recordingPath(paths, "trips", "live/trips.json"),
    recordingPath(paths, "stopDepartures", "live/stop_departures.json"),
    recordingPath(paths, "alerts", "live/alerts.json"),
    recordingPath(paths, "network", "live/network.json"),
    recordingPath(paths, "routesIndex", "static/routes_index.json"),
    recordingPath(paths, "stopsIndex", "static/stops_index.json"),
  ]);
  const claimedRoutePrefix = metadata.routePrefix;
  const missingRequired = requiredPaths.filter(
    (path) =>
      !payloads.has(path) &&
      !(
        typeof claimedRoutePrefix === "string" &&
        path.startsWith(claimedRoutePrefix)
      ),
  );
  if (missingRequired.length > 0) {
    fail(
      `E6_RECORDING_INCOMPLETE missing required files: ${missingRequired.join(", ")}`,
    );
  }

  let previousGeneratedMs = Number.NEGATIVE_INFINITY;
  const vehicleTicks = vehicleTickPaths.map((path, index) => {
    const payload = payloads.get(path);
    if (!Array.isArray(payload?.vehicles)) {
      fail(`E6_RECORDING_INVALID ${path} has no vehicles array`);
    }
    const generatedUtc = payload.generated_utc;
    const generatedMs = parseIsoInstant(generatedUtc);
    if (!Number.isFinite(generatedMs)) {
      fail(`E6_VEHICLE_TICK_GENERATED_UTC_INVALID tick=${index}`);
    }
    if (generatedMs <= previousGeneratedMs) {
      fail(`E6_VEHICLE_TICK_GENERATED_UTC_NOT_INCREASING tick=${index}`);
    }
    if (
      metadata.benchmarkEligible === true &&
      !isCaptureWindowInstant(generatedUtc)
    ) {
      fail(`E6_VEHICLE_TICK_CAPTURE_WINDOW_INVALID tick=${index}`);
    }
    previousGeneratedMs = generatedMs;
    if (payload.vehicles.length !== FLEET.fleetVehicles) {
      fail(
        `E6_FLEET_COUNT_MISMATCH tick=${index} actual=${payload.vehicles.length} expected=${FLEET.fleetVehicles}`,
      );
    }
    const identities = payload.vehicles.map((vehicle) => vehicle?.id);
    if (
      identities.some(
        (identity) =>
          typeof identity !== "string" || identity.trim().length === 0,
      )
    ) {
      fail(`E6_FLEET_IDENTITY_INVALID tick=${index}`);
    }
    if (new Set(identities).size !== identities.length) {
      fail(`E6_FLEET_IDENTITY_DUPLICATE tick=${index}`);
    }
    const activeRouteIds = sortedUnique(
      payload.vehicles
        .map((vehicle) => vehicle?.route)
        .filter((route) => typeof route === "string" && route.length > 0),
    );
    const tick = {
      payload,
      vehicles: payload.vehicles.length,
      activeRoutes: activeRouteIds.length,
      activeRouteIds,
    };
    if (tick.activeRoutes < minimumActiveRoutes) {
      fail(
        `E6_RECORDING_TOO_THIN activeRoutes=${tick.activeRoutes} minimum=${minimumActiveRoutes}`,
      );
    }
    return tick;
  });
  const scale = assertScaleMetadata(metadata, vehicleTicks);
  const vehicles = vehicleTicks[0].vehicles;
  const activeRouteIds = sortedUnique(
    vehicleTicks.flatMap((tick) => tick.activeRouteIds),
  );
  const activeRoutes = activeRouteIds.length;

  const routePrefix = metadata.routePrefix;
  if (typeof routePrefix !== "string" || routePrefix.length === 0) {
    fail("E6_RECORDING_INVALID routePrefix is required");
  }
  const missingRouteIds = activeRouteIds.filter(
    (id) => !payloads.has(`${routePrefix}${encodeURIComponent(id)}.json`),
  );
  if (missingRouteIds.length > 0) {
    fail(
      `E6_RECORDING_INCOMPLETE missing route files: ${missingRouteIds.join(", ")}`,
    );
  }
  const missingClaimedRouteFiles = requiredPaths.filter(
    (path) => path.startsWith(routePrefix) && !payloads.has(path),
  );
  if (missingClaimedRouteFiles.length > 0) {
    fail(
      `E6_RECORDING_INCOMPLETE missing required files: ${missingClaimedRouteFiles.join(", ")}`,
    );
  }

  const routesIndexPath = recordingPath(
    paths,
    "routesIndex",
    "static/routes_index.json",
  );
  const indexedIds = new Set(
    (payloads.get(routesIndexPath)?.routes ?? [])
      .map((route) => route?.id)
      .filter((id) => typeof id === "string"),
  );
  const absentFromIndex = activeRouteIds.filter((id) => !indexedIds.has(id));
  if (absentFromIndex.length > 0) {
    fail(
      `E6_RECORDING_INCOMPLETE active routes absent from index: ${absentFromIndex.join(", ")}`,
    );
  }

  const files = payloads.size;
  const declared = metadata.counts ?? {};
  const mismatches = [];
  if (declared.vehicles !== vehicles)
    mismatches.push(`vehicles ${declared.vehicles}!=${vehicles}`);
  if (declared.activeRoutes !== activeRoutes) {
    mismatches.push(`activeRoutes ${declared.activeRoutes}!=${activeRoutes}`);
  }
  const declaredTicks = declared.vehicleTicks;
  const actualTicks = vehicleTicks.map(
    ({ vehicles: count, activeRoutes: routes }) => ({
      vehicles: count,
      activeRoutes: routes,
    }),
  );
  if (
    !Array.isArray(declaredTicks) ||
    declaredTicks.length !== actualTicks.length ||
    declaredTicks.some(
      (tick, index) =>
        tick?.vehicles !== actualTicks[index].vehicles ||
        tick?.activeRoutes !== actualTicks[index].activeRoutes,
    )
  ) {
    mismatches.push("vehicleTicks mismatch");
  }
  if (declared.files !== files)
    mismatches.push(`files ${declared.files}!=${files}`);
  if (mismatches.length > 0) {
    fail(`E6_RECORDING_COUNT_MISMATCH ${mismatches.join(" ")}`);
  }

  return {
    sourceKind: metadata.sourceKind,
    benchmarkEligible: metadata.benchmarkEligible,
    vehicles,
    activeRoutes,
    files,
    baseVehicles: FLEET.baseVehicles,
    scaleLanes: FLEET.scaleLanes,
    fleetVehicles: FLEET.fleetVehicles,
    minimumActiveRoutes,
    completeRouteFiles: activeRouteIds.length,
    vehicleTicks: vehicleTicks.length,
    captureGate,
    attempt,
    scale,
  };
}

function anchorIso(payload) {
  if (typeof payload?.generated_utc === "string") {
    if (Number.isFinite(parseIsoInstant(payload.generated_utc)))
      return payload.generated_utc;
    fail("E6_RECORDING_TIMESTAMP_INVALID");
  }
  const liveGenerated = payload?.files?.live?.generated_utc;
  if (typeof liveGenerated === "string") {
    if (Number.isFinite(parseIsoInstant(liveGenerated))) return liveGenerated;
    fail("E6_RECORDING_TIMESTAMP_INVALID");
  }
  fail("E6_RECORDING_TIMESTAMP_MISSING payload has no generated_utc anchor");
}

function shiftIsoValues(value, deltaMs) {
  if (typeof value === "string") {
    if (!isIsoInstantString(value)) return value;
    const instant = parseIsoInstant(value);
    if (!Number.isFinite(instant)) fail("E6_RECORDING_TIMESTAMP_INVALID");
    return new Date(instant + deltaMs).toISOString();
  }
  if (Array.isArray(value))
    return value.map((entry) => shiftIsoValues(entry, deltaMs));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        shiftIsoValues(entry, deltaMs),
      ]),
    );
  }
  return value;
}

export function createStampAdvancer({ now = Date.now } = {}) {
  let lastServeMs = Number.NEGATIVE_INFINITY;
  return (payload) => {
    const wallNow = now();
    if (!Number.isFinite(wallNow)) fail("E6_REPLAY_CLOCK_INVALID");
    const serveMs = Math.max(wallNow, lastServeMs + 1);
    lastServeMs = serveMs;
    const recordedMs = parseIsoInstant(anchorIso(payload));
    return shiftIsoValues(payload, serveMs - recordedMs);
  };
}
