import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workflow = readFileSync(
  new URL("../workflows/web.yml", import.meta.url),
  "utf8",
);
const nodePin = readFileSync(new URL("../../.nvmrc", import.meta.url), "utf8");
const policies = {
  current: readFileSync(new URL("./web-ci-paths.mjs", import.meta.url)),
  // Exact policy at cef7ec228de105391059efaa36e96896879f8948, before run_layout.
  preLayout: readFileSync(
    new URL("./fixtures/web-ci-paths-pre-layout.mjs", import.meta.url),
  ),
  // Exact origin/main policy at b02e767935ac279714a636ad2d81dea15a9f1c07.
  // Retain this pre-migration policy to prove compatibility without network access.
  bootstrap: readFileSync(
    new URL("./fixtures/web-ci-paths-main.mjs", import.meta.url),
  ),
};
function workflowRun(job, name) {
  const jobBlock = workflow
    .split(`\n  ${job}:\n`)[1]
    ?.split(/\n {2}[\w-]+:\n/)[0];
  assert.ok(jobBlock, `Missing workflow job: ${job}`);
  const step = jobBlock.split(`      - name: ${name}\n`)[1];
  assert.ok(step, `Missing workflow runner: ${job}/${name}`);
  const block = step
    .split("        run: |\n")[1]
    ?.split(/\n(?=\S| {1,8}\S)/)[0];
  assert.ok(block, `Missing inline runner: ${job}/${name}`);
  return block
    .split("\n")
    .map((line) => line.slice(10))
    .join("\n");
}
function fixture(t, policy = policies.current) {
  const directory = mkdtempSync(join(tmpdir(), "transit-trusted-policy-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "checkout");
  mkdirSync(join(root, ".github/scripts"), { recursive: true });
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "core.hooksPath=",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=Policy test",
        "-c",
        "user.email=policy@example.invalid",
        ...args,
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  git("init", "--quiet", "--initial-branch=main");
  writeFileSync(join(root, ".github/scripts/web-ci-paths.mjs"), policy);
  writeFileSync(join(root, ".nvmrc"), nodePin);
  writeFileSync(join(root, "README.md"), "base\n");
  git("add", "--", ".github/scripts/web-ci-paths.mjs", ".nvmrc", "README.md");
  git("commit", "--quiet", "-m", "Base policy");
  const base = git("rev-parse", "HEAD");
  git("remote", "add", "origin", root);
  git("checkout", "--quiet", "-b", "topic");
  const event = join(directory, "event.json");
  const env = {
    ...process.env,
    RUNNER_TEMP: directory,
    GITHUB_WORKSPACE: root,
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_PATH: event,
    GITHUB_ENV: join(directory, "env"),
    GITHUB_OUTPUT: join(directory, "output"),
  };
  const run = (job, name, extra = {}) => {
    const script = join(directory, "step.ps1");
    writeFileSync(script, workflowRun(job, name));
    return spawnSync(
      "pwsh",
      ["-NoProfile", "-NonInteractive", "-File", script],
      { cwd: root, env: { ...env, ...extra }, encoding: "utf8" },
    );
  };
  const setEvent = (baseSha = base) =>
    writeFileSync(
      event,
      JSON.stringify({
        pull_request: {
          base: { sha: baseSha },
          head: { sha: git("rev-parse", "HEAD") },
        },
      }),
    );
  return { directory, root, git, base, env, run, setEvent };
}
function needs(extraResult) {
  return {
    classify: { result: "success", outputs: { run_e2e: "true" } },
    "prerelease-guard": { result: "success" },
    "ci-work": { result: "success" },
    unit: { result: "success" },
    e2e: { result: "success" },
    layout: { result: "success" },
    extra: { result: extraResult },
  };
}
for (const [version, source] of Object.entries(policies)) {
  for (const job of ["classify", "ci"]) {
    test(`${job} executes ${version} base policy despite a forged head`, (t) => {
      const f = fixture(t, source);
      writeFileSync(
        join(f.root, ".github/scripts/web-ci-paths.mjs"),
        'import { appendFileSync } from "node:fs"; if (process.argv[2] === "classify") appendFileSync(process.env.GITHUB_OUTPUT, "run_e2e=false\\n");\n',
      );
      f.git("add", "--", ".github/scripts/web-ci-paths.mjs");
      f.git("commit", "--quiet", "-m", "Forged policy");
      f.setEvent();
      const materialized = f.run(job, "Materialize trusted web policy");
      assert.equal(
        materialized.status,
        0,
        materialized.stderr + materialized.stdout,
      );
      const policy = readFileSync(f.env.GITHUB_ENV, "utf8")
        .trim()
        .split("WEB_CI_POLICY=")[1];
      assert.ok(!policy.startsWith(f.root));
      assert.equal(
        readFileSync(join(policy, ".nvmrc"), "utf8").trim(),
        nodePin.trim(),
      );
      if (job === "classify") {
        const result = f.run(job, "Classify web paths", {
          WEB_CI_POLICY: policy,
        });
        assert.equal(result.status, 0, result.stderr + result.stdout);
        assert.equal(
          readFileSync(f.env.GITHUB_OUTPUT, "utf8"),
          version === "current"
            ? "run_e2e=true\nrun_layout=true\n"
            : "run_e2e=true\n",
        );
      } else {
        for (const result of ["success", "failure", "cancelled"]) {
          const env = {
            ...f.env,
            WEB_CI_POLICY: policy,
            NEEDS_JSON: JSON.stringify(needs(result)),
          };
          if (version === "bootstrap") {
            // The old policy alone accepts unknown failed/cancelled needs.
            // Rejection below therefore proves the inline workflow guard works.
            assert.doesNotThrow(() =>
              execFileSync(
                process.execPath,
                [join(policy, "web-ci-paths.mjs"), "required"],
                { cwd: f.root, env, stdio: "pipe" },
              ),
            );
          }
          const aggregate = f.run(job, "Require selected jobs to succeed", env);
          assert.equal(
            aggregate.status === 0,
            result === "success",
            aggregate.stderr + aggregate.stdout,
          );
        }
        // This skip is not caught by the inline failure/cancelled guard. Only
        // the real base policy rejects it; the forged head's no-op accepts it.
        const env = {
          ...f.env,
          WEB_CI_POLICY: policy,
          NEEDS_JSON: JSON.stringify({
            ...needs("success"),
            layout: { result: "skipped" },
          }),
        };
        assert.doesNotThrow(() =>
          execFileSync(
            process.execPath,
            [join(f.root, ".github/scripts/web-ci-paths.mjs"), "required"],
            { cwd: f.root, env, stdio: "pipe" },
          ),
        );
        const aggregate = f.run(job, "Require selected jobs to succeed", env);
        assert.notEqual(
          aggregate.status,
          0,
          aggregate.stderr + aggregate.stdout,
        );
      }
    });
  }
}
for (const job of ["classify", "ci"]) {
  test(`${job} rejects a base outside origin/main`, (t) => {
    const f = fixture(t);
    f.git("commit", "--quiet", "--allow-empty", "-m", "Untrusted base");
    f.setEvent(f.git("rev-parse", "HEAD"));
    const result = f.run(job, "Materialize trusted web policy");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not reachable from origin\/main/);
  });
}
test("push and dispatch select everything without executing checkout policy", (t) => {
  const f = fixture(t);
  writeFileSync(
    join(f.root, ".github/scripts/web-ci-paths.mjs"),
    'throw new Error("Untrusted policy executed");',
  );
  for (const event of ["push", "workflow_dispatch"]) {
    writeFileSync(f.env.GITHUB_OUTPUT, "");
    const result = f.run("classify", "Classify web paths", {
      GITHUB_EVENT_NAME: event,
      WEB_CI_POLICY: f.root,
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(
      readFileSync(f.env.GITHUB_OUTPUT, "utf8"),
      "run_e2e=true\nrun_layout=true\n",
    );
  }
});

for (const [version, source] of Object.entries(policies)) {
  test(
    "aggregate enforces explicit layout selection with " + version + " base",
    (t) => {
      const f = fixture(t, source);
      f.setEvent();
      const materialized = f.run("ci", "Materialize trusted web policy");
      assert.equal(
        materialized.status,
        0,
        materialized.stderr + materialized.stdout,
      );
      const policy = readFileSync(f.env.GITHUB_ENV, "utf8")
        .trim()
        .split("WEB_CI_POLICY=")[1];
      for (const run_e2e of ["true", "false"]) {
        for (const run_layout of [undefined, "true", "false"]) {
          const input = needs("success");
          input.classify.outputs = { run_e2e, run_layout };
          input.layout.result = "skipped";
          const aggregate = f.run("ci", "Require selected jobs to succeed", {
            WEB_CI_POLICY: policy,
            NEEDS_JSON: JSON.stringify(input),
          });
          const accepted =
            run_layout === "false" &&
            (version === "current" || run_e2e === "false");
          assert.equal(
            aggregate.status === 0,
            accepted,
            aggregate.stderr + aggregate.stdout,
          );
        }
      }
    },
  );
}

for (const [version, source] of Object.entries(policies)) {
  test("db-only PR uses " + version + " base layout decision", (t) => {
    const f = fixture(t, source);
    mkdirSync(join(f.root, "apps/db"), { recursive: true });
    writeFileSync(join(f.root, "apps/db/example.py"), "# non-UI change");
    f.git("add", "--", "apps/db/example.py");
    f.git("commit", "--quiet", "-m", "Database change");
    f.setEvent();
    const materialized = f.run("classify", "Materialize trusted web policy");
    assert.equal(
      materialized.status,
      0,
      materialized.stderr + materialized.stdout,
    );
    const policy = readFileSync(f.env.GITHUB_ENV, "utf8")
      .trim()
      .split("WEB_CI_POLICY=")[1];
    const classified = f.run("classify", "Classify web paths", {
      WEB_CI_POLICY: policy,
    });
    assert.equal(classified.status, 0, classified.stderr + classified.stdout);
    const outputs = Object.fromEntries(
      readFileSync(f.env.GITHUB_OUTPUT, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    );
    assert.equal(outputs.run_e2e, "true");
    assert.equal(
      outputs.run_layout,
      version === "current" ? "false" : undefined,
    );
    for (const result of ["success", "skipped", "failure", "cancelled"]) {
      const input = needs("success");
      input.classify.outputs = outputs;
      input.layout.result = result;
      const aggregate = f.run("ci", "Require selected jobs to succeed", {
        WEB_CI_POLICY: policy,
        NEEDS_JSON: JSON.stringify(input),
      });
      assert.equal(
        aggregate.status === 0,
        result === "success" || (result === "skipped" && version === "current"),
        aggregate.stderr + aggregate.stdout,
      );
    }
  });
}
