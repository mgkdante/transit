import type { StopReliabilityPeriod } from '$lib/v1/schemas';

export type StopGrain = 'day' | 'week' | 'month';
export const STOP_GRAINS: readonly StopGrain[] = ['day', 'week', 'month'];

export function presentGrains(
	periods: readonly StopReliabilityPeriod[] | null | undefined,
): Set<StopGrain> {
	const set = new Set<StopGrain>();
	for (const p of periods ?? []) {
		if (p.grain === 'day' || p.grain === 'week' || p.grain === 'month') set.add(p.grain);
	}
	return set;
}

export function defaultStopGrain(present: ReadonlySet<StopGrain>): StopGrain {
	return STOP_GRAINS.find((g) => present.has(g)) ?? 'day';
}
