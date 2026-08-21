import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  realpath as readRealpath,
  stat as readStat,
} from "node:fs/promises";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PINS = Object.freeze({
  node: "24.15.0",
  bun: "1.3.11",
  chrome: "148.0.7778.178",
});

function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

function fail(message) {
  throw new Error(message);
}

export function assertCleanBenchmarkEnvironment(
  env = process.env,
  execArgv = process.execArgv,
) {
  const forbidden = [
    "NODE_OPTIONS",
    "NODE_PATH",
    "LD_PRELOAD",
    "BUN_OPTIONS",
    "BUN_CONFIG_PRELOAD",
  ].find((name) => typeof env[name] === "string" && env[name] !== "");
  if (forbidden) fail(`E6_RUNTIME_ENVIRONMENT_INVALID name=${forbidden}`);
  if (!Array.isArray(execArgv) || execArgv.length !== 0) {
    fail(`E6_RUNTIME_ARGUMENT_INVALID argument=${String(execArgv?.[0])}`);
  }
  return env;
}

async function runVersionCommand(executablePath, args) {
  return execFileAsync(executablePath, args, { encoding: "utf8" });
}

async function resolveFromPath(name, env = process.env) {
  for (const directory of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  fail(`E6_RUNTIME_${name.toUpperCase()}_MISSING`);
}

function freezeReceipt(engine, version, executablePath, stats) {
  const binary = Object.freeze({
    device: stats.dev,
    inode: stats.ino,
    sizeBytes: stats.size,
    modifiedMs: stats.mtimeMs,
  });
  return Object.freeze({ engine, version, executablePath, binary });
}

export function assertBenchmarkRuntimeReceipt(runtime) {
  if (!exactKeys(runtime, ["node", "bun", "chrome"]))
    fail("E6_RUNTIME_RECEIPT_INVALID");
  for (const engine of ["node", "bun", "chrome"]) {
    const receipt = runtime[engine];
    const binary = receipt?.binary;
    if (
      !exactKeys(receipt, ["engine", "version", "executablePath", "binary"]) ||
      receipt.engine !== engine ||
      receipt.version !== PINS[engine] ||
      typeof receipt.executablePath !== "string" ||
      !receipt.executablePath.startsWith("/") ||
      !exactKeys(binary, ["device", "inode", "sizeBytes", "modifiedMs"]) ||
      ![binary.device, binary.inode, binary.sizeBytes, binary.modifiedMs].every(
        (value) => Number.isFinite(value) && value >= 0,
      ) ||
      !Number.isSafeInteger(binary.device) ||
      !Number.isSafeInteger(binary.inode) ||
      !Number.isSafeInteger(binary.sizeBytes) ||
      binary.sizeBytes < 1
    ) {
      fail("E6_RUNTIME_RECEIPT_INVALID");
    }
  }
  return runtime;
}

async function readReceipt({
  engine,
  candidatePath,
  expectedOutput,
  version,
  realpath,
  stat,
  runCommand,
}) {
  let executablePath;
  let stats;
  try {
    executablePath = await realpath(candidatePath);
    stats = await stat(executablePath);
  } catch {
    fail(`E6_RUNTIME_${engine.toUpperCase()}_MISSING`);
  }
  if (!stats.isFile()) fail(`E6_RUNTIME_${engine.toUpperCase()}_MISSING`);

  let output;
  try {
    output = await runCommand(executablePath, ["--version"]);
  } catch {
    fail(`E6_RUNTIME_${engine.toUpperCase()}_MISSING`);
  }
  const actual = String(output?.stdout ?? output).trim();
  if (actual !== expectedOutput) {
    fail(
      `E6_RUNTIME_${engine.toUpperCase()}_VERSION_INVALID expected=${expectedOutput} actual=${actual || "missing"}`,
    );
  }
  return freezeReceipt(engine, version, executablePath, stats);
}

export async function preflightBenchmarkRuntime({
  execPath = process.execPath,
  chromeExecutablePath,
  env = process.env,
  resolveExecutable = resolveFromPath,
  realpath = readRealpath,
  stat = readStat,
  runCommand = runVersionCommand,
} = {}) {
  const node = await readReceipt({
    engine: "node",
    candidatePath: execPath,
    expectedOutput: `v${PINS.node}`,
    version: PINS.node,
    realpath,
    stat,
    runCommand,
  });
  let bunCandidate;
  try {
    bunCandidate = await resolveExecutable("bun", env);
  } catch {
    fail("E6_RUNTIME_BUN_MISSING");
  }
  const bun = await readReceipt({
    engine: "bun",
    candidatePath: bunCandidate,
    expectedOutput: PINS.bun,
    version: PINS.bun,
    realpath,
    stat,
    runCommand,
  });
  const chrome = await readReceipt({
    engine: "chrome",
    candidatePath: chromeExecutablePath,
    expectedOutput: `Google Chrome ${PINS.chrome}`,
    version: PINS.chrome,
    realpath,
    stat,
    runCommand,
  });
  return Object.freeze(assertBenchmarkRuntimeReceipt({ node, bun, chrome }));
}

export async function recheckBenchmarkRuntime(before, options) {
  assertBenchmarkRuntimeReceipt(before);
  const after = await preflightBenchmarkRuntime(options);
  for (const engine of ["node", "bun", "chrome"]) {
    if (JSON.stringify(before?.[engine]) !== JSON.stringify(after[engine])) {
      fail(`E6_RUNTIME_CHANGED engine=${engine}`);
    }
  }
  return after;
}

export function assertBrowserRuntimeVersion(actual, runtime) {
  if (actual !== runtime?.chrome?.version) {
    fail("E6_RUNTIME_CHROME_BROWSER_VERSION_INVALID");
  }
  return actual;
}
