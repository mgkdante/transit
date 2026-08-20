import { B2_FLEET_CONTRACT as FLEET } from "./fleet-contract.mjs";

export const E6_WINDOW_MS = 20_000;
export const E6_BUSY_BUDGET_MS = 8;
export const E6_INTERACTION_BUDGET_MS = 200;

const BINDING_PLAN = Object.freeze({
  id: "raw@3424-unthrottled",
  mode: "raw",
  rate: 1,
  fleetVehicles: FLEET.fleetVehicles,
  interactions: 13,
  windowMs: E6_WINDOW_MS,
  busyBudgetMs: E6_BUSY_BUDGET_MS,
  interactionBudgetMs: E6_INTERACTION_BUDGET_MS,
});

function bindingFailure(detail) {
  throw new Error(`E6_BINDING_ARM_REQUIRED ${detail}`);
}

export function buildMeasurementPlan({ env = {}, argv = [] } = {}) {
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== "string"))
    throw new Error("E6_CLI_INVALID");
  const envOverride = Object.keys(env).find(
    (name) =>
      /^(?:E6_MODE|E6_RATE|E6_FLEET_VEHICLES|E6_INTERACTIONS)$/u.test(name) ||
      (/^E6_/u.test(name) && /THROTTL/iu.test(name)),
  );
  const cliOverride = argv.find(
    (argument) =>
      /^--(?:mode|rate|fleet-vehicles|interactions)(?:=|$)/u.test(argument) ||
      /throttl/iu.test(argument),
  );
  if (envOverride || cliOverride)
    bindingFailure(`override=${envOverride ?? cliOverride}`);
  return { ...BINDING_PLAN };
}
