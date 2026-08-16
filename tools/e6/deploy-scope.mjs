#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const DEPLOYABLE_PATHS = new Set([
  ".bun-version",
  ".github/scripts/materialize-shared-config.mjs",
  ".github/shared-tooling.json",
  "bun.lock",
  "package.json",
  "turbo.json",
]);
const DEPLOYABLE_PREFIXES = [
  ".github/actions/",
  ".github/shared-tooling/",
  "apps/data-proxy/",
  "apps/web/",
  "packages/",
];
const NON_DEPLOYABLE_PATHS = new Set([
  ".github/workflows/web.yml",
  "apps/web/src/tests/shared-tooling-adoption.test.ts",
]);
const NON_DEPLOYABLE_PREFIXES = ["tools/e6/"];

function matches(path, exact, prefixes) {
  return exact.has(path) || prefixes.some((prefix) => path.startsWith(prefix));
}

export function deploymentEligible({ eventName, diffResolved, paths } = {}) {
  if (eventName === "workflow_dispatch") return true;
  if (eventName !== "push" || diffResolved !== true || !Array.isArray(paths)) {
    return true;
  }
  if (paths.length === 0) return true;
  let onlyKnownNonDeployable = true;
  for (const path of paths) {
    if (typeof path !== "string" || path.length === 0) return true;
    if (matches(path, NON_DEPLOYABLE_PATHS, NON_DEPLOYABLE_PREFIXES)) continue;
    if (matches(path, DEPLOYABLE_PATHS, DEPLOYABLE_PREFIXES)) return true;
    onlyKnownNonDeployable = false;
  }
  return !onlyKnownNonDeployable;
}

function resolvePushDiff(before, after) {
  if (
    !/^[a-f\d]{40}$/u.test(before ?? "") ||
    !/^[a-f\d]{40}$/u.test(after ?? "") ||
    /^0+$/u.test(before) ||
    /^0+$/u.test(after)
  ) {
    return { diffResolved: false, paths: [] };
  }
  try {
    const output = execFileSync(
      "git",
      ["diff", "--name-only", "-z", before, after],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    return {
      diffResolved: true,
      paths: output
        .toString("utf8")
        .split("\0")
        .filter((path) => path.length > 0),
    };
  } catch {
    return { diffResolved: false, paths: [] };
  }
}

export function main(env = process.env, stdout = process.stdout) {
  const eventName = env.E6_DEPLOY_EVENT;
  const diff =
    eventName === "workflow_dispatch"
      ? { diffResolved: true, paths: [] }
      : resolvePushDiff(env.E6_DEPLOY_BEFORE, env.E6_DEPLOY_AFTER);
  const deployWeb = deploymentEligible({ eventName, ...diff });
  stdout.write(`deploy_web=${deployWeb ? "true" : "false"}\n`);
  return 0;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  process.exitCode = main();
}
