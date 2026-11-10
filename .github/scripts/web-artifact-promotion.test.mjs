import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, selectPromotion } from "./web-artifact-promotion.mjs";

const env = {
  GITHUB_EVENT_NAME: "push",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_REPOSITORY: "yesid-dev/transit",
};
const seal = "b".repeat(64);
const run = {
  id: 123,
  run_attempt: 2,
  event: "merge_group",
  status: "completed",
  conclusion: "success",
  head_sha: env.GITHUB_SHA,
  repository: { full_name: env.GITHUB_REPOSITORY },
  path: ".github/workflows/web.yml",
};
const artifact = {
  id: 456,
  expired: false,
  name: `transit-web-${env.GITHUB_SHA}-production-2-${seal}`,
};
const api =
  (runs = [run], artifacts = [artifact]) =>
  async (path) =>
    path.startsWith("/actions/workflows/")
      ? { workflow_runs: runs }
      : { artifacts };

test("fallback is the default without a successful same-SHA queue producer", async () => {
  assert.equal(await selectPromotion(env, api([])), null);
  for (const patch of [
    { event: "pull_request" },
    { status: "in_progress" },
    { conclusion: "failure" },
    { head_sha: "c".repeat(40) },
    { repository: { full_name: "other/transit" } },
    { path: ".github/workflows/other.yml" },
  ]) {
    assert.equal(await selectPromotion(env, api([{ ...run, ...patch }])), null);
  }
  for (const event of ["pull_request", "merge_group", "workflow_dispatch"]) {
    assert.equal(
      await selectPromotion({ ...env, GITHUB_EVENT_NAME: event }, () => {
        throw new Error("must not query");
      }),
      null,
    );
  }
});

test("promotion is bound to repository, exact SHA, successful workflow, attempt and manifest seal", async () => {
  assert.deepEqual(await selectPromotion(env, api()), {
    artifact_id: "456",
    run_id: "123",
    producer_attempt: "2",
    manifest_sha256: seal,
  });
  for (const patch of [
    { expired: true },
    { name: artifact.name.replace("-2-", "-1-") },
    { name: artifact.name.replace("-production-", "-verification-") },
    { name: artifact.name.slice(0, -1) },
    { id: 0 },
  ]) {
    assert.equal(
      await selectPromotion(env, api([run], [{ ...artifact, ...patch }])),
      null,
    );
  }
  assert.equal(
    await selectPromotion(
      env,
      api([run], [artifact, { ...artifact, id: 789 }]),
    ),
    null,
  );
});

test("API failure explicitly selects a source build, never an unverified artifact", async () => {
  const directory = mkdtempSync(join(tmpdir(), "transit-promotion-"));
  try {
    const output = join(directory, "output");
    await main(
      { ...env, GITHUB_OUTPUT: output, GH_TOKEN: "test" },
      async () => ({ ok: false, status: 403 }),
    );
    assert.equal(readFileSync(output, "utf8"), "promoted=false\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
