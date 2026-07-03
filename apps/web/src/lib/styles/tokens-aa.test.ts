// tokens-aa.test.ts — WCAG AA contrast gate, computed straight from the design
// tokens (tools/tokens/tokens.json). This is a quality GATE, not a full sweep:
// it locks the load-bearing text/background pairs the citizen dashboard relies
// on in both themes — the semantic text scale, the interactive orange, the
// wayfinding amber, AND the dataviz status marks read ON A CARD (the worst-case
// dataviz surface, since cards lift one step above the page).
//
// P5.1 (2026-07-02): the WCAG math + the pair tables moved to @yesid/gates
// (vendored design system) — this file adapted yesid.dev's pattern originally,
// and the engine + TRANSIT_* preset tables were extracted from THIS file's
// pre-P5.1 inline implementation verbatim (git history holds it). The same
// tables also gate the design repo's reconciled tokens.json upstream, so a
// palette drift fails in BOTH repos with the actual ratio.
//
// Floors (WCAG 2.x): 4.5:1 for normal text, 3:1 for graphical objects /
// large-scale data marks; the glyph-load-bearing occupancy dim bands carry
// measured regression locks (colour is deliberately NOT the channel there).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runContrastPairs } from '@yesid/gates';
import {
	TRANSIT_TEXT_PAIRS,
	TRANSIT_DATAVIZ_STATUS_ON_CARD,
	TRANSIT_DATAVIZ_OCCUPANCY_ON_CARD,
	TRANSIT_AA_PAIRS,
} from '@yesid/gates/presets/transit';

const tokens = JSON.parse(
	readFileSync(resolve(process.cwd(), 'tools/tokens/tokens.json'), 'utf-8'),
) as Record<string, unknown>;

describe('tokens AA — computed contrast from tools/tokens/tokens.json', () => {
	// Print the full ratio table once so a near-miss is visible in CI output.
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
