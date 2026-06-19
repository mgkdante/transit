// metrics.content.test.ts — guards the explainer's data integrity:
//   1. EN/FR key parity (every bilingual field carries both locales, non-empty).
//   2. Every anchor is unique + URL-safe kebab-case (deep links never collide).
//   3. The metric set covers the reliability surface's labels (no surface metric
//      lacks an explainer entry) — the parity that lets the (i) tip exist on
//      every reliability number.

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

// The reliability surface's metric set, expressed as MetricKeys. Every metric
// the reliability surface labels (snapshot strip + the five cluster bands) must
// have an explainer entry so the (i) tip can deep-link it. This list is the
// contract between the surface and the explainer.
const SURFACE_METRICS: readonly MetricKey[] = [
	'otp', // strip.otpPct
	'avgDelay', // strip.avgDelayMin
	'p50p90', // strip.p50Min / p90Min
	'severe', // severe bar (cluster 01)
	'weakStops', // weak-stops ranked list (cluster 01)
	'regularityCov', // strip.headwayRegularityCov + regularity caption
	'headway', // observed / scheduled (cluster 02)
	'excessWait', // excess_wait (cluster 02)
	'cancellation', // strip.cancellationRatePct
	'skippedStop', // strip.skippedStopRatePct
	'serviceSpan', // service spans (cluster 02/03)
	'occupancy', // occupancy_mix (cluster 04)
	'habits', // habits heatmap (cluster 05)
	'seasonality', // weekday severe list (cluster 05)
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
			// caveats is a parallel bilingual list — both locales present + same length.
			expect(entry.caveats.en.length, `${entry.key}.caveats.en`).toBeGreaterThan(0);
			expect(entry.caveats.fr.length, `${entry.key}.caveats.fr`).toBeGreaterThan(0);
			expect(entry.caveats.en.length, `${entry.key}.caveats length parity`).toBe(
				entry.caveats.fr.length,
			);
			for (const c of [...entry.caveats.en, ...entry.caveats.fr]) {
				expect(c.trim(), `${entry.key} caveat non-empty`).toBeTruthy();
			}
			// sql is language-neutral but must be present.
			expect(entry.sql.trim(), `${entry.key}.sql`).toBeTruthy();
			// sciName is a single mono label.
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
			expect(c.tocLabel).toBeTruthy();
			expect(c.backToTop).toBeTruthy();
			expect(c.info.link).toBeTruthy();
			expect(c.info.trigger('X')).toContain('X');
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
