import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const configPath = process.env.WRANGLER_TOML ?? new URL("../wrangler.toml", import.meta.url);
const workflowPath =
  process.env.DEPLOY_WORKFLOW ??
  new URL("../../../.github/workflows/deploy-data-proxy.yml", import.meta.url);

function routePatterns(config) {
  const routes = /routes\s*=\s*\[([\s\S]*?)\]/.exec(config);
  assert.ok(routes, "wrangler.toml must define routes");
  return [...routes[1].matchAll(/pattern\s*=\s*"([^"]+)"/g)].map((match) => match[1]);
}

test("deployment config keeps the data and KPI routes narrowly scoped", () => {
  const config = readFileSync(configPath, "utf8");
  assert.deepEqual(routePatterns(config), [
    "transit.yesid.dev/data/*",
    "transit.yesid.dev/api/v1/*",
  ]);
});

test("production deploys are push-only from main", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  assert.doesNotMatch(workflow, /^\s*workflow_dispatch:/m);
  assert.match(workflow, /deploy-data-proxy:[\s\S]*?environment: production/);
  assert.match(
    workflow,
    /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/,
  );
  assert.match(workflow, /- name: Run production smoke\n\s+run: bash smoke\.sh/);
});
