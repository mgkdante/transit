// table-consolidation-f22.test.ts — the F22 table-consolidation receipts.
//
// F22 is the owner's "table styling componentization and consolidation across
// pages". The consolidation itself already shipped: `components/data/DataTable`
// is the ONE page-level table primitive, and it is the only non-chart file in
// the tree that renders a raw `<table>`. What never shipped were the acceptance
// receipts. This file is those receipts. It builds NOTHING; it measures.
//
// Three things live here, each with its own gate:
//
//   A. THE CHART-MARK CLASSIFICATION. Nine files under
//      `components/dataviz/chart/marks/**` render a raw `<table>`. The owner
//      asked for each one to be classified IN or OUT of the shared table
//      contract with a stated reason, not assumed. All nine are classified OUT
//      below, one entry per file, each reason read off that file. The
//      classification is not a comment that can rot: the gate asserts the
//      classified set EQUALS the observed set, and asserts the load-bearing
//      fact behind every OUT verdict (`<table class="sr-only">` — a visually
//      hidden accessible fallback for an SVG chart, never a rendered surface).
//      If a mark's fallback ever becomes visible, or a tenth mark appears, the
//      classification fails rather than silently going stale.
//
//   B. THE DECLARATION FINGERPRINT. The owner's receipt: "a declaration-
//      fingerprint check that page-level tables no longer carry bespoke
//      styling". The scanner walks every DataTable consumer, extracts every CSS
//      rule whose selector reaches a table element or a `data-table` internal,
//      and asserts the observed set EQUALS the pinned ledger below. A new
//      bespoke rule in any consumer — including a consumer that carries none
//      today — turns this RED. Each pinned rule carries an adjudication
//      verdict; the drift entries are the scoped follow-on work, recorded here
//      so the debt is named rather than invisible.
//
//   C. THE ABSENCE COMPOSITION. F21 shipped the in-table empty state; that
//      state is part of the table's contract, so no host may reach past the
//      primitive to restyle an absence sitting inside a cell.
//
// NOT IN SCOPE HERE: real overflow geometry. happy-dom performs no layout
// (`getBoundingClientRect().width === 0`), so a geometry assertion in vitest is
// a false receipt. Every assertion below is source/DOM-shaped on purpose.

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = process.cwd();
const SRC = resolve(WEB_ROOT, 'src');

const read = (absolute: string): string => readFileSync(absolute, 'utf8');
const rel = (absolute: string): string => relative(WEB_ROOT, absolute).split('\\').join('/');

function svelteFiles(root: string): string[] {
	const out: string[] = [];
	const walk = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const absolute = join(directory, entry.name);
			if (entry.isDirectory()) walk(absolute);
			else if (extname(entry.name) === '.svelte') out.push(absolute);
		}
	};
	walk(root);
	return out.sort();
}

const ALL_SVELTE = svelteFiles(SRC);

// ---------------------------------------------------------------------------
// A. the chart-mark classification
// ---------------------------------------------------------------------------

const PRIMITIVE = 'src/lib/components/data/DataTable.svelte';
const MARKS_DIR = 'src/lib/components/dataviz/chart/marks/';

type MarkVerdict = 'out:sr-only-chart-fallback';

interface MarkClassification {
	readonly file: string;
	readonly verdict: MarkVerdict;
	readonly reason: string;
}

// Read one file at a time on 2026-08-04 at base 95907930. Every one of the nine
// is the same shape and the shape is why they are OUT: a `<table class="sr-only">`
// sibling of the SVG inside the mark's `<figure>`, carrying the chart's values as
// text for assistive tech. It is never painted, so structure, density, header
// treatment, alignment, zebra/hairlines, overflow/scroll and responsive collapse
// — everything the shared primitive owns — are all inapplicable to it. Routing
// them through DataTable would mean handing a visual contract to markup that has
// no visual presentation, and would drag the chart layer into a dependency on
// `components/data` for zero rendered benefit.
const MARK_CLASSIFICATION: readonly MarkClassification[] = [
	{
		file: `${MARKS_DIR}DotStripMark.svelte`,
		verdict: 'out:sr-only-chart-fallback',
		reason:
			'sr-only fallback for the dot strip: one row per group (group name + value), captioned with the spec title. Not a rendered surface.',
	},
	{
		file: `${MARKS_DIR}DumbbellMark.svelte`,
		verdict: 'out:sr-only-chart-fallback',
		reason:
			'sr-only fallback for the scheduled/observed dumbbell: three columns keyed to the two endpoint labels the SVG encodes as position.',
	},
	{
		file: `${MARKS_DIR}HeatmapMark.svelte`,
		verdict: 'out:sr-only-chart-fallback',
		reason:
			'sr-only fallback for the day x hour grid: the tier WORD per cell, so the read never rests on hue. The visible grid is SVG in a ScrollFrame, which owns its own overflow.',
	},
	{
		file: `${MARKS_DIR}HistogramMark.svelte`,
		verdict: 'out:sr-only-chart-fallback',
		reason:
			'sr-only fallback for the distribution: EVERY bin including the tail bins the SVG clips. Its row count is deliberately larger than what is drawn.',
	},
	{
		file: `${MARKS_DIR}LineMark.svelte`,
		verdict: 'out:sr-only-chart-fallback',
		reason:
			'sr-only fallback for the multi-series line: one column per series, one row per x tick.',
	},
	{
		file: `${MARKS_DIR}MagnitudeBarsMark.svelte`,
		verdict: 'out:sr-only-chart-fallback',
		reason:
			'sr-only fallback for the ranking, including the per-row drill links and the confidence-interval text. Content, not styling.',
	},
	{
		file: `${MARKS_DIR}SparklineMark.svelte`,
		verdict: 'out:sr-only-chart-fallback',
		reason:
			'sr-only fallback for the sparkline: a caption plus a headerless two-column tbody. It has no `<thead>` at all, so the primitive\u2019s column-header contract does not even apply.',
	},
	{
		file: `${MARKS_DIR}StackedShareMark.svelte`,
		verdict: 'out:sr-only-chart-fallback',
		reason:
			'sr-only fallback for the 100%-stacked share bar: the colour read in words, one row per band. Headerless, like the sparkline.',
	},
	{
		file: `${MARKS_DIR}TrendMark.svelte`,
		verdict: 'out:sr-only-chart-fallback',
		reason:
			'sr-only fallback for the trend: x tick, primary value, and the optional secondary series.',
	},
];

const RAW_TABLE = /<table(?:\s|>)/;

describe('F22 A — chart-internal tables are classified, not assumed', () => {
	it('classifies every raw-table file in the tree and nothing that is not one', () => {
		const observed = ALL_SVELTE.filter((file) => RAW_TABLE.test(read(file))).map(rel);
		const classified = MARK_CLASSIFICATION.map((entry) => entry.file);

		expect(observed).toEqual([PRIMITIVE, ...classified].sort());
	});

	it('holds every OUT verdict to the sr-only fact it rests on', () => {
		for (const { file, verdict, reason } of MARK_CLASSIFICATION) {
			const source = read(resolve(WEB_ROOT, file));
			expect(verdict, file).toBe('out:sr-only-chart-fallback');
			expect(reason.length, file).toBeGreaterThan(40);
			// The whole verdict rests on this: the table is visually hidden.
			// (Several marks describe their fallback in a doc comment, so the
			// comments come out before the markup is counted.)
			const markup = source.replace(/<!--[\s\S]*?-->/g, '');
			const tables = markup.match(/<table[^>]*>/g) ?? [];
			expect(tables, file).toHaveLength(1);
			expect(tables[0], file).toMatch(/class="sr-only"/);
			// A fallback without a caption would be an accessibility defect, not
			// an out-of-scope layout scaffold.
			expect(markup, file).toMatch(/<caption>/);
			// And it must not be reaching for the shared primitive.
			expect(source, file).not.toMatch(/\bDataTable\b/);
		}
	});
});

// ---------------------------------------------------------------------------
// B. the declaration fingerprint
// ---------------------------------------------------------------------------

interface CssRule {
	readonly atRule: string;
	readonly selector: string;
	readonly body: string;
}

function styleBlocks(source: string): string[] {
	return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]);
}

/** Flattens a CSS block to leaf rules, hoisting at-rule conditions onto each leaf. */
function cssRules(css: string, atRule = ''): CssRule[] {
	const out: CssRule[] = [];
	let index = 0;
	while (index < css.length) {
		const open = css.indexOf('{', index);
		if (open < 0) break;
		const prelude = css.slice(index, open).trim();
		let depth = 1;
		let cursor = open + 1;
		while (cursor < css.length && depth > 0) {
			if (css[cursor] === '{') depth += 1;
			if (css[cursor] === '}') depth -= 1;
			cursor += 1;
		}
		const body = css.slice(open + 1, cursor - 1);
		if (prelude.startsWith('@')) out.push(...cssRules(body, prelude.replace(/\s+/g, ' ')));
		else
			out.push({
				atRule,
				selector: prelude.replace(/\s+/g, ' '),
				body: body.replace(/\s+/g, ' ').trim(),
			});
		index = cursor;
	}
	return out;
}

/**
 * A selector "reaches into the table" when it names a DataTable internal or a
 * bare table element. Both forms are bespoke table styling: the first reaches
 * past the primitive's props, the second styles table markup directly.
 */
const TABLE_ELEMENT_SELECTOR = /(^|[\s,>+~(])(table|thead|tbody|tfoot|tr|th|td)([\s,.:[)#]|$)/;
const reachesIntoTable = (selector: string): boolean =>
	/data-table/.test(selector) || TABLE_ELEMENT_SELECTOR.test(selector);

const fingerprint = (rule: CssRule): string =>
	`${rule.atRule ? `${rule.atRule} | ` : ''}${rule.selector} { ${rule.body} }`;

function tableRules(source: string): string[] {
	return styleBlocks(source)
		.flatMap((css) => cssRules(css.replace(/\/\*[\s\S]*?\*\//g, '')))
		.filter((rule) => reachesIntoTable(rule.selector))
		.map(fingerprint)
		.sort();
}

const RENDER_SITE = /<DataTable\b/;
const RENDER_SITE_COUNT = /<DataTable\b/g; // .match()-only twin: String.match ignores lastIndex; never .test() a /g regex

type Verdict =
	// Drift: the declaration re-specifies something the primitive's own contract
	// names (structure, density, header treatment, alignment, zebra/hairlines,
	// overflow, responsive collapse). It belongs in DataTable's API as a prop or
	// a documented variant, not in a `:global()` reaching into its internals.
	| 'drift:type-scale'
	| 'drift:density'
	| 'drift:hairline'
	| 'drift:header-treatment'
	| 'drift:frame-surface'
	| 'drift:responsive-collapse'
	| 'drift:redundant'
	// Legitimate: the declaration is about this instance's HOST, its content
	// shape, or an editorial emphasis — none of which the primitive can own
	// without becoming a config surface for every page that uses it.
	| 'legitimate:host-layout'
	| 'legitimate:content-shape'
	| 'legitimate:editorial-emphasis';

const DRIFT_VERDICTS: readonly Verdict[] = [
	'drift:type-scale',
	'drift:density',
	'drift:hairline',
	'drift:header-treatment',
	'drift:frame-surface',
	'drift:responsive-collapse',
	'drift:redundant',
];

interface PinnedRule {
	readonly rule: string;
	readonly verdict: Verdict;
	readonly note: string;
}

interface RenderSite {
	readonly file: string;
	readonly renders: number;
	readonly bespoke: readonly PinnedRule[];
}

// The before/after inventory of every page-level table render site, measured on
// 2026-08-04 at base 95907930. `renders` is the count of `<DataTable …/>` in the
// file; `bespoke` is the exact, whitespace-normalised set of rules in that
// file's `<style>` that reach a table element or a `data-table` internal.
//
// ADJUDICATION SUMMARY (the honest read, per the owner's ask):
//   * FOUR of the six consumers override the table's font-size, three of them
//     with a different value and two of them identically. The primitive
//     hardcodes `font-size: var(--text-small)`. That is a MISSING API, not six
//     independent taste calls — the strongest drift signal in the tree.
//   * THREE consumers each invent their own cell padding. Density is named in
//     the primitive's own contract, so a consumer setting it bespoke is drift
//     by definition.
//   * TWO consumers disagree with the primitive's row hairline, one by colour
//     and one by replacing the model wholesale with per-cell borders.
//   * ONE consumer (SectionHistoryCoverage) re-authors the primitive's tablet
//     stacked-collapse metrics. That is the heaviest single piece of drift.
// Fixing these is a CONSTRUCTION slice (a type-scale + density + hairline API on
// DataTable, then six migrations, then browser-lane geometry proof at the mobile
// ladder). F22 is verification: the drift is named and pinned here so it cannot
// grow while it waits.
const RENDER_SITES: readonly RenderSite[] = [
	{
		file: 'src/lib/components/schedule/ScheduleTable.svelte',
		renders: 3,
		bespoke: [
			{
				rule: ":global(.schedule-table-frame.data-table-frame[data-frame='card']) { background: var(--surface-2); }",
				verdict: 'drift:frame-surface',
				note: "frame='card' already owns a background (var(--card)); this swaps it. Belongs as a frame variant.",
			},
			{
				rule: ':global(.schedule-table.data-table th), :global(.schedule-table.data-table td) { padding: 0.8rem 1rem; border-bottom: 1px solid var(--border-subtle, var(--border)); vertical-align: top; }',
				verdict: 'drift:density',
				note: 'cell density plus a hairline model the primitive already provides; vertical-align re-states the primitive default.',
			},
			{
				rule: ':global(.schedule-table.data-table thead th) { white-space: nowrap; }',
				verdict: 'legitimate:content-shape',
				note: 'header labels must not wrap on a horizontally scrolling board. Scoped to thead, so the F21 no-nowrap law on VALUE cells is untouched.',
			},
			{
				rule: ':global(.schedule-table.data-table tbody tr + tr > *) { border-top: 0; }',
				verdict: 'drift:hairline',
				note: "cancels the primitive's row separator because the padding rule above re-implemented it as border-bottom.",
			},
			{
				rule: ':global(.schedule-table.data-table tbody tr:last-child > *) { border-bottom: 0; }',
				verdict: 'drift:hairline',
				note: 'the trailing-edge cleanup the replaced hairline model needs.',
			},
			{
				rule: ':global(.schedule-table.data-table tbody th), :global(.schedule-table.data-table tbody td) { font-family: var(--font-mono); font-size: var(--text-small); line-height: 1.45; color: var(--foreground); }',
				verdict: 'drift:redundant',
				note: 'three of the four declarations restate primitive defaults verbatim; only line-height is new.',
			},
			{
				rule: ':global(.schedule-table.data-table tbody th) { font-weight: 700; color: var(--accent-text); }',
				verdict: 'legitimate:editorial-emphasis',
				note: 'the service period is this board\u2019s row identity. Emphasis is an editorial call the primitive should not make.',
			},
			{
				rule: '@media (max-width: 48rem) | :global(.schedule-table.data-table th), :global(.schedule-table.data-table td) { padding: 0.7rem 0.75rem; }',
				verdict: 'drift:density',
				note: 'the same density drift, at a breakpoint.',
			},
		],
	},
	{
		file: 'src/lib/features/health/sections/SectionHistoryCoverage.svelte',
		renders: 1,
		bespoke: [
			{
				rule: ':global(table.coverage-table.data-table) { font-size: inherit; }',
				verdict: 'drift:type-scale',
				note: "undoes the primitive's hardcoded --text-small so the table inherits the section scale.",
			},
			{
				rule: ':global(table.coverage-table.data-table th), :global(table.coverage-table.data-table td) { padding: 0.875rem; }',
				verdict: 'drift:density',
				note: 'a third independent cell density.',
			},
			{
				rule: ':global(table.coverage-table.data-table tbody td) { font-family: inherit; }',
				verdict: 'drift:type-scale',
				note: "undoes the primitive's blanket mono on body cells. The primitive already has a per-column `numeric` flag; that is the right carrier for mono, not every tbody td.",
			},
			{
				rule: ':global(table.coverage-table.data-table tbody tr + tr > *) { border-top-color: var(--border); }',
				verdict: 'drift:hairline',
				note: "strengthens the primitive's 60%-alpha hairline to full. Two consumers now disagree with the primitive about hairlines.",
			},
			{
				rule: "@media (max-width: 1023px) | :global( .data-table-frame[data-responsive='stack'][data-stack-at='tablet'] table.coverage-table.data-table tbody tr ) { padding: 0; }",
				verdict: 'drift:responsive-collapse',
				note: 'zeroes the stacked row padding the primitive sets.',
			},
			{
				rule: "@media (max-width: 1023px) | :global( .data-table-frame[data-responsive='stack'][data-stack-at='tablet'] table.coverage-table.data-table tbody th ), :global( .data-table-frame[data-responsive='stack'][data-stack-at='tablet'] table.coverage-table.data-table tbody td ) { grid-template-columns: minmax(6.5rem, 0.35fr) minmax(0, 1fr); gap: 0.75rem; padding: 0.875rem; border-bottom: 1px solid var(--border); }",
				verdict: 'drift:responsive-collapse',
				note: "re-authors the primitive's stacked label/value track (7rem/0.45fr -> 6.5rem/0.35fr), its gap, its padding and its separator. Responsive collapse is named in the primitive's contract; this is the heaviest drift in the tree.",
			},
			{
				rule: "@media (max-width: 1023px) | :global( .data-table-frame[data-responsive='stack'][data-stack-at='tablet'] table.coverage-table.data-table tbody tr > :last-child ) { border-bottom: 0; }",
				verdict: 'drift:responsive-collapse',
				note: 'the trailing-edge cleanup the re-authored stack needs.',
			},
		],
	},
	{
		file: 'src/lib/features/hotspots/sections/HotspotSection.svelte',
		renders: 1,
		bespoke: [
			{
				rule: ':global(table.hotspot-tray-table.data-table) { font-size: var(--text-detail-body-mobile); }',
				verdict: 'drift:type-scale',
				note: 'the detail-body scale, set bespoke.',
			},
			{
				rule: '@media (min-width: 1024px) | :global(table.hotspot-tray-table.data-table) { font-size: var(--text-detail-body-desktop); }',
				verdict: 'drift:type-scale',
				note: 'and its desktop step. Byte-identical to the RepeatOffenderEvidenceTable pair below — the same override, invented twice.',
			},
		],
	},
	{
		file: 'src/lib/features/lines/reliability/sections/Section2TheWait.svelte',
		renders: 1,
		bespoke: [],
	},
	{
		file: 'src/lib/features/repeat-offenders/sections/RepeatOffenderEvidenceTable.svelte',
		renders: 1,
		bespoke: [
			{
				rule: ':global(table.offender-evidence-table.data-table) { font-size: var(--text-detail-body-mobile); }',
				verdict: 'drift:type-scale',
				note: 'the second copy of the HotspotSection pair.',
			},
			{
				rule: '@media (min-width: 1024px) | :global(table.offender-evidence-table.data-table) { font-size: var(--text-detail-body-desktop); }',
				verdict: 'drift:type-scale',
				note: 'the second copy of the HotspotSection desktop step.',
			},
		],
	},
];

describe('F22 B — the page-level declaration fingerprint', () => {
	it('inventories every DataTable render site (a new consumer must be declared)', () => {
		const observed = ALL_SVELTE.filter((file) => RENDER_SITE.test(read(file))).map((file) => ({
			file: rel(file),
			renders: (read(file).match(RENDER_SITE_COUNT) ?? []).length,
		}));

		expect(observed).toEqual(RENDER_SITES.map(({ file, renders }) => ({ file, renders })));
	});

	it('pins the exact bespoke table styling at every render site', () => {
		for (const { file, bespoke } of RENDER_SITES) {
			const observed = tableRules(read(resolve(WEB_ROOT, file)));
			expect(observed, `${file}: bespoke table styling changed`).toEqual(
				bespoke.map(({ rule }) => rule).sort(),
			);
		}
	});

	it('holds every pinned rule to a closed verdict set and a stated reason', () => {
		const verdicts = new Set<string>([
			...DRIFT_VERDICTS,
			'legitimate:host-layout',
			'legitimate:content-shape',
			'legitimate:editorial-emphasis',
		]);
		for (const { file, bespoke } of RENDER_SITES) {
			for (const { rule, verdict, note } of bespoke) {
				expect(verdicts.has(verdict), `${file}: ${rule}`).toBe(true);
				expect(note.length, `${file}: ${rule}`).toBeGreaterThan(20);
			}
		}
	});

	it('detects a planted bespoke rule (the fingerprint is not vacuously green)', () => {
		const clean = read(
			resolve(WEB_ROOT, 'src/lib/features/lines/reliability/sections/Section2TheWait.svelte'),
		);
		expect(tableRules(clean)).toEqual([]);

		const planted = clean.replace(
			'<style>',
			"<style>\n\t:global(table[data-slot='direction-table'].data-table td) { padding: 2rem; }",
		);
		expect(tableRules(planted)).toEqual([
			":global(table[data-slot='direction-table'].data-table td) { padding: 2rem; }",
		]);

		// …and the scanner is not fooled by a comment, an at-rule, or a
		// non-table selector that happens to contain the letters.
		expect(tableRules('<style>/* td { padding: 2rem } */ .thread { gap: 0; }</style>')).toEqual([]);
		expect(
			tableRules(
				'<style>@media (min-width: 40rem) { .x :global(.data-table) { gap: 0; } }</style>',
			),
		).toEqual(['@media (min-width: 40rem) | .x :global(.data-table) { gap: 0; }']);
	});

	it('names the drift the follow-on construction slice owes (nothing may be dropped silently)', () => {
		const drift = RENDER_SITES.flatMap(({ file, bespoke }) =>
			bespoke
				.filter(({ verdict }) => (DRIFT_VERDICTS as readonly string[]).includes(verdict))
				.map(({ verdict }) => `${file} :: ${verdict}`),
		);
		// 19 bespoke rules total: 17 drift + 2 legitimate, across 4 of the 5
		// consumers. Section2TheWait is the only clean one.
		expect(drift).toHaveLength(17);
		expect(
			new Set(RENDER_SITES.filter(({ bespoke }) => bespoke.length > 0).map(({ file }) => file))
				.size,
		).toBe(4);
		expect(
			RENDER_SITES.flatMap(({ bespoke }) => bespoke).filter(({ verdict }) =>
				verdict.startsWith('legitimate:'),
			),
		).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// C. the absence composition (F21 x F22)
// ---------------------------------------------------------------------------

describe('F22 C — the in-table empty state is part of the table contract', () => {
	it('lets no host restyle an absence sitting inside a table cell', () => {
		for (const { file, bespoke } of RENDER_SITES) {
			for (const { rule } of bespoke) {
				expect(rule, `${file}: a host is restyling the in-table absence primitive`).not.toMatch(
					/absent-value|state-notice/,
				);
			}
		}
	});

	it('keeps every in-table absence site inside the fingerprint inventory', () => {
		// The sites absence-containment.test.ts pins for `variant="row"`. Every
		// one of them must also be a fingerprinted render site, so the empty
		// state and the styling contract can never be pinned in different places.
		const absenceSites = [
			'src/lib/components/schedule/ScheduleTable.svelte',
			'src/lib/features/repeat-offenders/sections/RepeatOffenderEvidenceTable.svelte',
			'src/lib/features/hotspots/sections/HotspotSection.svelte',
			'src/lib/features/lines/reliability/sections/Section2TheWait.svelte',
			'src/lib/features/health/sections/SectionHistoryCoverage.svelte',
		];
		const inventoried = new Set(RENDER_SITES.map(({ file }) => file));

		for (const site of absenceSites) {
			expect(inventoried.has(site), `${site}: absence site missing from the F22 inventory`).toBe(
				true,
			);
			expect(read(resolve(WEB_ROOT, site))).toMatch(
				/<(?:AbsentValue|MaybeValue|StateNotice)\b[^>]*\b(?:variant|presentation)="row"/,
			);
		}
	});
});

// ---------------------------------------------------------------------------
// D. the third-consumer (extraction) verdict
// ---------------------------------------------------------------------------

describe('F22 D — extraction verdict for yesid.dev-design', () => {
	it('records that DataTable serves ONE app and therefore stays app-side', () => {
		// The owner's rule: an export serving one app stays app-side. DataTable
		// has 5 consumer files / 7 render sites, every one of them in this app.
		//
		// The third-consumer test was run against the other two repos on
		// 2026-08-04. `@yesid/ui` ships no table primitive. yesid.dev has
		// exactly ONE raw table — `apps/web/src/lib/components/home/
		// HeroSqlPanel.svelte`, a hero panel dressed as a psql result grid —
		// and it would NOT take DataTable as-is: it is chrome, not a data
		// surface, so it wants no caption (DataTable throws on an empty one),
		// no stacked collapse, no scroll region and no absence contract, and it
		// sets its own `text-xs md:text-sm` scale. Adopting the primitive there
		// would mean re-introducing exactly the `:global()` overrides pinned
		// above as drift. The API is also shaped by transit's needs (a `numeric`
		// column flag, a `terminal` header band, two named stack breakpoints).
		// VERDICT: does NOT earn extraction today. Re-test if a second product
		// grows a real data-table surface.
		const consumerFiles = RENDER_SITES.length;
		const renderSites = RENDER_SITES.reduce((sum, site) => sum + site.renders, 0);

		expect(consumerFiles).toBe(5);
		expect(renderSites).toBe(7);
		// A design-system import would show up as an @yesid/* table import here.
		expect(read(resolve(WEB_ROOT, PRIMITIVE))).not.toMatch(/from '@yesid\//);
	});
});
