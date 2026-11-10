#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEPLOYABLE_PATHS = new Set([
	'.nvmrc',
	'.bun-version',
	'bun.lock',
	'package.json',
	'turbo.json',
]);
const DEPLOYABLE_PREFIXES = [
	'.github/actions/',
	'apps/data-proxy/',
	'apps/web/',
];
const NON_DEPLOYABLE_PATHS = new Set([
	'.github/scripts/deploy-scope.mjs',
	'.github/scripts/deploy-scope.test.mjs',
	'.github/workflows/web.yml',
	'apps/web/src/lib/features/lines/RouteDetail.svelte.test.ts',
]);

function matches(path, exact, prefixes) {
	return exact.has(path) || prefixes.some((prefix) => path.startsWith(prefix));
}

export function deploymentEligible({
	eventName,
	diffResolved,
	paths,
	sameRevision,
} = {}) {
	if (eventName === 'workflow_dispatch') return true;
	if (eventName === 'push' && sameRevision === true) return false;
	if (eventName !== 'push' || diffResolved !== true || !Array.isArray(paths))
		return true;
	if (paths.length === 0) return true;

	let onlyKnownNonDeployable = true;
	for (const path of paths) {
		if (typeof path !== 'string' || path.length === 0) return true;
		if (NON_DEPLOYABLE_PATHS.has(path)) continue;
		if (matches(path, DEPLOYABLE_PATHS, DEPLOYABLE_PREFIXES)) return true;
		onlyKnownNonDeployable = false;
	}
	return !onlyKnownNonDeployable;
}

function resolvePushDiff(before, after, cwd) {
	if (
		!/^[a-f\d]{40}$/u.test(before ?? '') ||
		!/^[a-f\d]{40}$/u.test(after ?? '') ||
		/^0+$/u.test(before) ||
		/^0+$/u.test(after)
	) {
		return { diffResolved: false, paths: [] };
	}

	try {
		const output = execFileSync(
			'git',
			['diff', '--name-only', '-z', before, after],
			{
				cwd,
				stdio: ['ignore', 'pipe', 'ignore'],
			},
		);
		return {
			diffResolved: true,
			paths: output
				.toString('utf8')
				.split('\0')
				.filter((path) => path.length > 0),
		};
	} catch {
		return { diffResolved: false, paths: [] };
	}
}

export function main(
	env = process.env,
	stdout = process.stdout,
	cwd = process.cwd(),
) {
	const eventName = env.TRANSIT_DEPLOY_EVENT;
	const diff =
		eventName === 'workflow_dispatch'
			? { diffResolved: true, paths: [] }
			: resolvePushDiff(
					env.TRANSIT_DEPLOY_LIVE_SHA,
					env.TRANSIT_DEPLOY_AFTER,
					cwd,
				);
	const sameRevision =
		diff.diffResolved &&
		env.TRANSIT_DEPLOY_LIVE_SHA === env.TRANSIT_DEPLOY_AFTER;
	const deployWeb = deploymentEligible({ eventName, ...diff, sameRevision });
	stdout.write(`deploy_web=${deployWeb ? 'true' : 'false'}\n`);
	return 0;
}

export async function liveProductionSha(fetcher = fetch) {
	try {
		const response = await fetcher('https://transit.yesid.dev/health', {
			redirect: 'error',
			signal: AbortSignal.timeout(5_000),
			headers: { 'cache-control': 'no-cache' },
		});
		const body = await response.json();
		return [200, 503].includes(response.status) &&
			body?.service === 'transit-web' &&
			/^[a-f0-9]{40}$/.test(body.commit ?? '')
			? body.commit
			: undefined;
	} catch {
		return undefined;
	}
}

export async function lockedDeploymentDecision(
	env,
	cwd = process.cwd(),
	fetcher = fetch,
) {
	if (!['push', 'workflow_dispatch'].includes(env.TRANSIT_DEPLOY_EVENT)) {
		throw new Error('Invalid locked deployment event');
	}
	const candidate = env.TRANSIT_DEPLOY_AFTER;
	if (!/^[a-f0-9]{40}$/.test(candidate ?? ''))
		throw new Error('Invalid deployment candidate');
	const git = (...args) =>
		execFileSync('git', args, {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		}).trim();
	if (git('rev-parse', 'HEAD') !== candidate)
		throw new Error('Deployment checkout does not match candidate');
	const automatic = env.TRANSIT_DEPLOY_EVENT === 'push';
	if (automatic) {
		git(
			'fetch',
			'--no-tags',
			'origin',
			'+refs/heads/main:refs/remotes/origin/main',
		);
		if (git('rev-parse', 'refs/remotes/origin/main') !== candidate)
			return false;
	}
	const live = await liveProductionSha(fetcher);
	if (automatic && !live)
		throw new Error('Cannot read live production SHA for automatic deployment');
	if (automatic && live && live !== candidate) {
		try {
			git('cat-file', '-e', `${live}^{commit}`);
		} catch {
			git('fetch', '--no-tags', 'origin', live);
		}
		try {
			git('merge-base', '--is-ancestor', candidate, live);
			return false;
		} catch (error) {
			if (error.status !== 1)
				throw new Error('Cannot establish live deployment ancestry', {
					cause: error,
				});
		}
	}
	let output = '';
	main(
		{ ...env, TRANSIT_DEPLOY_LIVE_SHA: live },
		{ write: (value) => (output += value) },
		cwd,
	);
	return output === 'deploy_web=true\n';
}

if (
	process.argv[1] &&
	pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
	if (process.argv[2] === 'locked') {
		const deploy = await lockedDeploymentDecision(process.env);
		process.stdout.write(`deploy_web=${deploy}\n`);
	} else {
		const liveSha =
			process.env.TRANSIT_DEPLOY_EVENT === 'push'
				? await liveProductionSha()
				: undefined;
		process.exitCode = main({
			...process.env,
			TRANSIT_DEPLOY_LIVE_SHA: liveSha,
		});
	}
}
