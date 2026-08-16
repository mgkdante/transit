import { B2_FLEET_CONTRACT as FLEET } from "./fleet-contract.mjs";

const BINDING_MODE = "raw";
const BINDING_RATE = 1;
const DEFAULT_INTERACTIONS = 13;
const E6_WINDOW_MS = 20_000;
const E6_BUSY_BUDGET_MS = 8;
const E6_INTERACTION_BUDGET_MS = 200;

export const DEFAULT_E6_ARMS = Object.freeze([
  Object.freeze({
    id: "raw@3424-unthrottled",
    mode: BINDING_MODE,
    rate: BINDING_RATE,
    fleetVehicles: FLEET.fleetVehicles,
  }),
]);

function bindingFailure(detail) {
  throw new Error(`E6_BINDING_ARM_REQUIRED ${detail}`);
}

function optionValues(argv) {
  if (!Array.isArray(argv)) throw new Error("E6_CLI_INVALID");
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (typeof argument !== "string") throw new Error("E6_CLI_INVALID");
    if (/throttl/iu.test(argument)) bindingFailure(`hidden=${argument}`);
    const match = /^--(mode|rate|fleet-vehicles|interactions)(?:=(.*))?$/u.exec(
      argument,
    );
    if (!match) continue;
    const [, name, inline] = match;
    const value = inline === undefined ? argv[index + 1] : inline;
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`E6_CLI_INVALID --${name}`);
    }
    if (inline === undefined) index += 1;
    values[name] = value;
  }
  return values;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    !Number.isInteger(number) ||
    number <= 0
  ) {
    throw new Error(`${name} ${String(value)}`);
  }
  return number;
}

function assertNoHiddenThrottle(env) {
  const hidden = Object.keys(env ?? {}).find(
    (name) => /^E6_/u.test(name) && /THROTTL/iu.test(name),
  );
  if (hidden) bindingFailure(`hidden=${hidden}`);
}

export function parseE6Config({ env = {}, argv = [] } = {}) {
  assertNoHiddenThrottle(env);
  const cli = optionValues(argv);
  const mode = cli.mode ?? env.E6_MODE ?? BINDING_MODE;
  const rate = Number(cli.rate ?? env.E6_RATE ?? BINDING_RATE);
  const fleetVehicles = Number(
    cli["fleet-vehicles"] ?? env.E6_FLEET_VEHICLES ?? FLEET.fleetVehicles,
  );
  if (
    mode !== BINDING_MODE ||
    rate !== BINDING_RATE ||
    fleetVehicles !== FLEET.fleetVehicles
  ) {
    bindingFailure(
      `mode=${String(mode)} rate=${String(rate)} fleetVehicles=${String(fleetVehicles)}`,
    );
  }
  const interactions = positiveInteger(
    String(cli.interactions ?? env.E6_INTERACTIONS ?? DEFAULT_INTERACTIONS),
    "E6_INTERACTIONS_INVALID",
  );
  return {
    mode,
    rate,
    fleetVehicles,
    interactions,
    windowMs: E6_WINDOW_MS,
    busyBudgetMs: E6_BUSY_BUDGET_MS,
    interactionBudgetMs: E6_INTERACTION_BUDGET_MS,
  };
}

export function buildMeasurementPlan(options = {}) {
  const config = parseE6Config(options);
  return {
    ...config,
    arms: DEFAULT_E6_ARMS.map((arm) => ({ ...arm })),
  };
}

export function assertAllArmsScored(plan, results) {
  if (!Array.isArray(plan?.arms) || !Array.isArray(results)) {
    throw new Error("E6_ARMS_INVALID");
  }
  const scored = new Set(
    results
      .filter((result) => result?.scored === true)
      .map((result) => result.id),
  );
  const missing = plan.arms
    .map((arm) => arm.id)
    .filter((id) => !scored.has(id));
  if (missing.length > 0)
    throw new Error(`E6_ARMS_UNSCORED ${missing.join(",")}`);
  return true;
}
