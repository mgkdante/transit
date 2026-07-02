import { describe, it, expect } from 'vitest';
import { NETWORK_GRAINS, presentGrains, defaultNetworkGrain } from './presentGrains';
import type { TrendPoint } from '$lib/v1';

const pts = (n: number): TrendPoint[] => Array.from({ length: n }, (_, i) => ({ date: `d${i}` }));

describe('presentGrains', () => {
	it('offers day/week/month finest→coarsest', () => {
		expect(NETWORK_GRAINS).toEqual(['day', 'week', 'month']);
	});

	it('a grain is present iff its series carries ≥1 bucket', () => {
		const present = presentGrains({ daily: pts(2), weekly: [], monthly: pts(1) });
		expect(present.has('day')).toBe(true);
		expect(present.has('week')).toBe(false);
		expect(present.has('month')).toBe(true);
	});

	it('the default is the richest present grain (day→week→month), else day', () => {
		expect(defaultNetworkGrain(new Set(['week', 'month']))).toBe('week');
		expect(defaultNetworkGrain(new Set(['month']))).toBe('month');
		expect(defaultNetworkGrain(new Set())).toBe('day');
	});
});
