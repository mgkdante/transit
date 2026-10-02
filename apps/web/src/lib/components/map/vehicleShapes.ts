import type { RouteFile } from '$lib/v1/schemas';
import { routeDirectionVariants } from './routeDirection';
import { projectToPolyline, type Coord } from './polyline';

export type RouteShapes = readonly (readonly Coord[])[];

function isLngLatPair(value: unknown): value is [number, number] {
	return (
		Array.isArray(value) &&
		value.length >= 2 &&
		typeof value[0] === 'number' &&
		typeof value[1] === 'number' &&
		Number.isFinite(value[0]) &&
		Number.isFinite(value[1])
	);
}

export function routeShapes(route: RouteFile): RouteShapes {
	const out: Coord[][] = [];
	for (const variant of routeDirectionVariants(route)) {
		const shape = variant.direction.shape;
		if (!shape || shape.type !== 'LineString' || !Array.isArray(shape.coordinates)) continue;
		const coords = (shape.coordinates as unknown[]).filter(isLngLatPair);
		if (coords.length >= 2) out.push(coords as Coord[]);
	}
	return out;
}

export function bestShapeForPoint(
	shapes: RouteShapes,
	point: Coord,
	maxOffRouteM = 60,
): readonly Coord[] | null {
	let best: readonly Coord[] | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const coords of shapes) {
		const proj = projectToPolyline(coords, point);
		if (proj && proj.distance < bestDistance) {
			bestDistance = proj.distance;
			best = coords;
		}
	}
	return best != null && bestDistance <= maxOffRouteM ? best : null;
}
