import { createServer } from "node:http";

import { createStampAdvancer } from "./recording.mjs";

export function assertReplayVehicleRequests(
  stats,
  vehiclePath,
  before = {},
  expected = 1,
) {
  if (
    typeof vehiclePath !== "string" ||
    vehiclePath.length === 0 ||
    !Number.isSafeInteger(expected) ||
    expected < 0
  ) {
    throw new Error("E6_REPLAY_VEHICLE_REQUEST_INPUT_INVALID");
  }
  const served =
    (stats?.served?.[vehiclePath] ?? 0) - (before?.served?.[vehiclePath] ?? 0);
  if (!Number.isSafeInteger(served) || served !== expected) {
    throw new Error(
      `E6_REPLAY_VEHICLE_REQUEST_COUNT expected=${expected} actual=${served}`,
    );
  }
  return { path: vehiclePath, served };
}

export function assertReplayVehicleTicks(stats, vehicleTickPaths, before = {}) {
  if (
    !Array.isArray(vehicleTickPaths) ||
    vehicleTickPaths.length !== 2 ||
    new Set(vehicleTickPaths).size !== 2
  ) {
    throw new Error("E6_REPLAY_VEHICLE_TICKS_INVALID");
  }
  const vehicleTicks = vehicleTickPaths.map((path) => ({
    path,
    served:
      (stats?.vehicleTicks?.[path] ?? 0) - (before?.vehicleTicks?.[path] ?? 0),
  }));
  if (vehicleTicks.some(({ path, served }) => !path || served !== 1)) {
    throw new Error("E6_REPLAY_VEHICLE_TICKS_INCOMPLETE");
  }
  let vehicleEndpoint;
  try {
    vehicleEndpoint = assertReplayVehicleRequests(
      stats,
      vehicleTickPaths[0],
      before,
      2,
    );
  } catch (error) {
    throw new Error("E6_REPLAY_VEHICLE_TICKS_INCOMPLETE", { cause: error });
  }
  const beforeDeliveryCount = before?.vehicleDeliveries?.length ?? 0;
  const vehicleDeliveries =
    stats?.vehicleDeliveries?.slice(beforeDeliveryCount);
  if (
    !Array.isArray(vehicleDeliveries) ||
    vehicleDeliveries.length !== 2 ||
    new Set(vehicleDeliveries.map(({ recordedPath }) => recordedPath)).size !==
      2 ||
    vehicleDeliveries.some(
      ({ recordedPath, servedGeneratedUtc }) =>
        !vehicleTickPaths.includes(recordedPath) ||
        typeof servedGeneratedUtc !== "string" ||
        !Number.isFinite(Date.parse(servedGeneratedUtc)),
    ) ||
    Date.parse(vehicleDeliveries[1].servedGeneratedUtc) <=
      Date.parse(vehicleDeliveries[0].servedGeneratedUtc)
  ) {
    throw new Error("E6_REPLAY_VEHICLE_TICKS_INCOMPLETE");
  }
  return {
    vehicleEndpoint,
    vehicleTicks,
    vehicleDeliveries: vehicleDeliveries.map((delivery) => ({ ...delivery })),
  };
}

export function createReplayResponder(recording, { now = Date.now } = {}) {
  const provider = recording?.metadata?.provider;
  if (typeof provider !== "string" || provider.length === 0) {
    throw new Error("E6_REPLAY_PROVIDER_INVALID");
  }
  if (!(recording.payloads instanceof Map))
    throw new Error("E6_REPLAY_PAYLOADS_INVALID");
  const advance = createStampAdvancer({ now });
  const served = {};
  const servedVehicleTicks = {};
  const vehicleDeliveries = [];
  const providerPrefix = `/v1/${encodeURIComponent(provider)}/`;
  const vehiclesPath =
    recording.metadata.paths?.vehicles ?? "live/vehicles.json";
  const vehicleTickPaths = recording.metadata.vehicleTickPaths;
  const alternateVehicleTicks =
    Array.isArray(vehicleTickPaths) &&
    vehicleTickPaths.length === 2 &&
    vehicleTickPaths[0] === vehiclesPath &&
    vehicleTickPaths.every(
      (path) => typeof path === "string" && recording.payloads.has(path),
    );
  let vehicleTickCursor = 0;
  return {
    respond({ method, pathname }) {
      if (!["GET", "HEAD"].includes(method)) {
        return { status: 405, headers: { allow: "GET, HEAD" }, body: "" };
      }
      if (!pathname.startsWith(providerPrefix))
        return { status: 404, headers: {}, body: "" };
      const path = pathname.slice(providerPrefix.length);
      const isVehicleEndpoint = alternateVehicleTicks && path === vehiclesPath;
      const recordedPath = isVehicleEndpoint
        ? vehicleTickPaths[vehicleTickCursor % vehicleTickPaths.length]
        : path;
      const payload = recording.payloads.get(recordedPath);
      if (payload === undefined) return { status: 404, headers: {}, body: "" };
      const servedPayload = method === "GET" ? advance(payload) : null;
      const body = servedPayload ? `${JSON.stringify(servedPayload)}\n` : "";
      if (method === "GET") {
        served[path] = (served[path] ?? 0) + 1;
        if (isVehicleEndpoint) {
          vehicleTickCursor += 1;
          servedVehicleTicks[recordedPath] =
            (servedVehicleTicks[recordedPath] ?? 0) + 1;
          vehicleDeliveries.push({
            recordedPath,
            servedGeneratedUtc: servedPayload?.generated_utc,
          });
        }
      }
      return {
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          age: "0",
          "cache-control": "no-store",
          "content-length": String(Buffer.byteLength(body)),
          "content-type": "application/json; charset=utf-8",
          date: new Date(now()).toUTCString(),
        },
        body,
      };
    },
    stats: () => ({
      served: { ...served },
      vehicleTicks: { ...servedVehicleTicks },
      vehicleDeliveries: vehicleDeliveries.map((delivery) => ({ ...delivery })),
    }),
  };
}

export async function startReplayServer(
  recording,
  { host = "127.0.0.1", port = 0, now = Date.now } = {},
) {
  const replay = createReplayResponder(recording, { now });
  const server = createServer((request, response) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? host}`,
    );
    try {
      const result = replay.respond({
        method: request.method ?? "",
        pathname: url.pathname,
      });
      response.writeHead(result.status, result.headers);
      response.end(result.body);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("E6_REPLAY_ADDRESS_INVALID");
  const origin = `http://${host}:${address.port}`;
  return {
    origin,
    baseUrl: `${origin}/v1`,
    port: address.port,
    stats: replay.stats,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
