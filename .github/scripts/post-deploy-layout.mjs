import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { liveProductionSha } from "./deploy-scope.mjs";

export async function verifyDeployedSha(sha, fetcher = fetch) {
  if (
    !/^[a-f0-9]{40}$/.test(sha ?? "") ||
    (await liveProductionSha(fetcher)) !== sha
  ) {
    throw new Error(
      "Production Worker does not report the deployed source SHA",
    );
  }
}

export function report(env = process.env, execute = execFileSync) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(env.GH_REPO ?? "") ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") ||
    !/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID ?? "") ||
    !/^[1-9][0-9]{0,9}$/.test(env.GITHUB_RUN_ATTEMPT ?? "")
  )
    throw new Error("Invalid deployment report identity");
  const validVersion =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      env.ROLLBACK_VERSION ?? "",
    );
  const command = `gh workflow run rollback.yml -R ${env.GH_REPO} --ref main${validVersion ? ` -f version=${env.ROLLBACK_VERSION}` : ""}`;
  const slug = `layout-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  const url = `https://github.com/${env.GH_REPO}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`;
  const failed =
    env.DEPLOY_RESULT !== "success" || env.LAYOUT_RESULT !== "success";
  const body = `Deployment verification for SHA ${env.GITHUB_SHA}: ${env.DEPLOY_RESULT ?? "unknown"}.\nFull layout grid: ${env.LAYOUT_RESULT}.\nRun: ${url}, attempt ${env.GITHUB_RUN_ATTEMPT}.\n\nRollback command (${validVersion ? "captured pre-deployment Worker version" : "previous Worker version; captured target unavailable"}):\n\n\`\`\`sh\n${command}\n\`\`\``;
  appendFileSync(env.GITHUB_STEP_SUMMARY, `${body}\n`);
  const helper = fileURLToPath(new URL("./alert-issue.sh", import.meta.url));
  const args = failed
    ? [
        helper,
        "fire",
        slug,
        `Deployment verification failed for ${env.GITHUB_SHA.slice(0, 12)}`,
        body,
      ]
    : [helper, "resolve", slug, body];
  const output = execute("bash", args, { env, encoding: "utf8" });
  const existing = failed && output.match(/issue #(\d+) already open/);
  if (existing)
    execute(
      "gh",
      ["issue", "comment", existing[1], "--repo", env.GH_REPO, "--body", body],
      { env, encoding: "utf8" },
    );
  if (failed)
    throw new Error(
      "Post-deploy verification failed; alert published and rollback command recorded",
    );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  if (process.argv[2] === "verify")
    await verifyDeployedSha(process.env.GITHUB_SHA);
  else if (process.argv[2] === "report") report();
  else throw new Error("Expected verify or report");
}
