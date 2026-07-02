// selectTrendChart — the primary network trend (on-time % vs a chosen delay series).
//
// Ported VERBATIM from the NetworkHealth god-file `buildTrendChart` + the vehicles spark. The
// primary line is on-time % (green, 0–100 axis); the retard line reads either p90 ("slowest
// 10%") or avg-delay ("typical") — the toggle re-feeds this series. The two carry different
// units, so the delay series rides its OWN FIXED y-domain: DELAY_DIST_DOMAIN [0,15] (a
// p90-capable range — see domains.ts A2, the NAMED PAIRED constant vs lines' avg-only [0,8]),
// never the in-view max, so a given delay renders the same length on every window/grain/30s
// refresh. null points are GAPS (never bridged). Consumes the ALREADY-windowed series (one
// slice, shared by the sparkline / cancel / crowding marks).
//
// This selector stays on the interactive dual-axis TrendLine primitive (not the ChartSpec
// TrendMark): the live p90/avg toggle + per-index dual-series focus targets are a network
// affordance the single-primary ChartSpec TrendSpec does not model. The mark is already
// doctrine-clean (an absolute DELAY_DIST_DOMAIN literal, no in-view max), so it stays.

import {
	DELAY_DIST_DOMAIN,
	OTP_TREND_REFERENCE,
	otpTrendDomain,
} from '$lib/features/reliability/shiftGrains';
import type { TrendPoint } from '$lib/v1';

/** The primary-trend view-model TrendLine consumes. */
export interface TrendChartVM {
	/** On-time % per point (green, [0,100]). null = gap. */
	readonly onTime: Array<number | null>;
	/** The chosen delay series per point (amber, minutes). null = gap. */
	readonly retard: Array<number | null>;
	/** The FIXED retard y-domain (DELAY_DIST_DOMAIN [0,15]). */
	readonly retardDomain: [number, number];
	/**
	 * The ON-TIME y-domain. A DATA-ANCHORED, MIN-SPAN-floored, [0,100]-clamped zoom (S9B ·
	 * DECISIONS B1) so the ~1–2pt whole-network on-time wiggle reads as legible slope instead of a
	 * dead-flat line pinned on the full 100-tall frame — NOT an in-view /max normalization (see
	 * domains.otpTrendDomain: symmetric literal padding + clamp + floor). Honest because the axis
	 * carries true y-tick labels (87 vs 88) + the absolute reference line below.
	 */
	readonly onTimeDomain: [number, number];
	/** The absolute 80% reference anchor drawn on the zoomed on-time axis (DECISIONS B2). */
	readonly onTimeReference: number;
	/** x-axis labels (the point dates). */
	readonly xLabels: string[];
}

/**
 * Build the primary trend. `effectiveRetard` is the resolved series channel — the rider's
 * pick on the day grain, forced to 'avg' on week/month (where p90 carries no data).
 */
export function selectTrendChart(
	points: readonly TrendPoint[],
	effectiveRetard: 'p90' | 'avg',
): TrendChartVM {
	const onTime = points.map((p) => p.otp_pct ?? null);
	return {
		onTime,
		retard: points.map((p) =>
			effectiveRetard === 'avg' ? (p.avg_delay_min ?? null) : (p.p90_min ?? null),
		),
		retardDomain: [DELAY_DIST_DOMAIN[0], DELAY_DIST_DOMAIN[1]],
		// The zoom is computed over the ALREADY-windowed on-time series — the same slice every other
		// mark reads — so the axis tracks the visible window's real extremes (padded + floored + clamped).
		onTimeDomain: otpTrendDomain(onTime),
		onTimeReference: OTP_TREND_REFERENCE,
		xLabels: points.map((p) => p.date),
	};
}

/** The vehicles-in-service context series (day-grain only; null = gap). */
export function selectVehiclesSeries(points: readonly TrendPoint[]): Array<number | null> {
	return points.map((p) => p.vehicles ?? null);
}
