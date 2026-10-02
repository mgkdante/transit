// The neutral WCAG math lives in @yesid/gates. Transit owns the product-specific

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runContrastPairs } from '@yesid/gates';
import {
	TRANSIT_TEXT_PAIRS,
	TRANSIT_DATAVIZ_STATUS_ON_CARD,
	TRANSIT_DATAVIZ_OCCUPANCY_ON_CARD,
	TRANSIT_AA_PAIRS,
} from '../../../tools/design-gates';

const tokens = JSON.parse(
	readFileSync(resolve(process.cwd(), 'tools/tokens/tokens.json'), 'utf-8'),
) as Record<string, unknown>;

describe('tokens AA — computed contrast from tools/tokens/tokens.json', () => {
	it('prints the computed ratio table', () => {
		const rows = runContrastPairs(tokens, TRANSIT_AA_PAIRS).map(
			(r) => `  ${r.pass ? 'PASS' : 'FAIL'}  ${r.ratio.toFixed(2)}:1  (>=${r.floor})  ${r.label}`,
		);
		console.log(`\nWCAG contrast ratios (tokens.json):\n${rows.join('\n')}\n`);
		expect(rows.length).toBe(TRANSIT_AA_PAIRS.length);
	});

	describe('semantic text + interactive/wayfinding pairs >= 4.5:1', () => {
		for (const result of runContrastPairs(tokens, TRANSIT_TEXT_PAIRS)) {
			it(`${result.label} >= ${result.floor}:1`, () => {
				expect(result.pass, `${result.label} computed ${result.ratio.toFixed(2)}:1`).toBe(true);
			});
		}
	});

	describe('dataviz status marks on card (graphical objects) >= 3:1', () => {
		for (const result of runContrastPairs(tokens, TRANSIT_DATAVIZ_STATUS_ON_CARD)) {
			it(`${result.label} >= ${result.floor}:1`, () => {
				expect(result.pass, `${result.label} computed ${result.ratio.toFixed(2)}:1`).toBe(true);
			});
		}
	});

	describe('dataviz occupancy marks on card (incl. glyph-load-bearing locks)', () => {
		for (const result of runContrastPairs(tokens, TRANSIT_DATAVIZ_OCCUPANCY_ON_CARD)) {
			it(`${result.label} >= ${result.floor}:1`, () => {
				expect(result.pass, `${result.label} computed ${result.ratio.toFixed(2)}:1`).toBe(true);
			});
		}
	});
});
