import assert from "node:assert/strict";
import test from "node:test";

import {
  E6_INTERACTION_BUDGET_MS,
  E6_WINDOW_MS,
  buildMeasurementPlan,
} from "../lib/config.mjs";

test("uses the sole raw unthrottled 3,424-vehicle arm by default", () => {
  const plan = buildMeasurementPlan();
  assert.equal(E6_WINDOW_MS, 20_000);
  assert.equal(E6_INTERACTION_BUDGET_MS, 200);
  assert.equal(plan.windowMs, E6_WINDOW_MS);
  assert.equal(plan.interactionBudgetMs, E6_INTERACTION_BUDGET_MS);
  assert.deepEqual(plan, {
    id: "raw@3424-unthrottled",
    mode: "raw",
    rate: 1,
    fleetVehicles: 3_424,
    interactions: 13,
    windowMs: 20_000,
    busyBudgetMs: 8,
    interactionBudgetMs: 200,
  });
});

test("keeps every binding field fixed instead of exposing an override", () => {
  for (const options of [
    { env: { E6_MODE: "raw" } },
    { env: { E6_RATE: "1" } },
    { env: { E6_FLEET_VEHICLES: "3424" } },
    { env: { E6_INTERACTIONS: "9" } },
    { env: { E6_INTERACTIONS: "13" } },
    { env: { E6_CPU_THROTTLE_RATE: "1" } },
    { argv: ["--mode=raw"] },
    { argv: ["--rate", "1"] },
    { argv: ["--fleet-vehicles=3424"] },
    { argv: ["--interactions=13"] },
    { argv: ["--cpu-throttle", "1"] },
  ]) {
    assert.throws(
      () => buildMeasurementPlan(options),
      /E6_BINDING_ARM_REQUIRED/u,
    );
  }
});
