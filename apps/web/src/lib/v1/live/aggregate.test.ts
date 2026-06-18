import { describe, expect, it } from 'vitest';
import { aggregateLive } from './aggregate';
import { OCCUPANCY_CODES, STATUS_CODES, type Vehicle } from '$lib/v1/schemas';

// aggregateLive recomputes the publisher's network rollups (StatusDist /
// OccupancyMix / on_time_pct / delay percentiles) over a vehicle FACET. The
// contract invariants under test: every status key present (missing -> 0),
// fractional-or-null occupancy_mix, null-not-zero pct/percentiles on no data,
// 'unknown' counted as non_responding and excluded from on_time_pct.

let seq = 0;
/** Build a Vehicle with sensible defaults; override only the fields a test cares about. */
function vehicle(partial: Partial<Vehicle> & Pick<Vehicle, 'status'>): Vehicle {
	return {
		id: `v${seq++}`,
		lat: 45.5,
		lon: -73.6,
		updated_utc: '2026-06-15T12:00:00Z',
		...partial,
	} as Vehicle;
}

describe('aggregateLive — empty facet', () => {
	it('zeroes every status key and nulls the pct/mix/percentiles', () => {
		const agg = aggregateLive([]);
		expect(agg.count).toBe(0);
		for (const code of STATUS_CODES) expect(agg.statusDist[code]).toBe(0);
		expect(agg.onTimePct).toBeNull();
		expect(agg.occupancyMix).toBeNull();
		expect(agg.delayP50Min).toBeNull();
		expect(agg.delayP90Min).toBeNull();
		expect(agg.nonResponding).toBe(0);
	});
});

describe('aggregateLive — status distribution', () => {
	it('counts each status and always includes all five enum keys', () => {
		const agg = aggregateLive([
			vehicle({ status: 'early' }),
			vehicle({ status: 'on_time' }),
			vehicle({ status: 'on_time' }),
			vehicle({ status: 'late' }),
			vehicle({ status: 'severe' }),
			vehicle({ status: 'unknown' }),
		]);
		expect(agg.count).toBe(6);
		expect(agg.statusDist).toEqual({ early: 1, on_time: 2, late: 1, severe: 1, unknown: 1 });
		// No missing keys, ever.
		expect(Object.keys(agg.statusDist).sort()).toEqual([...STATUS_CODES].sort());
	});

	it('reports non_responding as the count of status "unknown"', () => {
		const agg = aggregateLive([
			vehicle({ status: 'unknown' }),
			vehicle({ status: 'unknown' }),
			vehicle({ status: 'on_time' }),
		]);
		expect(agg.nonResponding).toBe(2);
		expect(agg.statusDist.unknown).toBe(2);
	});
});

describe('aggregateLive — on_time_pct', () => {
	it('is the whole-percent share of STATUSED vehicles', () => {
		// 1 on_time of 4 statused (early/on_time/late/severe) = 25%.
		const agg = aggregateLive([
			vehicle({ status: 'on_time' }),
			vehicle({ status: 'early' }),
			vehicle({ status: 'late' }),
			vehicle({ status: 'severe' }),
		]);
		expect(agg.onTimePct).toBe(25);
	});

	it('excludes "unknown" from both numerator and denominator', () => {
		// 1 on_time of 2 STATUSED (on_time + late); the unknown is ignored → 50%.
		const agg = aggregateLive([
			vehicle({ status: 'on_time' }),
			vehicle({ status: 'late' }),
			vehicle({ status: 'unknown' }),
		]);
		expect(agg.onTimePct).toBe(50);
	});

	it('is null (not 0) when no vehicle has a usable status', () => {
		const agg = aggregateLive([vehicle({ status: 'unknown' }), vehicle({ status: 'unknown' })]);
		expect(agg.onTimePct).toBeNull();
	});
});

describe('aggregateLive — occupancy_mix', () => {
	it('is fractional (0..1) over vehicles that report occupancy and sums to ~1', () => {
		const agg = aggregateLive([
			vehicle({ status: 'on_time', occupancy: 'empty' }),
			vehicle({ status: 'on_time', occupancy: 'full' }),
			vehicle({ status: 'on_time', occupancy: 'full' }),
			vehicle({ status: 'on_time', occupancy: 'full' }),
		]);
		expect(agg.occupancyMix).not.toBeNull();
		const mix = agg.occupancyMix!;
		expect(mix.empty).toBeCloseTo(0.25);
		expect(mix.full).toBeCloseTo(0.75);
		// Every occupancy key present.
		expect(Object.keys(mix).sort()).toEqual([...OCCUPANCY_CODES].sort());
		const total = OCCUPANCY_CODES.reduce((s, code) => s + mix[code], 0);
		expect(total).toBeCloseTo(1);
	});

	it('uses only reporting vehicles as the denominator (ignores null occupancy)', () => {
		// 2 report (1 standing, 1 few_seats); 1 has no telemetry → denominator 2.
		const agg = aggregateLive([
			vehicle({ status: 'on_time', occupancy: 'standing' }),
			vehicle({ status: 'on_time', occupancy: 'few_seats' }),
			vehicle({ status: 'on_time', occupancy: null }),
		]);
		const mix = agg.occupancyMix!;
		expect(mix.standing).toBeCloseTo(0.5);
		expect(mix.few_seats).toBeCloseTo(0.5);
		expect(mix.empty).toBe(0);
	});

	it('is null when NO vehicle reports occupancy (no telemetry != 0% everything)', () => {
		const agg = aggregateLive([
			vehicle({ status: 'on_time', occupancy: null }),
			vehicle({ status: 'late' }),
		]);
		expect(agg.occupancyMix).toBeNull();
	});
});

describe('aggregateLive — delay percentiles', () => {
	it('computes p50/p90 over ABSOLUTE delay minutes', () => {
		// |delays| = [0, 2, 5, 10, 12] → p50 = 5.
		const agg = aggregateLive([
			vehicle({ status: 'on_time', delay_min: 0 }),
			vehicle({ status: 'late', delay_min: 2 }),
			vehicle({ status: 'late', delay_min: 5 }),
			vehicle({ status: 'severe', delay_min: 10 }),
			vehicle({ status: 'early', delay_min: -12 }),
		]);
		expect(agg.delayP50Min).toBe(5);
		// p90 over [0,2,5,10,12] linear-interp at rank 3.6 → 10 + 0.6*(12-10) = 11.2.
		expect(agg.delayP90Min).toBeCloseTo(11.2);
	});

	it('returns the single value for a one-vehicle sample', () => {
		const agg = aggregateLive([vehicle({ status: 'late', delay_min: 7 })]);
		expect(agg.delayP50Min).toBe(7);
		expect(agg.delayP90Min).toBe(7);
	});

	it('is null when no vehicle reports a delay', () => {
		const agg = aggregateLive([vehicle({ status: 'on_time' }), vehicle({ status: 'unknown' })]);
		expect(agg.delayP50Min).toBeNull();
		expect(agg.delayP90Min).toBeNull();
	});
});
