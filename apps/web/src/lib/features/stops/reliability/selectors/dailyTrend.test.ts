import { describe, it, expect } from 'vitest';
import { selectDailyTrend } from './dailyTrend';
import { SEVERE_DOMAIN, DELAY_POS_DOMAIN } from '$lib/features/reliability/shiftGrains';
import type { StopDailyPoint } from '$lib/v1';

const labels = {
	title: 'Severe-delay share · by day',
	severeLabel: 'Severe-delay share',
	avgLabel: 'Average delay',
	pctUnit: '%',
	minUnit: ' min',
};

const DAILY: StopDailyPoint[] = [
	{
		date: '2026-06-01',
		observation_count: 40,
		severe_count: 4,
		severe_pct: 10,
		avg_delay_min: 1.5,
	},
	{
		date: '2026-06-02',
		observation_count: 60,
		severe_count: 9,
		severe_pct: 15,
		avg_delay_min: 2.1,
	},
	{
		date: '2026-06-03',
		observation_count: 50,
		severe_count: 5,
		severe_pct: 10,
		avg_delay_min: 1.8,
	},
];

describe('selectDailyTrend', () => {
	it('emits a time-scale TrendSpec on ABSOLUTE domains (never in-view max)', () => {
		const spec = selectDailyTrend(DAILY, 'en', labels);
		if (spec.kind !== 'trend') throw new Error('expected trend');
		expect(spec.xScale).toBe('time');
		expect(spec.domain).toEqual(SEVERE_DOMAIN);
		expect(spec.domain[0]).toBe(0); // zero-based
		expect(spec.secondary?.domain).toEqual(DELAY_POS_DOMAIN);
		expect(spec.points).toHaveLength(3);
		// x is epoch-ms (time scale), sorted ascending.
		expect(spec.points[0].x).toBeLessThan(spec.points[2].x as number);
		expect(spec.points[0].y).toBe(10); // severe_pct plotted directly
		expect(spec.points[0].y2).toBe(1.5); // avg delay secondary
	});

	it('rides a per-day Wilson band from the served counts', () => {
		const spec = selectDailyTrend(DAILY, 'en', labels);
		if (spec.kind !== 'trend') throw new Error('expected trend');
		expect(spec.hasBand).toBe(true);
		expect(spec.points[0].bandLo).not.toBeNull();
		expect(spec.points[0].bandHi).not.toBeNull();
		expect(spec.points[0].bandLo!).toBeLessThanOrEqual(spec.points[0].y!);
	});

	it('clips to a {from,to} window', () => {
		const spec = selectDailyTrend(DAILY, 'en', labels, { from: '2026-06-02', to: '2026-06-03' });
		if (spec.kind !== 'trend') throw new Error('expected trend');
		expect(spec.points).toHaveLength(2);
		expect(spec.points[0].xLabel).toBe('2026-06-02');
	});

	it('degrades to honest ABSENCE below 2 real points (never a one-dot line)', () => {
		const spec = selectDailyTrend([DAILY[0]], 'en', labels);
		expect(spec.kind).toBe('absence');
		if (spec.kind !== 'absence') throw new Error('expected absence');
		expect(spec.reason).toBe('no-observations');
	});

	it('is honest absence on a null/empty series', () => {
		expect(selectDailyTrend(null, 'en', labels).kind).toBe('absence');
		expect(selectDailyTrend([], 'en', labels).kind).toBe('absence');
	});
});
