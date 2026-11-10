import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { changedFiles, selectSpecs, selectUnits } from './test-changed.mjs';
import config from './test-changed.config.json' with { type: 'json' };

const available = ['tests/a.spec.ts', 'tests/b.spec.ts'];
const rules = [{ prefix: 'src/a/', specs: ['a.spec.ts'] }];
test('direct specs, mapped app paths, Windows separators, union and deduplication', () => {
	assert.deepEqual(selectSpecs(['src\\a\\page.svelte', 'tests/b.spec.ts', 'tests/a.spec.ts'], available, rules).specs, available);
	assert.deepEqual(selectSpecs(['src/a/page.svelte'], available, rules).specs, [available[0]]);
});
test('unknown/shared/deleted spec paths fail closed; clean tree and --all are explicit', () => {
	for (const path of ['src/new/page.svelte', 'packages/ui/index.ts', 'tests/deleted.spec.ts', 'bun.lock']) {
		assert.deepEqual(selectSpecs([path], available, rules).specs, available);
	}
	assert.deepEqual(selectSpecs([], available, rules).specs, []);
	assert.deepEqual(selectSpecs([], available, rules, true).specs, available);
	assert.throws(() => selectSpecs(['src/a/foo'], available, [{ prefix: 'src/a/', specs: ['missing.spec.ts'] }]));
});
test('workspace selection includes transitive consumers and conservative root fallback', () => {
	const packages = [
		{ name: 'core', path: 'packages/core', scripts: { test: 'vitest run' } },
		{ name: 'ui', path: 'packages/ui', dependencies: { core: '*' }, scripts: { test: 'vitest run' } },
		{ name: 'web', path: 'apps/web', devDependencies: { ui: '*' }, scripts: { test: 'vitest run' } },
	];
	assert.deepEqual(selectUnits(['packages/core/a.ts'], packages), packages);
	assert.deepEqual(selectUnits(['apps/web/a.ts'], packages), [packages[2]]);
	assert.deepEqual(selectUnits(['package.json'], packages), packages);
	assert.deepEqual(selectUnits([], packages), []);
});
test('Git baseline includes committed, staged, unstaged, deleted, renamed and untracked paths', () => {
	const root = mkdtempSync(join(tmpdir(), 'test-changed-'));
	const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
	try {
		git('init', '-q'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
		for (const name of ['rename.ts', 'delete.ts', 'unstaged.ts']) writeFileSync(join(root, name), 'before');
		git('add', '.'); git('commit', '-qm', 'test: baseline');
		const base = git('rev-parse', 'HEAD'); git('update-ref', 'refs/remotes/origin/main', base);
		writeFileSync(join(root, 'committed.ts'), 'committed'); git('add', 'committed.ts'); git('commit', '-qm', 'test: change');
		git('mv', 'rename.ts', 'renamed.ts'); git('rm', 'delete.ts');
		writeFileSync(join(root, 'unstaged.ts'), 'after'); writeFileSync(join(root, 'untracked file.ts'), 'new');
		const result = changedFiles(root);
		assert.equal(result.base, base);
		assert.deepEqual(result.files, ['committed.ts', 'delete.ts', 'rename.ts', 'renamed.ts', 'unstaged.ts', 'untracked file.ts']);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
test('every configured map target exists and each mapped path selects tests', async () => {
	const { readdirSync } = await import('node:fs');
	const { fileURLToPath } = await import('node:url');
	const root = fileURLToPath(new URL('../', import.meta.url));
	const walk = dir => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry =>
		entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
	const specs = walk(config.specDir).filter(path => path.endsWith('.spec.ts'));
	for (const rule of config.rules) assert.ok(selectSpecs([`${rule.prefix}example`], specs, config.rules).specs.length);
});
