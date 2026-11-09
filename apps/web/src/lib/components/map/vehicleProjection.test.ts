import { describe, expect, it } from 'vitest';
import {
	PROJECTION_HORIZON_S,
	STALE_CUTOFF_S,
	fixAgeS,
	isVehicleStale,
	projectedDistanceM,
	projectVehicle,
	projectionHorizon,
	notReporting,
} from './vehicleProjection';
import { VehicleSchema } from '#lib/v1/schemas/index.ts';
import { cumulativeLengths, projectToPolyline, type Coord } from './polyline';

const W = [-73.7, 45.5] as Coord;
const E = [-73.4, 45.5] as Coord;
const STRAIGHT: Coord[] = [W, E];

const NOW_MS = Date.parse('2026-06-22T12:00:00Z');

describe('provider source lag', () => {
	it('extends the horizon and its stale cap', () => {
		expect(projectionHorizon(20, 60)).toBe(130);
		expect(projectionHorizon(100, 60)).toBe(210);
		expect(projectionHorizon(20, 0)).toBe(70);
	});
	it('keeps an OC-like fix moving only with its allowance', () => {
		const input = { coord: W, shape: STRAIGHT, speedMps: 10, ageS: 110, bearing: 90 };
		const projected = projectVehicle({ ...input, horizon: projectionHorizon(20, 60), cutoff: 210 });
		expect(projected.frozen).toBe(false);
		expect(projected.coord[0]).toBeGreaterThan(W[0]);
		expect(projectVehicle({ ...input, horizon: projectionHorizon(20) }).frozen).toBe(true);
	});
	it('allows expected source lag before declaring a vehicle silent', () => {
		const vehicle = (age: number) =>
			VehicleSchema.parse({
				id: 'oc',
				lat: 45.5,
				lon: -75.7,
				status: 'unknown',
				reported_utc: isoAgo(age),
				updated_utc: isoAgo(0),
			});
		expect(notReporting(vehicle(170), NOW_MS, 210)).toBeNull();
		expect(notReporting(vehicle(170), NOW_MS)).toEqual({ ageS: 170 });
		expect(notReporting(vehicle(215), NOW_MS, 210)).toEqual({ ageS: 215 });
	});
});
function isoAgo(seconds: number): string {
	return new Date(NOW_MS - seconds * 1000).toISOString();
}

describe('constants', () => {
	it('expose the tunable horizon + cutoff', () => {
		expect(PROJECTION_HORIZON_S).toBe(90);
		expect(STALE_CUTOFF_S).toBe(150);
	});
});

describe('fixAgeS', () => {
	it('uses reported_utc when present (the bus own fix time)', () => {
		const age = fixAgeS(isoAgo(30), isoAgo(5), NOW_MS);
		expect(age).toBeCloseTo(30, 3);
	});

	it('falls back to updated_utc when reported_utc is null/undefined', () => {
		expect(fixAgeS(null, isoAgo(42), NOW_MS)).toBeCloseTo(42, 3);
		expect(fixAgeS(undefined, isoAgo(7), NOW_MS)).toBeCloseTo(7, 3);
	});

	it('clamps a future (negative) age to 0', () => {
		const age = fixAgeS(isoAgo(-10), isoAgo(-10), NOW_MS);
		expect(age).toBe(0);
	});

	it('returns Infinity when neither timestamp parses', () => {
		expect(fixAgeS('not-a-date', 'also-not-a-date', NOW_MS)).toBe(Infinity);
	});

	it('returns Infinity when reported is junk and falls back ONLY via the ?? (junk reported still used)', () => {
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
	it('keeps the reported speed between ages 30 and 60 seconds', () => {
		expect(projectedDistanceM(10, 60) - projectedDistanceM(10, 30)).toBe(300);
	});
	const v = 10;
	const H = PROJECTION_HORIZON_S;

	it('returns 0 for non-positive speed', () => {
		expect(projectedDistanceM(0, 10)).toBe(0);
		expect(projectedDistanceM(-5, 10)).toBe(0);
	});

	it('is v·a within the horizon', () => {
		const a = 1;
		const d = projectedDistanceM(v, a);
		expect(d).toBeCloseTo(10, 6);
		expect(d).toBe(v * a);
	});

	it('pins at v·H exactly at a = H', () => {
		expect(projectedDistanceM(v, H)).toBeCloseTo(v * H, 6);
	});

	it('stays at v·H for ages beyond the horizon (saturates, no unbounded travel)', () => {
		const cap = v * H;
		expect(projectedDistanceM(v, H + 1)).toBeCloseTo(cap, 6);
		expect(projectedDistanceM(v, H + 9999)).toBeCloseTo(cap, 6);
		expect(projectedDistanceM(v, Infinity)).toBeCloseTo(cap, 6);
	});

	it('is continuous at the horizon (limit from below == value at H)', () => {
		const justBelow = projectedDistanceM(v, H - 0.000001);
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
		expect(projectedDistanceM(v, h, h)).toBeCloseTo(v * h, 6);
		expect(projectedDistanceM(v, 9999, h)).toBeCloseTo(v * h, 6);
	});
});

describe('projectVehicle', () => {
	it('advances FORWARD along a straight shape and reports the tangent heading', () => {
		const ageS = 5;
		const speedMps = 10;
		const res = projectVehicle({ coord: W, shape: STRAIGHT, speedMps, ageS, bearing: 17 });

		expect(res.frozen).toBe(false);
		expect(res.stale).toBe(false);
		expect(res.coord[0]).toBeGreaterThan(W[0]);
		expect(res.coord[1]).toBeCloseTo(45.5, 5);
		expect(res.bearing).toBeCloseTo(90, 0);

		const lengths = cumulativeLengths(STRAIGHT);
		const back = projectToPolyline(STRAIGHT, res.coord, lengths)!;
		const expected = projectedDistanceM(speedMps, ageS);
		expect(back.s).toBeCloseTo(expected, 0);
	});

	it('stops at a next stop ahead, but ignores a reported stop at or behind the vehicle', () => {
		const start = [-73.6, 45.5] as Coord;
		const ahead = [-73.599, 45.5] as Coord; // ~78 m east
		const behind = [-73.62, 45.5] as Coord; // ~1.6 km west
		const free = projectVehicle({
			coord: start,
			shape: STRAIGHT,
			speedMps: 10,
			ageS: 30,
			bearing: 90,
		});
		const clamped = projectVehicle({
			coord: start,
			shape: STRAIGHT,
			speedMps: 10,
			ageS: 30,
			bearing: 90,
			nextStop: ahead,
		});
		const notClamped = projectVehicle({
			coord: start,
			shape: STRAIGHT,
			speedMps: 10,
			ageS: 30,
			bearing: 90,
			nextStop: behind,
		});
		const atStop = projectVehicle({
			coord: start,
			shape: STRAIGHT,
			speedMps: 10,
			ageS: 30,
			bearing: 90,
			nextStop: start,
		});
		expect(clamped.coord[0]).toBeCloseTo(ahead[0], 5);
		expect(clamped.frozen).toBe(true);
		expect(notClamped.coord[0]).toBeCloseTo(free.coord[0], 9);
		expect(notClamped.frozen).toBe(false);
		expect(atStop.coord[0]).toBeCloseTo(free.coord[0], 9);
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
			ageS: STALE_CUTOFF_S,
			bearing: 200,
		});
		expect(res.stale).toBe(true);
		expect(res.frozen).toBe(true);
		expect(res.coord).toEqual(W);
		expect(res.bearing).toBe(200);
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
		const mid = [-73.55, 45.5] as Coord;
		const res = projectVehicle({ coord: mid, shape: STRAIGHT, speedMps: 10, ageS: 8, bearing: 0 });
		expect(res.frozen).toBe(false);
		expect(res.coord[0]).toBeGreaterThan(mid[0]);
		expect(res.coord[1]).toBeCloseTo(45.5, 5);
	});
});
