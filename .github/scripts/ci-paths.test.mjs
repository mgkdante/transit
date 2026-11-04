import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyPaths, checkRequiredJobs, DB_JOBS } from "./ci-paths.mjs";

test("classify CLI sees both sides of renames and runs all checks when a diff is unavailable", (t) => {
  const parent = resolve(tmpdir());
  const root = mkdtempSync(join(parent, "transit-ci-paths-"));
  t.after(() => {
    const within = relative(parent, resolve(root));
    assert.ok(
      within &&
        !isAbsolute(within) &&
        within !== ".." &&
        !within.startsWith(`..${sep}`),
    );
    rmSync(root, { recursive: true, force: true });
  });
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=CI test",
        "-c",
        "user.email=ci@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: root, encoding: "utf8" },
    ).trim();
  git("init", "--quiet");
  mkdirSync(join(root, "apps/db"), { recursive: true });
  mkdirSync(join(root, "apps/web"), { recursive: true });
  writeFileSync(join(root, "apps/db/old file.py"), "fixture\n");
  git("add", "apps/db/old file.py");
  git("commit", "--quiet", "-m", "base");
  const base = git("rev-parse", "HEAD");
  renameSync(
    join(root, "apps/db/old file.py"),
    join(root, "apps/web/new file.ts"),
  );
  git("add", "apps/db/old file.py", "apps/web/new file.ts");
  git("commit", "--quiet", "-m", "rename");
  const head = git("rev-parse", "HEAD");
  const eventPath = join(root, "event.json");
  const output = join(root, "output");
  const classify = (baseSha, headSha) => {
    writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: { base: { sha: baseSha }, head: { sha: headSha } },
      }),
    );
    writeFileSync(output, "");
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL("./ci-paths.mjs", import.meta.url)), "classify"],
      {
        cwd: root,
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: output,
        },
        stdio: "pipe",
      },
    );
    return readFileSync(output, "utf8").trim();
  };
  assert.equal(classify(base, head), "run_db=true");
  assert.equal(classify("f".repeat(40), head), "run_db=true");
  assert.equal(classify("--not-a-sha", head), "run_db=true");
  writeFileSync(join(root, "apps/web/new file.ts"), "web change\n");
  git("add", "apps/web/new file.ts");
  git("commit", "--quiet", "-m", "web only");
  assert.equal(classify(head, git("rev-parse", "HEAD")), "run_db=false");
});

test("web, proxy and documentation changes skip DB work", () => {
  for (const paths of [
    ["apps/web/src/app.css"],
    ["apps/data-proxy/index.js"],
    ["CONTRIBUTING.md"],
    ["bun.lock"],
    ["docs/guide.md"],
  ]) {
    assert.equal(classifyPaths(paths), false);
  }
});

test("DB, CI, unknown and unresolved paths run the DB checks", () => {
  for (const paths of [
    ["apps/db/src/model.py"],
    [".github/scripts/ci-paths.mjs"],
    [".github/workflows/web.yml"],
    [".python-version"],
    ["new-root-file"],
    [],
    null,
    [""],
  ]) {
    assert.equal(classifyPaths(paths), true);
  }
  assert.equal(
    classifyPaths(["README.md", "apps/db/tests/test_model.py"]),
    true,
  );
});

function needs(relevant = true) {
  return {
    classify: { result: "success", outputs: { run_db: String(relevant) } },
    ...Object.fromEntries(
      DB_JOBS.map((job) => [job, { result: relevant ? "success" : "skipped" }]),
    ),
  };
}

test("required checks accept successful work and deliberately skipped DB work", () => {
  assert.doesNotThrow(() => checkRequiredJobs(needs()));
  assert.doesNotThrow(() => checkRequiredJobs(needs(false)));
});

test("required checks fail closed on classifier failure, missing output or incomplete work", () => {
  for (const result of ["failure", "cancelled", "skipped"]) {
    const jobs = needs();
    jobs.classify.result = result;
    assert.throws(() => checkRequiredJobs(jobs));
  }
  for (const result of ["failure", "cancelled", "skipped", undefined]) {
    const jobs = needs();
    jobs[DB_JOBS[0]].result = result;
    assert.throws(() => checkRequiredJobs(jobs));
  }
  for (const runDb of ["", "maybe", undefined]) {
    const jobs = needs(false);
    jobs.classify.outputs.run_db = runDb;
    assert.throws(() => checkRequiredJobs(jobs));
  }
  const failedSkip = needs(false);
  failedSkip[DB_JOBS[0]].result = "failure";
  assert.throws(() => checkRequiredJobs(failedSkip));
});
