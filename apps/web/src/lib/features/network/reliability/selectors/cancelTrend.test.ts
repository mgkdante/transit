import { describe, it, expect } from 'vitest';
import { selectCancelTrend } from './cancelTrend';
import type { TrendPoint } from '#lib/v1/index.ts';

const opts = {
	locale: 'en',
	title: 'Cancellations',
	seriesLabel: 'Cancelled %',
	pctUnit: '%',
} as const;

describe('selectCancelTrend', () => {
	it('emits a zero-based domain rounded just above the largest reading', () => {
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
		expect(vm.spec.domain).toEqual([0, 3]);
		expect(vm.spec.secondary).toBeUndefined();
	});
	it.each([0, 0.04, 1, 10, 99, 100])('keeps headroom above a maximum of %s', (max) => {
		const vm = selectCancelTrend(
			[
				{ date: 'a', cancellation_rate: max },
				{ date: 'b', cancellation_rate: 0 },
			],
			opts,
		);
		if (vm.spec.kind !== 'trend') throw new Error('Expected trend');
		expect(vm.spec.domain[0]).toBe(0);
		expect(vm.spec.domain[1]).toBeGreaterThan(max);
		if (max > 0) expect(vm.spec.domain[1]).toBeLessThanOrEqual(max * 1.5);
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
