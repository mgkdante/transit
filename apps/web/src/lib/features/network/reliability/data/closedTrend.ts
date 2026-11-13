import type { NetworkTrend } from '#lib/v1/index.ts';
import { closedTrendPoints } from '#lib/v1/closedWindow.ts';
export function closeNetworkTrend(
	trend: NetworkTrend | null | undefined,
	closedThrough: string | null,
): NetworkTrend | null {
	if (!trend) return null;
	return {
		...trend,
		series: [...closedTrendPoints(trend.series ?? [], 'day', closedThrough)],
		weekly: [...closedTrendPoints(trend.weekly ?? [], 'week', closedThrough)],
		monthly: [...closedTrendPoints(trend.monthly ?? [], 'month', closedThrough)],
	};
}
