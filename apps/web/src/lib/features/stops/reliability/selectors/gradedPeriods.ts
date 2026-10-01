import type { ReliabilityPeriodVM } from '$lib/components/surface';
import type { StopReliabilityPeriod } from '$lib/v1/schemas';

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
