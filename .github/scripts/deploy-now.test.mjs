import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(new URL('../workflows/deploy-now.yml', import.meta.url), 'utf8');
const web = readFileSync(new URL('../workflows/web.yml', import.meta.url), 'utf8');

test('manual production deployment checks out the selected ref without CI dependencies', () => {
  const triggers = workflow.split('\non:\n')[1].split('\npermissions:')[0];
  assert.match(triggers, /workflow_dispatch:/);
  assert.doesNotMatch(triggers, /(?:push|pull_request|workflow_run|merge_group):/);
  assert.match(triggers, /ref:[\s\S]*required: true/);
  assert.match(triggers, /options: \[web, data-proxy, both\]/);
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /ref: \$\{\{ inputs.ref \}\}/);
  assert.match(workflow, /git rev-parse HEAD/);
  assert.doesNotMatch(workflow, /needs:|run:.*(?:test|smoke)|workflow_run/);
  for (const setting of ['TRANSIT_BUILD_TARGET: production', 'PUBLIC_SITE_ORIGIN: https://transit.yesid.dev', 'PUBLIC_V1_BASE: https://data.yesid.dev/v1', 'PUBLIC_INDEXING: "true"']) {
    assert.ok(workflow.includes(setting), setting);
    assert.ok(web.includes(setting), setting);
  }
  for (const source of [workflow, web.split('\n  deploy-production:')[1]]) {
    assert.match(source, /environment: production/);
    assert.match(source, /group: transit-data-edge-production\n\s+cancel-in-progress: false/);
  }
  for (const target of ['web', 'data-proxy']) {
    assert.match(workflow, new RegExp(`if: inputs.target == '${target}' \\|\\| inputs.target == 'both'`));
  }
});

test('deployment summaries use actual Wrangler versions and reject missing deployment receipts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'transit-deploy-summary-'));
  try {
    const scripts = [...workflow.matchAll(/node --input-type=module <<'NODE'\n([\s\S]*?)          NODE/g)];
    assert.equal(scripts.length, 2);
    for (const [, body] of scripts) {
      const receipt = join(directory, 'receipt.ndjson');
      const summary = join(directory, 'summary.md');
      const env = { ...process.env, WRANGLER_OUTPUT_FILE_PATH: receipt, GITHUB_STEP_SUMMARY: summary, TRANSIT_COMMIT_SHA: 'a'.repeat(40), DEPLOY_TARGET: 'web' };
      writeFileSync(receipt, JSON.stringify({ type: 'wrangler-session' }) + '\n' + JSON.stringify({ type: 'deploy', version_id: 'worker-version-123' }) + '\n');
      execFileSync(process.execPath, ['--input-type=module', '-e', body], { env });
      const result = readFileSync(summary, 'utf8');
      assert.ok(result.includes('a'.repeat(40)));
      assert.match(result, /Target: web/);
      assert.match(result, /Worker version: worker-version-123/);
      writeFileSync(receipt, JSON.stringify({ type: 'wrangler-session' }));
      assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', body], { env, stdio: 'pipe' }));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('older application refs use deployment control files preserved from the main dispatch revision', () => {
  const directory = mkdtempSync(join(tmpdir(), 'transit-deploy-control-'));
  const assets = ['.github/actions/setup/action.yml', 'apps/data-proxy/r2-cors.json', 'apps/data-proxy/scripts/configure-data-edge.mjs'];
  function step(name) {
    const block = workflow.split(`      - name: ${name}\n`)[1]?.split('\n      - name:')[0];
    assert.ok(block, `Missing ${name}`);
    return block.split('        run: |\n')[1].split('\n').map((line) => line.slice(10)).join('\n');
  }
  try {
    const root = join(directory, 'checkout');
    const temporary = join(directory, 'runner');
    mkdirSync(root);
    mkdirSync(temporary);
    for (const asset of assets) {
      mkdirSync(join(root, asset, '..'), { recursive: true });
      writeFileSync(join(root, asset), `main control: ${asset}`);
    }
    const run = (name) => {
      const script = join(directory, 'step.ps1');
      writeFileSync(script, step(name));
      execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', script], {
        cwd: root, env: { ...process.env, RUNNER_TEMP: temporary }, stdio: 'pipe',
      });
    };
    run('Preserve main deployment controls');
    // Model checkout of a historical ref that has none of these controls.
    for (const asset of assets) rmSync(join(root, asset));
    run('Restore main setup action');
    assert.equal(readFileSync(join(root, assets[0]), 'utf8'), `main control: ${assets[0]}`);
    for (const asset of assets.slice(1)) {
      assert.equal(readFileSync(join(temporary, 'transit-deploy-control', asset), 'utf8'), `main control: ${asset}`);
    }
    assert.match(workflow, /--file "\$RUNNER_TEMP\/transit-deploy-control\/apps\/data-proxy\/r2-cors.json"/);
    assert.match(workflow, /node "\$RUNNER_TEMP\/transit-deploy-control\/apps\/data-proxy\/scripts\/configure-data-edge.mjs"/);
    assert.ok(workflow.indexOf('Preserve main deployment controls') < workflow.indexOf('Check out deployment ref'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
