import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { BUILD_INPUTS, BUILD_TREES, restore } from "./web-build-artifact.mjs";
import { verifyQueueArtifact, main } from "./web-queue-gate.mjs";

const workflow = readFileSync(
  new URL("../workflows/web.yml", import.meta.url),
  "utf8",
);
const job = (name) =>
  workflow.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[\w-]+:\n/)[0];
function runner(name, step) {
  return job(name)
    .split(`      - name: ${step}\n`)[1]
    .split("        run: |\n")[1]
    .split(/\n(?=\S| {1,8}\S)/)[0]
    .split("\n")
    .map((line) => line.slice(10))
    .join("\n");
}
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "transit-queue-gate-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "checkout");
  mkdirSync(root);
  const write = (path, bytes) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  };
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "core.hooksPath=",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=Queue test",
        "-c",
        "user.email=queue@example.invalid",
        ...args,
      ],
      { cwd: root, encoding: "utf8", stdio: "pipe" },
    ).trim();
  git("init", "--quiet", "--initial-branch=main");
  for (const p of BUILD_INPUTS) write(p, "{}");
  write(".nvmrc", process.versions.node);
  write(
    ".bun-version",
    readFileSync(new URL("../../.bun-version", import.meta.url)),
  );
  write(
    "package.json",
    readFileSync(new URL("../../package.json", import.meta.url)),
  );
  for (const name of ["web-build-artifact.mjs", "web-queue-gate.mjs"])
    write(
      `.github/scripts/${name}`,
      readFileSync(new URL(`./${name}`, import.meta.url)),
    );
  git("add", "--", ...BUILD_INPUTS, ".github/scripts/web-queue-gate.mjs");
  git("commit", "--quiet", "-m", "Trusted main fixture");
  git("remote", "add", "origin", root);
  const env = {
    ...process.env,
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "yesid-dev/transit",
    GITHUB_SHA: git("rev-parse", "HEAD"),
    GITHUB_RUN_ID: "456",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_WORKSPACE: root,
    GITHUB_OUTPUT: join(directory, "outputs"),
    GITHUB_ENV: join(directory, "environment"),
    RUNNER_TEMP: directory,
  };
  function run(name, step, extra = {}, prefix = "") {
    const script = join(directory, "runner.ps1");
    writeFileSync(script, `${prefix}\n${runner(name, step)}`);
    return spawnSync(
      "pwsh",
      ["-NoProfile", "-NonInteractive", "-File", script],
      { cwd: root, env: { ...env, ...extra }, encoding: "utf8" },
    );
  }
  return { root, directory, write, git, env, run };
}
function receipt(f, seal) {
  return {
    queue_sha: f.env.GITHUB_SHA,
    queue_repository: f.env.GITHUB_REPOSITORY,
    artifact_id: "321",
    manifest_sha256: seal,
    producer_attempt: "1",
    producer_run_id: "123",
    workflow_id: "789",
  };
}
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function sealed(f) {
  const stage = join(f.directory, "artifact");
  const record = (root, path) => {
    const bytes = readFileSync(join(root, path));
    return { path, size: bytes.length, sha256: hash(bytes) };
  };
  const files = BUILD_TREES.map((tree) => {
    const p = `${tree}/entry.js`;
    mkdirSync(dirname(join(stage, p)), { recursive: true });
    writeFileSync(join(stage, p), "sealed build");
    return record(stage, p);
  }).sort((a, b) => (a.path < b.path ? -1 : 1));
  const manifest = {
    schema: 1,
    context: {
      repository: f.env.GITHUB_REPOSITORY,
      sha: f.env.GITHUB_SHA,
      run_id: "123",
      producer_attempt: "1",
      target: "production",
      public_env: {
        PUBLIC_SITE_ORIGIN: "https://transit.yesid.dev",
        PUBLIC_V1_BASE: "https://data.yesid.dev/v1",
        PUBLIC_INDEXING: "true",
      },
      tools: {
        node: readFileSync(join(f.root, ".nvmrc"), "utf8").trim(),
        bun: readFileSync(join(f.root, ".bun-version"), "utf8").trim(),
        wrangler: JSON.parse(readFileSync(join(f.root, "package.json"), "utf8"))
          .devDependencies.wrangler,
      },
      inputs: BUILD_INPUTS.map((p) => record(f.root, p)),
    },
    files,
  };
  const bytes = JSON.stringify(manifest);
  writeFileSync(join(stage, "manifest.json"), bytes);
  return { stage, proof: receipt(f, hash(bytes)), manifest };
}

test("real sealed-artifact preflight works without dependencies and never weakens deployment restore", (t) => {
  const f = fixture(t);
  const differentNode = process.versions.node.split(".");
  differentNode[0] = String(Number(differentNode[0]) + 1);
  f.write(".nvmrc", differentNode.join("."));
  f.git("commit", "--quiet", "-am", "Different pinned runtime");
  f.env.GITHUB_SHA = f.git("rev-parse", "HEAD");
  const { stage, proof } = sealed(f);
  assert.equal(verifyQueueArtifact(f.env, proof, stage).queue_proven, "true");
  assert.equal(
    existsSync(join(f.root, BUILD_TREES[0])),
    false,
    "Preflight must be read-only",
  );
  assert.throws(
    () =>
      restore(stage, {
        root: f.root,
        env: {
          ...f.env,
          TRANSIT_BUILD_TARGET: "production",
          PUBLIC_SITE_ORIGIN: "https://transit.yesid.dev",
          PUBLIC_V1_BASE: "https://data.yesid.dev/v1",
          PUBLIC_INDEXING: "true",
          TRANSIT_EXPECTED_MANIFEST_SHA256: proof.manifest_sha256,
          TRANSIT_PRODUCER_ATTEMPT: "1",
          TRANSIT_PRODUCER_RUN_ID: "123",
        },
      }),
    /Node version mismatch/,
  );
  writeFileSync(join(stage, BUILD_TREES[0], "entry.js"), "regression");
  assert.throws(
    () => verifyQueueArtifact(f.env, proof, stage),
    /Artifact inventory mismatch/,
  );
});
test("bad seal, wrong producer, changed source and unexpected files cannot issue a receipt", (t) => {
  const f = fixture(t);
  const { stage, proof } = sealed(f);
  assert.throws(
    () =>
      verifyQueueArtifact(
        f.env,
        { ...proof, manifest_sha256: "0".repeat(64) },
        stage,
      ),
    /Manifest seal mismatch/,
  );
  assert.throws(
    () =>
      verifyQueueArtifact(f.env, { ...proof, producer_run_id: "999" }, stage),
    /Build context mismatch/,
  );
  writeFileSync(join(stage, "extra.txt"), "extra");
  assert.throws(
    () => verifyQueueArtifact(f.env, proof, stage),
    /Unexpected artifact file/,
  );
  rmSync(join(stage, "extra.txt"));
  f.write("apps/web/package.json", "changed");
  assert.throws(
    () => verifyQueueArtifact(f.env, proof, stage),
    /Checkout contents|Build context/,
  );
});
test("CLI API failure and corrupt artifact emit only fallback outputs", async (t) => {
  const f = fixture(t);
  await main("prove", f.env, async () => {
    throw Error("API unavailable");
  });
  assert.equal(readFileSync(f.env.GITHUB_OUTPUT, "utf8"), "candidate=false\n");
  writeFileSync(f.env.GITHUB_OUTPUT, "");
  await main("verify", {
    ...f.env,
    TRANSIT_QUEUE_RECEIPT: join(f.directory, "missing"),
  });
  assert.equal(
    readFileSync(f.env.GITHUB_OUTPUT, "utf8"),
    "queue_proven=false\n",
  );
});
for (const name of ["queue-gate", "ci"])
  test(`${name} materializes the real main closure and ignores poisoned checkout code`, (t) => {
    const f = fixture(t);
    f.write(
      ".github/scripts/web-queue-gate.mjs",
      'throw Error("checkout poison")',
    );
    const result = f.run(name, "Materialize trusted queue policy");
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(
      readFileSync(f.env.GITHUB_OUTPUT, "utf8"),
      /^available=true\n$/,
    );
    const materialized = readFileSync(f.env.GITHUB_ENV, "utf8")
      .match(/WEB_QUEUE_POLICY=(.+)/)[1]
      .trim();
    for (const p of ["web-queue-gate.mjs", "web-build-artifact.mjs"])
      assert.equal(
        readFileSync(join(materialized, p), "utf8"),
        f.git("show", `${f.env.GITHUB_SHA}:.github/scripts/${p}`) + "\n",
      );
  });
test("git status 128 and missing trusted policy keep the full gate without a receipt", (t) => {
  const f = fixture(t);
  const prefix =
    "function git { if ($args[0] -eq 'merge-base') { $global:LASTEXITCODE = 128; return }; & (Get-Command git -CommandType Application).Source @args }";
  let r = f.run("queue-gate", "Materialize trusted queue policy", {}, prefix);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(f.env.GITHUB_OUTPUT, "utf8"), "available=false\n");
  assert.equal(existsSync(f.env.GITHUB_ENV), false);
  f.git("rm", "--", ".github/scripts/web-queue-gate.mjs");
  f.git("commit", "--quiet", "-m", "No trusted helper");
  writeFileSync(f.env.GITHUB_OUTPUT, "");
  r = f.run("queue-gate", "Materialize trusted queue policy", {
    GITHUB_SHA: f.git("rev-parse", "HEAD"),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(f.env.GITHUB_OUTPUT, "utf8"), "available=false\n");
  assert.equal(existsSync(f.env.GITHUB_ENV), false);
});
test("real aggregate requires proof or the full gate, and never accepts proof on PR or dispatch", (t) => {
  const f = fixture(t);
  const proof = receipt(f, "b".repeat(64));
  const needs = {
    classify: {
      result: "success",
      outputs: { run_e2e: "true", run_layout: "true" },
    },
    "prerelease-guard": { result: "success" },
    "queue-gate": {
      result: "success",
      outputs: { queue_proven: "true", ...proof },
    },
    ...Object.fromEntries(
      ["ci-work", "unit", "e2e", "layout"].map((k) => [
        k,
        { result: "skipped" },
      ]),
    ),
  };
  const run = (input, extra = {}) =>
    f.run("ci", "Require selected jobs to succeed", {
      WEB_QUEUE_POLICY: join(f.root, ".github/scripts"),
      NEEDS_JSON: JSON.stringify(input),
      ...extra,
    });
  let r = run(needs);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  for (const event of ["pull_request", "workflow_dispatch", "merge_group"]) {
    r = run(needs, { GITHUB_EVENT_NAME: event });
    assert.notEqual(r.status, 0);
  }
  const noProof = structuredClone(needs);
  noProof["queue-gate"].outputs = {};
  r = run(noProof);
  assert.notEqual(r.status, 0, "Skipped work without proof must fail");
  for (const k of ["ci-work", "unit", "e2e"]) noProof[k].result = "success";
  r = run(noProof);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  r = run(needs, { WEB_QUEUE_POLICY: "" });
  assert.notEqual(r.status, 0);
});
test("workflow only skips main push gates after verified proof and deploys that complete tuple", () => {
  for (const name of ["ci-work", "unit", "e2e"]) {
    assert.match(job(name), /github.event_name != 'push'/);
    assert.match(job(name), /github.ref != 'refs\/heads\/main'/);
    assert.match(job(name), /needs.queue-gate.result != 'success'/);
    assert.match(job(name), /needs.queue-gate.outputs.queue_proven != 'true'/);
    assert.match(job(name), /!cancelled\(\)/);
  }
  assert.match(
    job("queue-gate"),
    /id: verified\n\s+if: steps.download.outcome == 'success'/,
  );
  assert.match(
    job("queue-gate"),
    /queue_proven: \$\{\{ steps.verified.outputs.queue_proven \}\}/,
  );
  for (const name of [
    "artifact_id",
    "manifest_sha256",
    "producer_attempt",
    "producer_run_id",
  ]) {
    assert.ok(
      job("ci").includes(
        `needs.queue-gate.outputs.${name} || needs.ci-work.outputs.${name}`,
      ),
    );
    assert.ok(job("deploy-production").includes(`needs.ci.outputs.${name}`));
  }
  assert.doesNotMatch(job("deploy-production"), /needs.ci-work.outputs/);
  assert.match(job("deploy-production"), /needs.ci.result == 'success'/);
});

test("real job expressions always retain PR, queue, dispatch and unproven main gates", () => {
  for (const name of ["ci-work", "unit", "e2e"]) {
    const expression = job(name)
      .match(/\n    if: \$\{\{ (.+) \}\}/)[1]
      .replaceAll("!cancelled()", "true")
      .replaceAll("needs.queue-gate", "needs['queue-gate']");
    const selected = new Function("github", "needs", `return (${expression})`);
    for (const event_name of [
      "pull_request",
      "merge_group",
      "workflow_dispatch",
      "push",
    ]) {
      for (const result of ["success", "failure", "skipped", "cancelled"]) {
        for (const queue_proven of ["true", "false", undefined]) {
          const github = { event_name, ref: "refs/heads/main" };
          const needs = {
            "queue-gate": { result, outputs: { queue_proven } },
            classify: { result: "success", outputs: { run_e2e: "true" } },
          };
          const shouldReuse =
            event_name === "push" &&
            result === "success" &&
            queue_proven === "true";
          assert.equal(
            selected(github, needs),
            !shouldReuse,
            `${name}/${event_name}/${result}/${queue_proven}`,
          );
        }
      }
    }
  }
});
