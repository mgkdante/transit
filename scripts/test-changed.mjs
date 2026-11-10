import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import config from './test-changed.config.json' with { type: 'json' };

export function changedFiles(root, baseRef = 'origin/main') {
	const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
	const base = git('merge-base', 'HEAD', baseRef).trim();
	// No rename detection: both sides of a rename must affect selection.
	const files = [...new Set([
		...git('diff', '--name-only', '--no-renames', '-z', base, 'HEAD').split('\0'),
		...git('diff', '--cached', '--name-only', '--no-renames', '-z').split('\0'),
		...git('diff', '--name-only', '--no-renames', '-z').split('\0'),
		...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'),
	].filter(Boolean))].sort();
	return { base, files };
}

export function selectSpecs(files, available, rules, all = false) {
	if ((files.length || all) && !available.length) throw new Error('No browser specs available; refusing an empty fallback');
	const selected = new Set();
	const reasons = [];
	for (const raw of files) {
		const path = raw.replaceAll('\\', '/');
		if (available.includes(path)) {
			selected.add(path);
			reasons.push(`${path}: changed browser spec`);
			continue;
		}
		const matches = rules.filter(rule => rule.path ? path === rule.path : path.startsWith(rule.prefix));
		if (!matches.length) {
			available.forEach(spec => selected.add(spec));
			reasons.push(`${path}: unknown/shared path; safe default = all browser specs`);
		} else {
			for (const rule of matches) {
				const specs = rule.specs.map(name => available.find(spec => spec.endsWith('/' + name)));
				if (!specs.length || specs.some(spec => !spec)) throw new Error(`Invalid browser map: ${rule.path ?? rule.prefix}`);
				specs.forEach(spec => selected.add(spec));
			}
			reasons.push(`${path}: mapped by ${matches.map(rule => rule.path ?? rule.prefix).join(', ')}`);
		}
	}
	if (all) available.forEach(spec => selected.add(spec));
	return { specs: [...selected].sort(), reasons: all ? ['--all: full suites'] : reasons };
}

function walk(root, dir) {
	return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(entry => {
		const path = `${dir}/${entry.name}`;
		return entry.isDirectory() ? walk(root, path) : [path];
	});
}

function workspaces(root) {
	return ['apps', 'packages'].filter(dir => existsSync(resolve(root, dir))).flatMap(dir =>
		readdirSync(resolve(root, dir)).flatMap(name => {
			const path = `${dir}/${name}`;
			const manifest = resolve(root, path, 'package.json');
			return existsSync(manifest) ? [{ path, ...JSON.parse(readFileSync(manifest, 'utf8')) }] : [];
		}));
}

export function isGraphSource(path) {
	return /\.(?:[cm]?[jt]sx?|svelte)$/.test(path) && !/(?:^|\/)(?:scripts|tools)\//.test(path);
}

export function selectUnits(files, packages, all = false, generatedInputs = [], consumerInputs = []) {
	const selected = new Set();
	const fullTests = new Set(generatedInputs.filter(rule =>
		files.some(path => path.replaceAll('\\', '/').startsWith(rule.prefix)),
	).flatMap(rule => rule.workspaces));
	const consumers = new Set(consumerInputs.filter(rule =>
		files.some(path => path.replaceAll('\\', '/').startsWith(rule.prefix)),
	).flatMap(rule => rule.workspaces));
	packages.filter(pkg => fullTests.has(pkg.path) || consumers.has(pkg.path)).forEach(pkg => selected.add(pkg.name));
	for (const raw of files) {
		const path = raw.replaceAll('\\', '/');
		const owner = packages.find(pkg => path.startsWith(pkg.path + '/'));
		if (owner) selected.add(owner.name);
		else packages.forEach(pkg => selected.add(pkg.name));
		// Data, assets and command inputs can be read through fs rather than imports.
		if (!isGraphSource(path)) {
			(owner ? [owner] : packages).forEach(pkg => fullTests.add(pkg.path));
		}
	}
	if (all) packages.forEach(pkg => selected.add(pkg.name));
	// Include reverse workspace dependencies; Vitest owns the final module graph.
	let previous;
	do {
		previous = selected.size + fullTests.size;
		const fullNames = new Set(packages.filter(pkg => fullTests.has(pkg.path)).map(pkg => pkg.name));
		for (const pkg of packages) {
			const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
			if (Object.keys(deps).some(name => selected.has(name))) selected.add(pkg.name);
			if (Object.keys(deps).some(name => fullNames.has(name))) fullTests.add(pkg.path);
		}
	} while (selected.size + fullTests.size !== previous);
	return packages.filter(pkg => selected.has(pkg.name) && pkg.scripts?.test)
		.map(pkg => fullTests.has(pkg.path) ? { ...pkg, fullTest: true } : pkg);
}

function run(root, cwd, args, env = {}) {
	console.log(`> (${cwd}) bun ${args.join(' ')}`);
	const started = performance.now();
	const result = spawnSync('bun', args, { cwd: resolve(root, cwd), stdio: 'inherit', env: { ...process.env, ...env } });
	if (result.error) throw result.error;
	console.log(`Result: ${result.status ?? result.signal}; ${((performance.now() - started) / 1000).toFixed(2)}s`);
	if (result.status !== 0) throw Object.assign(new Error(`Command failed: bun ${args.join(' ')}`), { exitCode: result.status ?? 1 });
}

export function changedUnitArgs(script, base) {
	return ['run', 'test', '--changed', base, '--passWithNoTests',
		...(/--maxWorkers\b/.test(script) ? [] : ['--maxWorkers=4'])];
}

export function repositoryArgs(files, base, graphPrefixes = []) {
	const graphSafe = files.every(path => graphPrefixes.some(prefix => path.startsWith(prefix)));
	return ['run', 'test:repository', ...(graphSafe ? ['--changed', base, '--passWithNoTests'] : []), '--maxWorkers=4'];
}

export function selectUnitFileTests(files, rules = []) {
	return rules.filter(rule => files.some(path => path.replaceAll('\\', '/').startsWith(rule.prefix)));
}

function runUnitFiles(root, files, packages) {
	for (const rule of selectUnitFileTests(files, config.unitFileTests)) {
		const pkg = packages.find(pkg => pkg.path === rule.workspace);
		if (!pkg?.scripts?.test || !rule.tests.length) throw new Error(`Invalid filesystem test boundary: ${rule.prefix}`);
		if (pkg.fullTest) continue;
		console.log(`Unit: ${rule.workspace}: filesystem input ${rule.prefix}; ${rule.tests.join(', ')}`);
		run(root, rule.workspace, ['run', 'test', ...rule.tests,
			...(/--maxWorkers\b/.test(pkg.scripts.test) ? [] : ['--maxWorkers=4'])], config.unitEnv);
	}
}

function runBrowsers(root, selection, all) {
	for (const group of config.browserGroups) {
		const specs = selection.specs.filter(path => new RegExp(group.match).test(path));
		if (!all && !specs.length) continue;
		console.log(`Browser projects: ${(all ? group.allProjects : group.projects).join(', ')}`);
		const env = { ...config.unitEnv, ...group.env, ...(!all ? group.changedEnv : {}) };
		if (group.build) run(root, config.app, ['run', 'build', ...group.build], env);
		// Playwright CLI arguments are regexes: escape filenames (including brackets and dots).
		const filters = all ? [] : specs.map(path => relative(resolve(root, config.app), resolve(root, path)).replaceAll('\\', '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
		run(root, config.app, ['x', '--no-install', 'playwright', 'test', '-c', all ? config.fullPlaywright : config.playwright,
			...(all ? group.allProjects : group.projects).map(name => `--project=${name}`), ...filters], env);
	}
}

export function main(root, args) {
	const { values } = parseArgs({ args, options: {
		all: { type: 'boolean' }, base: { type: 'string', default: 'origin/main' },
	} });
	const all = values.all === true;
	const { base, files } = all ? { base: null, files: [] } : changedFiles(root, values.base);
	const available = walk(root, config.specDir).filter(path => path.endsWith('.spec.ts'));
	const selection = selectSpecs(files, available, config.rules, all);
	console.log(`Merge base (${values.base}): ${base ?? '(full suites)'}\nChanged files: ${files.join(', ') || '(none)'}`);
	console.log(selection.reasons.join('\n') || 'Clean tree: no changed tests');
	console.log(`Browser specs: ${selection.specs.join(', ') || '(none)'}`);
	run(root, '.', ['run', 'test:changed:selection']);
	if (all) run(root, '.', ['run', 'test']);
	else {
		const packages = selectUnits(files, workspaces(root), false, config.generatedInputs, config.consumerInputs);
		for (const pkg of packages) {
			const vitest = /\bvitest\b/.test(pkg.scripts.test) && !pkg.fullTest;
			console.log(`Unit: ${pkg.path}: affected workspace/dependent; ${vitest ? 'Vitest module graph' : pkg.fullTest ? 'full owning suite (filesystem/generated inputs)' : 'full owning suite (no Vitest)'}`);
			run(root, pkg.path, vitest ? changedUnitArgs(pkg.scripts.test, base) : ['run', 'test'], config.unitEnv);
		}
		runUnitFiles(root, files, packages);
		if (config.repositoryTests && files.length) {
			const args = repositoryArgs(files, base, config.repositoryGraphPrefixes);
			console.log(`Repository tests: ${args.includes('--changed') ? 'module graph' : 'full suite for filesystem/unknown contract inputs'}`);
			run(root, '.', args);
		}
	}
	if (!selection.specs.length && !all) return;
	runBrowsers(root, selection, all);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const started = performance.now();
	try { main(resolve(dirname(fileURLToPath(import.meta.url)), '..'), process.argv.slice(2)); }
	catch (error) { console.error(error.message); process.exitCode = error.exitCode ?? 1; }
	finally { console.log(`Total: ${((performance.now() - started) / 1000).toFixed(2)}s`); }
}
