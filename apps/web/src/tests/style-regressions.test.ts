import { describe, it, expect } from 'vitest';
import { resolve, sep } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { styleRegressionViolations, type ForbiddenPattern } from '@yesid/gates';

function scanStyleRegressions(config: Parameters<typeof styleRegressionViolations>[0]) {
	return styleRegressionViolations(config).map((result) => ({
		...result,
		hits: result.hits.map((path) => path.split(sep).join('/')),
	}));
}

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

const FORBIDDEN_ROOTS = ['src/lib/components', 'src/lib/features', 'src/routes'] as const;
const STYLE_SOURCE_EXTENSIONS = ['.svelte', '.css'] as const;

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
		prefix: 'src/lib/features/receipt/sections/SectionStateCuts.svelte',
		reason: 'structural KPI-card wrapper (S5-382 B1)',
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
		const safeHits = scanStyleRegressions({
			root,
			extensions: STYLE_SOURCE_EXTENSIONS,
			forbidden: [BARE_PROSE_MEASURE],
		})[0].hits;
		const noCarveoutHits = scanStyleRegressions({
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
const TO_MIGRATE_2026_07_30 = [] as const;

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

it('keeps the progressive poster heading and kicker on shared type tokens', () => {
	const source = readFileSync(
		resolve(process.cwd(), 'src/lib/features/map/MapProgressive.svelte'),
		'utf8',
	);
	const kickerRule = source.match(/\.map-progressive-kicker\s*\{([^}]*)\}/)?.[1] ?? '';
	const headingRule = source.match(/\n\s*h1\s*\{([^}]*)\}/)?.[1] ?? '';

	expect(kickerRule).toContain('letter-spacing: var(--tracking-eyebrow)');
	expect(headingRule).toContain('font-size: var(--text-display)');
	expect(headingRule).toContain('font-weight: 700');
	expect(headingRule).toContain('letter-spacing: var(--tracking-tight)');
});

describe('style regressions — the FORBIDDEN guard (P5.3d §C4)', () => {
	for (const rel of FORBIDDEN_ROOTS) {
		const root = resolve(process.cwd(), rel);

		describe(rel, () => {
			const results = scanStyleRegressions({
				root,
				extensions: STYLE_SOURCE_EXTENSIONS,
				forbidden: FORBIDDEN,
			}).map((r) => ({
				...r,
				hits: r.hits
					.filter((h) => !h.includes(FROZEN_MARKS_SEGMENT))
					.filter((h) => !(r.reason === FORBIDDEN[0].reason && h === OWNER_DIRECTED_FOOTER_DIVIDER))
					.filter(
						(h) => r.pattern !== BARE_PROSE_MEASURE_PATTERN || !isMeasurePathExcluded(rel, h),
					),
			}));

			it('scans a non-empty tree (guards against a wrong path)', () => {
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
			return scanStyleRegressions({ root, forbidden: [RAW_TABLE] })[0].hits;
		}).sort();
		const nonFrozen = rawSites.filter((site) => !site.startsWith(FROZEN_MARKS_PREFIX));

		expect(EMPTY_RAW_TABLE_ALLOWLIST).toEqual([]);
		expect(nonFrozen).toEqual([DATA_TABLE_SITE, ...TO_MIGRATE_2026_07_30].sort());
	});
});
