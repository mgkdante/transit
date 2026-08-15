import { createServer } from "node:http";

import { createStampAdvancer } from "./recording.mjs";

export function createReplayResponder(recording, { now = Date.now } = {}) {
  const provider = recording?.metadata?.provider;
  if (typeof provider !== "string" || provider.length === 0) {
    throw new Error("E6_REPLAY_PROVIDER_INVALID");
  }
  if (!(recording.payloads instanceof Map))
    throw new Error("E6_REPLAY_PAYLOADS_INVALID");
  const advance = createStampAdvancer({ now });
  const served = {};
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
      const recordedPath =
        alternateVehicleTicks && path === vehiclesPath
          ? vehicleTickPaths[vehicleTickCursor++ % vehicleTickPaths.length]
          : path;
      const recorded = recording.payloads.get(recordedPath);
      if (recorded === undefined) return { status: 404, headers: {}, body: "" };
      const body = `${JSON.stringify(advance(recorded))}\n`;
      served[path] = (served[path] ?? 0) + 1;
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
        body: method === "HEAD" ? "" : body,
      };
    },
    stats: () => ({ served: { ...served } }),
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
