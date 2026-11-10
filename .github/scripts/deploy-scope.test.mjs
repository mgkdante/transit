import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	deploymentEligible,
	main,
	liveProductionSha,
} from './deploy-scope.mjs';

function git(repository, args) {
	return execFileSync('git', args, {
		cwd: repository,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	}).trim();
}

test('live deployment SHA is read from the Worker identity even during a data outage', async () => {
	const sha = 'a'.repeat(40);
	for (const status of [200, 503]) {
		assert.equal(
			await liveProductionSha(async (url, options) => {
				assert.equal(url, 'https://transit.yesid.dev/health');
				assert.equal(options.redirect, 'error');
				return {
					status,
					json: async () => ({ service: 'transit-web', commit: sha }),
				};
			}),
			sha,
		);
	}
	for (const body of [
		{},
		{ service: 'other', commit: sha },
		{ service: 'transit-web', commit: 'short' },
	]) {
		assert.equal(
			await liveProductionSha(async () => ({
				status: 200,
				json: async () => body,
			})),
			undefined,
		);
	}
	assert.equal(
		await liveProductionSha(async () => {
			throw new Error('unavailable');
		}),
		undefined,
	);
});

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
		'.nvmrc',
		'.bun-version',
		'turbo.json',
		'.github/actions/setup/action.yml',
	]) {
		assert.equal(
			deploymentEligible({
				eventName: 'push',
				diffResolved: true,
				paths: [path],
			}),
			true,
			path,
		);
	}
	assert.equal(
		deploymentEligible({
			eventName: 'workflow_dispatch',
			diffResolved: false,
			paths: [],
		}),
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

test('CLI resolves a valid base/head diff in the checked-out repository', () => {
	const repository = mkdtempSync(join(tmpdir(), 'transit-deploy-scope-'));
	try {
		git(repository, ['init', '--initial-branch=main']);
		git(repository, ['config', 'user.email', 'test@example.invalid']);
		git(repository, ['config', 'user.name', 'Transit test']);
		mkdirSync(join(repository, '.github/workflows'), { recursive: true });
		const workflow = join(repository, '.github/workflows/web.yml');
		writeFileSync(workflow, 'name: web\n');
		git(repository, ['add', '.github/workflows/web.yml']);
		git(repository, ['commit', '--message', 'base']);
		const before = git(repository, ['rev-parse', 'HEAD']);

		writeFileSync(workflow, 'name: web\n# non-deploying workflow edit\n');
		git(repository, ['add', '.github/workflows/web.yml']);
		git(repository, ['commit', '--message', 'workflow edit']);
		const after = git(repository, ['rev-parse', 'HEAD']);

		let output = '';
		assert.equal(
			main(
				{
					TRANSIT_DEPLOY_EVENT: 'push',
					TRANSIT_DEPLOY_LIVE_SHA: before,
					TRANSIT_DEPLOY_AFTER: after,
				},
				{ write: (value) => (output += value) },
				repository,
			),
			0,
		);
		assert.equal(output, 'deploy_web=false\n');
	} finally {
		rmSync(repository, { recursive: true, force: true });
	}
});

test('a cancelled main push cannot hide product changes behind a workflow-only event diff', () => {
	const repository = mkdtempSync(join(tmpdir(), 'transit-live-deploy-scope-'));
	try {
		git(repository, ['init', '--initial-branch=main']);
		git(repository, ['config', 'user.email', 'test@example.invalid']);
		git(repository, ['config', 'user.name', 'Transit test']);
		mkdirSync(join(repository, 'apps/web/src'), { recursive: true });
		mkdirSync(join(repository, '.github/workflows'), { recursive: true });
		writeFileSync(join(repository, 'apps/web/src/app.css'), 'old');
		git(repository, ['add', 'apps/web/src/app.css']);
		git(repository, ['commit', '-m', 'live']);
		const live = git(repository, ['rev-parse', 'HEAD']);
		writeFileSync(join(repository, 'apps/web/src/app.css'), 'new');
		git(repository, ['commit', '-am', 'cancelled product push']);
		const before = git(repository, ['rev-parse', 'HEAD']);
		writeFileSync(join(repository, '.github/workflows/web.yml'), 'name: web\n');
		git(repository, ['add', '.github/workflows/web.yml']);
		git(repository, ['commit', '-m', 'workflow push']);
		const after = git(repository, ['rev-parse', 'HEAD']);
		const decide = (liveSha) => {
			let output = '';
			main(
				{
					TRANSIT_DEPLOY_EVENT: 'push',
					TRANSIT_DEPLOY_BEFORE: before,
					TRANSIT_DEPLOY_LIVE_SHA: liveSha,
					TRANSIT_DEPLOY_AFTER: after,
				},
				{ write: (value) => (output += value) },
				repository,
			);
			return output;
		};
		assert.equal(decide(live), 'deploy_web=true\n');
		assert.equal(decide(after), 'deploy_web=false\n');
		assert.equal(decide(undefined), 'deploy_web=true\n');
	} finally {
		rmSync(repository, { recursive: true, force: true });
	}
});
