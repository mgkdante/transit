import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReplayVehicleRequests,
  assertReplayVehicleTicks,
  createReplayResponder,
} from "../lib/replay.mjs";

test("serves recorded payloads with a fresh monotonic stamp on every request", () => {
  const replay = createReplayResponder(
    {
      metadata: { provider: "stm" },
      payloads: new Map([
        [
          "live/vehicles.json",
          {
            generated_utc: "2026-08-08T12:00:00.000Z",
            vehicles: [{ updated_utc: "2026-08-08T11:59:55.000Z" }],
          },
        ],
      ]),
    },
    { now: () => Date.parse("2026-08-10T12:00:00.000Z") },
  );
  const firstResponse = replay.respond({
    method: "GET",
    pathname: "/v1/stm/live/vehicles.json",
  });
  const secondResponse = replay.respond({
    method: "GET",
    pathname: "/v1/stm/live/vehicles.json",
  });
  const first = JSON.parse(firstResponse.body);
  const second = JSON.parse(secondResponse.body);
  assert.equal(firstResponse.status, 200);
  assert.equal(first.generated_utc, "2026-08-10T12:00:00.000Z");
  assert.equal(first.vehicles[0].updated_utc, "2026-08-10T11:59:55.000Z");
  assert.equal(second.generated_utc, "2026-08-10T12:00:00.001Z");
  assert.equal(replay.stats().served["live/vehicles.json"], 2);
});

test("refuses unknown provider paths instead of falling through to live data", () => {
  const replay = createReplayResponder({
    metadata: { provider: "stm" },
    payloads: new Map(),
  });
  const response = replay.respond({
    method: "GET",
    pathname: "/v1/other/live/vehicles.json",
  });
  assert.equal(response.status, 404);
});

test("alternates the two recorded vehicle ticks at the manifest vehicle path", () => {
  const replay = createReplayResponder(
    {
      metadata: {
        provider: "stm",
        paths: { vehicles: "live/vehicles.json" },
        vehicleTickPaths: [
          "live/vehicles.json",
          "recording/vehicle-tick-1.json",
        ],
      },
      payloads: new Map([
        [
          "live/vehicles.json",
          {
            generated_utc: "2026-08-08T12:00:00.000Z",
            vehicles: [{ id: "tick-0" }],
          },
        ],
        [
          "recording/vehicle-tick-1.json",
          {
            generated_utc: "2026-08-08T12:00:30.000Z",
            vehicles: [{ id: "tick-1" }],
          },
        ],
      ]),
    },
    { now: () => Date.parse("2026-08-10T12:00:00.000Z") },
  );
  const first = JSON.parse(
    replay.respond({ method: "GET", pathname: "/v1/stm/live/vehicles.json" })
      .body,
  );
  const second = JSON.parse(
    replay.respond({ method: "GET", pathname: "/v1/stm/live/vehicles.json" })
      .body,
  );
  assert.equal(first.vehicles[0].id, "tick-0");
  assert.equal(second.vehicles[0].id, "tick-1");
  assert.equal(second.generated_utc, "2026-08-10T12:00:00.001Z");
  assert.deepEqual(
    assertReplayVehicleTicks(replay.stats(), [
      "live/vehicles.json",
      "recording/vehicle-tick-1.json",
    ]),
    {
      vehicleEndpoint: { path: "live/vehicles.json", served: 2 },
      vehicleTicks: [
        { path: "live/vehicles.json", served: 1 },
        { path: "recording/vehicle-tick-1.json", served: 1 },
      ],
      vehicleDeliveries: [
        {
          recordedPath: "live/vehicles.json",
          servedGeneratedUtc: "2026-08-10T12:00:00.000Z",
        },
        {
          recordedPath: "recording/vehicle-tick-1.json",
          servedGeneratedUtc: "2026-08-10T12:00:00.001Z",
        },
      ],
    },
  );
});

test("refuses replay evidence unless both recorded vehicle ticks were served", () => {
  assert.throws(
    () =>
      assertReplayVehicleTicks(
        {
          served: { "live/vehicles.json": 1 },
          vehicleTicks: { "live/vehicles.json": 1 },
        },
        ["live/vehicles.json", "recording/vehicle-tick-1.json"],
      ),
    /E6_REPLAY_VEHICLE_TICKS_INCOMPLETE/u,
  );
  assert.throws(
    () =>
      assertReplayVehicleTicks(
        {
          served: { "live/vehicles.json": 4 },
          vehicleTicks: {
            "live/vehicles.json": 2,
            "recording/vehicle-tick-1.json": 2,
          },
        },
        ["live/vehicles.json", "recording/vehicle-tick-1.json"],
        {
          served: { "live/vehicles.json": 3 },
          vehicleTicks: {
            "live/vehicles.json": 2,
            "recording/vehicle-tick-1.json": 1,
          },
        },
      ),
    /E6_REPLAY_VEHICLE_TICKS_INCOMPLETE/u,
  );
});

test("requires exactly one public vehicle request for each refresh and exactly two per arm", () => {
  const before = { served: { "live/vehicles.json": 4 } };
  const afterOne = { served: { "live/vehicles.json": 5 } };
  assert.deepEqual(
    assertReplayVehicleRequests(afterOne, "live/vehicles.json", before, 1),
    { path: "live/vehicles.json", served: 1 },
  );
  assert.deepEqual(
    assertReplayVehicleRequests(before, "live/vehicles.json", before, 0),
    { path: "live/vehicles.json", served: 0 },
  );
  assert.throws(
    () =>
      assertReplayVehicleRequests(
        { served: { "live/vehicles.json": 6 } },
        "live/vehicles.json",
        before,
        1,
      ),
    /E6_REPLAY_VEHICLE_REQUEST_COUNT expected=1 actual=2/u,
  );
  assert.throws(
    () =>
      assertReplayVehicleTicks(
        {
          served: { "live/vehicles.json": 3 },
          vehicleTicks: {
            "live/vehicles.json": 2,
            "recording/vehicle-tick-1.json": 1,
          },
        },
        ["live/vehicles.json", "recording/vehicle-tick-1.json"],
      ),
    /E6_REPLAY_VEHICLE_TICKS_INCOMPLETE/u,
  );
});

test("does not count HEAD or direct tick paths as delivered vehicle ticks", () => {
  const replay = createReplayResponder(
    {
      metadata: {
        provider: "stm",
        paths: { vehicles: "live/vehicles.json" },
        vehicleTickPaths: [
          "live/vehicles.json",
          "recording/vehicle-tick-1.json",
        ],
      },
      payloads: new Map([
        ["live/vehicles.json", { generated_utc: "2026-08-08T12:00:00Z" }],
        [
          "recording/vehicle-tick-1.json",
          { generated_utc: "2026-08-08T12:00:30Z" },
        ],
      ]),
    },
    { now: () => Date.parse("2026-08-10T12:00:00Z") },
  );
  replay.respond({ method: "HEAD", pathname: "/v1/stm/live/vehicles.json" });
  replay.respond({
    method: "GET",
    pathname: "/v1/stm/recording/vehicle-tick-1.json",
  });
  replay.respond({ method: "GET", pathname: "/v1/stm/live/vehicles.json" });
  assert.throws(
    () =>
      assertReplayVehicleTicks(replay.stats(), [
        "live/vehicles.json",
        "recording/vehicle-tick-1.json",
      ]),
    /E6_REPLAY_VEHICLE_TICKS_INCOMPLETE/u,
  );
  assert.deepEqual(replay.stats().vehicleTicks, {
    "live/vehicles.json": 1,
  });
});
