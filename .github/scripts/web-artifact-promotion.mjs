import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function selectPromotion(env, api) {
  if (env.GITHUB_EVENT_NAME !== "push" || env.GITHUB_REF !== "refs/heads/main")
    return null;
  if (
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") ||
    !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? "")
  ) {
    throw new Error("Invalid promotion identity");
  }
  const runs = await api(
    `/actions/workflows/web.yml/runs?event=merge_group&head_sha=${env.GITHUB_SHA}&status=success&per_page=100`,
  );
  for (const run of runs.workflow_runs ?? []) {
    if (
      run.event !== "merge_group" ||
      run.status !== "completed" ||
      run.conclusion !== "success" ||
      run.head_sha !== env.GITHUB_SHA ||
      run.repository?.full_name !== env.GITHUB_REPOSITORY ||
      run.path !== ".github/workflows/web.yml" ||
      !Number.isSafeInteger(run.id) ||
      run.id < 1 ||
      !Number.isSafeInteger(run.run_attempt) ||
      run.run_attempt < 1
    )
      continue;
    const artifacts = await api(
      `/actions/runs/${run.id}/artifacts?per_page=100`,
    );
    const prefix = `transit-web-${env.GITHUB_SHA}-production-${run.run_attempt}-`;
    const matches = (artifacts.artifacts ?? []).filter(
      (artifact) =>
        artifact.expired === false &&
        Number.isSafeInteger(artifact.id) &&
        artifact.id > 0 &&
        typeof artifact.name === "string" &&
        artifact.name.startsWith(prefix) &&
        /^[a-f0-9]{64}$/.test(artifact.name.slice(prefix.length)),
    );
    if (matches.length === 1)
      return {
        artifact_id: String(matches[0].id),
        run_id: String(run.id),
        producer_attempt: String(run.run_attempt),
        manifest_sha256: matches[0].name.slice(prefix.length),
      };
  }
  return null;
}

export async function main(env = process.env, fetcher = fetch) {
  const api = async (path) => {
    const response = await fetcher(
      `https://api.github.com/repos/${env.GITHUB_REPOSITORY}${path}`,
      {
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${env.GH_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!response.ok)
      throw new Error(`Artifact lookup HTTP ${response.status}`);
    return response.json();
  };
  let selected;
  try {
    selected = await selectPromotion(env, api);
  } catch {
    // Lookup failure cannot authorize an artifact. Build the current source instead.
    console.log(
      "No verified queue artifact available; building this source revision.",
    );
  }
  const outputs = { promoted: String(Boolean(selected)), ...selected };
  appendFileSync(
    env.GITHUB_OUTPUT,
    Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
  return outputs;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  await main();
