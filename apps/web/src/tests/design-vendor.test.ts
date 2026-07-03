// design-vendor.test.ts — P5.1 integrity gates on the vendored design system
// (vendor/design, synced by tools/design-sync.ts).
//
// 1. MANIFEST HASH: the vendor tree must match its manifest treeHash — vendored
//    code is never hand-edited (one-direction flow: upstream in
//    ../yesid.dev-design, tag, re-sync). Same algorithm as design-sync.ts.
// 2. PIN: transit pins an exact design-system tag; bumping it is a deliberate
//    PR that re-runs design-sync and updates THIS assertion.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const VENDOR = resolve(process.cwd(), 'vendor/design');

/** The deliberate pin. Bump via `bun tools/design-sync.ts --tag <next>`. */
const PINNED_TAG = 'v0.2.0';

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

describe('vendor/design integrity', () => {
	const manifest = JSON.parse(readFileSync(join(VENDOR, 'manifest.json'), 'utf-8')) as {
		repo: string;
		tag: string;
		commit: string;
		treeHash: string;
	};

	it(`pins the deliberate design-system tag (${PINNED_TAG})`, () => {
		expect(manifest.repo).toBe('yesid.dev-design');
		expect(manifest.tag).toBe(PINNED_TAG);
		expect(manifest.commit).toMatch(/^[0-9a-f]{40}$/);
	});

	it('vendor tree matches the manifest hash (vendored code is never hand-edited)', () => {
		expect(treeHash(VENDOR)).toBe(manifest.treeHash);
	});
});
