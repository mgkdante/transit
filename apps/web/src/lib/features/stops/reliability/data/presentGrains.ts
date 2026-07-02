// presentGrains — the stop's calendar-grain AVAILABILITY.
//
// The SurfaceControls rail disables (never hides) a grain the stop's periods[]
// carry no row for. A stop has ONE snapshot per grain (not an N-bucket series), so
// availability keys on grain EXISTENCE (a period is present), NOT the MIN_POINTS
// bucket clamp — passing bucket counts would wrongly disable every stop grain.
//
// CAVEAT: the day grain carries ONLY p50/p90 (no otp/avg/severe), so availability
// must treat 'day' as present when a day period exists even though it lacks OTP —
// we key on grain existence, not on OTP presence, or the day would wrongly disable.

import type { StopReliabilityPeriod } from '$lib/v1/schemas';

/** The calendar grains this surface offers (finest → coarsest). */
export type StopGrain = 'day' | 'week' | 'month';
export const STOP_GRAINS: readonly StopGrain[] = ['day', 'week', 'month'];

/** The set of calendar grains this stop's periods[] actually carry a row for. */
export function presentGrains(
	periods: readonly StopReliabilityPeriod[] | null | undefined,
): Set<StopGrain> {
	const set = new Set<StopGrain>();
	for (const p of periods ?? []) {
		if (p.grain === 'day' || p.grain === 'week' || p.grain === 'month') set.add(p.grain);
	}
	return set;
}

/** The richest available grain (finest present, day→week→month), default 'day'. */
export function defaultStopGrain(present: ReadonlySet<StopGrain>): StopGrain {
	return STOP_GRAINS.find((g) => present.has(g)) ?? 'day';
}
