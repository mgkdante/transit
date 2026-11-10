import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const VERSION =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function rollback(version = "", execute = execFileSync) {
  if (version && !VERSION.test(version))
    throw new Error("Invalid Worker version ID");
  const output = execute(
    process.execPath,
    [
      fileURLToPath(
        new URL("../../node_modules/wrangler/bin/wrangler.js", import.meta.url),
      ),
      "rollback",
      ...(version ? [version] : []),
      "--yes",
    ],
    {
      cwd: fileURLToPath(new URL("../../apps/web", import.meta.url)),
      encoding: "utf8",
      env: process.env,
    },
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
  const actual = rollback(process.env.ROLLBACK_VERSION);
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `Production web rolled back to Worker version \`${actual}\`.\n`,
  );
  appendFileSync(process.env.GITHUB_OUTPUT, `version_id=${actual}\n`);
}
