// no-em-dash.test.ts — the brand-voice lint: no em dashes in user-facing copy.
//
// The owner's voice (and yesid.dev, the sister brand, which codifies the same
// rule in its own tests) never uses the em dash (U+2014). Rendered copy uses a
// comma for a clarifying continuation and a period for an independent clause;
// the no-data glyph is a middle dot "·", never an em dash. This guard keeps the
// product copy scrubbed so a future edit can't quietly reintroduce one.
//
// Two gates, BOTH on comment-stripped source so code comments / doctrine prose
// that happen to contain an em dash never trip the scan:
//
//   1. COPY MODULES — the dedicated bilingual copy layer (every *.copy.ts plus
//      the long-form content/SEO dictionaries). Comments are blanked, so only
//      the string VALUES that ship to users are scanned.
//
//   2. SVELTE TEMPLATES — every .svelte file with its comments AND <script>
//      blocks blanked, leaving the rendered template text + attribute values.
//
// Co-locate user copy in a *.copy.ts (the surface architecture mandates it) and
// both gates cover it; an em dash buried in a component's <script> string is an
// anti-pattern this lint deliberately does not chase.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC = resolve(process.cwd(), 'src');
const EM_DASH = '—';
const rel = (p: string) => p.replace(resolve(process.cwd()) + '/', '');

function walk(dir: string, keep: (p: string) => boolean, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walk(p, keep, out);
		else if (keep(p)) out.push(p);
	}
	return out;
}

// Blank comment CONTENT in place (newlines preserved → line numbers stay 1:1).
// For .svelte, also blank the entire <script> block so only the rendered
// template (text + attribute values) is scanned.
function stripNonRendered(src: string, isSvelte: boolean): string {
	const blank = (m: string) => m.replace(/[^\n]/g, ' ');
	let s = src
		.replace(/<!--[\s\S]*?-->/g, blank)
		.replace(/\/\*[\s\S]*?\*\//g, blank)
		.replace(/(^|[^:])(\/\/.*)$/gm, (_full, pre: string, comment: string) => pre + blank(comment));
	if (isSvelte) s = s.replace(/<script[\s\S]*?<\/script>/g, blank);
	return s;
}

function scan(file: string): string[] {
	const isSvelte = file.endsWith('.svelte');
	const stripped = stripNonRendered(readFileSync(file, 'utf-8'), isSvelte);
	const hits: string[] = [];
	stripped.split('\n').forEach((line, i) => {
		if (line.includes(EM_DASH)) hits.push(`${rel(file)}:${i + 1}: ${line.trim()}`);
	});
	return hits;
}

// --- Gate 1: the dedicated copy layer ---------------------------------------

describe('brand voice — no em dash in copy modules', () => {
	const isCopyModule = (p: string) =>
		/\.copy\.ts$/.test(p) || /\/metrics\.content\.ts$/.test(p) || /\/seo\/routeSeo\.ts$/.test(p);
	const files = walk(SRC, isCopyModule);

	it('finds the copy modules (guards against a wrong path)', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it('no copy-module string value contains an em dash (use a comma or a period)', () => {
		const violations = files.flatMap(scan);
		expect(
			violations,
			`Em dash (U+2014) in shipped copy. The brand voice never uses it — replace with a ` +
				`comma (continuation) or a period (independent clause):\n${violations.join('\n')}`,
		).toEqual([]);
	});
});

// --- Gate 2: rendered Svelte template text ----------------------------------

describe('brand voice — no em dash in Svelte templates', () => {
	const files = walk(SRC, (p) => p.endsWith('.svelte'));

	it('finds the Svelte components (guards against a wrong path)', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it('no rendered template text or attribute value contains an em dash (the no-data glyph is "·")', () => {
		const violations = files.flatMap(scan);
		expect(
			violations,
			`Em dash (U+2014) in rendered Svelte markup. Replace with a comma/period in prose, ` +
				`or the middle dot "·" for a no-data placeholder:\n${violations.join('\n')}`,
		).toEqual([]);
	});
});
