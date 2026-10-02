import { describe, it, expect } from 'vitest';
import {
	METRICS,
	METRICS_BY_KEY,
	METRIC_KEYS,
	METRIC_CLUSTER_ORDER,
	metricInfoFor,
	type MetricEntry,
	type MetricKey,
} from './metrics.content';
import { metricsCopy } from './metrics.copy';

const SURFACE_METRICS: readonly MetricKey[] = [
	'otp',
	'avgDelay',
	'p50p90',
	'severe',
	'weakStops',
	'regularityCov',
	'headway',
	'excessWait',
	'cancellation',
	'skippedStop',
	'serviceSpan',
	'occupancy',
	'habits',
	'seasonality',
];

const bilingualFields: ReadonlyArray<keyof MetricEntry> = [
	'name',
	'oneLiner',
	'definition',
	'math',
	'notReally',
];

describe('metrics.content — EN/FR parity', () => {
	it('every entry carries non-empty EN + FR for every bilingual text field', () => {
		for (const entry of METRICS) {
			for (const field of bilingualFields) {
				const value = entry[field] as { en: string; fr: string };
				expect(value.en, `${entry.key}.${String(field)}.en`).toBeTruthy();
				expect(value.fr, `${entry.key}.${String(field)}.fr`).toBeTruthy();
			}
			expect(entry.caveats.en.length, `${entry.key}.caveats.en`).toBeGreaterThan(0);
			expect(entry.caveats.fr.length, `${entry.key}.caveats.fr`).toBeGreaterThan(0);
			expect(entry.caveats.en.length, `${entry.key}.caveats length parity`).toBe(
				entry.caveats.fr.length,
			);
			for (const c of [...entry.caveats.en, ...entry.caveats.fr]) {
				expect(c.trim(), `${entry.key} caveat non-empty`).toBeTruthy();
			}
			expect(entry.sql.trim(), `${entry.key}.sql`).toBeTruthy();
			expect(entry.sciName.trim(), `${entry.key}.sciName`).toBeTruthy();
		}
	});

	it('the page-chrome copy has full EN/FR parity', () => {
		const en = metricsCopy.en;
		const fr = metricsCopy.fr;
		expect(Object.keys(en.sections).sort()).toEqual(Object.keys(fr.sections).sort());
		expect(Object.keys(en.clusters).sort()).toEqual(Object.keys(fr.clusters).sort());
		expect(Object.keys(en.confidence.levels).sort()).toEqual(
			Object.keys(fr.confidence.levels).sort(),
		);
		for (const c of [en, fr]) {
			expect(c.heading).toBeTruthy();
			expect(c.lede).toBeTruthy();
			expect(c.provenance.body).toBeTruthy();
			expect(c.provenance.unavailable).toBeTruthy();
			expect(c.tocLabel).toBeTruthy();
			expect(c.backToTop).toBeTruthy();
			expect(c.info.link).toBeTruthy();
			expect(c.info.trigger('X')).toContain('X');
		}
	});

	it('carries the structural-gaps ("Lacunes") card with all three named gaps in both locales', () => {
		for (const c of [metricsCopy.en, metricsCopy.fr]) {
			expect(c.lacunes.title, 'lacunes title').toBeTruthy();
			expect(c.lacunes.lede, 'lacunes lede').toBeTruthy();
			expect(c.lacunes.gaps.length, 'three structural gaps').toBe(3);
			for (const gap of c.lacunes.gaps) {
				expect(gap.heading.trim(), 'gap heading non-empty').toBeTruthy();
				expect(gap.body.trim(), 'gap body non-empty').toBeTruthy();
			}
		}
		expect(metricsCopy.en.lacunes.gaps.length).toBe(metricsCopy.fr.lacunes.gaps.length);
	});

	it('names the three structural gaps verbatim (passenger-weighting / no-realtime / OD) in EN', () => {
		const en = metricsCopy.en.lacunes;
		const headings = en.gaps.map((g) => g.heading);
		expect(headings).toContain('Reliability is NOT passenger-weighted');
		expect(headings).toContain('No realtime for rapid-transit modes that do not broadcast it');
		expect(headings).toContain('Stop-level and route-level, NOT journey (origin to destination)');
		const odGap = en.gaps.find((g) => g.heading.includes('journey'));
		expect(odGap?.body).toContain('origin to destination');
		expect(odGap?.body.toLowerCase()).toContain('origin-destination');
	});

	it('keeps the structural-gaps copy provider-agnostic (no hardcoded provider/mode name)', () => {
		const allGapText = [...metricsCopy.en.lacunes.gaps, ...metricsCopy.fr.lacunes.gaps]
			.flatMap((g) => [g.heading, g.body])
			.join(' ')
			.toLowerCase();
		expect(allGapText).not.toContain('métro');
		expect(allGapText).not.toContain('metro');
		expect(allGapText).not.toContain('stm');
	});

	it('keeps the live-positions explainer provider-agnostic (no hardcoded provider name)', () => {
		const text = [metricsCopy.en.livePositions, metricsCopy.fr.livePositions]
			.flatMap((s) => [s.title, s.lede, ...s.points.flatMap((p) => [p.heading, p.body])])
			.join(' ')
			.toLowerCase();
		for (const re of [/\bstm\b/, /\bsto\b/, /\bsts\b/, /\boc[\s-]?transpo\b/]) {
			expect(text).not.toMatch(re);
		}
	});

	it('every cluster used by an entry has an overline in both locales', () => {
		const usedClusters = new Set(METRICS.map((m) => m.cluster));
		for (const cluster of usedClusters) {
			expect(METRIC_CLUSTER_ORDER, `${cluster} is a known cluster`).toContain(cluster);
			expect(metricsCopy.en.clusters[cluster], `en cluster ${cluster}`).toBeTruthy();
			expect(metricsCopy.fr.clusters[cluster], `fr cluster ${cluster}`).toBeTruthy();
		}
	});
});

describe('metrics.content — anchors', () => {
	it('every anchor is unique', () => {
		const anchors = METRICS.map((m) => m.anchor);
		expect(new Set(anchors).size, anchors.join(',')).toBe(anchors.length);
	});

	it('every anchor is URL-safe kebab-case (no leading # or spaces)', () => {
		for (const entry of METRICS) {
			expect(entry.anchor, entry.key).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
		}
	});

	it('metric keys are unique', () => {
		expect(new Set(METRIC_KEYS).size).toBe(METRIC_KEYS.length);
	});
});

describe('metrics.content — reliability-surface coverage', () => {
	it('every reliability-surface metric has an explainer entry', () => {
		for (const key of SURFACE_METRICS) {
			expect(METRICS_BY_KEY[key], `surface metric "${key}" needs a content entry`).toBeDefined();
		}
	});

	it('the explainer covers exactly the surface metric set (no orphans, none missing)', () => {
		expect([...METRIC_KEYS].sort()).toEqual([...SURFACE_METRICS].sort());
	});
});

describe('metricInfoFor — (i) affordance payload', () => {
	it('returns the one-line tip and a localized deep link to the anchor', () => {
		const en = metricInfoFor('otp', 'en');
		expect(en.tip).toBe(METRICS_BY_KEY.otp.oneLiner.en);
		expect(en.anchor).toBe('otp');
		expect(en.href).toBe('/metrics#otp');

		const fr = metricInfoFor('otp', 'fr');
		expect(fr.tip).toBe(METRICS_BY_KEY.otp.oneLiner.fr);
		expect(fr.href).toBe('/fr/metrics#otp');
	});

	it('builds the right kebab anchor href for a multi-word metric', () => {
		expect(metricInfoFor('avgDelay', 'en').href).toBe('/metrics#avg-delay');
		expect(metricInfoFor('p50p90', 'fr').href).toBe('/fr/metrics#p50-p90');
	});
});
