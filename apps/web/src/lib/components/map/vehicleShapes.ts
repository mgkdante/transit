// map/vehicleShapes.ts — pick the right route SHAPE for a moving vehicle so the
// kinetic tween can walk ALONG the street (vehicleMotion path-follow, L1).
//
// A live vehicle carries its `route` id but NO direction, so for a route with
// two (or more) direction variants we must INFER which polyline the bus is on.
// We pick the variant whose shape the vehicle's CURRENT point projects onto with
// the least perpendicular error — and only if that error is within a plausible
// on-route band. If nothing is close enough (wrong route file, off-route GPS, no
// shape published), we return null and the tween falls back to the straight
// chord. This keeps motion HONEST: a bus is only path-followed on a street its
// own reported position actually sits on.

import type { RouteFile } from '$lib/v1/schemas';
import { routeDirectionVariants } from './routeDirection';
import { projectToPolyline, type Coord } from './polyline';

/** A route's direction-variant polylines (the parsed `LineString` coords). */
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

/**
 * Extract every direction variant's polyline from a RouteFile. Variants with no
 * usable shape (missing, not a LineString, < 2 points) are skipped. Returns an
 * empty array when the route publishes no shapes — the caller then has nothing to
 * path-follow and uses the chord.
 */
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

/**
 * Pick the variant polyline a vehicle at `point` is most plausibly travelling on
 * — the one with the smallest perpendicular projection error, gated by
 * `maxOffRouteM`. Returns null when no variant is close enough (so the tween
 * uses the chord rather than snapping to an unrelated street).
 */
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
