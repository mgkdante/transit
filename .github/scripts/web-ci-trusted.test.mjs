import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workflow = readFileSync(new URL("../workflows/web.yml", import.meta.url), "utf8");
const nodePin = readFileSync(new URL("../../.nvmrc", import.meta.url), "utf8");
function workflowRun(name) {
  const step = workflow.split(`      - name: ${name}\n`)[1];
  assert.ok(step, `Missing workflow runner: ${name}`);
  const block = step.split("        run: |\n")[1]?.split(/\n(?=\S| {1,8}\S)/)[0];
  assert.ok(block, `Missing inline runner: ${name}`);
  return block.split("\n").map((line) => line.slice(10)).join("\n");
}
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "transit-trusted-policy-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "checkout");
  mkdirSync(join(root, ".github/scripts"), { recursive: true });
  const git = (...args) => execFileSync("git", ["-c", "core.hooksPath=", "-c", "commit.gpgsign=false", "-c", "user.name=Policy test", "-c", "user.email=policy@example.invalid", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--quiet", "--initial-branch=main");
  // Use today's policy interface, including for bootstrapping the new workflow.
  writeFileSync(join(root, ".github/scripts/web-ci-paths.mjs"), execFileSync("git", ["show", "HEAD:.github/scripts/web-ci-paths.mjs"]));
  writeFileSync(join(root, ".nvmrc"), nodePin);
  writeFileSync(join(root, "README.md"), "base\n");
  git("add", "--", ".github/scripts/web-ci-paths.mjs", ".nvmrc", "README.md");
  git("commit", "--quiet", "-m", "Base policy");
  const base = git("rev-parse", "HEAD");
  git("remote", "add", "origin", root);
  git("checkout", "--quiet", "-b", "topic");
  const event = join(directory, "event.json");
  const env = { ...process.env, RUNNER_TEMP: directory, GITHUB_WORKSPACE: root, GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event, GITHUB_ENV: join(directory, "env"), GITHUB_OUTPUT: join(directory, "output") };
  const run = (name, extra = {}) => {
    const script = join(directory, "step.ps1");
    writeFileSync(script, workflowRun(name));
    return spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", script], { cwd: root, env: { ...env, ...extra }, encoding: "utf8" });
  };
  const setEvent = (baseSha = base) => writeFileSync(event, JSON.stringify({ pull_request: { base: { sha: baseSha }, head: { sha: git("rev-parse", "HEAD") } } }));
  return { directory, root, git, base, env, run, setEvent };
}

test("workflow executes the base classifier despite a forged head policy", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, ".github/scripts/web-ci-paths.mjs"), 'import { appendFileSync } from "node:fs"; appendFileSync(process.env.GITHUB_OUTPUT, "run_e2e=false\\n");\n');
  f.git("add", "--", ".github/scripts/web-ci-paths.mjs");
  f.git("commit", "--quiet", "-m", "Forged classifier");
  f.setEvent();
  const materialized = f.run("Materialize trusted web policy");
  assert.equal(materialized.status, 0, materialized.stderr + materialized.stdout);
  const policy = readFileSync(f.env.GITHUB_ENV, "utf8").trim().split("WEB_CI_POLICY=")[1];
  assert.ok(!policy.startsWith(f.root));
  assert.equal(readFileSync(join(policy, ".nvmrc"), "utf8").trim(), nodePin.trim());
  const result = f.run("Classify web paths", { WEB_CI_POLICY: policy });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(readFileSync(f.env.GITHUB_OUTPUT, "utf8"), "run_e2e=true\n");
  const needs = { classify: { result: "success", outputs: { run_e2e: "true" } }, "prerelease-guard": { result: "success" }, "ci-work": { result: "success" }, unit: { result: "success" }, e2e: { result: "success" }, layout: { result: "success" } };
  for (const result of ["success", "failure", "cancelled"]) {
    const aggregate = f.run("Require selected jobs to succeed", { WEB_CI_POLICY: policy, NEEDS_JSON: JSON.stringify({ ...needs, extra: { result } }) });
    assert.equal(aggregate.status === 0, result === "success", aggregate.stderr + aggregate.stdout);
  }
});

test("workflow rejects a base outside origin/main", (t) => {
  const f = fixture(t);
  f.git("commit", "--quiet", "--allow-empty", "-m", "Untrusted base");
  f.setEvent(f.git("rev-parse", "HEAD"));
  const result = f.run("Materialize trusted web policy");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not reachable from origin\/main/);
});

test("push and dispatch select everything without executing checkout policy", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, ".github/scripts/web-ci-paths.mjs"), 'throw new Error("Untrusted policy executed");');
  for (const event of ["push", "workflow_dispatch"]) {
    writeFileSync(f.env.GITHUB_OUTPUT, "");
    const result = f.run("Classify web paths", { GITHUB_EVENT_NAME: event, WEB_CI_POLICY: f.root });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(readFileSync(f.env.GITHUB_OUTPUT, "utf8"), "run_e2e=true\n");
  }
});
