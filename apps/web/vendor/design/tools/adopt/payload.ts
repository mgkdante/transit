import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse as parsePath, relative, resolve, sep } from 'node:path';

import {
	MANIFEST_SCHEMA,
	PACKAGE_EXCLUDE,
	PACKAGE_NAMES,
	REPOSITORY_ID,
	WORKTREE_EXCLUDE,
	exclusionPolicyDigest,
	parseManifest,
	parseProvenance,
	pathInside,
	toolDigest,
	treeHash,
	type AdoptManifest,
	type AdoptProvenance,
	type AdoptTrustRecord,
	type PackageName,
} from './contract.js';
import {
	installAdoption,
	type AdoptResult,
	type AdoptRuntime,
} from './transaction.js';

export interface AdoptFromSourceOptions {
	source: string;
	dest: string;
	packages: PackageName[];
	provenance: AdoptProvenance;
	runtime?: AdoptRuntime;
}

function assertSafeDestination(dest: string, source?: string): void {
	const resolvedDest = resolve(dest);
	const forbidden = new Set([parsePath(resolvedDest).root, resolve(process.cwd()), resolve(homedir())]);
	if (forbidden.has(resolvedDest)) {
		throw new Error(`refusing unsafe destination ${resolvedDest}`);
	}
	if (source) {
		const resolvedSource = resolve(source);
		if (pathInside(resolvedDest, resolvedSource) || pathInside(resolvedSource, resolvedDest)) {
			throw new Error('destination and source must not contain one another');
		}
	}
}

function readPackageJson(path: string): Record<string, unknown> {
	try {
		return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
	} catch (error) {
		throw new Error(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function readManifest(dest: string): AdoptManifest {
	const path = join(dest, 'manifest.json');
	if (!existsSync(path)) throw new Error(`no manifest at ${path}`);
	return parseManifest(readPackageJson(path), path);
}

function assertReplaceableDestination(dest: string): void {
	if (!existsSync(dest)) return;
	if (!lstatSync(dest).isDirectory()) {
		throw new Error(`refusing to replace a non-adoption destination at ${dest}`);
	}
	if (readdirSync(dest).length === 0) return;
	try {
		readManifest(dest);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(
			`refusing to replace a non-adoption destination at ${dest}; ` +
				`expected an empty directory or a valid yesid.dev-design manifest (${detail})`,
		);
	}
}

function normalizedRelative(root: string, path: string): string {
	return relative(root, path).split(sep).join('/');
}

function walkSourceFiles(root: string, current = root, out: string[] = []): string[] {
	for (const entry of readdirSync(current).sort()) {
		const path = join(current, entry);
		const rel = normalizedRelative(root, path);
		if (WORKTREE_EXCLUDE.test(rel)) continue;
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) throw new Error(`refusing symbolic link ${path}`);
		if (stat.isDirectory()) walkSourceFiles(root, path, out);
		else if (stat.isFile()) out.push(path);
	}
	return out;
}

interface InternalDependency {
	field: string;
	name: string;
	sibling: PackageName;
}

function internalDependencies(packageJson: Record<string, unknown>): InternalDependency[] {
	const found: InternalDependency[] = [];
	for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
		const dependencies = packageJson[field];
		if (!dependencies || typeof dependencies !== 'object') continue;
		for (const [name, version] of Object.entries(dependencies)) {
			if (!name.startsWith('@yesid/')) continue;
			const sibling = name.slice('@yesid/'.length);
			if (!PACKAGE_NAMES.includes(sibling as PackageName)) {
				throw new Error(`cannot vendor unresolved workspace dependency ${name}`);
			}
			if (typeof version !== 'string' || !/^workspace:\S+$/.test(version)) {
				throw new Error(`internal dependency ${name} must use workspace:`);
			}
			found.push({ field, name, sibling: sibling as PackageName });
		}
	}
	return found;
}

function validatePackageClosure(source: string, packages: PackageName[]): void {
	for (const name of packages) {
		const packageJsonPath = join(source, 'packages', name, 'package.json');
		if (!existsSync(packageJsonPath)) throw new Error(`package ${name} not found at ${packageJsonPath}`);
		for (const dependency of internalDependencies(readPackageJson(packageJsonPath))) {
			if (!packages.includes(dependency.sibling)) {
				throw new Error(`${name} requires ${dependency.sibling}; include both packages`);
			}
		}
	}
}

function copyPackage(source: string, dest: string): void {
	mkdirSync(dest, { recursive: true });
	for (const path of walkSourceFiles(source)) {
		const rel = normalizedRelative(source, path);
		if (PACKAGE_EXCLUDE.test(rel)) continue;
		const target = join(dest, ...rel.split('/'));
		mkdirSync(dirname(target), { recursive: true });
		copyFileSync(path, target);
	}
}

function copyToolBundle(source: string, dest: string): void {
	const toolRoot = join(source, 'tools');
	const entrypoint = join(toolRoot, 'adopt.ts');
	const moduleRoot = join(toolRoot, 'adopt');
	if (!existsSync(entrypoint) || !existsSync(moduleRoot)) {
		throw new Error(`self-vendored adopt tool is incomplete under ${toolRoot}`);
	}
	const files = [entrypoint, ...walkSourceFiles(moduleRoot)];
	for (const path of files) {
		const rel = normalizedRelative(source, path);
		const target = join(dest, ...rel.split('/'));
		mkdirSync(dirname(target), { recursive: true });
		copyFileSync(path, target);
	}
}

function rewriteInternalWorkspaceDependencies(packageRoot: string): void {
	const packageJsonPath = join(packageRoot, 'package.json');
	const packageJson = readPackageJson(packageJsonPath);
	const dependencies = internalDependencies(packageJson);
	if (dependencies.length === 0) return;
	for (const dependency of dependencies) {
		const field = packageJson[dependency.field] as Record<string, unknown>;
		field[dependency.name] = `file:../${dependency.sibling}`;
	}
	writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf-8');
}

export function checkAdoption(destInput: string): AdoptManifest {
	const dest = resolve(destInput);
	assertSafeDestination(dest);
	const manifest = readManifest(dest);
	const actualToolDigest = toolDigest(dest);
	if (actualToolDigest !== manifest.toolDigest) {
		throw new Error(`adopt tool digest mismatch in ${dest}`);
	}
	if (manifest.exclusionPolicyDigest !== exclusionPolicyDigest()) {
		throw new Error(`adoption exclusion policy differs from this tool`);
	}
	const { treeHash: expectedTreeHash, ...trust } = manifest;
	const actual = treeHash(dest, trust);
	if (actual !== expectedTreeHash) {
		throw new Error(
			`vendor tree hash mismatch\n  manifest: ${expectedTreeHash}\n  actual:   ${actual}\n` +
				'Vendored design files changed after adoption. Upstream the change and bump the pinned tag.',
		);
	}
	return manifest;
}

export function adoptFromSource(options: AdoptFromSourceOptions): AdoptResult {
	const source = resolve(options.source);
	const dest = resolve(options.dest);
	const provenance = parseProvenance(options.provenance, 'adoption source');
	assertSafeDestination(dest, source);
	assertReplaceableDestination(dest);
	validatePackageClosure(source, options.packages);
	const license = join(source, 'LICENSE');
	if (!existsSync(license)) throw new Error(`LICENSE not found at ${license}`);

	return installAdoption(
		{
			dest,
			build(stage) {
				copyFileSync(license, join(stage, 'LICENSE'));
				copyToolBundle(source, stage);
				for (const name of options.packages) {
					const packageDest = join(stage, name);
					copyPackage(join(source, 'packages', name), packageDest);
					rewriteInternalWorkspaceDependencies(packageDest);
				}
				const trust: AdoptTrustRecord = {
					schema: MANIFEST_SCHEMA,
					repository: REPOSITORY_ID,
					provenance: {
						mode: provenance.mode,
						tag: { ...provenance.tag },
						asset: provenance.asset ? { ...provenance.asset } : null,
					},
					packages: [...options.packages],
					exclusionPolicyDigest: exclusionPolicyDigest(),
					toolDigest: toolDigest(stage),
				};
				const manifest: AdoptManifest = {
					...trust,
					treeHash: treeHash(stage, trust),
				};
				writeFileSync(
					join(stage, 'manifest.json'),
					`${JSON.stringify(manifest, null, '\t')}\n`,
					'utf-8',
				);
				return manifest;
			},
			inspect: checkAdoption,
			recognize(path) {
				try {
					readManifest(path);
					return true;
				} catch {
					return false;
				}
			},
		},
		options.runtime,
	);
}
