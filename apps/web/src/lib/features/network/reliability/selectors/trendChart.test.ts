import { describe, it, expect } from 'vitest';
import { selectTrendChart, selectVehiclesSpark } from './trendChart';
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

const opts = {
	locale: 'en',
	title: 'Network trend',
	onTimeLabel: 'On-time %',
	retardLabel: 'Slowest 10% (min)',
	pctUnit: '%',
	minUnit: ' min',
} as const;

function trendOf(spec: ReturnType<typeof selectTrendChart>) {
	if (spec.kind !== 'trend') throw new Error(`expected trend, got ${spec.kind}`);
	return spec;
}

describe('selectTrendChart', () => {
	it('reads the p90 series on the secondary channel with the absolute [0,15] domain (never in-view max)', () => {
		const spec = trendOf(selectTrendChart(points, 'p90', opts));
		expect(spec.points.map((p) => p.y2 ?? null)).toEqual([5, 6, null]);
		expect(spec.secondary?.domain).toEqual([DELAY_DIST_DOMAIN[0], DELAY_DIST_DOMAIN[1]]);
		expect(spec.secondary?.domain).toEqual([0, 15]);
		expect(spec.secondary?.label).toBe('Slowest 10% (min)');
	});

	it('reads the avg series on the secondary channel when forced to avg (week/month)', () => {
		const spec = trendOf(selectTrendChart(points, 'avg', opts));
		expect(spec.points.map((p) => p.y2 ?? null)).toEqual([2.1, 1.8, null]);
	});

	it('keeps null points as GAPS in both channels (never bridged, never a fabricated 0)', () => {
		const spec = trendOf(selectTrendChart(points, 'p90', opts));
		expect(spec.points.map((p) => p.y)).toEqual([78, 81, null]);
		expect(spec.points[2].y2).toBeNull();
	});

	it('degrades to honest absence below two real points (never a one-dot line)', () => {
		const spec = selectTrendChart([{ date: 'a', otp_pct: 81 }], 'avg', opts);
		expect(spec.kind).toBe('absence');
	});

	it('zooms the on-time axis to a data-anchored, min-span-floored, [0,100]-clamped domain (S9B)', () => {
		// A low-variance week (87/88) — the flat-trend complaint: the axis must floor the span so the
		// wiggle shows slope, while staying inside [0,100] and carrying the absolute 80% reference.
		const flat = trendOf(
			selectTrendChart(
				[
					{ date: 'a', otp_pct: 87 },
					{ date: 'b', otp_pct: 88 },
				],
				'avg',
				opts,
			),
		);
		expect(flat.domain[1] - flat.domain[0]).toBeGreaterThanOrEqual(OTP_TREND_MIN_SPAN);
		expect(flat.domain[0]).toBeGreaterThanOrEqual(0);
		expect(flat.domain[1]).toBeLessThanOrEqual(100);
		expect(flat.target).toBe(OTP_TREND_REFERENCE);
	});

	it('anchors the zoom to the VISIBLE (windowed) series extremes, not the full scale', () => {
		const wide = trendOf(
			selectTrendChart(
				[
					{ date: 'a', otp_pct: 40 },
					{ date: 'b', otp_pct: 95 },
				],
				'avg',
				opts,
			),
		);
		expect(wide.domain[0]).toBeGreaterThan(0);
		expect(wide.domain[1]).toBeLessThanOrEqual(100);
	});
});

describe('selectVehiclesSpark', () => {
	const sparkOpts = { locale: 'en', title: 'Vehicles', label: 'Vehicles' } as const;

	it('is null-gapped with an explicit data-anchored domain', () => {
		const spec = selectVehiclesSpark(points, sparkOpts);
		expect(spec?.values).toEqual([9, 11, null]);
		expect(spec?.domain[0]).toBeLessThanOrEqual(9);
		expect(spec?.domain[1]).toBeGreaterThanOrEqual(11);
		expect(spec?.domain[0]).toBeGreaterThanOrEqual(0);
	});

	it('stands down (null) when no point carries a vehicles reading', () => {
		expect(selectVehiclesSpark([{ date: 'a', vehicles: null }], sparkOpts)).toBeNull();
	});
});
