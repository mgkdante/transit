import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type MatchRules = Readonly<{ paths: string[]; prefixes: string[] }>;
type ClassifierRules = Readonly<{
	schema: 1;
	always: MatchRules;
	jobs: Record<string, MatchRules>;
	ignore: Readonly<Record<'docs-only' | 'irrelevant', MatchRules>>;
}>;
type Manifest = Readonly<{
	schema: number;
	source: Readonly<{ repository: string; sha: string; gate: string }>;
	configurations: ReadonlyArray<
		Readonly<{
			mode: string;
			sources: ReadonlyArray<Readonly<{ path: string; digest: string }>>;
			target: string;
		}>
	>;
	callers: ReadonlyArray<Readonly<{ workflow: string; action: string }>>;
}>;

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SOURCE_REPOSITORY = 'mgkdante/yesid.dev-design';
const SOURCE_SHA = 'a4e9d0e3b42da8121b5e9f98de2e315ad48e8f25';
const BASE_DIGEST = 'sha256:588a4acf72f44593561112fc945d410548b56cf556bbbc9bc745c1f7b218424f';
const ACTIONS = {
	classifier: '.github/actions/classify-paths',
	reporter: '.github/actions/required-context',
	drift: '.github/actions/shared-tooling-drift',
} as const;
const DB_WORK = ['offline-tests-work', 'alembic-single-head-work', 'real-db-tests-work'];
const DB_CONTEXTS = ['offline-tests', 'alembic-single-head', 'real-db-tests'];
const GOVERNED_PR_WORKFLOWS = ['.github/workflows/ci.yml', '.github/workflows/web.yml'];

function text(path: string): string {
	return readFileSync(join(ROOT, path), 'utf8');
}

function topLevelBlock(source: string, key: string): string {
	const lines = source.split(/\r?\n/u);
	const start = lines.findIndex((line) => line === `${key}:`);
	if (start < 0) return '';
	let end = start + 1;
	while (end < lines.length && (!lines[end]?.trim() || /^\s/u.test(lines[end] ?? ''))) end += 1;
	return lines.slice(start + 1, end).join('\n');
}

function nestedBlock(source: string, key: string, indent = 2): string {
	const lines = source.split(/\r?\n/u);
	const prefix = `${' '.repeat(indent)}${key}:`;
	const start = lines.findIndex((line) => line === prefix);
	if (start < 0) return '';
	let end = start + 1;
	while (
		end < lines.length &&
		(!lines[end]?.trim() || lines[end]!.length - lines[end]!.trimStart().length > indent)
	) {
		end += 1;
	}
	return lines.slice(start + 1, end).join('\n');
}

function quotedList(source: string): string[] {
	return [...source.matchAll(/^\s+-\s+"([^"]+)"\s*$/gmu)].map((match) => match[1]!);
}

function directMapping(block: string, indent = 2): Map<string, string> {
	const entries = new Map<string, string>();
	const pattern = new RegExp(`^ {${indent}}([A-Za-z0-9_-]+):\\s*([^#\\s]+)`, 'gmu');
	for (const match of block.matchAll(pattern)) entries.set(match[1]!, match[2]!);
	return entries;
}

function jobBlocks(source: string): Map<string, string> {
	const jobs = topLevelBlock(source, 'jobs');
	const lines = jobs.split('\n');
	const starts: Array<{ id: string; line: number }> = [];
	for (const [line, contents] of lines.entries()) {
		const match = contents.match(/^ {2}([A-Za-z0-9_-]+):\s*$/u);
		if (match) starts.push({ id: match[1]!, line });
	}
	return new Map(
		starts.map(({ id, line }, index) => [
			id,
			lines.slice(line, starts[index + 1]?.line ?? lines.length).join('\n'),
		]),
	);
}

function directNeeds(job: string): string[] {
	const inline = job.match(/^ {4}needs:\s*\[([^\]]*)\]\s*$/mu);
	if (inline) {
		return inline[1]!
			.split(',')
			.map((value) => value.trim())
			.filter(Boolean);
	}
	const scalar = job.match(/^ {4}needs:\s*([A-Za-z0-9_-]+)\s*$/mu);
	return scalar ? [scalar[1]!] : [];
}

function classifierRules(source: string): ClassifierRules {
	const lines = source.split(/\r?\n/u);
	const start = lines.findIndex((line) => /^ {10}rules-json:\s*>-\s*$/u.test(line));
	expect(start, 'rules-json block must exist').toBeGreaterThanOrEqual(0);
	const jsonLines: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (!line.startsWith('            ')) break;
		jsonLines.push(line.slice(12));
	}
	return JSON.parse(jsonLines.join('\n')) as ClassifierRules;
}

function matches(path: string, rules: MatchRules): boolean {
	return rules.paths.includes(path) || rules.prefixes.some((prefix) => path.startsWith(prefix));
}

function classify(path: string, rules: ClassifierRules): Record<string, boolean> {
	const jobs = Object.keys(rules.jobs);
	if (matches(path, rules.always)) return Object.fromEntries(jobs.map((job) => [job, true]));
	const selected = Object.fromEntries(jobs.map((job) => [job, matches(path, rules.jobs[job]!)]));
	if (Object.values(selected).some(Boolean)) return selected;
	if (Object.values(rules.ignore).some((ignored) => matches(path, ignored))) return selected;
	return Object.fromEntries(jobs.map((job) => [job, true]));
}

function sha256(contents: string | Uint8Array): string {
	return `sha256:${createHash('sha256').update(contents).digest('hex')}`;
}

function actionCount(source: string, action: string): number {
	const reference = `${SOURCE_REPOSITORY}/${action}@${SOURCE_SHA}`;
	return source.split(reference).length - 1;
}

describe('ST7 Transit workflow timeout governance', () => {
	it('caps every job in the governed PR workflows with an explicit positive timeout', () => {
		const uncapped: string[] = [];
		const nonPositive: string[] = [];
		for (const workflow of GOVERNED_PR_WORKFLOWS) {
			for (const [jobName, job] of jobBlocks(text(workflow))) {
				const timeout = job.match(/^ {4}timeout-minutes:\s*(\d+)\s*$/mu);
				if (!timeout) {
					uncapped.push(`${workflow}:${jobName}`);
					continue;
				}
				if (Number(timeout[1]) <= 0) nonPositive.push(`${workflow}:${jobName}`);
			}
		}

		expect({ uncapped, nonPositive }).toEqual({ uncapped: [], nonPositive: [] });
	});
});

describe('ST5 Transit shared-tooling adoption', () => {
	it('keeps push selectivity while making both PR workflows always report', () => {
		const ci = text('.github/workflows/ci.yml');
		const web = text('.github/workflows/web.yml');
		const ciEvents = topLevelBlock(ci, 'on');
		const webEvents = topLevelBlock(web, 'on');

		expect(nestedBlock(ciEvents, 'pull_request')).not.toMatch(/^\s*paths:/mu);
		expect(nestedBlock(webEvents, 'pull_request')).not.toMatch(/^\s*paths:/mu);
		expect(quotedList(nestedBlock(ciEvents, 'push'))).toEqual([
			'.env.example',
			'.gitleaks.toml',
			'apps/db/**',
			'.github/workflows/**',
			'.github/scripts/**',
			'.github/actions/**',
			'.bun-version',
		]);
		expect(quotedList(nestedBlock(webEvents, 'push'))).toEqual([
			'apps/web/**',
			'apps/data-proxy/**',
			'packages/**',
			'bun.lock',
			'.bun-version',
			'package.json',
			'turbo.json',
			'.github/workflows/web.yml',
			'.github/actions/**',
		]);
		for (const workflow of [ci, web]) {
			expect(Object.fromEntries(directMapping(topLevelBlock(workflow, 'permissions')))).toEqual({
				contents: 'read',
				'pull-requests': 'read',
			});
		}
	});

	it('pins the exact shared callers and binds their complete manifest', () => {
		const ci = text('.github/workflows/ci.yml');
		const web = text('.github/workflows/web.yml');
		expect(actionCount(ci, ACTIONS.classifier)).toBe(1);
		expect(actionCount(web, ACTIONS.classifier)).toBe(1);
		expect(actionCount(ci, ACTIONS.reporter)).toBe(1);
		expect(actionCount(web, ACTIONS.reporter)).toBe(1);
		expect(actionCount(ci, ACTIONS.drift) + actionCount(web, ACTIONS.drift)).toBe(1);

		const manifestPath = join(ROOT, '.github/shared-tooling.json');
		expect(existsSync(manifestPath)).toBe(true);
		if (!existsSync(manifestPath)) return;
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
		expect(manifest.source).toEqual({
			repository: SOURCE_REPOSITORY,
			sha: SOURCE_SHA,
			gate: ACTIONS.drift,
		});

		const overlay = '.github/shared-tooling/turbo.overlay.json';
		expect(existsSync(join(ROOT, overlay))).toBe(true);
		if (!existsSync(join(ROOT, overlay))) return;
		expect(manifest.configurations).toEqual([
			{
				mode: 'json-merge',
				sources: [
					{
						path: 'node_modules/.yesid-shared-tooling/turbo/base.json',
						digest: BASE_DIGEST,
					},
					{ path: overlay, digest: sha256(readFileSync(join(ROOT, overlay))) },
				],
				target: 'turbo.json',
			},
		]);
		expect(manifest.callers.map(({ workflow, action }) => `${workflow}\0${action}`).sort()).toEqual(
			[
				`.github/workflows/ci.yml\0${ACTIONS.classifier}`,
				`.github/workflows/ci.yml\0${ACTIONS.reporter}`,
				`.github/workflows/web.yml\0${ACTIONS.classifier}`,
				`.github/workflows/web.yml\0${ACTIONS.reporter}`,
				`.github/workflows/web.yml\0${ACTIONS.drift}`,
			].sort(),
		);
	});

	it('keeps DB work parallel behind the three exact conservative reporters', () => {
		const jobs = jobBlocks(text('.github/workflows/ci.yml'));
		for (const job of DB_WORK) {
			expect(jobs.has(job), job).toBe(true);
			expect(directNeeds(jobs.get(job)!)).toEqual(['classify']);
			expect(jobs.get(job)).toContain(`relevant['${job}']`);
		}
		for (const context of DB_CONTEXTS) expect(jobs.has(context), context).toBe(false);

		const reporters = [...jobs].filter(([, job]) =>
			job.includes(`${SOURCE_REPOSITORY}/${ACTIONS.reporter}@${SOURCE_SHA}`),
		);
		expect(reporters).toHaveLength(1);
		const [, reporter] = reporters[0]!;
		expect(reporter).toMatch(/^ {4}if:\s*(?:\$\{\{\s*)?always\(\)(?:\s*\}\})?\s*$/mu);
		expect(reporter).toMatch(/^ {6}fail-fast:\s*false\s*$/mu);
		expect(reporter).toMatch(/^ {4}name:\s*\$\{\{\s*matrix\.context\s*\}\}\s*$/mu);
		expect(
			[...reporter.matchAll(/^\s+-\s*context:\s*([A-Za-z0-9_-]+)\s*$/gmu)].map(
				(match) => match[1]!,
			),
		).toEqual(DB_CONTEXTS);
		expect(directNeeds(reporter).sort()).toEqual(['classify', ...DB_WORK].sort());
	});

	it('preserves the web ci and deploy contract behind one always reporter', () => {
		const jobs = jobBlocks(text('.github/workflows/web.yml'));
		const work = jobs.get('ci-work');
		const reporter = jobs.get('ci');
		expect(work).toBeDefined();
		expect(reporter).toBeDefined();
		if (!work || !reporter) return;
		expect(directNeeds(work)).toEqual(['classify']);
		expect(work).toContain("relevant['ci-work']");
		expect(directNeeds(reporter)).toEqual(['classify', 'ci-work']);
		expect(reporter).toMatch(/^ {4}if:\s*(?:\$\{\{\s*)?always\(\)(?:\s*\}\})?\s*$/mu);
		expect(reporter).toContain(`${SOURCE_REPOSITORY}/${ACTIONS.reporter}@${SOURCE_SHA}`);

		const setup = work.indexOf('uses: ./.github/actions/setup');
		const materialize = work.indexOf('.github/scripts/materialize-shared-config.mjs');
		const drift = work.indexOf(`${SOURCE_REPOSITORY}/${ACTIONS.drift}@${SOURCE_SHA}`);
		expect(setup).toBeGreaterThanOrEqual(0);
		expect(materialize).toBeGreaterThan(setup);
		expect(drift).toBeGreaterThan(materialize);

		for (const deploy of ['deploy-dev', 'deploy-production']) {
			expect(directNeeds(jobs.get(deploy)!)).toEqual(['ci']);
			expect(jobs.get(deploy)).toContain('CLOUDFLARE_API_TOKEN');
		}
		expect(jobs.get('deploy-production')).toContain('run: bash smoke.sh');
	});

	it('classifies each product domain selectively while unknown paths fail safe', () => {
		const dbRules = classifierRules(text('.github/workflows/ci.yml'));
		const webRules = classifierRules(text('.github/workflows/web.yml'));
		const allDb = Object.fromEntries(DB_WORK.map((job) => [job, true]));
		const noDb = Object.fromEntries(DB_WORK.map((job) => [job, false]));

		expect(classify('apps/db/src/transit_ops/cli.py', dbRules)).toEqual(allDb);
		expect(classify('.github/workflows/ci.yml', dbRules)).toEqual(allDb);
		expect(classify('.github/shared-tooling.json', dbRules)).toEqual(allDb);
		expect(classify('.github/shared-tooling/turbo.overlay.json', dbRules)).toEqual(allDb);
		expect(classify('apps/web/src/routes/+page.svelte', dbRules)).toEqual(noDb);
		expect(classify('README.md', dbRules)).toEqual(noDb);
		expect(classify('new-root-surface.txt', dbRules)).toEqual(allDb);

		expect(classify('apps/web/src/routes/+page.svelte', webRules)).toEqual({ 'ci-work': true });
		expect(classify('apps/data-proxy/src/index.ts', webRules)).toEqual({ 'ci-work': true });
		expect(classify('.github/workflows/ci.yml', webRules)).toEqual({ 'ci-work': true });
		expect(classify('.github/scripts/materialize-shared-config.mjs', webRules)).toEqual({
			'ci-work': true,
		});
		expect(classify('apps/db/src/transit_ops/cli.py', webRules)).toEqual({ 'ci-work': false });
		expect(classify('README.md', webRules)).toEqual({ 'ci-work': false });
		expect(classify('new-root-surface.txt', webRules)).toEqual({ 'ci-work': true });
	});
});
