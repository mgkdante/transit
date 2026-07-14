import { describe, it, expect } from 'vitest';
import { poolDailyRange } from './dailyRange';
import { wilsonBoundsProportion } from '$lib/v1/stats';
import type { StopDailyPoint } from '$lib/v1';

// The DB lane's stop_daily.test.ts CLIENT-POOLING invariant, exercised through the
// real selector: summing served counts reproduces the per-day + pooled rate EXACTLY.
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

describe('poolDailyRange', () => {
	it('pools the whole series EXACTLY off the summed counts (no stored average)', () => {
		const v = poolDailyRange(DAILY);
		expect(v.observations).toBe(150);
		expect(v.severeCount).toBe(18);
		// 100 * 18 / 150 = 12.0 — a value equal to NO single day's rate, so the pool is
		// a real re-computation off the counts, not a stored average.
		expect(v.severePct).toBe(12);
		expect(v.daysWithData).toBe(3);
		expect(v.from).toBe('2026-06-01');
		expect(v.to).toBe('2026-06-03');
		expect(v.reliable).toBe(true);
	});

	it('recomputes the Wilson interval client-side off the counts (matches the kernel)', () => {
		const v = poolDailyRange(DAILY);
		const [lo, hi] = wilsonBoundsProportion(18, 150)!;
		expect(v.wilsonLo).toBe(Math.round(lo * 1000) / 10);
		expect(v.wilsonHi).toBe(Math.round(hi * 1000) / 10);
	});

	it('clips to a {from,to} sub-range and pools only the in-range days', () => {
		const v = poolDailyRange(DAILY, { from: '2026-06-01', to: '2026-06-02' });
		expect(v.daysWithData).toBe(2);
		expect(v.observations).toBe(100);
		expect(v.severeCount).toBe(13);
		expect(v.severePct).toBe(13); // 100*13/100
	});

	it('observation-weights the avg delay (never a naive per-day mean)', () => {
		const v = poolDailyRange(DAILY);
		// (1.5*40 + 2.1*60 + 1.8*50) / 150 = (60 + 126 + 90) / 150 = 1.84
		expect(v.avgDelayMin).toBe(1.8);
	});

	it('uses retained additive delay sums instead of re-pooling rounded daily averages', () => {
		const roundedDaily: StopDailyPoint[] = [
			{
				date: '2026-01-31',
				observation_count: 50,
				severe_count: 5,
				severe_pct: 10,
				avg_delay_min: 1.2,
			},
			{
				date: '2026-02-01',
				observation_count: 50,
				severe_count: 5,
				severe_pct: 10,
				avg_delay_min: 1.2,
			},
		];
		const exact = {
			daysWithData: 2,
			from: '2026-01-31',
			to: '2026-02-01',
			observationCount: 100,
			inClampObservationCount: 100,
			severeCount: 10,
			sumDelaySeconds: 7_500,
		};

		const v = poolDailyRange(roundedDaily, null, exact as never);

		expect(v.avgDelayMin).toBe(1.3);
		expect(v.severePct).toBe(10);
		expect(v.observations).toBe(100);
	});

	it('rounds a negative retained average delay tie half away from zero', () => {
		const v = poolDailyRange([], null, {
			daysWithData: 1,
			from: '2026-06-01',
			to: '2026-06-01',
			observationCount: 30,
			inClampObservationCount: 30,
			severeCount: 0,
			sumDelaySeconds: -90,
		});

		// -90 seconds / 30 observations / 60 = -0.05 min, which the wire contract
		// rounds half away from zero rather than collapsing to negative zero.
		expect(v.avgDelayMin).toBe(-0.1);
	});

	it('withholds the pooled share below MIN_N (too thin to print a percentage)', () => {
		const thin: StopDailyPoint[] = [
			{ date: '2026-06-01', observation_count: 5, severe_count: 1, severe_pct: 20 },
			{ date: '2026-06-02', observation_count: 4, severe_count: 0, severe_pct: 0 },
		];
		const v = poolDailyRange(thin); // 9 obs < MIN_N (30)
		expect(v.observations).toBe(9);
		expect(v.reliable).toBe(false);
		expect(v.severePct).toBeNull();
		expect(v.wilsonLo).toBeNull();
		expect(v.wilsonHi).toBeNull();
	});

	it('returns an empty verdict for a window with no in-range days', () => {
		const v = poolDailyRange(DAILY, { from: '2027-01-01', to: '2027-01-31' });
		expect(v.daysWithData).toBe(0);
		expect(v.observations).toBe(0);
		expect(v.severePct).toBeNull();
		expect(v.avgDelayMin).toBeNull();
		expect(v.from).toBeNull();
	});

	it('is honest on a null/empty series', () => {
		expect(poolDailyRange(null).daysWithData).toBe(0);
		expect(poolDailyRange([]).observations).toBe(0);
	});
});
