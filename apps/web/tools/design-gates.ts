import type { ForbiddenPattern } from '@yesid/gates';
import type { ContrastPair } from '@yesid/gates';

export const TRANSIT_BRAND_HEXES = ['#E07800', '#FFB627'] as const;

export const TRANSIT_AFFORDANCE_TOKENS = ['primary', 'success', 'destructive', 'accent'] as const;

export const TRANSIT_ALLOW_MARKERS = [
	'doctrine-allow: interactive',
	'AFFORDANCE MARKER',
	'lone --primary touch',
] as const;

export const TRANSIT_TEXT_PAIRS: readonly ContrastPair[] = [
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

const STATUS_KEYS = ['early', 'on-time', 'late', 'severe', 'unknown'] as const;

export const TRANSIT_DATAVIZ_STATUS_ON_CARD: readonly ContrastPair[] = [
	...STATUS_KEYS.map(
		(key): ContrastPair => [
			`D dataviz-status-${key} / card`,
			['dark', `dataviz.status.${key}`],
			['dark', 'card'],
			3,
		],
	),
	...STATUS_KEYS.map(
		(key): ContrastPair => [
			`L dataviz-status-${key} / card`,
			['light', `dataviz.status.${key}`],
			['light', 'card'],
			3,
		],
	),
];

export const TRANSIT_DATAVIZ_OCCUPANCY_ON_CARD: readonly ContrastPair[] = [
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

export const TRANSIT_STYLE_ROOTS = ['src/lib/components/', 'src/lib/features/', 'src/routes/'];
const BARE_PROSE_MEASURE =
	/(?<![-\w])(?<!\(\s*)(?:max-width|max-inline-size)\s*:\s*(?:\d+(?:\.\d+)?|\.\d+)(?:ch|rem)\b/;
export const TRANSIT_FORBIDDEN: ForbiddenPattern[] = [
	{
		pattern:
			/border-(left|inline-start|top):\s*[23]px\s+solid\s+(var\(--(dataviz|primary|accent|rule|border-rule)|color-mix)/,
		reason:
			'stripe: a 2px/3px accent border-rule (P7 retired these). Carry the signal with StatusBadge / a severity chip / a full border-color / the numbered chip instead.',
	},
	{
		pattern: /border-(left|l)-\[?[^\];]*\b(dataviz|primary|accent|rule)\b[^\];]*\]?\s+/,
		reason: 'stripe: a Tailwind border-left utility on a brand token (P7 retired these).',
	},
	{
		pattern:
			/transition:[^;]*\b\d+ms\b|animation:[^;]*\b\d+ms\b|\btransition-duration:\s*\d+ms|\banimation-duration:\s*\d+ms/,
		reason:
			'raw motion literal: a bare <n>ms in a transition/animation. Use --duration-* / --ease-* tokens (P2).',
	},
	{
		pattern: /var\(--(duration|ease|radius|space|spacing|measure)[a-z0-9-]*,/,
		reason:
			'token fallback: var(--token, <fallback>) for a duration/ease/radius/space/measure token. tokens.css is always loaded \u2014 drop the fallback (P2 no-fallback law).',
	},
	{
		pattern: /text-shadow:[^;]*var\(--(glow|primary|accent)/,
		reason:
			'text-shadow glow: glow is never text (the glow-never-text law). A neutral legibility halo (e.g. var(--background)) is fine; a glow/primary/accent one is not.',
	},
	{
		pattern: BARE_PROSE_MEASURE,
		reason:
			'bare prose measure: max-width/max-inline-size with a ch/rem literal. Delete the cap or use a --measure-* token.',
	},
];

// Frozen chart marks skip every pattern; these structural widths skip only the prose-measure one.
export const TRANSIT_STYLE_EXEMPTIONS = {
	everyPattern: ['dataviz/chart/marks/'],
	proseMeasure: [
		'src/lib/components/surface/SearchInput.svelte',
		'src/lib/features/alerts/sections/AlertLog.svelte',
		'src/lib/features/health/sections/SectionEnvelope.svelte',
		'src/lib/features/health/sections/SectionRetention.svelte',
		'src/lib/features/receipt/sections/SectionStateCuts.svelte',
		'src/lib/features/map/MapMotionControl.svelte',
		'src/lib/features/map/MapSelectionDetail.svelte',
	],
	measurePattern: BARE_PROSE_MEASURE,
};
