import { describe, expect, it } from 'vitest';
import {
	PROJECTION_HORIZON_S,
	STALE_CUTOFF_S,
	fixAgeS,
	isVehicleStale,
	projectedDistanceM,
	projectVehicle,
} from './vehicleProjection';
import { cumulativeLengths, projectToPolyline, type Coord } from './polyline';

// A long, due-east straight shape near Montréal so an advanced point stays on it
// for any plausible projection distance (km of headroom). East leg only → the
// tangent is ~90° (due east) everywhere.
const W = [-73.7, 45.5] as Coord;
const E = [-73.4, 45.5] as Coord; // ~23 km east of W
const STRAIGHT: Coord[] = [W, E];

// A fixed reference instant + ISO timestamps derived from it so age math is exact.
const NOW_MS = Date.parse('2026-06-22T12:00:00Z');
function isoAgo(seconds: number): string {
	return new Date(NOW_MS - seconds * 1000).toISOString();
}

describe('constants', () => {
	it('expose the tunable horizon + cutoff', () => {
		expect(PROJECTION_HORIZON_S).toBe(50);
		expect(STALE_CUTOFF_S).toBe(150);
	});
});

describe('fixAgeS', () => {
	it('uses reported_utc when present (the bus own fix time)', () => {
		// reported 30s ago, updated 5s ago → age tracks REPORTED (30s), not updated.
		const age = fixAgeS(isoAgo(30), isoAgo(5), NOW_MS);
		expect(age).toBeCloseTo(30, 3);
	});

	it('falls back to updated_utc when reported_utc is null/undefined', () => {
		expect(fixAgeS(null, isoAgo(42), NOW_MS)).toBeCloseTo(42, 3);
		expect(fixAgeS(undefined, isoAgo(7), NOW_MS)).toBeCloseTo(7, 3);
	});

	it('clamps a future (negative) age to 0', () => {
		// reported 10s in the FUTURE (clock skew) → clamp to 0, never negative.
		const age = fixAgeS(isoAgo(-10), isoAgo(-10), NOW_MS);
		expect(age).toBe(0);
	});

	it('returns Infinity when neither timestamp parses', () => {
		expect(fixAgeS('not-a-date', 'also-not-a-date', NOW_MS)).toBe(Infinity);
	});

	it('returns Infinity when reported is junk and falls back ONLY via the ?? (junk reported still used)', () => {
		// reported_utc is present-but-unparseable → `?? ` does NOT fall back (it is
		// non-null), so the junk is parsed → Infinity. Honest: a corrupt fix is stale.
		expect(fixAgeS('garbage', isoAgo(5), NOW_MS)).toBe(Infinity);
	});
});

describe('isVehicleStale', () => {
	it('is INCLUSIVE at the cutoff: 149 fresh, 150 stale (default cutoff)', () => {
		expect(isVehicleStale(149)).toBe(false);
		expect(isVehicleStale(150)).toBe(true);
		expect(isVehicleStale(149.9999)).toBe(false);
	});

	it('treats Infinity (unparseable fix) as stale', () => {
		expect(isVehicleStale(Infinity)).toBe(true);
	});

	it('honours a custom cutoff', () => {
		expect(isVehicleStale(60, 60)).toBe(true);
		expect(isVehicleStale(59.9, 60)).toBe(false);
	});
});

describe('projectedDistanceM', () => {
	const v = 10; // m/s
	const H = PROJECTION_HORIZON_S; // 50

	it('returns 0 for non-positive speed', () => {
		expect(projectedDistanceM(0, 10)).toBe(0);
		expect(projectedDistanceM(-5, 10)).toBe(0);
	});

	it('is ~v·a for tiny ages (decay negligible) and below the linear estimate', () => {
		const a = 1;
		const d = projectedDistanceM(v, a);
		// Closed form: v·(a − a²/2H) = 10·(1 − 1/100) = 9.9.
		expect(d).toBeCloseTo(9.9, 6);
		// Strictly less than the naive v·a (=10) because effective speed already decayed.
		expect(d).toBeLessThan(v * a);
	});

	it('pins at v·H/2 exactly at a = H', () => {
		// d(H) = v·(H − H²/2H) = v·H/2.
		expect(projectedDistanceM(v, H)).toBeCloseTo((v * H) / 2, 6);
	});

	it('stays at v·H/2 for ages beyond the horizon (saturates, no unbounded travel)', () => {
		const cap = (v * H) / 2;
		expect(projectedDistanceM(v, H + 1)).toBeCloseTo(cap, 6);
		expect(projectedDistanceM(v, H + 9999)).toBeCloseTo(cap, 6);
		expect(projectedDistanceM(v, Infinity)).toBeCloseTo(cap, 6);
	});

	it('is continuous at the horizon (limit from below == value at H)', () => {
		const justBelow = projectedDistanceM(v, H - 0.0001);
		const atH = projectedDistanceM(v, H);
		expect(justBelow).toBeCloseTo(atH, 3);
	});

	it('is monotonically non-decreasing in age up to the horizon', () => {
		let prev = -1;
		for (let a = 0; a <= H; a += 5) {
			const d = projectedDistanceM(v, a);
			expect(d).toBeGreaterThanOrEqual(prev);
			prev = d;
		}
	});

	it('clamps a negative age to 0 distance', () => {
		expect(projectedDistanceM(v, -10)).toBe(0);
	});

	it('honours a custom horizon (saturation cap scales with it)', () => {
		const h = 20;
		expect(projectedDistanceM(v, h, h)).toBeCloseTo((v * h) / 2, 6);
		expect(projectedDistanceM(v, 9999, h)).toBeCloseTo((v * h) / 2, 6);
	});
});

describe('projectVehicle', () => {
	it('advances FORWARD along a straight shape and reports the tangent heading', () => {
		// Bus at the west end, moving east at 10 m/s, fixed 5s ago. It should advance
		// EAST (lon increases) by ~ projectedDistanceM(10, 5) metres, heading ~90°.
		const ageS = 5;
		const speedMps = 10;
		const res = projectVehicle({ coord: W, shape: STRAIGHT, speedMps, ageS, bearing: 17 });

		expect(res.frozen).toBe(false);
		expect(res.stale).toBe(false);
		// Advanced eastward: lon strictly greater than the start.
		expect(res.coord[0]).toBeGreaterThan(W[0]);
		// Stayed on the parallel (due-east shape).
		expect(res.coord[1]).toBeCloseTo(45.5, 5);
		// Heading is the SHAPE tangent (~due east), NOT the reported bearing (17).
		expect(res.bearing).toBeCloseTo(90, 0);

		// The advanced arc-length matches projectedDistanceM within a metre.
		const lengths = cumulativeLengths(STRAIGHT);
		const back = projectToPolyline(STRAIGHT, res.coord, lengths)!;
		const expected = projectedDistanceM(speedMps, ageS);
		expect(back.s).toBeCloseTo(expected, 0);
	});

	it('advances further for a larger age (up to the saturation cap)', () => {
		const near = projectVehicle({ coord: W, shape: STRAIGHT, speedMps: 10, ageS: 5, bearing: 0 });
		const far = projectVehicle({ coord: W, shape: STRAIGHT, speedMps: 10, ageS: 40, bearing: 0 });
		expect(far.coord[0]).toBeGreaterThan(near.coord[0]);
	});

	it('FREEZES (and flags stale) when the fix is past the cutoff, keeping the reported bearing', () => {
		const res = projectVehicle({
			coord: W,
			shape: STRAIGHT,
			speedMps: 10,
			ageS: STALE_CUTOFF_S, // exactly the cutoff → stale (inclusive)
			bearing: 200,
		});
		expect(res.stale).toBe(true);
		expect(res.frozen).toBe(true);
		expect(res.coord).toEqual(W);
		expect(res.bearing).toBe(200); // reported bearing kept, NOT a tangent
	});

	it('FREEZES (not stale) when there is no shape — never dead-reckons on the raw bearing', () => {
		const res = projectVehicle({ coord: W, shape: null, speedMps: 10, ageS: 5, bearing: 123 });
		expect(res.frozen).toBe(true);
		expect(res.stale).toBe(false);
		expect(res.coord).toEqual(W);
		expect(res.bearing).toBe(123);
	});

	it('FREEZES when the shape is degenerate (<2 points or zero length)', () => {
		const single = projectVehicle({ coord: W, shape: [W], speedMps: 10, ageS: 5, bearing: 5 });
		expect(single.frozen).toBe(true);
		expect(single.coord).toEqual(W);

		const zeroLen = projectVehicle({
			coord: W,
			shape: [W, W],
			speedMps: 10,
			ageS: 5,
			bearing: 5,
		});
		expect(zeroLen.frozen).toBe(true);
		expect(zeroLen.coord).toEqual(W);
	});

	it('FREEZES when speed is null or zero (no travel to project)', () => {
		const nullSpeed = projectVehicle({
			coord: W,
			shape: STRAIGHT,
			speedMps: null,
			ageS: 5,
			bearing: 88,
		});
		expect(nullSpeed.frozen).toBe(true);
		expect(nullSpeed.stale).toBe(false);
		expect(nullSpeed.coord).toEqual(W);
		expect(nullSpeed.bearing).toBe(88);

		const zeroSpeed = projectVehicle({
			coord: W,
			shape: STRAIGHT,
			speedMps: 0,
			ageS: 5,
			bearing: 88,
		});
		expect(zeroSpeed.frozen).toBe(true);
		expect(zeroSpeed.coord).toEqual(W);
	});

	it('does not advance at age 0 even when projecting (distance is 0)', () => {
		const res = projectVehicle({ coord: W, shape: STRAIGHT, speedMps: 10, ageS: 0, bearing: 0 });
		expect(res.frozen).toBe(false);
		// Projected onto the shape at its start → same lon as W (within rounding).
		expect(res.coord[0]).toBeCloseTo(W[0], 5);
		expect(res.coord[1]).toBeCloseTo(W[1], 5);
	});

	it('honours a custom cutoff (an age that would be fresh by default can be stale)', () => {
		const res = projectVehicle({
			coord: W,
			shape: STRAIGHT,
			speedMps: 10,
			ageS: 60,
			bearing: 30,
			cutoff: 60,
		});
		expect(res.stale).toBe(true);
		expect(res.frozen).toBe(true);
		expect(res.coord).toEqual(W);
	});

	it('snaps a bus that started mid-shape forward from its projection, not from arc 0', () => {
		// Start the bus already partway along (its coord projects to s>0); the result
		// must be EAST of that start, i.e. advanced from the projection — never reset.
		const mid = [-73.55, 45.5] as Coord; // ~halfway along the east shape
		const res = projectVehicle({ coord: mid, shape: STRAIGHT, speedMps: 10, ageS: 8, bearing: 0 });
		expect(res.frozen).toBe(false);
		expect(res.coord[0]).toBeGreaterThan(mid[0]);
		expect(res.coord[1]).toBeCloseTo(45.5, 5);
	});
});
