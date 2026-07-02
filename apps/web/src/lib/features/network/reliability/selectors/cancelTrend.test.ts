import { describe, it, expect } from 'vitest';
import { selectCancelTrend } from './cancelTrend';
import { CANCEL_RATE_DOMAIN } from '$lib/features/reliability/shiftGrains';
import type { TrendPoint } from '$lib/v1';

describe('selectCancelTrend', () => {
	it('carries the series + latest non-null reading on the absolute [0,100] domain', () => {
		const points: TrendPoint[] = [
			{ date: 'a', cancellation_rate: 1.2 },
			{ date: 'b', cancellation_rate: 2.6 },
		];
		const vm = selectCancelTrend(points);
		expect(vm.hasCancel).toBe(true);
		expect(vm.series).toEqual([1.2, 2.6]);
		expect(vm.latest).toBe(2.6);
		expect(vm.domain).toEqual([CANCEL_RATE_DOMAIN[0], CANCEL_RATE_DOMAIN[1]]);
		expect(vm.domain).toEqual([0, 100]);
		expect(vm.empty).toEqual([null, null]);
	});

	it('finds the latest non-null reading past a trailing gap', () => {
		const points: TrendPoint[] = [
			{ date: 'a', cancellation_rate: 3.0 },
			{ date: 'b', cancellation_rate: null },
		];
		expect(selectCancelTrend(points).latest).toBe(3.0);
	});

	it('stands down (hasCancel false) when every point is null (never a flat zero line)', () => {
		const points: TrendPoint[] = [
			{ date: 'a', cancellation_rate: null },
			{ date: 'b', cancellation_rate: null },
		];
		const vm = selectCancelTrend(points);
		expect(vm.hasCancel).toBe(false);
		expect(vm.latest).toBeNull();
	});
});
