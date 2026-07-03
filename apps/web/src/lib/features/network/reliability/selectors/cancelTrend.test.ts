import { describe, it, expect } from 'vitest';
import { selectCancelTrend } from './cancelTrend';
import { CANCEL_RATE_DOMAIN } from '$lib/features/reliability/shiftGrains';
import type { TrendPoint } from '$lib/v1';

const opts = {
	locale: 'en',
	title: 'Cancellations',
	seriesLabel: 'Cancelled %',
	pctUnit: '%',
} as const;

describe('selectCancelTrend', () => {
	it('emits a single-series trend spec + the latest non-null reading on the absolute [0,100] domain', () => {
		const points: TrendPoint[] = [
			{ date: 'a', cancellation_rate: 1.2 },
			{ date: 'b', cancellation_rate: 2.6 },
		];
		const vm = selectCancelTrend(points, opts);
		expect(vm.hasCancel).toBe(true);
		expect(vm.latest).toBe(2.6);
		expect(vm.spec.kind).toBe('trend');
		if (vm.spec.kind !== 'trend') throw new Error('unreachable');
		expect(vm.spec.points.map((p) => p.y)).toEqual([1.2, 2.6]);
		expect(vm.spec.domain).toEqual([CANCEL_RATE_DOMAIN[0], CANCEL_RATE_DOMAIN[1]]);
		expect(vm.spec.domain).toEqual([0, 100]);
		// Single-series: no secondary channel (the legacy empty retard array is gone).
		expect(vm.spec.secondary).toBeUndefined();
	});

	it('finds the latest non-null reading past a trailing gap', () => {
		const points: TrendPoint[] = [
			{ date: 'a', cancellation_rate: 3.0 },
			{ date: 'b', cancellation_rate: null },
		];
		expect(selectCancelTrend(points, opts).latest).toBe(3.0);
	});

	it('stands down (hasCancel false, absence spec) when every point is null (never a flat zero line)', () => {
		const points: TrendPoint[] = [
			{ date: 'a', cancellation_rate: null },
			{ date: 'b', cancellation_rate: null },
		];
		const vm = selectCancelTrend(points, opts);
		expect(vm.hasCancel).toBe(false);
		expect(vm.latest).toBeNull();
		expect(vm.spec.kind).toBe('absence');
	});
});
