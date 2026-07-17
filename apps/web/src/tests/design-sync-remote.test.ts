import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(process.cwd(), 'tools/design-sync.ts');
const tempRoots: string[] = [];

function makeTempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), 'transit-design-sync-test-'));
	tempRoots.push(root);
	return root;
}

function write(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, 'utf-8');
}

function makeDesignFixture(root: string): string {
	const source = join(root, 'fixture');
	write(join(source, 'LICENSE'), 'fixture license\n');
	for (const name of ['tokens', 'motion', 'gates', 'ui']) {
		write(
			join(source, 'packages', name, 'package.json'),
			`${JSON.stringify({
				name: `@yesid/${name}`,
				...(name === 'ui' ? { dependencies: { '@yesid/motion': 'workspace:*' } } : {}),
			})}\n`,
		);
		write(join(source, 'packages', name, 'src', 'index.ts'), `export const name = '${name}';\n`);
	}
	return source;
}

function makeFakeGit(root: string): { bin: string; log: string } {
	const bin = join(root, 'bin');
	const log = join(root, 'git.log');
	const executable = join(bin, 'git');
	write(
		executable,
		`#!/usr/bin/env bun
import { appendFileSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
appendFileSync(process.env.DESIGN_SYNC_TEST_GIT_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'clone') {
	cpSync(process.env.DESIGN_SYNC_TEST_FIXTURE, args.at(-1), { recursive: true });
	process.exit(0);
}
if (args[0] === '-C' && args[2] === 'rev-list') {
	console.log('a'.repeat(40));
	process.exit(0);
}
if (args[0] === '-C' && args[2] === 'archive') {
	const result = spawnSync('tar', ['-C', args[1], '-cf', '-', 'packages', 'LICENSE'], { stdio: ['ignore', 'inherit', 'inherit'] });
	process.exit(result.status ?? 1);
}
console.error('unexpected fake git invocation: ' + JSON.stringify(args));
process.exit(2);
`,
	);
	chmodSync(executable, 0o755);
	return { bin, log };
}

function runSync(script: string, source: string, env: NodeJS.ProcessEnv) {
	return spawnSync('bun', [script, '--tag', 'v0.6.0', '--source', source], {
		cwd: dirname(dirname(script)),
		env,
		encoding: 'utf-8',
	});
}

afterEach(() => {
	for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('design-sync source transport', () => {
	it('shallow-clones URL sources at the tag and matches local-source output', () => {
		const root = makeTempRoot();
		const fixture = makeDesignFixture(root);
		const webRoot = join(root, 'brand', 'transit', 'apps', 'web');
		const script = join(webRoot, 'tools', 'design-sync.ts');
		mkdirSync(dirname(script), { recursive: true });
		cpSync(SCRIPT, script);
		const fakeGit = makeFakeGit(root);
		const env = {
			...process.env,
			PATH: `${fakeGit.bin}:${process.env.PATH ?? ''}`,
			DESIGN_SYNC_TEST_FIXTURE: fixture,
			DESIGN_SYNC_TEST_GIT_LOG: fakeGit.log,
		};
		const remoteUrl = 'https://example.test/yesid.dev-design.git';

		const remote = runSync(script, remoteUrl, env);
		expect(remote.status, remote.stderr || remote.stdout).toBe(0);
		const remoteManifest = JSON.parse(
			readFileSync(join(webRoot, 'vendor', 'design', 'manifest.json'), 'utf-8'),
		) as { treeHash: string };
		expect(readFileSync(join(webRoot, 'vendor', 'design', 'LICENSE'), 'utf-8')).toBe(
			'fixture license\n',
		);
		const invocations = readFileSync(fakeGit.log, 'utf-8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as string[]);
		const clone = invocations.find((args) => args[0] === 'clone');
		expect(clone?.slice(0, -1)).toEqual([
			'clone',
			'--depth',
			'1',
			'--single-branch',
			'--branch',
			'v0.6.0',
			remoteUrl,
		]);
		expect(clone).toBeDefined();
		expect(existsSync(clone?.at(-1) ?? '')).toBe(false);

		const local = runSync(script, fixture, env);
		expect(local.status, local.stderr || local.stdout).toBe(0);
		const localManifest = JSON.parse(
			readFileSync(join(webRoot, 'vendor', 'design', 'manifest.json'), 'utf-8'),
		) as { treeHash: string };
		expect(localManifest.treeHash).toBe(remoteManifest.treeHash);
	});
});
