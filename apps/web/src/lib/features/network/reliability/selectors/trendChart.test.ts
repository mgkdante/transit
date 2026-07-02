import { describe, it, expect } from 'vitest';
import { selectTrendChart, selectVehiclesSeries } from './trendChart';
import {
	DELAY_DIST_DOMAIN,
	OTP_TREND_MIN_SPAN,
	OTP_TREND_REFERENCE,
} from '$lib/features/reliability/shiftGrains';
import type { TrendPoint } from '$lib/v1';

const points: TrendPoint[] = [
	{ date: '2026-06-14', otp_pct: 78, avg_delay_min: 2.1, p90_min: 5, vehicles: 9 },
	{ date: '2026-06-15', otp_pct: 81, avg_delay_min: 1.8, p90_min: 6, vehicles: 11 },
	{ date: '2026-06-16', otp_pct: null, avg_delay_min: null, p90_min: null, vehicles: null },
];

describe('selectTrendChart', () => {
	it('reads the p90 series under the p90 channel on the absolute [0,15] domain (never in-view max)', () => {
		const vm = selectTrendChart(points, 'p90');
		expect(vm.retard).toEqual([5, 6, null]);
		expect(vm.retardDomain).toEqual([DELAY_DIST_DOMAIN[0], DELAY_DIST_DOMAIN[1]]);
		expect(vm.retardDomain).toEqual([0, 15]);
	});

	it('reads the avg series under the retard channel when forced to avg (week/month)', () => {
		const vm = selectTrendChart(points, 'avg');
		expect(vm.retard).toEqual([2.1, 1.8, null]);
	});

	it('keeps null points as GAPS in both channels (never bridged, never a fabricated 0)', () => {
		const vm = selectTrendChart(points, 'p90');
		expect(vm.onTime).toEqual([78, 81, null]);
		expect(vm.retard[2]).toBeNull();
	});

	it('vehicles series is null-gapped', () => {
		expect(selectVehiclesSeries(points)).toEqual([9, 11, null]);
	});

	it('zooms the on-time axis to a data-anchored, min-span-floored, [0,100]-clamped domain (S9B)', () => {
		// A low-variance week (87/88) — the flat-trend complaint: the axis must floor the span so the
		// wiggle shows slope, while staying inside [0,100] and carrying the absolute 80% reference.
		const flat = selectTrendChart(
			[
				{ date: 'a', otp_pct: 87 },
				{ date: 'b', otp_pct: 88 },
			],
			'avg',
		);
		expect(flat.onTimeDomain[1] - flat.onTimeDomain[0]).toBeGreaterThanOrEqual(OTP_TREND_MIN_SPAN);
		expect(flat.onTimeDomain[0]).toBeGreaterThanOrEqual(0);
		expect(flat.onTimeDomain[1]).toBeLessThanOrEqual(100);
		expect(flat.onTimeReference).toBe(OTP_TREND_REFERENCE);
	});

	it('anchors the zoom to the VISIBLE (windowed) series extremes, not the full scale', () => {
		const wide = selectTrendChart(
			[
				{ date: 'a', otp_pct: 40 },
				{ date: 'b', otp_pct: 95 },
			],
			'avg',
		);
		expect(wide.onTimeDomain[0]).toBeGreaterThan(0);
		expect(wide.onTimeDomain[1]).toBeLessThanOrEqual(100);
	});
});
