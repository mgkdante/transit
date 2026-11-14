import type { NetworkFile, NetworkShift, TrendPoint } from './index';

const pointView = (point: TrendPoint) =>
	({
		date: point.date,
		onTimePct: point.otp_pct ?? null,
		meanDelayMin: point.avg_delay_min ?? null,
		p90Min: point.p90_min ?? null,
		cancellationPct: point.cancellation_rate ?? null,
		completenessPct: point.service_completeness_rate ?? null,
		vehicles: point.vehicles ?? null,
		occupancyMix: point.occupancy_mix ?? null,
	}) as const;
export type NetworkPointView = ReturnType<typeof pointView>;

const shiftView = (row: NetworkShift) =>
	({
		grain: row.grain,
		onTimePct: row.otp_pct ?? null,
		meanDelayMin: row.avg_delay_min ?? null,
		severePct: row.severe_pct ?? null,
	}) as const;
export type NetworkShiftView = ReturnType<typeof shiftView>;

export function networkReliabilityView(
	input: {
		live?: NetworkFile | null;
		points?: readonly TrendPoint[];
		byShift?: readonly NetworkShift[];
		byDaytype?: readonly NetworkShift[];
	} = {},
) {
	const live = input.live;
	return {
		live:
			live == null
				? null
				: ({
						onTimePct: live.on_time_pct ?? null,
						coveragePct: live.coverage_pct ?? null,
						p50Min: live.delay_p50_min ?? null,
						p90Min: live.delay_p90_min ?? null,
						vehicles: live.vehicles_in_service,
						silentTrips: live.non_responding,
						statusDistribution: live.status_dist,
						occupancyMix: live.occupancy_mix ?? null,
						delayBuckets: live.delay_histogram ?? null,
						silentByLine: live.non_responding_by_route ?? null,
					} as const),
		points: (input.points ?? []).map(pointView) as readonly NetworkPointView[],
		byShift: (input.byShift ?? []).map(shiftView) as readonly NetworkShiftView[],
		byDaytype: (input.byDaytype ?? []).map(shiftView) as readonly NetworkShiftView[],
	} as const;
}
export type NetworkLiveView = NonNullable<ReturnType<typeof networkReliabilityView>['live']>;
