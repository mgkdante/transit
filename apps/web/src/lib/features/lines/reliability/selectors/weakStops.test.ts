import { describe, it, expect } from 'vitest';
import { selectWeakStops, type WeakStopsLabels } from './weakStops';
import { DELAY_POS_DOMAIN } from '$lib/features/reliability/domains';
import type { WeakStop } from '$lib/v1';

const labels: WeakStopsLabels = {
	title: 'Weakest stops',
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

describe('selectWeakStops', () => {
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
