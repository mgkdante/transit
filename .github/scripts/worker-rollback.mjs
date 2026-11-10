import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const VERSION =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function runWrangler(args, execute) {
  return execute(
    process.execPath,
    [
      fileURLToPath(
        new URL("../../node_modules/wrangler/bin/wrangler.js", import.meta.url),
      ),
      ...args,
    ],
    {
      cwd: fileURLToPath(new URL("../../apps/web", import.meta.url)),
      encoding: "utf8",
      env: process.env,
    },
  );
}

export function currentWorkerVersion(execute = execFileSync) {
  const deployments = JSON.parse(
    runWrangler(["deployments", "list", "--json"], execute),
  );
  if (
    !Array.isArray(deployments) ||
    deployments.some((item) => !Number.isFinite(Date.parse(item.created_on)))
  ) {
    throw new Error("Cannot identify active production deployment");
  }
  const latest = deployments
    .sort((a, b) => Date.parse(a.created_on) - Date.parse(b.created_on))
    .at(-1);
  if (
    latest?.versions?.length !== 1 ||
    latest.versions[0].percentage !== 100 ||
    !VERSION.test(latest.versions[0].version_id)
  ) {
    throw new Error("Cannot identify one active production Worker version");
  }
  return latest.versions[0].version_id;
}

export function rollback(version = "", execute = execFileSync) {
  if (version && !VERSION.test(version))
    throw new Error("Invalid Worker version ID");
  const output = runWrangler(
    ["rollback", ...(version ? [version] : []), "--yes"],
    execute,
  );
  const actual = output.match(/Current Version ID:\s*([a-f0-9-]+)/i)?.[1];
  if (!VERSION.test(actual ?? "") || (version && actual !== version)) {
    throw new Error("Wrangler did not confirm the requested rollback");
  }
  return actual;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const capture = process.argv[2] === "capture";
  const actual = capture
    ? currentWorkerVersion()
    : rollback(process.env.ROLLBACK_VERSION);
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `${capture ? "Captured rollback target" : "Production web rolled back to Worker version"} \`${actual}\`.\n`,
  );
  appendFileSync(process.env.GITHUB_OUTPUT, `version_id=${actual}\n`);
}
