import { describe, it, expect } from 'vitest';
import { WINDOWS, bestFitWindow, windowedSeries } from './trendWindow';
import type { TrendPoint } from '$lib/v1';

const day = (n: number): TrendPoint[] =>
	Array.from({ length: n }, (_, i) => ({ date: `2026-05-${String(i + 1).padStart(2, '0')}` }));

describe('trendWindow', () => {
	it('offers 7/30/90-day windows', () => {
		expect(WINDOWS).toEqual([7, 30, 90]);
	});

	it('best-fit picks the richest window that fits (largest ≤ n), else 7', () => {
		expect(bestFitWindow(0)).toBe(7);
		expect(bestFitWindow(5)).toBe(7);
		expect(bestFitWindow(40)).toBe(30);
		expect(bestFitWindow(200)).toBe(90);
	});

	it('DAY grain slices the most-recent windowDays tail', () => {
		const series = { daily: day(40), weekly: [], monthly: [] };
		const out = windowedSeries('day', series, 7);
		expect(out).toHaveLength(7);
		// The tail is the most-recent 7 days (…, 05-40 would overflow, so last real is index 39).
		expect(out[out.length - 1].date).toBe(series.daily[39].date);
	});

	// The flat-week/month bug guard: the DAY window must NEVER slice a coarse grain — week/month
	// render their FULL (short) series un-sliced, so they are not flattened to a 7d tail.
	it('WEEK grain renders the full weekly series un-sliced (never flattened to a 7d tail)', () => {
		const weekly = day(3).map((p, i) => ({ ...p, date: `2026-0${i + 1}-01` }));
		const out = windowedSeries('week', { daily: day(40), weekly, monthly: [] }, 7);
		expect(out).toHaveLength(3);
		expect(out).toEqual(weekly);
	});

	it('MONTH grain renders the full monthly series un-sliced', () => {
		const monthly = day(2).map((p, i) => ({ ...p, date: `2026-0${i + 4}-01` }));
		const out = windowedSeries('month', { daily: day(40), weekly: [], monthly }, 7);
		expect(out).toHaveLength(2);
		expect(out).toEqual(monthly);
	});
});
