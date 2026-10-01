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

const PRIMITIVE = 'src/lib/components/data/DataTable.svelte';
const MARKS_DIR = 'src/lib/components/dataviz/chart/marks/';

type MarkVerdict = 'out:sr-only-chart-fallback';

interface MarkClassification {
	readonly file: string;
	readonly verdict: MarkVerdict;
	readonly reason: string;
}

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
			const markup = source.replace(/<!--[\s\S]*?-->/g, '');
			const tables = markup.match(/<table[^>]*>/g) ?? [];
			expect(tables, file).toHaveLength(1);
			expect(tables[0], file).toMatch(/class="sr-only"/);
			expect(markup, file).toMatch(/<caption>/);
			expect(source, file).not.toMatch(/\bDataTable\b/);
		}
	});
});

interface CssRule {
	readonly atRule: string;
	readonly selector: string;
	readonly body: string;
}

function styleBlocks(source: string): string[] {
	return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]);
}

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
const RENDER_SITE_COUNT = /<DataTable\b/g;

type Verdict =
	| 'drift:type-scale'
	| 'drift:density'
	| 'drift:hairline'
	| 'drift:header-treatment'
	| 'drift:frame-surface'
	| 'drift:responsive-collapse'
	| 'drift:redundant'
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
				rule: "@media (max-width: 1023px) | :global( .data-table-frame[data-responsive='stack'][data-stack-at='tablet'] table.coverage-table.data-table tbody th ), :global( .data-table-frame[data-responsive='stack'][data-stack-at='tablet'] table.coverage-table.data-table tbody td ) { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.875rem; border-bottom: 1px solid var(--border); }",
				verdict: 'drift:responsive-collapse',
				note: "replaces the primitive's stacked label/value grid with a vertical flex layout, and overrides its gap, padding and separator. Responsive collapse remains primitive-owned; this is still drift.",
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

describe('F22 D — extraction verdict for yesid.dev-design', () => {
	it('records that DataTable serves ONE app and therefore stays app-side', () => {
		// 2026-08-04. `@yesid/ui` ships no table primitive. yesid.dev has
		const consumerFiles = RENDER_SITES.length;
		const renderSites = RENDER_SITES.reduce((sum, site) => sum + site.renders, 0);

		expect(consumerFiles).toBe(5);
		expect(renderSites).toBe(7);
		// A design-system import would show up as an @yesid/* table import here.
		expect(read(resolve(WEB_ROOT, PRIMITIVE))).not.toMatch(/from '@yesid\//);
	});
});
