// brand-doctrine.test.ts — the lint that enforces the four-colour doctrine.
// Two gates:
//
//   1. NO RAW BRAND HEX. The interactive orange (#E07800) and wayfinding amber
//      (#FFB627) must always flow through tokens (var(--primary) / var(--accent)
//      / var(--accent-text) / bg-primary / text-accent-text …). A literal hex in
//      source hard-codes one theme and bypasses the light/dark split — it can
//      never reskin. Banned across ALL of src (any case), except the generated
//      token source (tokens.css) where the hex is defined.
//
//   2. DATAVIZ MARKS STAY ON THE DATAVIZ SCALE. A data mark must be encoded with
//      var(--dataviz-*) / bg-dataviz-* / text-dataviz-*, NEVER the semantic
//      affordance tokens (--primary / --success / --destructive). Orange is
//      INTERACTIVE-ONLY; green/red are affordance verdicts, not data. This gate
//      is scoped to the dataviz/ kit and looks for those tokens used as a FILL
//      (fill=, stroke=, bg-*, the CSS `background`/`color`/`fill`/`stroke`
//      properties).
//
//   ALLOWLIST. Interactive affordances inside a dataviz component legitimately
//   touch --primary (e.g. Distribution's p50 MEDIAN marker line — a UI
//   affordance, not a data mark, documented in dataviz/tokens.ts). A genuine
//   affordance must be ANNOTATED in source near the usage with one of the
//   recognised markers — an explicit `doctrine-allow: interactive`, or the
//   pre-existing affordance comment ("AFFORDANCE MARKER" / "lone --primary
//   touch"). Violations are detected on comment-STRIPPED source (so doctrine
//   prose that merely NAMES a token never trips the gate); the allowlist is
//   checked on the ORIGINAL source so an annotating comment can clear the usage.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC = resolve(process.cwd(), 'src');
const COMPONENTS = resolve(process.cwd(), 'src/lib/components');
const DATAVIZ = join(COMPONENTS, 'dataviz');

// Generated token source — the brand hex IS the point there (it's where the
// tokens are defined). Map paint (basemap.ts / vehicleSprites.ts) also holds raw
// hex, but never the BRAND orange/amber, so it doesn't trip this gate.
const BRAND_HEX_ALLOWLIST = new Set([resolve(SRC, 'lib/styles/tokens.css')]);

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (p.endsWith('.svelte') || p.endsWith('.ts')) out.push(p);
	}
	return out;
}

// Wider walk for the brand-hex gate: all source (.svelte/.ts/.css), minus tests
// (which legitimately assert hex values) and the generated token source.
function walkSrc(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walkSrc(p, out);
		else if (
			/\.(svelte|ts|css)$/.test(p) &&
			!/\.(test|spec)\.ts$/.test(p) &&
			!BRAND_HEX_ALLOWLIST.has(p)
		)
			out.push(p);
	}
	return out;
}

const rel = (p: string) => p.replace(resolve(process.cwd()) + '/', '');

/**
 * Blank out Svelte/JS/CSS comment CONTENT in place so doctrine prose (which
 * legitimately NAMES the banned tokens to explain why they're avoided) never
 * trips the scan. Newlines are PRESERVED — every comment char becomes a space —
 * so line numbers stay 1:1 with the original (the allowlist window is checked
 * against the original at the same index).
 */
function blankComments(src: string): string {
	const blank = (m: string) => m.replace(/[^\n]/g, ' ');
	return src
		.replace(/<!--[\s\S]*?-->/g, blank)
		.replace(/\/\*[\s\S]*?\*\//g, blank)
		.replace(/(^|[^:])(\/\/.*)$/gm, (_full, pre: string, comment: string) => pre + blank(comment));
}

/** Split into [lineNo, text] keeping original numbers (for allowlist windows). */
function numbered(src: string): Array<[number, string]> {
	return src.split('\n').map((line, i) => [i + 1, line]);
}

// --- Gate 1: raw brand hex anywhere in src ----------------------------------

const RAW_BRAND_HEX = /#(?:e07800|ffb627)\b/i;

describe('brand doctrine — no raw brand hex anywhere in src', () => {
	const files = walkSrc(SRC);

	it('scans a non-empty source tree (guards against a wrong path)', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it('no source file hardcodes #E07800 / #FFB627 — interactive orange and wayfinding amber must flow through tokens', () => {
		const violations: string[] = [];
		for (const file of files) {
			const scanned = blankComments(readFileSync(file, 'utf-8'));
			for (const [n, line] of numbered(scanned)) {
				if (RAW_BRAND_HEX.test(line)) violations.push(`${rel(file)}:${n}: ${line.trim()}`);
			}
		}
		expect(violations, violations.join('\n')).toEqual([]);
	});
});

// --- Gate 2: dataviz kit must not encode data with affordance tokens --------

// Matches an affordance token used as a FILL. Covers SVG attrs (fill=/stroke=
// "var(--primary)"), Tailwind fill utilities (bg-primary, bg-success,
// border-destructive, text-destructive, fill-success …) and the raw CSS
// properties (background|color|fill|stroke: var(--primary)).
const AFFORDANCE = '(?:primary|success|destructive|accent)';
const FILL_PATTERNS: RegExp[] = [
	// fill="var(--primary)" / stroke='var(--success)'
	new RegExp(`(?:fill|stroke)\\s*=\\s*["']?var\\(--${AFFORDANCE}\\)`),
	// bg-[var(--primary)] / fill-[var(--success)]
	new RegExp(`(?:bg|fill|stroke|text)-\\[var\\(--${AFFORDANCE}\\)\\]`),
	// bg-primary / bg-success / text-destructive / fill-destructive utility classes
	new RegExp(`\\b(?:bg|fill|stroke|text)-${AFFORDANCE}\\b`),
	// CSS: background: var(--primary); color: var(--success); fill: var(--destructive)
	new RegExp(`(?:background|background-color|color|fill|stroke)\\s*:\\s*var\\(--${AFFORDANCE}\\)`),
];

// Recognised allowlist markers (checked on ORIGINAL source, incl. comments).
const ALLOW_MARKERS = ['doctrine-allow: interactive', 'AFFORDANCE MARKER', 'lone --primary touch'];

function datavizViolations(src: string): string[] {
	const original = src.split('\n');
	// Comments blanked IN PLACE → line numbers stay aligned with `original`.
	const scanned = blankComments(src).split('\n');
	const bad: string[] = [];
	scanned.forEach((line, i) => {
		if (!FILL_PATTERNS.some((re) => re.test(line))) return;
		// Allowlist window: this usage or up to 8 ORIGINAL lines above carries a
		// marker. 8 lines covers an affordance comment sitting above a multi-line
		// SVG element whose fill attr lands several rows down.
		const window = original.slice(Math.max(0, i - 8), i + 1).join('\n');
		if (ALLOW_MARKERS.some((m) => window.includes(m))) return;
		bad.push(`L${i + 1}: ${line.trim()}`);
	});
	return bad;
}

describe('brand doctrine — dataviz kit encodes data only with the dataviz scale', () => {
	const files = walk(DATAVIZ);

	it('scans a non-empty dataviz kit (guards against a wrong path)', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	for (const file of files) {
		it(`${rel(file)} does not use --primary/--success/--destructive/--accent as a data fill`, () => {
			const bad = datavizViolations(readFileSync(file, 'utf-8'));
			expect(
				bad,
				`${rel(file)} uses an affordance token as a data mark — encode it with the dataviz scale ` +
					`(var(--dataviz-*) / bg-dataviz-* / text-dataviz-*), or mark a genuine interactive ` +
					`affordance with "doctrine-allow: interactive":\n${bad.join('\n')}`,
			).toEqual([]);
		});
	}

	// Negative control: prove the allowlist marker is actually honoured, so a
	// future refactor that drops the marker (or the affordance) is caught.
	it('Distribution.svelte p50 median marker is the one allowlisted interactive --primary touch', () => {
		const src = readFileSync(join(DATAVIZ, 'Distribution.svelte'), 'utf-8');
		// The raw source DOES contain the affordance token (the marker line)…
		expect(src).toMatch(/stroke="var\(--primary\)"/);
		// …but the doctrine scan passes BECAUSE it is allowlisted.
		expect(datavizViolations(src)).toEqual([]);
	});
});
