import type { TrendPoint } from '$lib/v1';

export type NetworkGrain = 'day' | 'week' | 'month';
export const NETWORK_GRAINS: readonly NetworkGrain[] = ['day', 'week', 'month'];

export interface NetworkGrainSeries {
	readonly daily: readonly TrendPoint[];
	readonly weekly: readonly TrendPoint[];
	readonly monthly: readonly TrendPoint[];
}

export function presentGrains(series: NetworkGrainSeries): Set<NetworkGrain> {
	const set = new Set<NetworkGrain>();
	if (series.daily.length > 0) set.add('day');
	if (series.weekly.length > 0) set.add('week');
	if (series.monthly.length > 0) set.add('month');
	return set;
}

export function defaultNetworkGrain(present: ReadonlySet<NetworkGrain>): NetworkGrain {
	return NETWORK_GRAINS.find((g) => present.has(g)) ?? 'day';
}
