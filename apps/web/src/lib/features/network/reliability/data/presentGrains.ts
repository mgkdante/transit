// presentGrains — the network trend's calendar-grain AVAILABILITY (day / week / month).
//
// Ported VERBATIM from the NetworkHealth god-file's inline grain logic. Unlike a stop
// (ONE snapshot per grain), the network trend is an N-BUCKET series per grain: the daily
// `series`, the additive `weekly` (week-start dated) and `monthly` (month-start dated). A
// grain is OFFERED only when its series carries data, so availability keys on the bucket
// COUNT (how many points the grain published), not on grain existence.
//
// The SurfaceControls rail reproduces TODAY's exact enable-iff-any-data semantics with
// minPoints=1 (a bucket count of ≥1 enables a grain) — NOT the MIN_POINTS_PER_GRAIN=7 floor
// (tightening the network trend grains is a separate S9 decision, not this re-seat).

import type { TrendPoint } from '$lib/v1';

/** The calendar grains the network trend offers (finest → coarsest). */
export type NetworkGrain = 'day' | 'week' | 'month';
export const NETWORK_GRAINS: readonly NetworkGrain[] = ['day', 'week', 'month'];

/** The three grain series, so the availability + default can be computed from one input. */
export interface NetworkGrainSeries {
	readonly daily: readonly TrendPoint[];
	readonly weekly: readonly TrendPoint[];
	readonly monthly: readonly TrendPoint[];
}

/** The set of grains this trend's series actually populate (bucket count ≥ 1). */
export function presentGrains(series: NetworkGrainSeries): Set<NetworkGrain> {
	const set = new Set<NetworkGrain>();
	if (series.daily.length > 0) set.add('day');
	if (series.weekly.length > 0) set.add('week');
	if (series.monthly.length > 0) set.add('month');
	return set;
}

/**
 * The richest populated grain (finest present, day→week→month), default 'day'. This is the
 * codec-owned clamp target: a chosen coarse grain whose series is absent (an older snapshot)
 * falls back here, and an empty daily series falls the day grain forward to the first
 * populated coarse grain — never a dead/empty grain.
 */
export function defaultNetworkGrain(present: ReadonlySet<NetworkGrain>): NetworkGrain {
	return NETWORK_GRAINS.find((g) => present.has(g)) ?? 'day';
}
