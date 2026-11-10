import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as scope from "./deploy-scope.mjs";
import * as worker from "./worker-rollback.mjs";
import { report } from "./post-deploy-layout.mjs";

const version = "12345678-1234-1234-1234-123456789abc";

test("inside the production lock, a newer deployment cannot be overwritten by an older main run", async () => {
  const root = mkdtempSync(join(tmpdir(), "transit-deploy-order-"));
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "core.hooksPath=",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=Transit test",
        "-c",
        "user.email=test@example.invalid",
        ...args,
      ],
      { cwd: root, encoding: "utf8", stdio: "pipe" },
    ).trim();
  try {
    git("init", "--initial-branch=main");
    mkdirSync(join(root, "apps/web"), { recursive: true });
    writeFileSync(join(root, "apps/web/source.txt"), "A");
    git("add", "apps/web/source.txt");
    git("commit", "-m", "A");
    const a = git("rev-parse", "HEAD");
    writeFileSync(join(root, "apps/web/source.txt"), "B");
    git("commit", "-am", "B");
    const b = git("rev-parse", "HEAD");
    git("remote", "add", "origin", root);
    git("checkout", "--detach", a);
    const env = { TRANSIT_DEPLOY_EVENT: "push", TRANSIT_DEPLOY_AFTER: a };
    const live = async () => ({
      status: 200,
      json: async () => ({ service: "transit-web", commit: b }),
    });
    assert.equal(typeof scope.lockedDeploymentDecision, "function");
    assert.equal(await scope.lockedDeploymentDecision(env, root, live), false);
    git("branch", "-f", "main", a);
    const unavailable = async () => {
      throw new Error("identity unavailable");
    };
    await assert.rejects(
      scope.lockedDeploymentDecision(env, root, unavailable),
      /Cannot read live production SHA/,
    );
    assert.equal(
      await scope.lockedDeploymentDecision(
        { ...env, TRANSIT_DEPLOY_EVENT: "workflow_dispatch" },
        root,
        unavailable,
      ),
      true,
    );
    assert.equal(await scope.lockedDeploymentDecision(env, root, live), false);
    assert.equal(
      await scope.lockedDeploymentDecision(
        { ...env, TRANSIT_DEPLOY_EVENT: "workflow_dispatch" },
        root,
        live,
      ),
      true,
    );
    git("branch", "-f", "main", b);
    git("checkout", "--detach", b);
    const olderLive = async () => ({
      status: 200,
      json: async () => ({ service: "transit-web", commit: a }),
    });
    assert.equal(
      await scope.lockedDeploymentDecision(
        { ...env, TRANSIT_DEPLOY_AFTER: b },
        root,
        olderLive,
      ),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("overlapping grids cannot change another deployment run or attempts alert", () => {
  const root = mkdtempSync(join(tmpdir(), "transit-alert-order-"));
  try {
    const a = {
      GH_REPO: "yesid-dev/transit",
      GITHUB_SHA: "a".repeat(40),
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
      DEPLOY_RESULT: "success",
      LAYOUT_RESULT: "success",
      ROLLBACK_VERSION: version,
      GITHUB_STEP_SUMMARY: join(root, "summary"),
    };
    const b = {
      ...a,
      GITHUB_SHA: "b".repeat(40),
      GITHUB_RUN_ID: "124",
      LAYOUT_RESULT: "failure",
    };
    const calls = [];
    const execute = (_command, args) => {
      calls.push(args);
      return "";
    };
    assert.throws(() => report(b, execute), /alert published/);
    report(a, execute);
    assert.notEqual(calls[0][2], calls[1][2]);
    calls.length = 0;
    report({ ...b, LAYOUT_RESULT: "success" }, execute);
    assert.throws(
      () => report({ ...a, LAYOUT_RESULT: "failure" }, execute),
      /alert published/,
    );
    assert.notEqual(calls[0][2], calls[1][2]);
    calls.length = 0;
    report(a, execute);
    report({ ...a, GITHUB_RUN_ATTEMPT: "2" }, execute);
    assert.notEqual(calls[0][2], calls[1][2]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("successful layout cannot conceal failed smoke after a Worker deployment", () => {
  const root = mkdtempSync(join(tmpdir(), "transit-smoke-alert-"));
  try {
    const env = {
      GH_REPO: "yesid-dev/transit",
      GITHUB_SHA: "a".repeat(40),
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
      DEPLOY_RESULT: "failure",
      LAYOUT_RESULT: "success",
      ROLLBACK_VERSION: version,
      GITHUB_STEP_SUMMARY: join(root, "summary"),
    };
    let action;
    assert.throws(
      () =>
        report(env, (_command, args) => {
          action = args[1];
          return "";
        }),
      /alert published/,
    );
    assert.equal(action, "fire");
    assert.ok(
      readFileSync(env.GITHUB_STEP_SUMMARY, "utf8").includes(
        `-f version=${version}`,
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rollback guidance captures the current 100-percent Worker version before mutation", () => {
  assert.equal(typeof worker.currentWorkerVersion, "function");
  assert.equal(
    worker.currentWorkerVersion((_node, args) => {
      assert.deepEqual(args.slice(1), ["deployments", "list", "--json"]);
      return JSON.stringify([
        {
          created_on: "2026-11-10T05:00:00Z",
          versions: [{ version_id: version, percentage: 100 }],
        },
        {
          created_on: "2026-11-09T05:00:00Z",
          versions: [
            {
              version_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
              percentage: 100,
            },
          ],
        },
      ]);
    }),
    version,
  );
  assert.throws(
    () => worker.currentWorkerVersion(() => JSON.stringify([])),
    /active/,
  );
  assert.throws(
    () =>
      worker.currentWorkerVersion(() =>
        JSON.stringify([
          {
            created_on: "2026-11-10T05:00:00Z",
            versions: [{ version_id: version, percentage: 50 }],
          },
        ]),
      ),
    /active/,
  );
});
