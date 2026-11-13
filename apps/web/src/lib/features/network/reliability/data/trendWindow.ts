import type { TrendPoint } from '#lib/v1/index.ts';

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

export function trendWindowSegments(
	closedDays: number,
	labels: Record<WindowDays, string>,
	reason: (n: number) => string,
) {
	return WINDOWS.map((d, i) => {
		const available = closedDays > 0 && (i === 0 || d <= closedDays);
		return {
			key: String(d),
			label: labels[d],
			available,
			...(!available && closedDays > 0 ? { title: reason(closedDays) } : {}),
		};
	});
}

export function trendWindowEnd(date: string, grain: 'day' | 'week' | 'month'): string {
	const end = new Date(date + 'T00:00:00Z');
	if (grain === 'week') end.setUTCDate(end.getUTCDate() + 6);
	if (grain === 'month') end.setUTCMonth(end.getUTCMonth() + 1, 0);
	return end.toISOString().slice(0, 10);
}
