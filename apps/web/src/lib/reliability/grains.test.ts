import { describe, expect, it } from 'vitest';
import { RELIABILITY_GRAINS, presentGrains, defaultReliabilityGrain } from './grains';

describe('reliability grains', () => {
	it.each([
		['line', { periods: [{ grain: 'month' }, { grain: 'day' }, { grain: 'am_peak' }] }],
		['stop', { periods: [{ grain: 'day' }, { grain: 'month' }, { grain: 'weekday' }] }],
		['network', { series: [{}], weekly: [], monthly: [{}] }],
	] as const)('finds the same calendar grains for a %s snapshot', (_entity, snapshot) => {
		expect(presentGrains(snapshot)).toEqual(new Set(['day', 'month']));
	});
	it('offers the finest available grain, with day as the empty fallback', () => {
		expect(RELIABILITY_GRAINS).toEqual(['day', 'week', 'month']);
		expect(defaultReliabilityGrain(new Set(['week', 'month']))).toBe('week');
		expect(defaultReliabilityGrain(new Set(['month']))).toBe('month');
		expect(defaultReliabilityGrain(presentGrains(null))).toBe('day');
	});
});
