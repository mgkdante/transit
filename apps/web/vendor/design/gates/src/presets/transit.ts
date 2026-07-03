// transit preset tables — transcribed verbatim from transit's gates at the
// P5.1 adoption point: brand-doctrine.test.ts (brand hexes, affordance tokens,
// allow markers) + tokens-aa.test.ts (AA pairs incl. the dataviz-on-card sets).
// Transit's thin gate specs consume these tables and stay behavior-identical.
import type { ContrastPair } from '../engines/contrastPairs.js';

export const TRANSIT_BRAND_HEXES = ['#E07800', '#FFB627'] as const;

/** Relative path (from the app root) where the brand hex is legitimately defined. */
export const TRANSIT_BRAND_HEX_ALLOWLIST_REL = ['src/lib/styles/tokens.css'] as const;

export const TRANSIT_AFFORDANCE_TOKENS = ['primary', 'success', 'destructive', 'accent'] as const;

export const TRANSIT_ALLOW_MARKERS = [
	'doctrine-allow: interactive',
	'AFFORDANCE MARKER',
	'lone --primary touch',
] as const;

// Semantic text + interactive/wayfinding affordance pairs (4.5:1).
export const TRANSIT_TEXT_PAIRS: readonly ContrastPair[] = [
	['D foreground / background', ['dark', 'foreground'], ['dark', 'background'], 4.5],
	['D foreground / card', ['dark', 'foreground'], ['dark', 'card'], 4.5],
	['D muted-foreground / popover (worst case)', ['dark', 'muted-foreground'], ['dark', 'popover'], 4.5],
	['D primary / background (interactive orange)', ['dark', 'primary'], ['dark', 'background'], 4.5],
	['D primary / card', ['dark', 'primary'], ['dark', 'card'], 4.5],
	['D accent-text / card (wayfinding amber)', ['dark', 'accent-text'], ['dark', 'card'], 4.5],
	['D destructive / card', ['dark', 'destructive'], ['dark', 'card'], 4.5],
	['L foreground / background', ['light', 'foreground'], ['light', 'background'], 4.5],
	['L foreground / card', ['light', 'foreground'], ['light', 'card'], 4.5],
	['L muted-foreground / muted (worst case)', ['light', 'muted-foreground'], ['light', 'muted'], 4.5],
	['L primary / background (interactive orange)', ['light', 'primary'], ['light', 'background'], 4.5],
	['L primary / muted (worst case)', ['light', 'primary'], ['light', 'muted'], 4.5],
	['L accent-text / card (wayfinding amber)', ['light', 'accent-text'], ['light', 'card'], 4.5],
	['L destructive / muted (worst case)', ['light', 'destructive'], ['light', 'muted'], 4.5],
];

// Dataviz status marks read ON A CARD — the worst-case dataviz surface (cards
// lift one step above the page). Graphical data marks paired with a glyph ride
// the 3:1 graphical-object floor. Token keys are HYPHENATED (the SHARED
// CONTRACT: 'on_time' -> dataviz.status.on-time).
const STATUS_KEYS = ['early', 'on-time', 'late', 'severe', 'unknown'] as const;

export const TRANSIT_DATAVIZ_STATUS_ON_CARD: readonly ContrastPair[] = [
	...STATUS_KEYS.map(
		(k): ContrastPair => [
			`D dataviz-status-${k} / card`,
			['dark', `dataviz.status.${k}`],
			['dark', 'card'],
			3,
		],
	),
	...STATUS_KEYS.map(
		(k): ContrastPair => [
			`L dataviz-status-${k} / card`,
			['light', `dataviz.status.${k}`],
			['light', 'card'],
			3,
		],
	),
];

// Dataviz OCCUPANCY marks on a card. Occupancy is ALWAYS encoded glyph+color —
// the fill-level glyph is the load-bearing channel. The purple luminance ramp
// deliberately puts the LOW bands close to the dark surface; dim-band floors
// are REGRESSION LOCKS at the measured ratios (below 3:1 by design; the glyph
// carries the meaning). Bright bands hold the full 3:1.
export const TRANSIT_DATAVIZ_OCCUPANCY_ON_CARD: readonly ContrastPair[] = [
	['D dataviz-occupancy-many-seats / card', ['dark', 'dataviz.occupancy.many-seats'], ['dark', 'card'], 3],
	['D dataviz-occupancy-few-seats / card', ['dark', 'dataviz.occupancy.few-seats'], ['dark', 'card'], 3],
	['D dataviz-occupancy-standing / card', ['dark', 'dataviz.occupancy.standing'], ['dark', 'card'], 3],
	['D dataviz-occupancy-full / card', ['dark', 'dataviz.occupancy.full'], ['dark', 'card'], 3],
	['L dataviz-occupancy-few-seats / card', ['light', 'dataviz.occupancy.few-seats'], ['light', 'card'], 3],
	['L dataviz-occupancy-standing / card', ['light', 'dataviz.occupancy.standing'], ['light', 'card'], 3],
	['L dataviz-occupancy-full / card', ['light', 'dataviz.occupancy.full'], ['light', 'card'], 3],
	// Glyph-load-bearing dim bands — locked at the measured ratio.
	['D dataviz-occupancy-empty / card (glyph load-bearing)', ['dark', 'dataviz.occupancy.empty'], ['dark', 'card'], 2.1],
	['L dataviz-occupancy-empty / card (glyph load-bearing)', ['light', 'dataviz.occupancy.empty'], ['light', 'card'], 1.7],
	['L dataviz-occupancy-many-seats / card (glyph load-bearing)', ['light', 'dataviz.occupancy.many-seats'], ['light', 'card'], 2.7],
];

export const TRANSIT_AA_PAIRS: readonly ContrastPair[] = [
	...TRANSIT_TEXT_PAIRS,
	...TRANSIT_DATAVIZ_STATUS_ON_CARD,
	...TRANSIT_DATAVIZ_OCCUPANCY_ON_CARD,
];
