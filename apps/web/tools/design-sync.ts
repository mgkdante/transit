#!/usr/bin/env bun
// design-sync — vendors the yesid.dev-design packages (@yesid/tokens,
// @yesid/motion, @yesid/gates, @yesid/ui) into apps/web/vendor/design at a PINNED TAG.
//
// The committed vendor snapshot + this script IS the pin: cascade = re-run at
// a new tag and review the diff (a deliberate bump-PR, per the design repo's
// governance laws). Apps NEVER patch vendor/ code — upstream first, then bump.
//
// Usage:
//   bun tools/design-sync.ts --tag v0.6.0
//   bun tools/design-sync.ts --tag v0.6.0 --source ../yesid.dev-design
//   bun tools/design-sync.ts --tag v0.6.0 --source https://github.com/mgkdante/yesid.dev-design
//   bun tools/design-sync.ts --check          # no source repo needed; CI-safe
import { spawnSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // apps/web/tools
const webRoot = resolve(here, '..');
const DESIGN_REPO = resolve(webRoot, '../../../yesid.dev-design');
const VENDOR = join(webRoot, 'vendor/design');
const MANIFEST = join(VENDOR, 'manifest.json');

const PACKAGES = ['tokens', 'motion', 'gates', 'ui'] as const;

// Test/dev-only files stay in the design repo (its CI runs them); the vendor
// snapshot carries runtime + type surface only.
const EXCLUDE =
	/(^|\/)(__tests__\/|test-fixtures\/|scripts\/|research\/|vitest\.(?:config|setup)\.ts$|vitest\.d\.ts$|\.gitignore$)|\.test\.ts$/;

function gitError(args: string[], result: ReturnType<typeof spawnSync>): Error {
	const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
	const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
	return new Error(
		`git ${args[0]} failed: ${stderr || stdout || `exit ${result.status ?? 'unknown'}`}`,
	);
}

function runGit(args: string[]): string {
	const result = spawnSync('git', args, { encoding: 'utf-8' });
	if (result.status !== 0) throw gitError(args, result);
	return result.stdout.trim();
}

function extractTaggedPackages(source: string, tag: string, destination: string): void {
	const args = ['-C', source, 'archive', tag, 'packages', 'LICENSE'];
	const archive = spawnSync('git', args, { maxBuffer: 128 * 1024 * 1024 });
	if (archive.status !== 0) throw gitError(args, archive);
	const extracted = spawnSync('tar', ['-x', '-C', destination], {
		input: archive.stdout,
		encoding: 'utf-8',
	});
	if (extracted.status !== 0) {
		throw new Error(
			`tar extraction failed: ${extracted.stderr.trim() || `exit ${extracted.status ?? 'unknown'}`}`,
		);
	}
}

function isGitUrl(source: string): boolean {
	return /^(?:https?|ssh|git|file):\/\//i.test(source) || /^[^/\\\s]+@[^:\s]+:.+/.test(source);
}

function walkFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir).sort()) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walkFiles(p, out);
		else out.push(p);
	}
	return out;
}

/** Deterministic tree hash: sha256 over sorted 'relpath\0content\0' records. */
function treeHash(root: string): string {
	const h = createHash('sha256');
	for (const f of walkFiles(root)) {
		const rel = relative(root, f);
		if (rel === 'manifest.json') continue;
		h.update(rel);
		h.update('\0');
		h.update(readFileSync(f));
		h.update('\0');
	}
	return h.digest('hex');
}

/** Convert design-monorepo workspace links into standalone sibling file links. */
function rewriteInternalWorkspaceDependencies(packageRoot: string): void {
	const packageJsonPath = join(packageRoot, 'package.json');
	const source = readFileSync(packageJsonPath, 'utf-8');
	const rewritten = source.replace(
		/("@yesid\/([^"]+)"\s*:\s*)"workspace:\*"/g,
		(_match, prefix: string, sibling: string) => {
			if (!PACKAGES.includes(sibling as (typeof PACKAGES)[number])) {
				throw new Error(`cannot vendor unresolved workspace dependency @yesid/${sibling}`);
			}
			return `${prefix}"file:../${sibling}"`;
		},
	);
	if (rewritten !== source) writeFileSync(packageJsonPath, rewritten, 'utf-8');
}

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const tagIdx = args.indexOf('--tag');
const tag = tagIdx >= 0 ? args[tagIdx + 1] : undefined;
const sourceIdx = args.indexOf('--source');
const sourceArg = sourceIdx >= 0 ? args[sourceIdx + 1] : undefined;

if (sourceIdx >= 0 && (!sourceArg || sourceArg.startsWith('--'))) {
	console.error(
		'usage: bun tools/design-sync.ts --tag <vX.Y.Z> [--source <path-or-git-url>] | --check',
	);
	process.exit(1);
}

if (checkOnly) {
	if (!existsSync(MANIFEST)) {
		console.error('✗ design-sync --check: no manifest at ' + MANIFEST);
		process.exit(1);
	}
	const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'));
	const actual = treeHash(VENDOR);
	if (actual !== manifest.treeHash) {
		console.error(
			`✗ vendor/design tree hash mismatch\n  manifest: ${manifest.treeHash}\n  actual:   ${actual}\n` +
				'  vendor/design was edited by hand or partially synced. Never patch vendored code —\n' +
				'  upstream the change in ../yesid.dev-design, tag it, and re-run design-sync --tag <tag>.',
		);
		process.exit(1);
	}
	console.log(
		`✓ vendor/design matches manifest (${manifest.tag} @ ${manifest.commit.slice(0, 9)})`,
	);
	process.exit(0);
}

if (!tag) {
	console.error(
		'usage: bun tools/design-sync.ts --tag <vX.Y.Z> [--source <path-or-git-url>] | --check',
	);
	process.exit(1);
}

const remoteSource = sourceArg && isGitUrl(sourceArg) ? sourceArg : undefined;
const sourceRoot = remoteSource ? mkdtempSync(join(tmpdir(), 'design-sync-source-')) : undefined;
try {
	const designRepo = remoteSource
		? join(sourceRoot as string, 'yesid.dev-design')
		: resolve(sourceArg ?? DESIGN_REPO);
	if (remoteSource) {
		runGit(['clone', '--depth', '1', '--single-branch', '--branch', tag, remoteSource, designRepo]);
	} else if (!existsSync(designRepo)) {
		console.error(`✗ design repo not found at ${designRepo}`);
		process.exit(1);
	}

	const commit = runGit(['-C', designRepo, 'rev-list', '-1', tag]);
	const tmp = mkdtempSync(join(tmpdir(), 'design-sync-'));
	try {
		extractTaggedPackages(designRepo, tag, tmp);
		rmSync(VENDOR, { recursive: true, force: true });
		mkdirSync(VENDOR, { recursive: true });
		cpSync(join(tmp, 'LICENSE'), join(VENDOR, 'LICENSE'));
		for (const pkg of PACKAGES) {
			const src = join(tmp, 'packages', pkg);
			const dst = join(VENDOR, pkg);
			for (const f of walkFiles(src)) {
				const rel = relative(src, f);
				if (EXCLUDE.test(rel)) continue;
				const target = join(dst, rel);
				mkdirSync(dirname(target), { recursive: true });
				cpSync(f, target);
			}
			rewriteInternalWorkspaceDependencies(dst);
		}
		const manifest = {
			repo: 'yesid.dev-design',
			tag,
			commit,
			note: 'GENERATED by tools/design-sync.ts — never edit vendor/design by hand (one-direction flow).',
			treeHash: treeHash(VENDOR),
		};
		writeFileSync(MANIFEST, JSON.stringify(manifest, null, '\t') + '\n', 'utf-8');
		console.log(`✓ vendored @yesid/{${PACKAGES.join(',')}} at ${tag} (${commit.slice(0, 9)})`);
		console.log(`  treeHash ${manifest.treeHash}`);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
} finally {
	if (sourceRoot) rmSync(sourceRoot, { recursive: true, force: true });
}
