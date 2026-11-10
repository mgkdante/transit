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

if (
	process.argv[1] &&
	pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
	const liveSha =
		process.env.TRANSIT_DEPLOY_EVENT === 'push'
			? await liveProductionSha()
			: undefined;
	process.exitCode = main({ ...process.env, TRANSIT_DEPLOY_LIVE_SHA: liveSha });
}
