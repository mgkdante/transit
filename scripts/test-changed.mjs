import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './test-changed.config.json' with { type: 'json' };

export function changedFiles(root) {
	const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
	const base = git('merge-base', 'HEAD', 'origin/main').trim();
	// No rename detection: both sides of a rename must affect selection.
	const files = [...new Set([
		...git('diff', '--name-only', '--no-renames', '-z', base).split('\0'),
		...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'),
	].filter(Boolean))].sort();
	return { base, files };
}

export function selectSpecs(files, available, rules, all = false) {
	const selected = new Set();
	const reasons = [];
	for (const raw of files) {
		const path = raw.replaceAll('\\', '/');
		if (available.includes(path)) {
			selected.add(path);
			reasons.push(`${path}: changed browser spec`);
			continue;
		}
		const matches = rules.filter(rule => path.startsWith(rule.prefix));
		if (!matches.length) {
			available.forEach(spec => selected.add(spec));
			reasons.push(`${path}: unknown/shared path; safe default = all browser specs`);
		} else {
			for (const rule of matches) {
				const specs = rule.specs.map(name => available.find(spec => spec.endsWith('/' + name)));
				if (!specs.length || specs.some(spec => !spec)) throw new Error(`Invalid browser map: ${rule.prefix}`);
				specs.forEach(spec => selected.add(spec));
			}
			reasons.push(`${path}: mapped by ${matches.map(rule => rule.prefix).join(', ')}`);
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

export function selectUnits(files, packages, all = false) {
	const selected = new Set();
	for (const raw of files) {
		const path = raw.replaceAll('\\', '/');
		const owner = packages.find(pkg => path.startsWith(pkg.path + '/'));
		if (owner) selected.add(owner.name);
		else packages.forEach(pkg => selected.add(pkg.name));
	}
	if (all) packages.forEach(pkg => selected.add(pkg.name));
	// Include reverse workspace dependencies; Vitest owns the final module graph.
	let previous;
	do {
		previous = selected.size;
		for (const pkg of packages) {
			const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
			if (Object.keys(deps).some(name => selected.has(name))) selected.add(pkg.name);
		}
	} while (selected.size !== previous);
	return packages.filter(pkg => selected.has(pkg.name) && pkg.scripts?.test);
}

function run(root, cwd, args, env = {}) {
	console.log(`> (${cwd}) bun ${args.join(' ')}`);
	const started = performance.now();
	const result = spawnSync('bun', args, { cwd: resolve(root, cwd), stdio: 'inherit', env: { ...process.env, ...env } });
	if (result.error) throw result.error;
	console.log(`Result: ${result.status ?? result.signal}; ${((performance.now() - started) / 1000).toFixed(2)}s`);
    if (result.status !== 0) throw Object.assign(new Error(`Command failed: bun ${args.join(' ')}`), { exitCode: result.status ?? 1 });
}

export function main(root, args) {
	if (args.some(arg => arg !== '--all')) throw new Error('Usage: bun run test:changed [--all]');
	const all = args.includes('--all');
	const { base, files } = changedFiles(root);
	const available = walk(root, config.specDir).filter(path => path.endsWith('.spec.ts'));
	const selection = selectSpecs(files, available, config.rules, all);
	console.log(`Merge base: ${base}\nChanged files: ${files.join(', ') || '(none)'}`);
	console.log(selection.reasons.join('\n') || 'Clean tree: no changed tests');
	console.log(`Browser specs: ${selection.specs.join(', ') || '(none)'}`);
	run(root, '.', ['run', 'test:changed:selection']);
	if (all) run(root, '.', ['run', 'test']);
	else {
		for (const pkg of selectUnits(files, workspaces(root))) {
			const vitest = /\bvitest\b/.test(pkg.scripts.test);
			console.log(`Unit: ${pkg.path}: affected workspace/dependent; ${vitest ? 'Vitest module graph' : 'full owning suite (no Vitest)'}`);
			run(root, pkg.path, ['run', 'test', ...(vitest ? ['--changed', base, '--passWithNoTests', '--maxWorkers=4'] : [])], config.unitEnv);
		}
		if (config.repositoryTests && files.length) run(root, '.', ['run', 'test:repository', '--changed', base, '--passWithNoTests', '--maxWorkers=4']);
	}
	if (!selection.specs.length && !all) return;
	for (const [index, group] of config.browserGroups.entries()) {
        if (all && index > 0) continue;
		const specs = selection.specs.filter(path => new RegExp(group.match).test(path));
		if (!all && !specs.length) continue;
		console.log(`Browser projects: ${(all ? group.allProjects : group.projects).join(', ')}`);
		if (group.build) run(root, config.app, ['run', 'build', ...group.build], config.unitEnv);
		// Playwright CLI arguments are regexes: escape filenames (including brackets and dots).
		const filters = all ? [] : specs.map(path => relative(resolve(root, config.app), resolve(root, path)).replaceAll('\\', '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
		run(root, config.app, ['x', '--no-install', 'playwright', 'test', '-c', config.playwright,
			...(all ? group.allProjects : group.projects).map(name => `--project=${name}`), ...filters], config.unitEnv);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const started = performance.now();
    try { main(resolve(dirname(fileURLToPath(import.meta.url)), '..'), process.argv.slice(2)); }
	catch (error) { console.error(error.message); process.exitCode = error.exitCode ?? 1; }
    finally { console.log(`Total: ${((performance.now() - started) / 1000).toFixed(2)}s`); }
}
