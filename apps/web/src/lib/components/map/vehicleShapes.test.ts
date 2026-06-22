import { describe, expect, it } from 'vitest';
import { bestShapeForPoint, routeShapes, type RouteShapes } from './vehicleShapes';
import type { Coord } from './polyline';
import type { RouteFile } from '$lib/v1/schemas';

function route(directions: RouteFile['directions']): RouteFile {
	return {
		generated_utc: '2026-06-21T00:00:00Z',
		id: '161',
		long: 'Van Horne',
		directions,
	} as RouteFile;
}

const EAST_LEG: Coord[] = [
	[-73.6, 45.5],
	[-73.58, 45.5],
];
const NORTH_LEG: Coord[] = [
	[-73.5, 45.5],
	[-73.5, 45.52],
];

describe('routeShapes', () => {
	it('extracts each variant LineString as coords', () => {
		const r = route([
			{ dir: 0, shape: { type: 'LineString', coordinates: EAST_LEG } },
			{ dir: 1, shape: { type: 'LineString', coordinates: NORTH_LEG } },
		]);
		const shapes = routeShapes(r);
		expect(shapes).toHaveLength(2);
		expect(shapes[0]).toEqual(EAST_LEG);
	});

	it('skips variants with no usable shape (missing / wrong type / too few points)', () => {
		const r = route([
			{ dir: 0, shape: null },
			{ dir: 1, shape: { type: 'Point', coordinates: [-73.6, 45.5] } },
			{ dir: 2, shape: { type: 'LineString', coordinates: [[-73.6, 45.5]] } },
			{ dir: 3, shape: { type: 'LineString', coordinates: EAST_LEG } },
		]);
		const shapes = routeShapes(r);
		expect(shapes).toHaveLength(1);
		expect(shapes[0]).toEqual(EAST_LEG);
	});

	it('returns empty when the route publishes no shapes', () => {
		expect(routeShapes(route([{ dir: 0, shape: null }]))).toEqual([]);
	});
});

describe('bestShapeForPoint', () => {
	const shapes: RouteShapes = [EAST_LEG, NORTH_LEG];

	it('picks the variant the vehicle is closest to', () => {
		// On the east leg.
		expect(bestShapeForPoint(shapes, [-73.59, 45.5005])).toBe(EAST_LEG);
		// On the north leg.
		expect(bestShapeForPoint(shapes, [-73.5, 45.51])).toBe(NORTH_LEG);
	});

	it('returns null when the point is too far from every variant', () => {
		// ~5 km north of both legs.
		expect(bestShapeForPoint(shapes, [-73.55, 45.6])).toBeNull();
	});

	it('returns null for an empty shape set', () => {
		expect(bestShapeForPoint([], [-73.6, 45.5])).toBeNull();
	});
});
