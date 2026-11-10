// Materialized together with web-build-artifact.mjs from trusted main, never imported from a PR.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifySealed } from "./web-build-artifact.mjs";

export const REQUIRED_QUEUE_JOBS = [
  "classify",
  "prerelease-guard",
  "ci-work",
  "unit",
  "e2e (1)",
  "e2e (2)",
  "e2e (3)",
  "ci",
];
const OPTIONAL_QUEUE_JOBS = new Set([
  "queue-gate",
  "layout",
  "preview",
  "deploy_scope",
  "deploy production",
  "post-deploy-layout",
  "post-deploy-result",
]);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const eligible = (env) =>
  env.GITHUB_EVENT_NAME === "push" &&
  env.GITHUB_REF === "refs/heads/main" &&
  env.GITHUB_REPOSITORY === "yesid-dev/transit" &&
  /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") &&
  /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "") &&
  env.GITHUB_RUN_ATTEMPT === "1";
function complete(page, key) {
  return (
    Number.isSafeInteger(page.total_count) &&
    page.total_count >= 0 &&
    page.total_count <= 100 &&
    Array.isArray(page[key]) &&
    page[key].length === page.total_count
  );
}
function identity(run, env, workflow) {
  return (
    positive(run.id) &&
    run.workflow_id === workflow &&
    positive(workflow) &&
    run.path === ".github/workflows/web.yml" &&
    run.head_sha === env.GITHUB_SHA &&
    run.repository?.full_name === env.GITHUB_REPOSITORY &&
    positive(run.repository?.id) &&
    run.run_attempt === 1
  );
}
function green(run, env, workflow) {
  return (
    identity(run, env, workflow) &&
    run.event === "merge_group" &&
    run.status === "completed" &&
    run.conclusion === "success"
  );
}

export async function proveQueueGate(env, api) {
  if (!eligible(env)) return null;
  try {
    const current = await api(`/actions/runs/${env.GITHUB_RUN_ID}`);
    if (
      !identity(current, env, current.workflow_id) ||
      String(current.id) !== env.GITHUB_RUN_ID ||
      current.event !== "push"
    )
      return null;
    // Include all statuses: a successful older attempt/run must not hide a failure.
    const runs = await api(
      `/actions/workflows/${current.workflow_id}/runs?event=merge_group&head_sha=${env.GITHUB_SHA}&per_page=100`,
    );
    if (!complete(runs, "workflow_runs") || runs.workflow_runs.length !== 1)
      return null;
    const run = runs.workflow_runs[0];
    if (
      !green(run, env, current.workflow_id) ||
      run.repository.id !== current.repository.id
    )
      return null;
    const page = await api(
      `/actions/runs/${run.id}/attempts/1/jobs?per_page=100`,
    );
    if (!complete(page, "jobs")) return null;
    const names = new Set();
    const ids = new Set();
    for (const job of page.jobs) {
      if (
        !positive(job.id) ||
        ids.has(job.id) ||
        names.has(job.name) ||
        job.run_id !== run.id ||
        job.run_attempt !== 1 ||
        job.status !== "completed"
      )
        return null;
      ids.add(job.id);
      names.add(job.name);
      if (
        job.conclusion !== "success" &&
        !(job.conclusion === "skipped" && OPTIONAL_QUEUE_JOBS.has(job.name))
      )
        return null;
      if (
        REQUIRED_QUEUE_JOBS.includes(job.name) &&
        job.conclusion !== "success"
      )
        return null;
    }
    if (REQUIRED_QUEUE_JOBS.some((name) => !names.has(name))) return null;
    const artifacts = await api(
      `/actions/runs/${run.id}/artifacts?per_page=100`,
    );
    if (!complete(artifacts, "artifacts")) return null;
    const prefix = `transit-web-${env.GITHUB_SHA}-production-1-`;
    const matching = artifacts.artifacts.filter(
      (a) => typeof a.name === "string" && a.name.startsWith(prefix),
    );
    if (matching.length !== 1) return null;
    const artifact = matching[0];
    if (
      !positive(artifact.id) ||
      artifact.expired !== false ||
      !/^[a-f0-9]{64}$/.test(artifact.name.slice(prefix.length)) ||
      artifact.workflow_run?.id !== run.id ||
      artifact.workflow_run.head_sha !== env.GITHUB_SHA ||
      artifact.workflow_run.repository_id !== current.repository.id ||
      artifact.workflow_run.head_repository_id !== current.repository.id
    )
      return null;
    // Fence an attempt/status change while reading jobs and artifacts.
    const final = await api(`/actions/runs/${run.id}`);
    if (
      !green(final, env, current.workflow_id) ||
      final.id !== run.id ||
      final.repository.id !== current.repository.id
    )
      return null;
    return {
      queue_sha: env.GITHUB_SHA,
      queue_repository: env.GITHUB_REPOSITORY,
      artifact_id: String(artifact.id),
      manifest_sha256: artifact.name.slice(prefix.length),
      producer_attempt: "1",
      producer_run_id: String(run.id),
      workflow_id: String(current.workflow_id),
    };
  } catch {
    return null;
  }
}

function validReceipt(env, receipt) {
  return (
    eligible(env) &&
    receipt.queue_sha === env.GITHUB_SHA &&
    receipt.queue_repository === env.GITHUB_REPOSITORY &&
    /^[a-f0-9]{64}$/.test(receipt.manifest_sha256 ?? "") &&
    receipt.producer_attempt === "1" &&
    [receipt.artifact_id, receipt.producer_run_id, receipt.workflow_id].every(
      (id) => /^[1-9][0-9]*$/.test(id ?? ""),
    ) &&
    receipt.producer_run_id !== env.GITHUB_RUN_ID
  );
}

export function requireQueueGate(env, needs) {
  const receipt = needs["queue-gate"]?.outputs ?? {};
  if (
    needs["queue-gate"]?.result !== "success" ||
    receipt.queue_proven !== "true" ||
    !validReceipt(env, receipt)
  )
    throw Error("No trusted exact-SHA queue receipt");
  if (
    needs.classify?.result !== "success" ||
    needs.classify.outputs?.run_e2e !== "true" ||
    needs.classify.outputs?.run_layout !== "true"
  )
    throw Error("Invalid main classification");
  if (needs["prerelease-guard"]?.result !== "success")
    throw Error("Prerelease guard did not succeed");
  for (const [name, job] of Object.entries(needs)) {
    if (!["success", "skipped"].includes(job.result))
      throw Error(`${name}: ${job.result}`);
    if (
      job.result === "skipped" &&
      !["ci-work", "unit", "e2e", "layout"].includes(name)
    )
      throw Error(`${name}: skipped outside the proven gate`);
  }
  for (const name of ["ci-work", "unit", "e2e", "layout"])
    if (!["success", "skipped"].includes(needs[name]?.result))
      throw Error(`${name}: missing gate result`);
  return true;
}

export function verifyQueueArtifact(
  env,
  receipt,
  stage,
  verify = verifySealed,
) {
  if (!validReceipt(env, receipt))
    throw Error("Invalid queue artifact receipt");
  verify(stage, {
    root: env.GITHUB_WORKSPACE,
    env: {
      ...env,
      TRANSIT_BUILD_TARGET: "production",
      PUBLIC_SITE_ORIGIN: "https://transit.yesid.dev",
      PUBLIC_V1_BASE: "https://data.yesid.dev/v1",
      PUBLIC_INDEXING: "true",
      TRANSIT_EXPECTED_MANIFEST_SHA256: receipt.manifest_sha256,
      TRANSIT_PRODUCER_ATTEMPT: receipt.producer_attempt,
      TRANSIT_PRODUCER_RUN_ID: receipt.producer_run_id,
    },
  });
  return { queue_proven: "true", ...receipt };
}

export async function main(command, env = process.env, fetcher = fetch) {
  const emit = (outputs) =>
    appendFileSync(
      env.GITHUB_OUTPUT,
      Object.entries(outputs)
        .map(([k, v]) => `${k}=${v}\n`)
        .join(""),
    );
  if (command === "required")
    return requireQueueGate(env, JSON.parse(env.NEEDS_JSON));
  if (command === "prove") {
    const proof = await proveQueueGate(env, async (path) => {
      const response = await fetcher(
        `https://api.github.com/repos/yesid-dev/transit${path}`,
        {
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          headers: {
            Authorization: `Bearer ${env.GH_TOKEN}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      if (!response.ok) throw Error(`Queue evidence API: ${response.status}`);
      return response.json();
    });
    if (proof)
      writeFileSync(env.TRANSIT_QUEUE_RECEIPT, JSON.stringify(proof), {
        flag: "wx",
      });
    emit({ candidate: String(Boolean(proof)), ...proof });
    return;
  }
  if (command === "verify") {
    let outputs = { queue_proven: "false" };
    try {
      outputs = verifyQueueArtifact(
        env,
        JSON.parse(readFileSync(env.TRANSIT_QUEUE_RECEIPT, "utf8")),
        env.TRANSIT_QUEUE_ARTIFACT,
      );
    } catch {
      console.log("Queue artifact unavailable or invalid; using the full gate");
    }
    emit(outputs);
    return;
  }
  throw Error("Usage: web-queue-gate.mjs prove|verify|required");
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
