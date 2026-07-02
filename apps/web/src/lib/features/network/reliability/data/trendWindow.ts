// trendWindow — the 7/30/90-day trailing window for the DAY-grain network trend.
//
// Ported VERBATIM from the NetworkHealth god-file. build_network_trend publishes the full
// series (~90d OTP/avg-delay, ~14d p90/vehicles); the DAY grain slices the TAIL (most recent
// N days) and offers only windows that fit the data (a window longer than the series is
// disabled, never a dead control). Default = the richest ENABLED window that fits, else 7.
//
// The window applies to the DAY grain ONLY: week/month render their full (short) coarse
// series — the 7/30/90 window has no meaning there (the flat-week/month bug this re-seat
// guards against was a day-window slice wrongly applied to a coarse grain).

import type { TrendPoint } from '$lib/v1';

/** The offered trailing windows (days), finest → coarsest. */
export const WINDOWS = [7, 30, 90] as const;
export type WindowDays = (typeof WINDOWS)[number];

/** The richest WINDOW that fits the loaded series (largest ≤ n), else the always-valid 7. */
export function bestFitWindow(seriesLength: number): WindowDays {
	return [...WINDOWS].reverse().find((d) => d <= seriesLength) ?? 7;
}

/**
 * The points the trend renders for the given grain. On the DAY grain this is the most-recent
 * `windowDays` daily points (clamped to the available length); on week/month it is the FULL
 * (short) coarse series — the 7/30/90 window is not applied there. ONE slice, shared by every
 * mark the orchestrator feeds.
 */
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
