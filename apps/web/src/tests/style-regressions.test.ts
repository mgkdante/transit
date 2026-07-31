// style-regressions.test.ts — the FORBIDDEN guard (P5.3d §C4).
//
// The vibe kill-table sweep (P1–P12) retired four recurring anti-patterns from
// the `<style>` blocks. This gate makes those kills permanent: once a pattern is
// swept out of a directory, it can never come back. The detection engine is the
// vendored `styleRegressionViolations` (byte-equivalent to yesid.dev's
// style-regressions gate); the FORBIDDEN table + the scan roots are transit's
// per-app taste contract and live here.
//
// SCOPE (P5.3d stage B): the sweep is COMPLETE site-wide. Stage A cleared
// `lib/features/{map,lines}`; stage B cleared everything else —
// `lib/components/**` (ui/brand/dataviz edge, shared, shell, layout, surface,
// map canvas), `routes/**`, and the remaining `lib/features/**` surfaces. The
// guard now runs over the whole component + route tree with EMPTY selector/value
// allowlists (§C4: "Allowlists start and stay EMPTY."). Structural/legacy files
// outside the prose-measure law use the documented path-prefix exclusions below.
// Slice 040's binding owner directive restores one exact full-width footer
// divider; that declaration is inventory-pinned below while every other hit
// remains forbidden.
//
// FROZEN EXEMPTION (§C4 P8): the P5.2 chart marks under
// `lib/components/dataviz/chart/marks/**` are FROZEN — the sweep does not touch
// them and this guard does not scan them. Their stroke/dash literals and any
// pre-existing token fallbacks are the mark contract's business, out of scope
// for the vibe kill-table. This is a directory exclusion, NOT an allowlist: no
// individual violation is ever pinned, and the exclusion is expressed as a path
// prefix so nothing in the swept tree can hide behind it.
//
// The FORBIDDEN patterns (§C4 + WS4 A6):
//   1. STRIPES — border-(left|inline-start|top) accent rules on the brand tokens
//      (dataviz/primary/accent/rule). Retired by P7; they can't return.
//   2. RAW MS — a bare `<n>ms` duration/easing literal in a transition/animation.
//      All motion flows through `--duration-*`/`--ease-*` (P2).
//   3. TOKEN FALLBACKS — `var(--duration|ease|radius|space|measure…, <fallback>)`. tokens
//      are always loaded; the fallback is where the drift/lies lived (P2).
//   4. TEXT-SHADOW GLOW — `text-shadow` on a glow/primary/accent token. Glow is
//      never text (P-glow law); a neutral legibility halo is fine.
//   5. BARE PROSE MEASURES — max-width/max-inline-size with a ch/rem literal.
//      Delete the cap or use one of the shared --measure-* tokens.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { styleRegressionViolations, type ForbiddenPattern } from '@yesid/gates';

const TOKEN_FALLBACK_PATTERN = /var\(--(duration|ease|radius|space|spacing|measure)[a-z0-9-]*,/;
const BARE_PROSE_MEASURE_PATTERN =
	/(?<![-\w])(?<!\(\s*)(?:max-width|max-inline-size)\s*:\s*(?:\d+(?:\.\d+)?|\.\d+)(?:ch|rem)\b/;
const BARE_PROSE_MEASURE_WITHOUT_AT_RULE_CARVEOUT =
	/(?<![-\w])(?:max-width|max-inline-size)\s*:\s*(?:\d+(?:\.\d+)?|\.\d+)(?:ch|rem)\b/;
const BARE_PROSE_MEASURE: ForbiddenPattern = {
	pattern: BARE_PROSE_MEASURE_PATTERN,
	reason:
		'bare prose measure: max-width/max-inline-size with a ch/rem literal. Delete the cap or use a --measure-* token.',
};

// The FORBIDDEN table — site-final (§C4). No entry may be relaxed or removed.
const FORBIDDEN: readonly ForbiddenPattern[] = [
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
		pattern: TOKEN_FALLBACK_PATTERN,
		reason:
			'token fallback: var(--token, <fallback>) for a duration/ease/radius/space/measure token. tokens.css is always loaded — drop the fallback (P2 no-fallback law).',
	},
	{
		pattern: /text-shadow:[^;]*var\(--(glow|primary|accent)/,
		reason:
			'text-shadow glow: glow is never text (the glow-never-text law). A neutral legibility halo (e.g. var(--background)) is fine; a glow/primary/accent one is not.',
	},
	BARE_PROSE_MEASURE,
];

describe('style regressions — token-fallback falsification', () => {
	it('catches a measure-token fallback without banning a bare measure reference', () => {
		expect(TOKEN_FALLBACK_PATTERN.test('max-width: var(--measure-body, 60rem);')).toBe(true);
		expect(TOKEN_FALLBACK_PATTERN.test('max-width: var(--measure-body);')).toBe(false);
	});
});

// Swept roots — site-wide after stage B. The whole component + route tree is
// under the guard.
const FORBIDDEN_ROOTS = ['src/lib/components', 'src/lib/features', 'src/routes'] as const;
const STYLE_SOURCE_EXTENSIONS = ['.svelte', '.css'] as const;

// A6 path-prefix exclusions. These are structural files/subtrees outside the
// prose-measure law, never a selector/value allowlist. Home is the named legacy
// calibrated exception; _kit is dev-only. SearchInput and the two map controls
// are pre-existing control geometry that the prose census deliberately excludes.
const MEASURE_PATH_PREFIX_EXCLUSIONS = [
	{
		prefix: 'src/lib/components/shared/ErrorIllustration.svelte',
		reason: 'structural SVG cap',
	},
	{
		prefix: 'src/lib/components/surface/SearchInput.svelte',
		reason: 'structural input-control width',
	},
	{
		prefix: 'src/lib/features/alerts/sections/AlertLog.svelte',
		reason: 'structural card-list width',
	},
	{
		prefix: 'src/lib/features/health/sections/SectionEnvelope.svelte',
		reason: 'structural key-value grid',
	},
	{
		prefix: 'src/lib/features/health/sections/SectionRetention.svelte',
		reason: 'structural retention grid',
	},
	{
		prefix: 'src/lib/features/home/HomeHero.svelte',
		reason: 'legacy calibrated home measure',
	},
	{
		prefix: 'src/lib/features/home/HomeWhat.svelte',
		reason: 'legacy calibrated home measure',
	},
	{
		prefix: 'src/lib/features/map/MapMotionControl.svelte',
		reason: 'structural content-sized control',
	},
	{
		prefix: 'src/lib/features/map/MapSelectionDetail.svelte',
		reason: 'structural compact map panel',
	},
	{
		prefix: 'src/routes/+error.svelte',
		reason: 'structural error containers and responsive wrapper',
	},
	{
		prefix: 'src/routes/[[lang=locale]]/_kit/',
		reason: 'dev-only route subtree',
	},
] as const;
const EMPTY_MEASURE_LITERAL_ALLOWLIST: readonly string[] = [];

// Frozen-marks exclusion (§C4 P8). Any hit whose path is under the chart-marks
// directory is dropped from the report: the P5.2 chart marks are off-limits to
// the sweep, so the guard must not force an edit inside them. The engine emits
// hit paths with the SCAN ROOT replaced by 'src' (so under the
// 'src/lib/components' root a mark reads 'src/dataviz/chart/marks/…'); match on
// the directory segment to stay independent of which root produced the hit.
const FROZEN_MARKS_SEGMENT = 'dataviz/chart/marks/';
const OWNER_DIRECTED_FOOTER_DIVIDER = 'src/layout/Footer.svelte';
const OWNER_DIRECTED_FOOTER_DECLARATION = 'border-top: 2px solid var(--border-rule-accent)';

function measureHitPrefix(scanRoot: (typeof FORBIDDEN_ROOTS)[number], appPrefix: string) {
	return appPrefix.replace(scanRoot, 'src');
}

function isMeasurePathExcluded(scanRoot: (typeof FORBIDDEN_ROOTS)[number], hit: string): boolean {
	return MEASURE_PATH_PREFIX_EXCLUSIONS.some(
		({ prefix }) =>
			prefix.startsWith(`${scanRoot}/`) && hit.startsWith(measureHitPrefix(scanRoot, prefix)),
	);
}

describe('style regressions — prose-measure gate controls', () => {
	it('keeps the selector/value allowlist empty and every path-prefix exclusion live', () => {
		expect(EMPTY_MEASURE_LITERAL_ALLOWLIST).toEqual([]);

		const invalid = MEASURE_PATH_PREFIX_EXCLUSIONS.flatMap(({ prefix, reason }) => {
			const root = FORBIDDEN_ROOTS.find((candidate) => prefix.startsWith(`${candidate}/`));
			const issues = [];
			if (!root) issues.push(`${prefix}: outside the scan roots (${reason})`);
			if (!existsSync(resolve(process.cwd(), prefix)))
				issues.push(`${prefix}: stale path (${reason})`);
			return issues;
		});

		expect(invalid).toEqual([]);
	});

	it('does not mistake min-width declarations or @media max-width conditions for prose caps', () => {
		const root = resolve(process.cwd(), 'src/lib/components/schedule');
		const safeHits = styleRegressionViolations({
			root,
			extensions: STYLE_SOURCE_EXTENSIONS,
			forbidden: [BARE_PROSE_MEASURE],
		})[0].hits;
		const noCarveoutHits = styleRegressionViolations({
			root,
			extensions: STYLE_SOURCE_EXTENSIONS,
			forbidden: [
				{
					pattern: BARE_PROSE_MEASURE_WITHOUT_AT_RULE_CARVEOUT,
					reason: 'negative control without the at-rule carve-out',
				},
			],
		})[0].hits;

		expect(BARE_PROSE_MEASURE_PATTERN.test('min-width: 34rem;')).toBe(false);
		expect(BARE_PROSE_MEASURE_PATTERN.test('max-width: 55ch;')).toBe(true);
		expect(BARE_PROSE_MEASURE_PATTERN.test('max-inline-size: 28rem;')).toBe(true);
		expect(safeHits).toEqual([]);
		expect(noCarveoutHits).toContain('src/ScheduleTable.svelte');
	});
});

const RAW_TABLE: ForbiddenPattern = {
	pattern: /<table(?:\s|>)/,
	reason: 'raw table inventory',
};

// S5-375 probe 4: the stacked cell wrapper's track pin is the CI-escape
// mechanism — its PRESENCE is component-tested, its PLACEMENT was not.
// Both stack blocks must pin .data-table-cell-content to track two.
it('pins the DataTable cell wrapper to stack track two in both stack blocks', () => {
	const source = readFileSync(
		resolve(import.meta.dirname, '../lib/components/data/DataTable.svelte'),
		'utf8',
	);
	const pins = source.match(/\.data-table-cell-content\s*\{[^}]*grid-column:\s*2/g) ?? [];
	expect(pins).toHaveLength(2);
});

const EMPTY_RAW_TABLE_ALLOWLIST: readonly string[] = [];
const FROZEN_MARKS_PREFIX = 'src/dataviz/chart/marks/';
const DATA_TABLE_SITE = 'src/data/DataTable.svelte';
// Exact migration debt as of 2026-07-30. Each later WS5 PR deletes its migrated site.
// This is deliberately not a permissive allowlist: the observed inventory must equal it.
const TO_MIGRATE_2026_07_30 = [
	'src/health/sections/SectionHistoryCoverage.svelte',
	'src/home/HomeHero.svelte',
	'src/schedule/ScheduleTable.svelte',
] as const;

it('pins the owner-directed footer divider as the only P7 stripe in Footer.svelte', () => {
	const source = readFileSync(
		resolve(process.cwd(), 'src/lib/components/layout/Footer.svelte'),
		'utf8',
	);
	const stripePattern = new RegExp(FORBIDDEN[0].pattern.source, 'g');
	const statusRule = source.match(/\.footer-status-border\s*\{([^}]*)\}/)?.[1] ?? '';

	expect(source.match(stripePattern)).toHaveLength(1);
	expect(statusRule.replace(/\s+/g, ' ').trim()).toBe(`${OWNER_DIRECTED_FOOTER_DECLARATION};`);
});

describe('style regressions — the FORBIDDEN guard (P5.3d §C4)', () => {
	for (const rel of FORBIDDEN_ROOTS) {
		const root = resolve(process.cwd(), rel);

		describe(rel, () => {
			const results = styleRegressionViolations({
				root,
				extensions: STYLE_SOURCE_EXTENSIONS,
				forbidden: FORBIDDEN,
			}).map((r) => ({
				...r,
				hits: r.hits
					// Drop frozen-marks hits (§C4 P8) — the sweep never edits those files.
					.filter((h) => !h.includes(FROZEN_MARKS_SEGMENT))
					// Slice 040's owner-directed footer divider (pinned below).
					.filter((h) => !(r.reason === FORBIDDEN[0].reason && h === OWNER_DIRECTED_FOOTER_DIVIDER))
					// A6 exceptions are path-prefix exclusions for this pattern only.
					.filter(
						(h) => r.pattern !== BARE_PROSE_MEASURE_PATTERN || !isMeasurePathExcluded(rel, h),
					),
			}));

			it('scans a non-empty tree (guards against a wrong path)', () => {
				// Every root has .svelte files; if the walk found none the path is wrong.
				expect(results.length).toBe(FORBIDDEN.length);
			});

			for (const { reason, hits } of results) {
				it(`no ${reason}`, () => {
					expect(hits, `${rel}: ${reason}\n${hits.join('\n')}`).toEqual([]);
				});
			}
		});
	}
});

describe('raw table inventory — WS5 shrinking gate', () => {
	it('contains only DataTable, the dated migration debt, and the frozen marks prefix', () => {
		const rawSites = FORBIDDEN_ROOTS.flatMap((rel) => {
			const root = resolve(process.cwd(), rel);
			return styleRegressionViolations({ root, forbidden: [RAW_TABLE] })[0].hits;
		}).sort();
		const nonFrozen = rawSites.filter((site) => !site.startsWith(FROZEN_MARKS_PREFIX));

		expect(EMPTY_RAW_TABLE_ALLOWLIST).toEqual([]);
		expect(nonFrozen).toEqual([DATA_TABLE_SITE, ...TO_MIGRATE_2026_07_30].sort());
	});
});
