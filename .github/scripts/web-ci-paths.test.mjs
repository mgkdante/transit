import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  classifyPaths,
  classifyLayoutPaths,
  changedPaths,
  checkRequiredJobs,
} from "./web-ci-paths.mjs";

test("only explicitly allowed root documentation skips e2e", () => {
  assert.equal(classifyPaths(["README.md", "AGENTS.md", "GLOSSARY.md"]), false);
  for (const path of [
    "apps/web/src/routes/+page.svelte",
    "unknown.md",
    ".github/workflows/web.yml",
    "bun.lock",
    "package.json",
    "apps/web/README.md",
    "contracts/example.json",
    "patches/example.patch",
    "turbo.json",
  ]) {
    assert.equal(classifyPaths(["README.md", path]), true, path);
  }
  for (const paths of [[], null, undefined, [null], [""]]) {
    assert.equal(classifyPaths(paths), true);
  }
});

test("non-PR events, event errors, empty diffs and git errors select everything", () => {
  const directory = mkdtempSync(join(tmpdir(), "transit-web-paths-"));
  const eventPath = join(directory, "event.json");
  try {
    for (const name of ["push", "workflow_dispatch", "unknown"]) {
      assert.equal(
        classifyPaths(changedPaths({ GITHUB_EVENT_NAME: name })),
        true,
      );
    }
    const env = {
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: eventPath,
    };
    assert.equal(classifyPaths(changedPaths(env)), true);
    for (const content of [
      "invalid json",
      "{}",
      JSON.stringify({
        pull_request: { base: { sha: "bad" }, head: { sha: "bad" } },
      }),
    ]) {
      writeFileSync(eventPath, content);
      assert.equal(classifyPaths(changedPaths(env)), true);
    }
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    for (const head of [sha, "f".repeat(40)]) {
      writeFileSync(
        eventPath,
        JSON.stringify({
          pull_request: { base: { sha }, head: { sha: head } },
        }),
      );
      assert.equal(classifyPaths(changedPaths(env)), true);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function needs(selected = "true") {
  return {
    classify: {
      result: "success",
      outputs: { run_e2e: selected, run_layout: selected },
    },
    "prerelease-guard": { result: "success" },
    "ci-work": { result: "success" },
    unit: { result: "success" },
    e2e: { result: "success" },
    layout: { result: "success" },
  };
}

test("aggregate accepts success and only a deliberate e2e and layout skip", () => {
  assert.doesNotThrow(() => checkRequiredJobs(needs()));
  const deliberate = needs("false");
  deliberate.e2e.result = "skipped";
  deliberate.layout.result = "skipped";
  assert.doesNotThrow(() => checkRequiredJobs(deliberate));
  for (const selected of ["true", "false"]) {
    for (const job of [
      "classify",
      "prerelease-guard",
      "ci-work",
      "unit",
      "e2e",
      "layout",
    ]) {
      for (const result of ["failure", "cancelled", "skipped", undefined]) {
        if (
          selected === "false" &&
          ["e2e", "layout"].includes(job) &&
          result === "skipped"
        )
          continue;
        const input = needs(selected);
        input[job].result = result;
        assert.throws(
          () => checkRequiredJobs(input),
          `${selected} ${job} ${result}`,
        );
      }
    }
  }
  for (const selected of [undefined, "", "invalid"]) {
    const input = needs();
    input.classify.outputs.run_e2e = selected;
    assert.throws(() => checkRequiredJobs(input));
  }
  assert.throws(() => checkRequiredJobs({}));
});

test("aggregate rejects a missing guard", () => {
  const input = needs();
  delete input["prerelease-guard"];
  assert.throws(() => checkRequiredJobs(input));
});

test("aggregate rejects failure or cancellation in any extra need", () => {
  for (const result of ["failure", "cancelled"]) {
    assert.throws(() => checkRequiredJobs({ ...needs(), extra: { result } }));
  }
  assert.doesNotThrow(() =>
    checkRequiredJobs({ ...needs(), extra: { result: "success" } }),
  );
});

test("layout selects UI and unknown paths but skips known non-UI scopes", () => {
  for (const path of [
    "apps/db/src/ingest.py",
    "apps/data-proxy/src/index.js",
    "README.md",
    "apps/web/e2e/search.spec.ts",
    "apps/web/scripts/example.mjs",
  ]) {
    assert.equal(classifyLayoutPaths([path]), false, path);
  }
  for (const path of [
    "apps/web/src/routes/+page.svelte",
    "apps/web/static/icon.svg",
    "apps/web/e2e/layout.spec.ts",
    "apps/web/e2e/layout-debt.ts",
    "apps/web/e2e/layout-map.spec.ts",
    "apps/web/e2e/data.mjs",
    "apps/web/e2e/playwright.config.ts",
    "apps/web/package.json",
    "apps/web/svelte.config.js",
    "apps/web/vite.config.ts",
    "apps/web/tailwind.config.js",
    "apps/web/postcss.config.cjs",
    "package.json",
    "bun.lock",
    "contracts/v1.json",
    ".github/workflows/web.yml",
    ".github/scripts/web-ci-paths.mjs",
    ".github/scripts/web-ci-trusted.test.mjs",
    ".github/scripts/fixtures/web-ci-paths-main.mjs",
    "unknown.md",
    "patches/example.patch",
    "apps/web/new-config.json",
  ]) {
    assert.equal(
      classifyLayoutPaths(["apps/db/src/ingest.py", path]),
      true,
      path,
    );
  }
  for (const paths of [[], null, undefined, [null], [""]])
    assert.equal(classifyLayoutPaths(paths), true);
  assert.equal(
    classifyLayoutPaths(changedPaths({ GITHUB_EVENT_NAME: "push" })),
    true,
  );
});

test("layout skip needs its own explicit false independent of e2e", () => {
  const input = needs("true");
  input.layout.result = "skipped";
  for (const selected of ["true", undefined, "", "invalid"]) {
    input.classify.outputs.run_layout = selected;
    assert.throws(() => checkRequiredJobs(input));
  }
  input.classify.outputs.run_layout = String(
    classifyLayoutPaths(["apps/db/src/ingest.py"]),
  );
  assert.doesNotThrow(() => checkRequiredJobs(input));
  for (const result of ["failure", "cancelled"]) {
    input.layout.result = result;
    assert.throws(() => checkRequiredJobs(input));
  }
  input.layout.result = "success";
  delete input.classify.outputs.run_layout;
  assert.doesNotThrow(() => checkRequiredJobs(input));
  input.classify.outputs.run_layout = String(
    classifyLayoutPaths(["apps/web/src/app.css"]),
  );
  input.layout.result = "skipped";
  assert.throws(() => checkRequiredJobs(input));
});
