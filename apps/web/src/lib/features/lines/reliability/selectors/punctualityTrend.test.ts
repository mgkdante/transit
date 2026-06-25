import { describe, expect, it } from 'vitest';
import { selectPunctualityTrend, type PunctualityTrendLabels } from './punctualityTrend';
import { DELAY_POS_DOMAIN, OTP_DOMAIN } from '$lib/features/reliability/domains';
import type { PunctualityVM } from '../clusters';

// Deterministic verification of the §01 trend selector — the spec semantics the one
// <Chart> then renders. (The LayerChart PIXEL geometry is the library's job, enforced to
// the absolute domain by the spec + the chart-doctrine gate; it can't be exercised in a
// no-layout test env, so this locks the SHAPE: the matrix, the band rule, the domains,
// and honest absence.)

const labels: PunctualityTrendLabels = {
	title: 'On-time % · trend',
	otpLabel: 'On-time %',
	retardLabel: 'Avg delay',
	pctUnit: '%',
	minUnit: ' min',
	shiftLabel: (g) => g.toUpperCase(),
};

function vmWith(over: Partial<PunctualityVM>): PunctualityVM {
	return {
		headline: { otpPct: null, avgDelayMin: null, p50Min: null, p90Min: null, severePct: null },
		trend: [],
		dayOfWeek: [],
		weakStops: [],
		peakOffPeak: { byShift: [], byDayType: [] },
		byShiftDaytype: [],
		isEmpty: false,
		...over,
	} as unknown as PunctualityVM;
}

const shiftRows = [
	{ grain: 'am_peak', otpPct: 90, avgDelayMin: 0.6 },
	{ grain: 'pm_peak', otpPct: 84, avgDelayMin: 1.6 },
	{ grain: 'midday', otpPct: 88, avgDelayMin: 1.0 },
];

const dailyRows = [
	{
		date: '2026-06-18',
		otp_pct: 86,
		avg_delay_min: 1.2,
		wilson_lo: 80,
		wilson_hi: 91,
		observation_count: 140,
	},
	{
		date: '2026-06-19',
		otp_pct: 88,
		avg_delay_min: 1.0,
		wilson_lo: 83,
		wilson_hi: 92,
		observation_count: 160,
	},
	{
		date: '2026-06-20',
		otp_pct: null,
		avg_delay_min: null,
		wilson_lo: null,
		wilson_hi: null,
		observation_count: 0,
	},
];

describe('selectPunctualityTrend — the granularity matrix', () => {
	it('DAY grain → the intra-day shift pattern on a band x-scale (no Wilson band)', () => {
		const vm = vmWith({ peakOffPeak: { byShift: shiftRows, byDayType: [] } as never });
		const spec = selectPunctualityTrend(vm, 'day', 'en', labels);
		expect(spec.kind).toBe('trend');
		if (spec.kind !== 'trend') return;
		expect(spec.xScale).toBe('band');
		expect(spec.hasBand).toBe(false);
		// Sorted into SHIFT_GRAIN_ORDER (am_peak < midday < pm_peak), x = the band label.
		expect(spec.points.map((p) => p.x)).toEqual(['am_peak', 'midday', 'pm_peak']);
		expect(spec.points.map((p) => p.xLabel)).toEqual(['AM_PEAK', 'MIDDAY', 'PM_PEAK']);
		expect(spec.points.map((p) => p.y)).toEqual([90, 88, 84]);
		expect(spec.points.map((p) => p.y2)).toEqual([0.6, 1.0, 1.6]);
	});

	it('WEEK grain → the dated daily series on a time x-scale, with the Wilson band', () => {
		const vm = vmWith({ trend: dailyRows as never });
		const spec = selectPunctualityTrend(vm, 'week', 'en', labels);
		expect(spec.kind).toBe('trend');
		if (spec.kind !== 'trend') return;
		expect(spec.xScale).toBe('time');
		expect(spec.hasBand).toBe(true);
		// x is epoch-ms (a number), xLabel is the date string.
		expect(typeof spec.points[0].x).toBe('number');
		expect(spec.points[0].xLabel).toBe('2026-06-18');
		expect(spec.points[0].bandLo).toBe(80);
		expect(spec.points[0].bandHi).toBe(91);
		// the null daily point keeps its null (the line BREAKS there, never bridged).
		expect(spec.points[2].y).toBeNull();
	});

	it('carries the ABSOLUTE domains the renderer pins (never an extent)', () => {
		const vm = vmWith({ peakOffPeak: { byShift: shiftRows, byDayType: [] } as never });
		const spec = selectPunctualityTrend(vm, 'day', 'en', labels);
		if (spec.kind !== 'trend') throw new Error('expected trend');
		expect(spec.domain).toBe(OTP_DOMAIN);
		expect(spec.secondary?.domain).toBe(DELAY_POS_DOMAIN);
		expect(spec.target).toBe(80);
		expect(spec.minN).toBe(30);
		expect(spec.minPointsForLine).toBe(7);
	});

	it('fewer than two real points → honest absence, never a one-dot line', () => {
		const vm = vmWith({ trend: [dailyRows[0], dailyRows[2]] as never }); // 1 real + 1 null
		const spec = selectPunctualityTrend(vm, 'week', 'en', labels);
		expect(spec.kind).toBe('absence');
		if (spec.kind !== 'absence') return;
		expect(spec.reason).toBe('no-observations');
	});
});
