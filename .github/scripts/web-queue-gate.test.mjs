import assert from "node:assert/strict";
import { test } from "node:test";
import {
  proveQueueGate,
  requireQueueGate,
  REQUIRED_QUEUE_JOBS,
} from "./web-queue-gate.mjs";

const sha = "a".repeat(40);
const seal = "b".repeat(64);
const env = {
  GITHUB_EVENT_NAME: "push",
  GITHUB_REF: "refs/heads/main",
  GITHUB_REPOSITORY: "yesid-dev/transit",
  GITHUB_SHA: sha,
  GITHUB_RUN_ID: "456",
  GITHUB_RUN_ATTEMPT: "1",
};
function fixture() {
  const queue = {
    id: 123,
    workflow_id: 789,
    run_attempt: 1,
    event: "merge_group",
    status: "completed",
    conclusion: "success",
    head_sha: sha,
    path: ".github/workflows/web.yml",
    repository: { full_name: env.GITHUB_REPOSITORY, id: 42 },
  };
  const current = {
    ...queue,
    id: 456,
    event: "push",
    status: "in_progress",
    conclusion: null,
  };
  const jobs = REQUIRED_QUEUE_JOBS.map((name, i) => ({
    id: i + 1,
    run_id: 123,
    run_attempt: 1,
    name,
    status: "completed",
    conclusion: "success",
  }));
  jobs.push({
    id: 99,
    run_id: 123,
    run_attempt: 1,
    name: "layout",
    status: "completed",
    conclusion: "skipped",
  });
  const artifact = {
    id: 321,
    expired: false,
    name: `transit-web-${sha}-production-1-${seal}`,
    workflow_run: {
      id: 123,
      head_sha: sha,
      repository_id: 42,
      head_repository_id: 42,
    },
  };
  const runs = [queue];
  const api = async (path) => {
    if (path === "/actions/runs/456") return current;
    if (path.startsWith("/actions/workflows/789/runs?"))
      return { total_count: runs.length, workflow_runs: runs };
    if (path === "/actions/runs/123") return queue;
    if (path === "/actions/runs/123/attempts/1/jobs?per_page=100")
      return { total_count: jobs.length, jobs };
    if (path === "/actions/runs/123/artifacts?per_page=100")
      return { total_count: 1, artifacts: [artifact] };
    throw Error(`Unexpected API: ${path}`);
  };
  return { queue, current, jobs, artifact, runs, api };
}
test("exact same-workflow green queue proof binds the producer artifact", async () => {
  const proof = await proveQueueGate(env, fixture().api);
  assert.deepEqual(proof, {
    queue_sha: sha,
    queue_repository: env.GITHUB_REPOSITORY,
    artifact_id: "321",
    manifest_sha256: seal,
    producer_attempt: "1",
    producer_run_id: "123",
    workflow_id: "789",
  });
});
test("absent queue and admin bypass use the full gate", async () => {
  const f = fixture();
  f.runs.length = 0;
  assert.equal(await proveQueueGate(env, f.api), null);
});
for (const event of ["pull_request", "merge_group", "workflow_dispatch"])
  test(`${event} cannot reuse a queue gate or call its API`, async () => {
    assert.equal(
      await proveQueueGate({ ...env, GITHUB_EVENT_NAME: event }, () => {
        throw Error("API called");
      }),
      null,
    );
  });
for (const [field, value] of [
  ["head_sha", "c".repeat(40)],
  ["workflow_id", 987],
  ["event", "push"],
  ["conclusion", "failure"],
  ["status", "in_progress"],
  ["run_attempt", 2],
  ["path", ".github/workflows/ci.yml"],
  ["repository", { full_name: "other/transit", id: 42 }],
])
  test(`queue ${field} mismatch falls back`, async () => {
    const f = fixture();
    f.queue[field] = value;
    assert.equal(await proveQueueGate(env, f.api), null);
  });
for (const conclusion of ["failure", "cancelled", "skipped", "timed_out", null])
  test(`required queue job ${conclusion} falls back`, async () => {
    const f = fixture();
    f.jobs[0].conclusion = conclusion;
    assert.equal(await proveQueueGate(env, f.api), null);
  });
test("missing, duplicate, foreign-attempt jobs and unknown skips fall back", async () => {
  for (const mutate of [
    (f) => f.jobs.shift(),
    (f) => f.jobs.push({ ...f.jobs[0] }),
    (f) => (f.jobs[0].run_attempt = 2),
    (f) => (f.jobs.at(-1).name = "new-required-job"),
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(await proveQueueGate(env, f.api), null);
  }
});
test("mixed runs, truncated API pages, API errors and rerun attempts fall back", async () => {
  const f = fixture();
  f.runs.push({ ...f.queue, id: 124, conclusion: "failure" });
  assert.equal(await proveQueueGate(env, f.api), null);
  assert.equal(
    await proveQueueGate(env, async () => {
      throw Error("403");
    }),
    null,
  );
  assert.equal(
    await proveQueueGate(env, async (p) =>
      p.includes("/workflows/")
        ? { total_count: 101, workflow_runs: [fixture().queue] }
        : fixture().api(p),
    ),
    null,
  );
  assert.equal(
    await proveQueueGate({ ...env, GITHUB_RUN_ATTEMPT: "2" }, fixture().api),
    null,
  );
});
test("expired, mismatched and unbound artifacts fall back", async () => {
  for (const mutate of [
    (a) => (a.expired = true),
    (a) => (a.name = a.name.replace(sha, "c".repeat(40))),
    (a) => (a.workflow_run.id = 999),
    (a) => (a.workflow_run.head_repository_id = 999),
    (a) => (a.name += "bad"),
  ]) {
    const f = fixture();
    mutate(f.artifact);
    assert.equal(await proveQueueGate(env, f.api), null);
  }
});

test("a concurrent queue rerun or changed final status cannot issue proof", async () => {
  for (const patch of [
    { run_attempt: 2 },
    { conclusion: "failure" },
    { status: "in_progress" },
  ]) {
    const f = fixture();
    const api = async (path) =>
      path === "/actions/runs/123" ? { ...f.queue, ...patch } : f.api(path);
    assert.equal(await proveQueueGate(env, api), null);
  }
});
test("incomplete jobs/artifacts and duplicate production artifacts cannot issue proof", async () => {
  for (const kind of ["jobs", "artifacts", "duplicate"]) {
    const f = fixture();
    const api = async (path) => {
      const page = await f.api(path);
      if (kind === "jobs" && page.jobs)
        return { ...page, total_count: page.total_count + 1 };
      if (kind === "artifacts" && page.artifacts)
        return { ...page, total_count: 101 };
      if (kind === "duplicate" && page.artifacts)
        return {
          total_count: 2,
          artifacts: [f.artifact, { ...f.artifact, id: 322 }],
        };
      return page;
    };
    assert.equal(await proveQueueGate(env, api), null);
  }
});
test("aggregate accepts only a trusted receipt for main push and rejects any failed dependency", async () => {
  const proof = await proveQueueGate(env, fixture().api);
  const needs = Object.fromEntries(
    ["ci-work", "unit", "e2e", "layout"].map((name) => [
      name,
      { result: "skipped" },
    ]),
  );
  needs["queue-gate"] = {
    result: "success",
    outputs: { queue_proven: "true", ...proof },
  };
  needs.classify = {
    result: "success",
    outputs: { run_e2e: "true", run_layout: "true" },
  };
  needs["prerelease-guard"] = { result: "success" };
  assert.equal(requireQueueGate(env, needs), true);
  for (const event of ["pull_request", "merge_group", "workflow_dispatch"])
    assert.throws(() =>
      requireQueueGate({ ...env, GITHUB_EVENT_NAME: event }, needs),
    );
  for (const name of Object.keys(needs)) {
    const changed = structuredClone(needs);
    changed[name].result = "failure";
    assert.throws(() => requireQueueGate(env, changed));
  }
  for (const field of Object.keys(proof)) {
    const changed = structuredClone(needs);
    delete changed["queue-gate"].outputs[field];
    assert.throws(() => requireQueueGate(env, changed));
  }
  const wrong = structuredClone(needs);
  wrong["queue-gate"].outputs.queue_sha = "c".repeat(40);
  assert.throws(() => requireQueueGate(env, wrong));
});
