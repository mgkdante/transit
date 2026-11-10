import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../workflows/web.yml", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../workflows/rollback.yml", import.meta.url),
  "utf8",
);
const job = (name) =>
  workflow.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[\w-]+:\n/)[0];

test("production and queue gates keep the complete PR grid out of the deploy path", () => {
  assert.match(job("layout"), /github.event_name == 'pull_request'/);
  assert.match(job("post-deploy-layout"), /needs: \[deploy-production\]/);
  assert.match(job("post-deploy-layout"), /steps: \*layout-steps/);
  assert.match(job("layout"), /steps: &layout-steps/);
  assert.match(job("layout"), /test:e2e:layout/);
  assert.match(
    job("post-deploy-layout"),
    /shard: \[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12\]/,
  );
  assert.match(job("ci"), /GITHUB_EVENT_NAME -ne 'pull_request'/);
  assert.match(
    job("deploy-production"),
    /needs: \[ci, deploy_scope, ci-work\]/,
  );
  assert.doesNotMatch(job("deploy-production"), /needs:.*post-deploy/);
  assert.match(
    workflow,
    /group: web-\$\{\{ github.ref == 'refs\/heads\/main' && github.run_id \|\| github.ref \}\}/,
  );
});

test("promotion binds download and restoration to the selected run and keeps the source-build fallback", () => {
  assert.match(
    job("ci-work"),
    /node .github\/scripts\/web-artifact-promotion.mjs/,
  );
  assert.match(
    job("ci-work"),
    /if: steps.promote.outputs.promoted != 'true'\n\s+run: bun run build/,
  );
  assert.match(
    job("ci-work"),
    /run-id: \$\{\{ steps.promote.outputs.run_id \}\}/,
  );
  assert.match(
    job("deploy-production"),
    /TRANSIT_PRODUCER_RUN_ID: \$\{\{ needs.ci-work.outputs.producer_run_id \}\}/,
  );
  assert.match(
    job("deploy-production"),
    /run-id: \$\{\{ needs.ci-work.outputs.producer_run_id \}\}/,
  );
  assert.doesNotMatch(
    job("deploy_scope"),
    /github.event.before|TRANSIT_DEPLOY_BEFORE/,
  );
});

test("post-deploy failures use the shared alert and rollback shares the production lock", () => {
  assert.match(job("post-deploy-result"), /issues: write/);
  assert.match(job("post-deploy-result"), /post-deploy-layout.mjs report/);
  assert.match(rollback, /workflow_dispatch:/);
  assert.match(rollback, /required: false/);
  assert.doesNotMatch(rollback, /\n  push:|\n  pull_request:|needs:/);
  for (const source of [job("deploy-production"), rollback]) {
    assert.match(
      source,
      /group: transit-data-edge-production\n\s+cancel-in-progress: false/,
    );
  }
});

test("a successful deploy receipt survives failed verification and controls reporting", () => {
  const deploy = job("deploy-production");
  assert.match(deploy, /deployed: \$\{\{ steps.deploy.outputs.deployed \}\}/);
  assert.match(deploy, /node .github\/scripts\/deploy-scope.mjs locked/);
  assert.ok(
    deploy.indexOf("id: locked_scope") <
      deploy.indexOf("Apply public snapshot CORS"),
  );
  assert.match(deploy, /&& printf 'deployed=true\\n'/);
  for (const name of ["post-deploy-layout", "post-deploy-result"]) {
    assert.match(
      job(name),
      /always\(\) && needs.deploy-production.outputs.deployed == 'true'/,
    );
    assert.doesNotMatch(
      job(name),
      /needs.deploy-production.result == 'success'/,
    );
  }
  assert.match(
    job("post-deploy-layout"),
    /outputs.identity_verified == 'true'/,
  );
  assert.match(
    job("post-deploy-result"),
    /DEPLOY_RESULT: \$\{\{ needs.deploy-production.result \}\}/,
  );
  assert.match(
    job("post-deploy-result"),
    /ROLLBACK_VERSION: \$\{\{ needs.deploy-production.outputs.rollback_version \}\}/,
  );
});
