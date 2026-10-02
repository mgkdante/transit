// The neutral detection engines live in @yesid/gates. Transit owns its product

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { brandHexViolations, datavizViolations, tvOnlyInUiViolations, walk } from '@yesid/gates';
import {
	TRANSIT_BRAND_HEXES,
	TRANSIT_BRAND_HEX_ALLOWLIST_REL,
	TRANSIT_AFFORDANCE_TOKENS,
	TRANSIT_ALLOW_MARKERS,
} from '../../tools/design-gates';

const SRC = resolve(process.cwd(), 'src');
const DATAVIZ = resolve(process.cwd(), 'src/lib/components/dataviz');
const UI_ROOT = resolve(process.cwd(), 'src/lib/components/ui');

const rel = (p: string) => p.replace(resolve(process.cwd()) + '/', '');

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

	it('the doctrine-allow marker clears a genuine interactive affordance (and only then)', () => {
		const hit = '<line stroke="var(--primary)" />';
		expect(datavizViolations(hit, datavizConfig)).toHaveLength(1);
		const allowed = `<!-- doctrine-allow: interactive — a UI affordance, not a data mark -->\n${hit}`;
		expect(datavizViolations(allowed, datavizConfig)).toEqual([]);
	});
});

describe('brand doctrine — tailwind-variants value imports stay in ui/', () => {
	const result = tvOnlyInUiViolations({ root: SRC, uiRoots: [UI_ROOT] });

	it('scans a non-empty source tree', () => {
		expect(result.fileCount).toBeGreaterThan(0);
	});

	it('no tv() value import outside src/lib/components/ui (type-only imports are fine anywhere)', () => {
		expect(result.violations, result.violations.join('\n')).toEqual([]);
	});
});
