import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
let packageJson = null;
try {
  packageJson = JSON.parse(
    await readFile(new URL("tools/e6/package.json", root), "utf8"),
  );
} catch {
  // The RED baseline intentionally has no local package contract yet.
}
const workflow = await readFile(
  new URL(".github/workflows/web.yml", root),
  "utf8",
);

function jobBlock(name) {
  const lines = workflow.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start < 0) return "";
  const relativeEnd = lines
    .slice(start + 1)
    .findIndex((line) => /^  [a-zA-Z0-9_-]+:$/u.test(line));
  const end = relativeEnd < 0 ? lines.length : start + 1 + relativeEnd;
  return lines.slice(start + 1, end).join("\n");
}

test("tools/e6 changes trigger the web workflow and dedicated required B2 work", () => {
  assert.match(workflow, /^      - "tools\/e6\/\*\*"$/mu);
  assert.match(
    workflow,
    /"e6-tests-work"\s*:\s*\{[\s\S]*?"prefixes"\s*:\s*\["tools\/e6\/"\]/u,
  );
  const work = jobBlock("e6-tests-work");
  assert.notEqual(work, "");
  assert.match(work, /^    needs: \[classify\]$/mu);
  assert.match(work, /relevant\['e6-tests-work'\]/u);
  assert.match(work, /working-directory: \$\{\{ github\.workspace \}\}/u);
  assert.match(
    work,
    /run: bun run --shell=bun --cwd tools\/e6 b2:check/u,
  );

  const aggregate = jobBlock("ci");
  assert.match(
    aggregate,
    /^    needs: \[classify, ci-work, e6-tests-work\]$/mu,
  );
});

test("the local B2 command runs the full E6 contract suite and synthetic RED proof", () => {
  assert.notEqual(packageJson, null);
  const command = packageJson?.scripts?.["b2:check"];
  assert.equal(typeof command, "string");
  assert.match(command, /bun test test\/\*\.test\.mjs/u);
  assert.match(command, /node e6-measure\.mjs --red-proof --duration-ms 2000/u);
});

test("deploy scope is diff-based, conservative on ambiguity, and required by both push deploy jobs", () => {
  const scope = jobBlock("deploy_scope");
  assert.notEqual(scope, "");
  assert.match(scope, /github\.event_name/u);
  assert.match(scope, /github\.event\.before/u);
  assert.match(scope, /github\.sha/u);
  assert.match(scope, /tools\/e6\/deploy-scope\.mjs/u);
  assert.match(scope, /^    outputs:\n      deploy_web:/mu);
  assert.match(
    scope,
    /^    if: \$\{\{ github\.event_name != 'pull_request' \}\}$/mu,
  );

  for (const name of ["deploy-dev", "deploy-production"]) {
    const deploy = jobBlock(name);
    assert.match(deploy, /^    needs: \[ci, deploy_scope\]$/mu);
    assert.match(deploy, /needs\.deploy_scope\.outputs\.deploy_web == 'true'/u);
    assert.match(deploy, /github\.event_name == 'workflow_dispatch'/u);
  }
});
