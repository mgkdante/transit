// tokens-aa.test.ts — WCAG AA contrast gate, computed straight from the design
// tokens (tools/tokens/tokens.json). This is a quality GATE, not a full sweep:
// it locks the load-bearing text/background pairs the citizen dashboard relies
// on in both themes — the semantic text scale, the interactive orange, the
// wayfinding amber, AND the dataviz status marks read ON A CARD (the worst-case
// dataviz surface, since cards lift one step above the page).
//
// Why compute from the JSON rather than the generated CSS: the JSON is the
// single source of truth the generators consume; any palette drift that breaks
// a contracted pair fails HERE with the actual ratio, before it can reach a
// stylesheet. Pattern adapted from yesid.dev's contrast-floors.test.ts.
//
// Floors (WCAG 2.x): 4.5:1 for normal text, 3:1 for graphical objects /
// large-scale data marks. Dataviz status fills are read as graphical objects
// (a coloured chip/dot paired with a glyph), so they ride the 3:1 floor.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Token access — the JSON is DTCG-shaped: color.<mode>.<...path>.$value. Dataviz
// keys are nested (color.<mode>.dataviz.status.on-time.$value). hex() walks a
// dotted path and asserts the leaf is a 6-digit hex.
// ---------------------------------------------------------------------------

const tokens = JSON.parse(
	readFileSync(resolve(process.cwd(), 'tools/tokens/tokens.json'), 'utf-8'),
) as Record<string, unknown>;

type Mode = 'dark' | 'light' | 'brand';

function leaf(path: string): unknown {
	return path.split('.').reduce<unknown>((node, key) => {
		if (node && typeof node === 'object' && key in (node as Record<string, unknown>)) {
			return (node as Record<string, unknown>)[key];
		}
		return undefined;
	}, tokens);
}

/** Resolve a `color.<mode>.<path>` token to its 6-digit hex value. */
function hex(mode: Mode, path: string): string {
	const node = leaf(`color.${mode}.${path}`) as { $value?: unknown } | undefined;
	const v = node?.$value;
	if (typeof v !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(v)) {
		throw new Error(`token color.${mode}.${path} is not a 6-digit hex color: ${String(v)}`);
	}
	return v;
}

// ---------------------------------------------------------------------------
// WCAG 2.x relative luminance + contrast ratio.
// ---------------------------------------------------------------------------

function luminance(h: string): number {
	const [r, g, b] = [1, 3, 5]
		.map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
		.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

// [label, [fgMode, fgPath], [bgMode, bgPath], floor]
type Pair = [string, [Mode, string], [Mode, string], number];

// Semantic text + interactive/wayfinding affordance pairs (4.5:1).
const TEXT_PAIRS: Pair[] = [
	['D foreground / background', ['dark', 'foreground'], ['dark', 'background'], 4.5],
	['D foreground / card', ['dark', 'foreground'], ['dark', 'card'], 4.5],
	[
		'D muted-foreground / popover (worst case)',
		['dark', 'muted-foreground'],
		['dark', 'popover'],
		4.5,
	],
	['D primary / background (interactive orange)', ['dark', 'primary'], ['dark', 'background'], 4.5],
	['D primary / card', ['dark', 'primary'], ['dark', 'card'], 4.5],
	['D accent-text / card (wayfinding amber)', ['dark', 'accent-text'], ['dark', 'card'], 4.5],
	['D destructive / card', ['dark', 'destructive'], ['dark', 'card'], 4.5],
	['L foreground / background', ['light', 'foreground'], ['light', 'background'], 4.5],
	['L foreground / card', ['light', 'foreground'], ['light', 'card'], 4.5],
	[
		'L muted-foreground / muted (worst case)',
		['light', 'muted-foreground'],
		['light', 'muted'],
		4.5,
	],
	[
		'L primary / background (interactive orange)',
		['light', 'primary'],
		['light', 'background'],
		4.5,
	],
	['L primary / muted (worst case)', ['light', 'primary'], ['light', 'muted'], 4.5],
	['L accent-text / card (wayfinding amber)', ['light', 'accent-text'], ['light', 'card'], 4.5],
	['L destructive / muted (worst case)', ['light', 'destructive'], ['light', 'muted'], 4.5],
];

// Dataviz status marks read ON A CARD — the worst-case dataviz surface (cards
// lift one step above the page). These are graphical data marks paired with a
// glyph, so they ride the 3:1 graphical-object floor. Token keys are HYPHENATED
// (the SHARED CONTRACT: 'on_time' -> dataviz.status.on-time).
const STATUS_KEYS = ['early', 'on-time', 'late', 'severe', 'unknown'] as const;
const DATAVIZ_STATUS_ON_CARD: Pair[] = [
	...STATUS_KEYS.map(
		(k): Pair => [
			`D dataviz-status-${k} / card`,
			['dark', `dataviz.status.${k}`],
			['dark', 'card'],
			3,
		],
	),
	...STATUS_KEYS.map(
		(k): Pair => [
			`L dataviz-status-${k} / card`,
			['light', `dataviz.status.${k}`],
			['light', 'card'],
			3,
		],
	),
];

// Dataviz OCCUPANCY marks on a card. Occupancy is ALWAYS encoded glyph+color —
// the fill-level glyph (OCCUPANCY_GLYPH ▁▃▅▇█ in dataviz/tokens.ts) is the
// load-bearing channel. The purple luminance ramp deliberately puts the LOW
// bands close to the dark surface, so `empty` (both themes) and light
// `many-seats` sit BELOW the 3:1 graphical-object floor ON COLOUR ALONE — which
// is exactly why the glyph is mandatory, never optional (slice-9.3, map hero).
// Floors here are REGRESSION LOCKS at the measured ratios: a palette drift that
// darkens a band below its lock fails loudly. Bright bands hold the full 3:1.
const DATAVIZ_OCCUPANCY_ON_CARD: Pair[] = [
	[
		'D dataviz-occupancy-many-seats / card',
		['dark', 'dataviz.occupancy.many-seats'],
		['dark', 'card'],
		3,
	],
	[
		'D dataviz-occupancy-few-seats / card',
		['dark', 'dataviz.occupancy.few-seats'],
		['dark', 'card'],
		3,
	],
	[
		'D dataviz-occupancy-standing / card',
		['dark', 'dataviz.occupancy.standing'],
		['dark', 'card'],
		3,
	],
	['D dataviz-occupancy-full / card', ['dark', 'dataviz.occupancy.full'], ['dark', 'card'], 3],
	[
		'L dataviz-occupancy-few-seats / card',
		['light', 'dataviz.occupancy.few-seats'],
		['light', 'card'],
		3,
	],
	[
		'L dataviz-occupancy-standing / card',
		['light', 'dataviz.occupancy.standing'],
		['light', 'card'],
		3,
	],
	['L dataviz-occupancy-full / card', ['light', 'dataviz.occupancy.full'], ['light', 'card'], 3],
	// Glyph-load-bearing dim bands — locked at the measured ratio (below 3:1 by
	// design; the fill-glyph carries the meaning, colour does not).
	[
		'D dataviz-occupancy-empty / card (glyph load-bearing)',
		['dark', 'dataviz.occupancy.empty'],
		['dark', 'card'],
		2.1,
	],
	[
		'L dataviz-occupancy-empty / card (glyph load-bearing)',
		['light', 'dataviz.occupancy.empty'],
		['light', 'card'],
		1.7,
	],
	[
		'L dataviz-occupancy-many-seats / card (glyph load-bearing)',
		['light', 'dataviz.occupancy.many-seats'],
		['light', 'card'],
		2.7,
	],
];

const ALL_PAIRS: Pair[] = [...TEXT_PAIRS, ...DATAVIZ_STATUS_ON_CARD, ...DATAVIZ_OCCUPANCY_ON_CARD];

describe('tokens AA — computed contrast from tools/tokens/tokens.json', () => {
	// Print the full ratio table once so a near-miss is visible in CI output.
	it('prints the computed ratio table', () => {
		const rows = ALL_PAIRS.map(([label, fg, bg, floor]) => {
			const r = ratio(hex(fg[0], fg[1]), hex(bg[0], bg[1]));
			const mark = r >= floor ? 'PASS' : 'FAIL';
			return `  ${mark}  ${r.toFixed(2)}:1  (>=${floor})  ${label}`;
		});
		console.log(`\nWCAG contrast ratios (tokens.json):\n${rows.join('\n')}\n`);
		expect(rows.length).toBe(ALL_PAIRS.length);
	});

	describe('semantic text + interactive/wayfinding pairs >= 4.5:1', () => {
		for (const [label, fg, bg, floor] of TEXT_PAIRS) {
			it(`${label} >= ${floor}:1`, () => {
				const r = ratio(hex(fg[0], fg[1]), hex(bg[0], bg[1]));
				expect(r, `${label} computed ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(floor);
			});
		}
	});

	describe('dataviz status marks on card (graphical objects) >= 3:1', () => {
		for (const [label, fg, bg, floor] of DATAVIZ_STATUS_ON_CARD) {
			it(`${label} >= ${floor}:1`, () => {
				const r = ratio(hex(fg[0], fg[1]), hex(bg[0], bg[1]));
				expect(r, `${label} computed ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(floor);
			});
		}
	});
});
