import { describe, expect, it } from 'vitest';
import {
	buildPathBetween,
	chordBearing,
	cumulativeLengths,
	projectToPolyline,
	walkAlong,
	type Coord,
} from './polyline';

const EAST = [-73.6, 45.5] as Coord;
const CORNER = [-73.58, 45.5] as Coord;
const NORTH = [-73.58, 45.52] as Coord;
const L_PATH: Coord[] = [EAST, CORNER, NORTH];

describe('cumulativeLengths', () => {
	it('is a prefix sum starting at 0 and ending at the total length', () => {
		const cum = cumulativeLengths(L_PATH);
		expect(cum).toHaveLength(3);
		expect(cum[0]).toBe(0);
		expect(cum[1]).toBeGreaterThan(0);
		expect(cum[2]).toBeGreaterThan(cum[1]);
	});

	it('handles degenerate inputs (empty → [], single point → [0])', () => {
		expect(cumulativeLengths([])).toEqual([]);
		expect(cumulativeLengths([EAST])).toEqual([0]);
	});

	it('measures a known east-west segment in metres (approx)', () => {
		const cum = cumulativeLengths([EAST, CORNER]);
		expect(cum[1]).toBeGreaterThan(1500);
		expect(cum[1]).toBeLessThan(1620);
	});

	it('MEMOIZES by array reference: same array → identical cached array, new array → recomputes', () => {
		const shapeA: Coord[] = [EAST, CORNER, NORTH];
		const shapeB: Coord[] = [EAST, CORNER, NORTH];

		const firstA = cumulativeLengths(shapeA);
		const secondA = cumulativeLengths(shapeA);
		expect(secondA).toBe(firstA);

		const firstB = cumulativeLengths(shapeB);
		expect(firstB).not.toBe(firstA);
		expect(firstB).toEqual(firstA);
	});
});

describe('projectToPolyline', () => {
	it('projects a point to the NEAREST segment with its arc length', () => {
		const probe = [-73.59, 45.501] as Coord;
		const proj = projectToPolyline(L_PATH, probe);
		expect(proj).not.toBeNull();
		const cum = cumulativeLengths(L_PATH);
		expect(proj!.s).toBeGreaterThan(cum[1] * 0.3);
		expect(proj!.s).toBeLessThan(cum[1] * 0.7);
		expect(proj!.distance).toBeGreaterThan(80);
		expect(proj!.distance).toBeLessThan(140);
		expect(proj!.point[1]).toBeCloseTo(45.5, 5);
	});

	it('clamps the projection to a segment endpoint when the point is off the end', () => {
		const proj = projectToPolyline([EAST, CORNER], [-73.7, 45.5]);
		expect(proj).not.toBeNull();
		expect(proj!.s).toBe(0);
		expect(proj!.point[0]).toBeCloseTo(EAST[0], 6);
	});

	it('returns null for a polyline with fewer than two points', () => {
		expect(projectToPolyline([EAST], EAST)).toBeNull();
		expect(projectToPolyline([], EAST)).toBeNull();
	});
});

describe('walkAlong', () => {
	it('walks distance d to the right position and reports the segment tangent', () => {
		const cum = cumulativeLengths(L_PATH);
		const start = walkAlong(L_PATH, 0)!;
		expect(start.coord[0]).toBeCloseTo(EAST[0], 6);
		expect(start.bearing).toBeCloseTo(90, 0);

		const atCorner = walkAlong(L_PATH, cum[1])!;
		expect(atCorner.coord[0]).toBeCloseTo(CORNER[0], 6);
		expect(atCorner.coord[1]).toBeCloseTo(CORNER[1], 6);
		expect(atCorner.bearing).toBeCloseTo(90, 0);

		const onNorthLeg = walkAlong(L_PATH, cum[1] + (cum[2] - cum[1]) * 0.5)!;
		const b = onNorthLeg.bearing;
		expect(b < 5 || b > 355).toBe(true);
		expect(onNorthLeg.coord[0]).toBeCloseTo(CORNER[0], 6);
	});

	it('advancing by half the total length lands ~halfway in arc terms', () => {
		const cum = cumulativeLengths(L_PATH);
		const total = cum[2];
		const half = walkAlong(L_PATH, total / 2)!;
		const back = projectToPolyline(L_PATH, half.coord)!;
		expect(back.s).toBeCloseTo(total / 2, 0);
	});

	it('clamps s beyond the ends (no extrapolation past the last vertex)', () => {
		const cum = cumulativeLengths(L_PATH);
		const past = walkAlong(L_PATH, cum[2] + 9999)!;
		expect(past.coord[0]).toBeCloseTo(NORTH[0], 6);
		expect(past.coord[1]).toBeCloseTo(NORTH[1], 6);
		const before = walkAlong(L_PATH, -9999)!;
		expect(before.coord[0]).toBeCloseTo(EAST[0], 6);
	});

	it('returns null on empty input', () => {
		expect(walkAlong([], 10)).toBeNull();
	});
});

describe('buildPathBetween', () => {
	it('returns a sampler that follows the bend instead of cutting the chord', () => {
		const sampler = buildPathBetween(L_PATH, [-73.599, 45.5], [-73.58, 45.519]);
		expect(sampler).not.toBeNull();
		const mid = sampler!(0.5);
		const chordMidLon = (-73.599 + -73.58) / 2;
		expect(mid.coord[0]).toBeGreaterThan(chordMidLon);
	});

	it('bounds the walk to the arc between the two fixes (t=0 ~from, t=1 ~to)', () => {
		const sampler = buildPathBetween(L_PATH, [-73.599, 45.5], [-73.58, 45.519])!;
		const start = sampler(0);
		const end = sampler(1);
		expect(start.coord[0]).toBeCloseTo(-73.599, 2);
		expect(end.coord[1]).toBeCloseTo(45.519, 2);
	});

	it('never walks past t=1 even when progress is clamped above 1 (no extrapolation)', () => {
		const sampler = buildPathBetween(L_PATH, [-73.599, 45.5], [-73.58, 45.519])!;
		const atOne = sampler(1);
		const beyond = sampler(1.5);
		expect(beyond.coord).toEqual(atOne.coord);
	});

	it('falls back (null) when the shape is degenerate', () => {
		expect(buildPathBetween([EAST], EAST, NORTH)).toBeNull();
		expect(buildPathBetween([EAST, EAST], EAST, NORTH)).toBeNull();
	});

	it('falls back (null) when a fix is implausibly far off the route', () => {
		const sampler = buildPathBetween(L_PATH, [-73.599, 45.5], [-73.58, 45.6]);
		expect(sampler).toBeNull();
	});

	it('falls back (null) when both fixes project to ~the same arc point (no travel)', () => {
		const sampler = buildPathBetween(L_PATH, [-73.599, 45.5], [-73.599, 45.5]);
		expect(sampler).toBeNull();
	});
});

describe('chordBearing', () => {
	it('reports the compass bearing of the straight chord', () => {
		expect(chordBearing(EAST, CORNER)).toBeCloseTo(90, 0);
		expect(chordBearing(CORNER, NORTH)).toBeCloseTo(0, 0);
	});

	it('returns null when the two points coincide (no direction)', () => {
		expect(chordBearing(EAST, EAST)).toBeNull();
	});
});

describe('project + walk round-trip (forward-projection helpers)', () => {
	const cum = cumulativeLengths(L_PATH);

	it('advancing from a projected point by d lands d metres further along the arc', () => {
		const start = projectToPolyline(L_PATH, [-73.595, 45.5005])!;
		const advanced = walkAlong(L_PATH, start.s + 400)!;
		const back = projectToPolyline(L_PATH, advanced.coord)!;
		expect(back.s).toBeCloseTo(start.s + 400, 0);
	});

	it('advancing past the shape end pins at the final vertex (no extrapolation)', () => {
		const start = projectToPolyline(L_PATH, EAST)!;
		const advanced = walkAlong(L_PATH, start.s + cum[cum.length - 1] + 9999)!;
		expect(advanced.coord[0]).toBeCloseTo(NORTH[0], 6);
		expect(advanced.coord[1]).toBeCloseTo(NORTH[1], 6);
	});

	it('the sampled tangent at the advanced point is the local travel direction', () => {
		const start = projectToPolyline(L_PATH, EAST)!;
		const stillEast = walkAlong(L_PATH, start.s + 200)!;
		expect(stillEast.bearing).toBeCloseTo(90, 0);

		const onNorth = walkAlong(L_PATH, cum[1] + (cum[2] - cum[1]) * 0.5)!;
		expect(onNorth.bearing < 5 || onNorth.bearing > 355).toBe(true);
	});
});
