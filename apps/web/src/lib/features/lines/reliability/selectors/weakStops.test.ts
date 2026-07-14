import { describe, it, expect } from 'vitest';
import { selectWeakStops, type WeakStopsLabels } from './weakStops';
import { DELAY_POS_DOMAIN, SEVERE_DOMAIN } from '$lib/features/reliability/domains';
import type { WeakStop } from '$lib/v1';

const labels: WeakStopsLabels = {
	title: 'Weakest stops',
	rowLabel: 'Stop',
	xLabel: 'Avg delay',
	unit: ' min',
	stopHref: (id) => `/stop/${id}`,
};

const stops: WeakStop[] = [
	{ id: 'a', name: 'Alpha', avg_delay_min: 2 },
	{ id: 'b', name: 'Bravo', avg_delay_min: 6 },
	{ id: 'c', name: 'Charlie', avg_delay_min: 4 },
	{ id: 'd', name: null, avg_delay_min: null }, // no measured delay → filtered out
];

describe('selectWeakStops — scalar/fallback (avg-delay magnitude)', () => {
	it('ranks worst mean-delay first and truncates to N', () => {
		const { spec, total, shown } = selectWeakStops(stops, 2, 'en', labels);
		expect(total).toBe(3); // the null-delay stop is excluded from the ranking
		expect(shown).toBe(2);
		expect(spec.kind).toBe('magnitude-bars');
		if (spec.kind !== 'magnitude-bars') throw new Error('expected magnitude-bars');
		expect(spec.rows.map((r) => r.label)).toEqual(['Bravo', 'Charlie']); // 6 then 4
		expect(spec.rows[0].value).toBe(6);
	});

	it('emits the ABSOLUTE delay domain, severity scale, and per-row drill hrefs', () => {
		const { spec } = selectWeakStops(stops, 10, 'en', labels);
		if (spec.kind !== 'magnitude-bars') throw new Error('expected magnitude-bars');
		expect(spec.domain).toEqual(DELAY_POS_DOMAIN);
		expect(spec.domain[0]).toBe(0); // zero-based, never /max
		expect(spec.scale).toBe('severity');
		expect(spec.sort).toBe('given'); // already ranked by the selector
		expect(spec.rows[0].href).toBe('/stop/b');
		expect(spec.rows.every((r) => r.severity != null)).toBe(true);
		expect(spec.rowLabel).toBe('Stop');
	});

	it('falls back to a stop-id label when the name is missing', () => {
		const { spec } = selectWeakStops(
			[{ id: 'x99', name: null, avg_delay_min: 3 }],
			5,
			'en',
			labels,
		);
		if (spec.kind !== 'magnitude-bars') throw new Error('expected magnitude-bars');
		expect(spec.rows[0].label).toContain('x99');
	});

	it('returns an honest-absence spec when no stop has a measured delay', () => {
		const { spec, total, shown } = selectWeakStops(
			[{ id: 'a', name: 'A', avg_delay_min: null }],
			10,
			'en',
			labels,
		);
		expect(total).toBe(0);
		expect(shown).toBe(0);
		expect(spec.kind).toBe('absence');
	});
});

describe('selectWeakStops — windowed/preRanked (severe-rate magnitude, S7-B)', () => {
	const winLabels: WeakStopsLabels = {
		...labels,
		severeXLabel: 'Severe-delay rate',
		severeUnit: '%',
		note: (w) => `severe ${w.severe_pct}% n=${w.observation_count}`,
		ciLabel: '95% CI',
	};
	// DB-ranked worst-first by the not-severe Wilson LB (NOT avg). The first stop's pooled avg is
	// <= 0 — a worst-by-rate stop — and MUST still draw a non-zero bar (severe-rate magnitude).
	// wilson_lo/hi are the contract's NOT-severe-rate CI (real semantics: not_severe = 100 − severe,
	// e.g. severe 42 → not_severe 58 ∈ [53, 67]); the selector flips them onto the severe scale so
	// the rendered CI brackets the bar — [100 − hi, 100 − lo] = [33, 47] for w1.
	const winStops: WeakStop[] = [
		{
			id: 'w1',
			name: 'Worst',
			avg_delay_min: -1,
			severe_pct: 42,
			observation_count: 987,
			wilson_lo: 53,
			wilson_hi: 67,
		},
		{
			id: 'w2',
			name: 'Second',
			avg_delay_min: 6,
			severe_pct: 30,
			observation_count: 400,
			wilson_lo: 64,
			wilson_hi: 76,
		},
		{
			id: 'w3',
			name: 'Third',
			avg_delay_min: 4,
			severe_pct: 18,
			observation_count: 200,
			wilson_lo: 76,
			wilson_hi: 88,
		},
	];

	it('encodes severe_pct on SEVERE_DOMAIN and PRESERVES the DB order (no re-sort by avg)', () => {
		const { spec } = selectWeakStops(winStops, 10, 'en', winLabels, { preRanked: true });
		if (spec.kind !== 'magnitude-bars') throw new Error('expected magnitude-bars');
		expect(spec.domain).toEqual(SEVERE_DOMAIN);
		expect(spec.domain[0]).toBe(0);
		expect(spec.xLabel).toBe('Severe-delay rate');
		expect(spec.unit).toBe('%');
		// order is the contract order, NOT avg-DESC (which would put w2 first).
		expect(spec.rows.map((r) => r.key)).toEqual(['w1', 'w2', 'w3']);
		expect(spec.rows[0].value).toBe(42); // severe rate, not the -1 avg
	});

	it('a worst stop with avg <= 0 draws a NON-ZERO bar (the dishonest-empty-bar fix)', () => {
		const { spec } = selectWeakStops(winStops, 10, 'en', winLabels, { preRanked: true });
		if (spec.kind !== 'magnitude-bars') throw new Error('expected magnitude-bars');
		expect(spec.rows[0].value).toBe(42); // > 0, the severe rate — never an empty bar
	});

	it('surfaces n / severe-scale wilson bounds / the evidence note + ciLabel on the windowed path', () => {
		const { spec } = selectWeakStops(winStops, 10, 'en', winLabels, { preRanked: true });
		if (spec.kind !== 'magnitude-bars') throw new Error('expected magnitude-bars');
		expect(spec.rows[0].n).toBe(987);
		// the CI is FLIPPED onto the severe scale ([100 − 67, 100 − 53] = [33, 47]) so it brackets
		// the bar's value (42), instead of the raw not-severe interval [53, 67] far up the axis.
		expect(spec.rows[0].wilsonLo).toBe(33);
		expect(spec.rows[0].wilsonHi).toBe(47);
		expect(spec.rows[0].wilsonLo!).toBeLessThanOrEqual(spec.rows[0].value!);
		expect(spec.rows[0].value!).toBeLessThanOrEqual(spec.rows[0].wilsonHi!);
		expect(spec.rows[0].note).toBe('severe 42% n=987');
		expect(spec.ciLabel).toBe('95% CI'); // the Wilson interval is surfaced (whisker + tooltip + sr-only)
	});

	it('omits ciLabel on the scalar/fallback path (no Wilson bounds there)', () => {
		const { spec } = selectWeakStops(stops, 10, 'en', winLabels);
		if (spec.kind !== 'magnitude-bars') throw new Error('expected magnitude-bars');
		expect(spec.ciLabel).toBeUndefined();
	});

	it('truncates to N honestly (total = full served set, shown <= N)', () => {
		const { total, shown } = selectWeakStops(winStops, 2, 'en', winLabels, { preRanked: true });
		expect(total).toBe(3);
		expect(shown).toBe(2);
	});

	it('a null severe_pct renders the honest no-data swatch (value null, never 0)', () => {
		const { spec } = selectWeakStops(
			[{ id: 'z', name: 'Z', avg_delay_min: 2, severe_pct: null, observation_count: 40 }],
			5,
			'en',
			winLabels,
			{ preRanked: true },
		);
		if (spec.kind !== 'magnitude-bars') throw new Error('expected magnitude-bars');
		expect(spec.rows[0].value).toBeNull();
	});
});
