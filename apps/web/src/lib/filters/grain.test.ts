import { describe, it, expect } from 'vitest';
import { usableGrains, isGrainUsable, MIN_POINTS_PER_GRAIN, availableGrains } from './grain';

describe('usableGrains — data-depth gating (the flat-trend fix)', () => {
	it('enables only grains with >= minPoints trustworthy buckets', () => {
		// a thin route: plenty of days, but week/month collapse to too few points.
		const counts = { day: 30, week: 4, month: 1 };
		expect(usableGrains('historic', counts)).toEqual(['day']);
	});

	it('enables coarser grains once they have enough buckets', () => {
		const counts = { day: 90, week: 12, month: 8 };
		expect(usableGrains('historic', counts)).toEqual(['day', 'week', 'month']);
	});

	it('treats a missing count as zero (grain disabled, not crashed)', () => {
		expect(usableGrains('historic', {})).toEqual([]);
	});

	it('never exceeds the tier-available set', () => {
		const counts = { day: 99, week: 99, month: 99, live: 99 };
		const usable = usableGrains('static', counts);
		for (const g of usable) expect(availableGrains('static')).toContain(g);
	});

	it('respects a custom minPoints', () => {
		const counts = { day: 5, week: 5, month: 5 };
		expect(usableGrains('historic', counts, 5)).toEqual(['day', 'week', 'month']);
		expect(usableGrains('historic', counts, MIN_POINTS_PER_GRAIN)).toEqual([]);
	});

	it('isGrainUsable gates on both availability and depth', () => {
		const counts = { day: 30, week: 2 };
		expect(isGrainUsable('historic', 'day', counts)).toBe(true);
		expect(isGrainUsable('historic', 'week', counts)).toBe(false); // too few buckets
		expect(isGrainUsable('historic', 'nonsense', counts)).toBe(false);
	});
});
