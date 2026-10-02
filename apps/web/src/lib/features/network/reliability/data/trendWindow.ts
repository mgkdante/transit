import type { TrendPoint } from '$lib/v1';

export const WINDOWS = [7, 30, 90] as const;
export type WindowDays = (typeof WINDOWS)[number];

export function bestFitWindow(seriesLength: number): WindowDays {
	return [...WINDOWS].reverse().find((d) => d <= seriesLength) ?? 7;
}

export function windowedSeries(
	grain: 'day' | 'week' | 'month',
	series: {
		readonly daily: readonly TrendPoint[];
		readonly weekly: readonly TrendPoint[];
		readonly monthly: readonly TrendPoint[];
	},
	windowDays: WindowDays,
): readonly TrendPoint[] {
	if (grain === 'week') return series.weekly;
	if (grain === 'month') return series.monthly;
	return series.daily.slice(Math.max(0, series.daily.length - windowDays));
}
