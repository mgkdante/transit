// no-em-dash.test.ts — the brand-voice lint: no em dashes in user-facing output.
//
// The owner's voice (and yesid.dev, the sister brand, which codifies the same
// rule in its own tests) never uses the em dash (U+2014). Rendered copy uses a
// comma for a clarifying continuation and a period for an independent clause;
// the no-data glyph is a middle dot "·", never an em dash.
//
// THE INVARIANT this gate leans on: the em-dash CHARACTER never appears in code
// syntax — only in (a) comments or (b) string literals. Comments are the author's
// scratch space and are exempt; a string literal, wherever it lives (a *.copy.ts
// value, a Svelte template, OR a formatter's no-data glyph buried in a <script>
// block), ships to a user. So the gate scans COMMENT-STRIPPED source — keeping
// <script> blocks, unlike a naive template-only scan — and any surviving em dash
// is a rendered one. Tests are excluded (they legitimately assert the character).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC = resolve(process.cwd(), 'src');
const EM_DASH = '—';
const rel = (p: string) => p.replace(resolve(process.cwd()) + '/', '');

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(svelte|ts)$/.test(p) && !/\.(test|spec)\.ts$/.test(p)) out.push(p);
	}
	return out;
}

// Blank comment CONTENT in place (newlines preserved → line numbers stay 1:1).
// <script> blocks are deliberately KEPT: a `'—'` glyph const lives there and
// still renders. Only true comments (JS //, JS/CSS block, Svelte <!-- -->) are
// blanked so the author's prose never trips the gate.
function blankComments(src: string): string {
	const blank = (m: string) => m.replace(/[^\n]/g, ' ');
	return src
		.replace(/<!--[\s\S]*?-->/g, blank)
		.replace(/\/\*[\s\S]*?\*\//g, blank)
		.replace(/(^|[^:])(\/\/.*)$/gm, (_full, pre: string, comment: string) => pre + blank(comment));
}

describe('brand voice — no em dash in any rendered string', () => {
	const files = walk(SRC);

	it('scans a non-empty source tree (guards against a wrong path)', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it('no string literal anywhere in src contains an em dash (copy → comma/period; no-data glyph → "·")', () => {
		const violations: string[] = [];
		for (const file of files) {
			blankComments(readFileSync(file, 'utf-8'))
				.split('\n')
				.forEach((line, i) => {
					if (line.includes(EM_DASH)) violations.push(`${rel(file)}:${i + 1}: ${line.trim()}`);
				});
		}
		expect(
			violations,
			`Em dash (U+2014) in a shipped string. The brand voice never uses it — replace prose with ` +
				`a comma (continuation) or a period (independent clause), and a no-data placeholder with ` +
				`the middle dot "·":\n${violations.join('\n')}`,
		).toEqual([]);
	});
});
