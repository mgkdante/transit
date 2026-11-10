import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { changedFiles, selectSpecs, selectUnits, changedUnitArgs, selectUnitFileTests } from './test-changed.mjs';
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
	assert.throws(() => selectSpecs(['unknown.ts'], [], rules), /empty fallback/);
	assert.throws(() => selectSpecs([], [], rules, true), /empty fallback/);
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
	assert.deepEqual(selectUnits(['package.json'], packages), packages.map(pkg => ({ ...pkg, fullTest: true })));
	assert.ok(selectUnits(['packages/core/data.json'], packages).every(pkg => pkg.fullTest));
	assert.ok(selectUnits(['packages/core/scripts/generate.ts'], packages).every(pkg => pkg.fullTest));
	assert.ok(selectUnits(['packages/core/source.ts'], packages).every(pkg => !pkg.fullTest));
	assert.deepEqual(selectUnits([], packages), []);
});
test('Git baseline includes committed, staged, unstaged, deleted, renamed and untracked paths', () => {
	const root = mkdtempSync(join(tmpdir(), 'test-changed-'));
	const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
	try {
		git('init', '-q'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
		for (const name of ['rename.ts', 'delete.ts', 'unstaged.ts', 'staged-only.ts', 'committed-cancelled.ts']) writeFileSync(join(root, name), 'before');
		git('add', '.'); git('commit', '-qm', 'test: baseline');
		const base = git('rev-parse', 'HEAD'); git('update-ref', 'refs/remotes/origin/main', base);
		writeFileSync(join(root, 'committed.ts'), 'committed');
		writeFileSync(join(root, 'committed-cancelled.ts'), 'after');
		git('add', 'committed.ts', 'committed-cancelled.ts'); git('commit', '-qm', 'test: change');
		writeFileSync(join(root, 'committed-cancelled.ts'), 'before'); git('add', 'committed-cancelled.ts');
		git('mv', 'rename.ts', 'renamed.ts'); git('rm', 'delete.ts');
		writeFileSync(join(root, 'staged-only.ts'), 'staged'); git('add', 'staged-only.ts');
		writeFileSync(join(root, 'staged-only.ts'), 'before');
		writeFileSync(join(root, 'unstaged.ts'), 'after'); writeFileSync(join(root, 'untracked file.ts'), 'new');
		const result = changedFiles(root);
		assert.equal(result.base, base);
		assert.equal(changedFiles(root, 'HEAD').base, git('rev-parse', 'HEAD'));
		assert.deepEqual(result.files, ['committed-cancelled.ts', 'committed.ts', 'delete.ts', 'rename.ts', 'renamed.ts', 'staged-only.ts', 'unstaged.ts', 'untracked file.ts']);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI propagates owning-suite failures and --all works without an origin/main ref', () => {
	const root = mkdtempSync(join(tmpdir(), 'test-changed-cli-'));
	const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
	const manifest = (path, scripts) => writeFileSync(join(root, path), JSON.stringify({ name: path, scripts }));
	const source = `import { main } from ${JSON.stringify(new URL('./test-changed.mjs', import.meta.url).href)};
		try { main(${JSON.stringify(root)}, JSON.parse(process.argv[1])); }
		catch (error) { console.error(error.message); process.exitCode = error.exitCode ?? 1; }`;
	const invoke = args => spawnSync(process.execPath, ['--input-type=module', '-e', source, JSON.stringify(args)], { encoding: 'utf8' });
	try {
		mkdirSync(join(root, config.specDir), { recursive: true });
		mkdirSync(join(root, 'apps/fixture'), { recursive: true });
		writeFileSync(join(root, config.specDir, 'fixture.spec.ts'), '// fixture');
		manifest('package.json', { 'test:changed:selection': 'node -e "process.exit(0)"', test: 'node -e "process.exit(9)"' });
		manifest('apps/fixture/package.json', { test: 'node -e "process.exit(7)"' });
		git('init', '-q'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
		git('add', '.'); git('commit', '-qm', 'test: baseline');
		git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD').trim());
		writeFileSync(join(root, 'apps/fixture/source.ts'), 'export const changed = true;');
		const owning = invoke([]);
		assert.equal(owning.status, 7, owning.stdout + owning.stderr);
		assert.match(owning.stdout, /full owning suite/);
		git('update-ref', '-d', 'refs/remotes/origin/main');
		const full = invoke(['--all']);
		assert.equal(full.status, 9, full.stdout + full.stderr);
		const missing = invoke([]);
		assert.equal(missing.status, 1);
		assert.match(missing.stderr, /origin\/main/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
test('every configured map target exists and each mapped path selects tests', async () => {
	const { readdirSync } = await import('node:fs');
	const { fileURLToPath } = await import('node:url');
	const root = fileURLToPath(new URL('../', import.meta.url));
	const walk = dir => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry =>
		entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
	const specs = walk(config.specDir).filter(path => path.endsWith('.spec.ts'));
	for (const rule of config.rules) assert.ok(selectSpecs([rule.path ?? `${rule.prefix}example`], specs, config.rules).specs.length);
});

test('shared map sheet and search controls retain their dedicated regression specs', () => {
	const available = ['layout-sheet-scroll.spec.ts', 'controls.spec.ts', 'map.spec.ts'].map(name => `${config.specDir}/${name}`);
	assert.ok(selectSpecs(['apps/web/src/lib/features/map/MapMobileDetailSheet.svelte'], available, config.rules)
		.specs.includes(`${config.specDir}/layout-sheet-scroll.spec.ts`));
	assert.ok(selectSpecs(['apps/web/src/lib/features/search/SearchField.svelte'], available, config.rules)
		.specs.includes(`${config.specDir}/controls.spec.ts`));
});

test('full browser phases preserve separate core and layout preparation', () => {
	const [core, layout] = config.browserGroups;
	assert.deepEqual(core.build, []);
	assert.ok(core.allProjects.includes('http') && core.allProjects.includes('dark'));
	assert.deepEqual(layout.build, ['--mode', 'e2e']);
	assert.deepEqual(layout.allProjects, ['layout-*']);
	assert.equal(core.env?.TRANSIT_E2E_PANEL_SIZES, undefined);
	assert.equal(layout.env?.TRANSIT_E2E_PANEL_SIZES, undefined);
	assert.equal(layout.changedEnv.TRANSIT_E2E_PANEL_SIZES, '1');
});

test('changed Vitest arguments preserve existing worker limits without duplicate flags', () => {
    assert.deepEqual(changedUnitArgs('node prepare.mjs && vitest run --maxWorkers=4', 'abc'),
        ['run', 'test', '--changed', 'abc', '--passWithNoTests']);
    assert.equal(changedUnitArgs('vitest run', 'abc').filter(arg => arg.startsWith('--maxWorkers')).length, 1);
});

test('Transit generated schemas and direct proxy imports select their real web consumer', () => {
	const packages = ['apps/web', 'apps/data-proxy'].map(path => ({
		path, ...JSON.parse(readFileSync(new URL(`../${path}/package.json`, import.meta.url), 'utf8')),
	}));
	for (const path of ['apps/web/src/lib/v1/schemas/json/providers.schema.json', 'apps/web/scripts/gen-contract.mjs']) {
		const selected = selectUnits([path], packages, false, config.generatedInputs, config.consumerInputs);
		assert.equal(selected.find(pkg => pkg.path === 'apps/web')?.fullTest, true, path);
	}
	const shared = selectUnits(['apps/data-proxy/src/snapshot-response.js'], packages, false, config.generatedInputs, config.consumerInputs);
	assert.deepEqual(shared.map(pkg => pkg.path).sort(), ['apps/data-proxy', 'apps/web']);
	assert.equal(shared.find(pkg => pkg.path === 'apps/web').fullTest, undefined);
});

test('source scans remain selected for ordinary web module edits', () => {
    const jobs = selectUnitFileTests(['apps/web/src/lib/features/map/MapMobileDetailSheet.svelte'], config.unitFileTests);
    const tests = jobs.flatMap(job => job.tests);
    assert.ok(tests.includes('src/lib/i18n/frenchCopy.test.ts'));
    assert.ok(tests.includes('src/lib/components/shared/controlCohesion.test.ts'));
});