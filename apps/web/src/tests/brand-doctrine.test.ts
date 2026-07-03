// brand-doctrine.test.ts — the lint that enforces the four-colour doctrine.
//
// P5.1 (2026-07-02): the detection ENGINES moved to @yesid/gates (the vendored
// design system, vendor/design/gates — this file's own pre-P5.1 inline
// implementation was their source, so detection is byte-equivalent; this
// file's git history holds the originals). What remains here is transit's
// CONFIG (roots, preset tables) + the negative controls that pin consumer
// files. Three gates:
//
//   1. NO RAW BRAND HEX — #E07800/#FFB627 must flow through tokens; banned
//      across ALL of src except the generated token source where they are
//      defined.
//   2. DATAVIZ MARKS STAY ON THE DATAVIZ SCALE — the dataviz/ kit never
//      encodes data with --primary/--success/--destructive/--accent as a
//      fill; genuine interactive affordances carry an allow-marker.
//   3. tv() ONLY IN ui/ — value imports of tailwind-variants are legal only
//      under src/lib/components/ui (the design-system convention, now gated).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { brandHexViolations, datavizViolations, tvOnlyInUiViolations, walk } from '@yesid/gates';
import {
	TRANSIT_BRAND_HEXES,
	TRANSIT_BRAND_HEX_ALLOWLIST_REL,
	TRANSIT_AFFORDANCE_TOKENS,
	TRANSIT_ALLOW_MARKERS,
} from '@yesid/gates/presets/transit';

const SRC = resolve(process.cwd(), 'src');
const DATAVIZ = resolve(process.cwd(), 'src/lib/components/dataviz');
const UI_ROOT = resolve(process.cwd(), 'src/lib/components/ui');

const rel = (p: string) => p.replace(resolve(process.cwd()) + '/', '');

// --- Gate 1: raw brand hex anywhere in src ----------------------------------

describe('brand doctrine — no raw brand hex anywhere in src', () => {
	const result = brandHexViolations({
		root: SRC,
		hexes: TRANSIT_BRAND_HEXES,
		allowlist: new Set(TRANSIT_BRAND_HEX_ALLOWLIST_REL.map((r) => resolve(process.cwd(), r))),
	});

	it('scans a non-empty source tree (guards against a wrong path)', () => {
		expect(result.fileCount).toBeGreaterThan(0);
	});

	it('no source file hardcodes #E07800 / #FFB627 — interactive orange and wayfinding amber must flow through tokens', () => {
		expect(result.violations, result.violations.join('\n')).toEqual([]);
	});
});

// --- Gate 2: dataviz kit must not encode data with affordance tokens --------

const datavizConfig = {
	affordanceTokens: TRANSIT_AFFORDANCE_TOKENS,
	allowMarkers: TRANSIT_ALLOW_MARKERS,
	markerWindow: 8,
};

describe('brand doctrine — dataviz kit encodes data only with the dataviz scale', () => {
	const files = walk(DATAVIZ, ['.svelte', '.ts']);

	it('scans a non-empty dataviz kit (guards against a wrong path)', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	for (const file of files) {
		it(`${rel(file)} does not use --primary/--success/--destructive/--accent as a data fill`, () => {
			const bad = datavizViolations(readFileSync(file, 'utf-8'), datavizConfig);
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
		expect(datavizViolations(src, datavizConfig)).toEqual([]);
	});
});

// --- Gate 3: tv() only in ui/ ------------------------------------------------

describe('brand doctrine — tailwind-variants value imports stay in ui/', () => {
	const result = tvOnlyInUiViolations({ root: SRC, uiRoots: [UI_ROOT] });

	it('scans a non-empty source tree', () => {
		expect(result.fileCount).toBeGreaterThan(0);
	});

	it('no tv() value import outside src/lib/components/ui (type-only imports are fine anywhere)', () => {
		expect(result.violations, result.violations.join('\n')).toEqual([]);
	});
});
