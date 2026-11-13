import { describe, it, expect } from 'vitest';
import { WINDOWS, bestFitWindow, windowedSeries } from './trendWindow';
import type { TrendPoint } from '#lib/v1/index.ts';

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
		expect(out[out.length - 1].date).toBe(series.daily[39].date);
	});

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

it('a disabled window says how many days are recorded', async () => {
	const { trendWindowSegments } = await import('./trendWindow');
	const { networkReliabilityCopy } = await import('../network-reliability.copy');
	const copy = networkReliabilityCopy.en;
	const labels = { 7: copy.window.d7, 30: copy.window.d30, 90: copy.window.d90 };
	expect(trendWindowSegments(12, labels, copy.window.reason)).toEqual([
		{ key: '7', label: labels[7], available: true },
		{ key: '30', label: labels[30], available: false, title: copy.window.reason(12) },
		{ key: '90', label: labels[90], available: false, title: copy.window.reason(12) },
	]);
	expect(
		trendWindowSegments(0, labels, copy.window.reason).every((s) => !s.available && !s.title),
	).toBe(true);
});
