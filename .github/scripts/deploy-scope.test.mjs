import assert from 'node:assert/strict';
import test from 'node:test';
import { deploymentEligible, main } from './deploy-scope.mjs';

test('tooling-only and workflow-only pushes preserve the deployed Worker', () => {
	assert.equal(typeof deploymentEligible, 'function');
	assert.equal(
		deploymentEligible({
			eventName: 'push',
			diffResolved: true,
			paths: [
				'.github/scripts/deploy-scope.mjs',
				'.github/scripts/deploy-scope.test.mjs',
				'.github/workflows/web.yml',
				'apps/web/src/tests/shared-tooling-adoption.test.ts',
				'apps/web/src/lib/features/lines/RouteDetail.svelte.test.ts',
			],
		}),
		false,
	);
});

test('deployable changes and manual dispatch remain eligible', () => {
	assert.equal(typeof deploymentEligible, 'function');
	for (const path of [
		'apps/web/src/routes/+page.svelte',
		'apps/data-proxy/src/index.ts',
		'package.json',
		'bun.lock',
		'.bun-version',
		'turbo.json',
		'.github/actions/setup/action.yml',
		'.github/shared-tooling/turbo.overlay.json',
	]) {
		assert.equal(
			deploymentEligible({ eventName: 'push', diffResolved: true, paths: [path] }),
			true,
			path,
		);
	}
	assert.equal(
		deploymentEligible({ eventName: 'workflow_dispatch', diffResolved: false, paths: [] }),
		true,
	);
});

test('unknown or unresolved push diffs fail safe to deployment', () => {
	assert.equal(typeof deploymentEligible, 'function');
	assert.equal(
		deploymentEligible({ eventName: 'push', diffResolved: false, paths: [] }),
		true,
	);
	assert.equal(
		deploymentEligible({
			eventName: 'push',
			diffResolved: true,
			paths: ['new-root-surface.txt'],
		}),
		true,
	);
	assert.equal(
		deploymentEligible({ eventName: 'push', diffResolved: true, paths: [] }),
		true,
	);
});

test('CLI scope output is conservative for zero-before pushes and explicit dispatch', () => {
	assert.equal(typeof main, 'function');
	for (const env of [
		{
			TRANSIT_DEPLOY_EVENT: 'push',
			TRANSIT_DEPLOY_BEFORE: '0'.repeat(40),
			TRANSIT_DEPLOY_AFTER: '1'.repeat(40),
		},
		{ TRANSIT_DEPLOY_EVENT: 'workflow_dispatch' },
		{
			TRANSIT_DEPLOY_EVENT: 'push',
			TRANSIT_DEPLOY_BEFORE: 'not-a-commit-sha',
			TRANSIT_DEPLOY_AFTER: '1'.repeat(40),
		},
		{
			TRANSIT_DEPLOY_EVENT: 'push',
			TRANSIT_DEPLOY_BEFORE: 'a'.repeat(39),
			TRANSIT_DEPLOY_AFTER: '1'.repeat(40),
		},
	]) {
		let output = '';
		assert.equal(main(env, { write: (value) => (output += value) }), 0);
		assert.equal(output, 'deploy_web=true\n');
	}
});
