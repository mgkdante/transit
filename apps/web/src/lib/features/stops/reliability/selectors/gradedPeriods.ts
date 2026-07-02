// gradedPeriods + dayPercentiles — the calendar-grain readouts.
//
// Ports the StopDetail inline `gradedPeriods` + `dayPercentiles` transforms
// VERBATIM. gradedPeriods maps the selected-grain periods → the shared
// ReliabilityPane VM: the DAY grain carries a real p50/p90 (captioned "median"),
// week/month carry only an observation-weighted mean (captioned "avg") — never a
// mean wearing a "median" label. dayPercentiles surfaces the day period's typical
// (p50) vs worst-case (p90) as its own prominent pair; both null ⇒ no pair.

import type { ReliabilityPeriodVM } from '$lib/components/surface';
import type { StopReliabilityPeriod } from '$lib/v1/schemas';

/**
 * Map the selected-grain periods → the ReliabilityPane view-model. `grainLabel`
 * localizes the raw contract grain string (never the raw 'day'/'week' token).
 */
export function selectGradedPeriods(
	periods: readonly StopReliabilityPeriod[] | null | undefined,
	grain: string,
	grainLabel: (grain: string) => string,
): ReliabilityPeriodVM[] {
	return (periods ?? [])
		.filter((p) => p.grain === grain)
		.map((p) => {
			const hasRealP50 = p.p50_min != null;
			return {
				grain: grainLabel(p.grain),
				otpPct: p.otp_pct ?? null,
				delayMin: hasRealP50 ? p.p50_min! : (p.avg_delay_min ?? null),
				delayKind: hasRealP50 ? ('median' as const) : ('avg' as const),
				p90Min: p.p90_min ?? null,
				severePct: p.severe_pct ?? null,
			};
		});
}

/**
 * The day period's typical (p50) vs worst-case (p90). The pipeline emits at most
 * one day period, so we read the single (last) row. Returns null when the day
 * grain is not selected, no day period exists, or both percentiles are absent.
 */
export function selectDayPercentiles(
	periods: readonly StopReliabilityPeriod[] | null | undefined,
	grain: string,
): { p50: number | null; p90: number | null } | null {
	if (grain !== 'day') return null;
	const days = (periods ?? []).filter((p) => p.grain === 'day');
	if (days.length === 0) return null;
	const last = days[days.length - 1];
	if (last.p50_min == null && last.p90_min == null) return null;
	return { p50: last.p50_min ?? null, p90: last.p90_min ?? null };
}
