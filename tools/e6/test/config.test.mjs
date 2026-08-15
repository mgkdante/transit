import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPreviewPortsFree,
  buildMeasurementPlan,
  parseE6Config,
  parseListeningPorts,
} from "../lib/config.mjs";
import * as config from "../lib/config.mjs";

test("uses the sole raw unthrottled 3,424-vehicle arm by default", () => {
  const plan = buildMeasurementPlan();
  assert.deepEqual(plan, {
    mode: "raw",
    rate: 1,
    fleetVehicles: 3_424,
    interactions: 13,
    windowMs: 20_000,
    busyBudgetMs: 8,
    interactionBudgetMs: 200,
    arms: [
      {
        id: "raw@3424-unthrottled",
        mode: "raw",
        rate: 1,
        fleetVehicles: 3_424,
      },
    ],
  });
});

test("rejects the binding arm when it is unscored", () => {
  const plan = buildMeasurementPlan();
  assert.throws(
    () => config.assertAllArmsScored(plan, []),
    /E6_ARMS_UNSCORED raw@3424-unthrottled/u,
  );
  assert.equal(
    config.assertAllArmsScored(
      plan,
      plan.arms.map(({ id }) => ({ id, scored: true })),
    ),
    true,
  );
});

test("accepts explicit binding values and a custom trusted-action count", () => {
  const config = parseE6Config({
    env: { E6_MODE: "raw", E6_RATE: "1", E6_INTERACTIONS: "9" },
    argv: [
      "--mode=raw",
      "--rate",
      "1",
      "--fleet-vehicles=3424",
      "--interactions=17",
    ],
  });
  assert.deepEqual(config, {
    mode: "raw",
    rate: 1,
    fleetVehicles: 3_424,
    interactions: 17,
    windowMs: 20_000,
    busyBudgetMs: 8,
    interactionBudgetMs: 200,
  });
});

test("rejects smooth, throttled, wrong-fleet, and hidden throttle inputs", () => {
  for (const options of [
    { env: { E6_MODE: "smooth" } },
    { env: { E6_RATE: "2" } },
    { env: { E6_FLEET_VEHICLES: "856" } },
    { env: { E6_CPU_THROTTLE_RATE: "1" } },
  ]) {
    assert.throws(
      () => buildMeasurementPlan(options),
      /E6_BINDING_ARM_REQUIRED/u,
    );
  }
});

test("rejects invalid mode, rate, and interaction inputs before a run begins", () => {
  assert.throws(
    () => parseE6Config({ env: { E6_MODE: "fast" } }),
    /E6_BINDING_ARM_REQUIRED/u,
  );
  assert.throws(
    () => parseE6Config({ env: { E6_RATE: "Infinity" } }),
    /E6_BINDING_ARM_REQUIRED/u,
  );
  assert.throws(
    () => parseE6Config({ env: { E6_INTERACTIONS: "0" } }),
    /E6_INTERACTIONS_INVALID/u,
  );
});

test("parses preview listeners and fails closed for the guarded port range", () => {
  const ports = parseListeningPorts(`
LISTEN 0      511        127.0.0.1:4217       0.0.0.0:*    users:(("node",pid=12,fd=21))
node 44 runner  22u  IPv6 0x0  TCP *:4221 (LISTEN)
`);
  assert.deepEqual(ports, [4217, 4221]);
  assert.throws(
    () => assertPreviewPortsFree(ports),
    /E6_PREVIEW_PORTS_BUSY 4217,4221/u,
  );
  assert.doesNotThrow(() => assertPreviewPortsFree([4216, 4224]));
});
