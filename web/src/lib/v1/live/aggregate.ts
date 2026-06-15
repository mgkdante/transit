// Live aggregate — recompute network-health rollups over a FACET of vehicles.
//
// network.json carries network-WIDE rollups. When a surface scopes to a subset
// (one route, one stop, a filtered selection) it needs the same rollups over
// just those vehicles. This module recomputes them client-side from a Vehicle[]
// facet, matching the publisher's shapes (StatusDist / OccupancyMix / percentiles).
//
// INVARIANTS (match the contract exactly):
//   - status_dist defaults EVERY enum key to 0, even when absent in the facet —
//     no missing keys, so downstream charts never special-case undefined.
//   - occupancy_mix is FRACTIONAL (0..1), summing to ~1 over vehicles that
//     report occupancy; null when NO vehicle in the facet reports occupancy
//     (no telemetry != "0% everything").
//   - on_time_pct / percentiles are null when the facet has no qualifying data,
//     never a fabricated 0.
//   - non_responding counts vehicles with status 'unknown' (the live "we have a
//     vehicle but no usable status" bucket).

import type { OccupancyCode, StatusCode, Vehicle } from '$lib/v1/schemas';

/** Every status bucket, zero-initialized — the StatusDist key set. */
const STATUS_CODES: readonly StatusCode[] = ['early', 'on_time', 'late', 'severe', 'unknown'];

/** Every occupancy bucket — the OccupancyMix key set. */
const OCCUPANCY_CODES: readonly OccupancyCode[] = [
	'empty',
	'many_seats',
	'few_seats',
	'standing',
	'full',
];

/** Count of vehicles per status; every enum key present (missing -> 0). */
export type StatusDist = Record<StatusCode, number>;

/** Fractional (0..1) share of vehicles per occupancy bucket. */
export type OccupancyMix = Record<OccupancyCode, number>;

/** Recomputed rollups over a vehicle facet. */
export interface LiveAggregate {
	/** Vehicles considered in the facet (the denominator for shares). */
	readonly count: number;
	/** Per-status counts, all five keys present. */
	readonly statusDist: StatusDist;
	/** Whole-percent on-time share, or null when no statused vehicle qualifies. */
	readonly onTimePct: number | null;
	/** Fractional occupancy mix (0..1), or null when no vehicle reports occupancy. */
	readonly occupancyMix: OccupancyMix | null;
	/** Median absolute delay (minutes), or null when no vehicle reports delay. */
	readonly delayP50Min: number | null;
	/** 90th-percentile absolute delay (minutes), or null when none reports delay. */
	readonly delayP90Min: number | null;
	/** Vehicles with status 'unknown' (present-but-unusable). */
	readonly nonResponding: number;
}

/** A zeroed StatusDist with all five keys. */
function zeroStatusDist(): StatusDist {
	const dist = {} as StatusDist;
	for (const code of STATUS_CODES) dist[code] = 0;
	return dist;
}

/**
 * Linear-interpolated percentile over a numeric sample.
 * `p` is 0..100. Returns null for an empty sample. Sample need not be sorted.
 */
function percentile(values: readonly number[], p: number): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	if (sorted.length === 1) return sorted[0];
	const rank = (p / 100) * (sorted.length - 1);
	const lo = Math.floor(rank);
	const hi = Math.ceil(rank);
	if (lo === hi) return sorted[lo];
	const frac = rank - lo;
	return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/**
 * Recompute the live rollups over a facet of vehicles.
 *
 * Pass the already-faceted set (e.g. the vehicles on one route via the live
 * index's vehiclesByRoute). Empty facet -> zeroed status_dist, null
 * pct/mix/percentiles, 0 non_responding.
 */
export function aggregateLive(vehicles: readonly Vehicle[]): LiveAggregate {
	const statusDist = zeroStatusDist();
	const occupancyCounts = {} as Record<OccupancyCode, number>;
	for (const code of OCCUPANCY_CODES) occupancyCounts[code] = 0;

	let occupancyReported = 0;
	const delays: number[] = [];

	for (const vehicle of vehicles) {
		statusDist[vehicle.status] += 1;

		if (vehicle.occupancy != null) {
			occupancyCounts[vehicle.occupancy] += 1;
			occupancyReported += 1;
		}

		if (vehicle.delay_min != null) {
			delays.push(Math.abs(vehicle.delay_min));
		}
	}

	// on_time_pct: share of STATUSED vehicles (excludes 'unknown' from both
	// numerator and denominator — an unknown vehicle is not "on time" nor a
	// fair miss). Null when no vehicle has a usable status.
	const statusedCount = statusDist.early + statusDist.on_time + statusDist.late + statusDist.severe;
	const onTimePct =
		statusedCount > 0 ? Math.round((statusDist.on_time / statusedCount) * 100) : null;

	// occupancy_mix: fractional shares over vehicles that REPORT occupancy.
	// Null when none report (no telemetry != all-empty).
	let occupancyMix: OccupancyMix | null = null;
	if (occupancyReported > 0) {
		occupancyMix = {} as OccupancyMix;
		for (const code of OCCUPANCY_CODES) {
			occupancyMix[code] = occupancyCounts[code] / occupancyReported;
		}
	}

	const delayP50Min = percentile(delays, 50);
	const delayP90Min = percentile(delays, 90);

	return {
		count: vehicles.length,
		statusDist,
		onTimePct,
		occupancyMix,
		delayP50Min,
		delayP90Min,
		nonResponding: statusDist.unknown,
	};
}
