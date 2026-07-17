#!/usr/bin/env bun
// design-sync — vendors the yesid.dev-design packages (@yesid/tokens,
// @yesid/motion, @yesid/gates, @yesid/ui) into apps/web/vendor/design at a PINNED TAG.
//
// Why vendored-sync (P5.1, 2026-07-02): the design repo is local-only (not on
// GitHub / npm yet — operator decision pending), so a file: dep on a sibling
// repo would break CI checkouts. The committed vendor snapshot + this script
// IS the pin: cascade = re-run at a new tag and review the diff (a deliberate
// bump-PR, per the design repo's governance laws). Apps NEVER patch vendor/
// code — upstream first, then bump.
//
// Usage:
//   bun tools/design-sync.ts --tag v0.2.0    # sync (requires ../yesid.dev-design)
//   bun tools/design-sync.ts --check          # verify vendor tree matches manifest
//                                              (no sibling repo needed — CI-safe)
import { execSync } from 'node:child_process';
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
	console.error('usage: bun tools/design-sync.ts --tag <vX.Y.Z> | --check');
	process.exit(1);
}
if (!existsSync(DESIGN_REPO)) {
	console.error(`✗ design repo not found at ${DESIGN_REPO}`);
	process.exit(1);
}

const commit = execSync(`git -C ${DESIGN_REPO} rev-list -1 ${tag}`, { encoding: 'utf-8' }).trim();
const tmp = mkdtempSync(join(tmpdir(), 'design-sync-'));
try {
	execSync(`git -C ${DESIGN_REPO} archive ${tag} packages | tar -x -C ${tmp}`, {
		stdio: 'inherit',
		shell: '/bin/bash',
	});
	rmSync(VENDOR, { recursive: true, force: true });
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
