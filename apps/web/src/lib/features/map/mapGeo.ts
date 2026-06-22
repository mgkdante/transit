// mapGeo — pure geometry/camera helpers for the /map hero.
//
// Side-effect-free math extracted from MapHero so the load-bearing logic (route
// bounding boxes, near-me zoom levels) is unit-testable without a GL context.
// Nothing here touches the map instance, stores, or reactive state; the stateful
// callers in MapHero pass plain data in and act on the returned values.

import type { RouteFile } from '$lib/v1';
import type { GeocodePrecision } from '$lib/geocode/types';

/** A MapLibre LngLatBounds tuple: [[minLon, minLat], [maxLon, maxLat]]. */
export type MapBounds = [[number, number], [number, number]];

/**
 * Compute the bounding box that contains every direction shape of a route, or
 * null when the route has no usable geometry. Walks all direction shapes and
 * their coordinate pairs, ignoring non-finite / malformed entries, so a partial
 * or empty shape never yields a fabricated box. Mirrors the camera-fit input
 * MapLibre's fitBounds expects (lon/lat order).
 */
export function routeBoundsFromFile(route: RouteFile): MapBounds | null {
	let minLon = Infinity;
	let minLat = Infinity;
	let maxLon = -Infinity;
	let maxLat = -Infinity;
	for (const direction of route.directions ?? []) {
		const coords = (direction.shape as { coordinates?: unknown })?.coordinates;
		if (!Array.isArray(coords)) continue;
		for (const pair of coords) {
			if (!Array.isArray(pair) || pair.length < 2) continue;
			const lon = Number(pair[0]);
			const lat = Number(pair[1]);
			if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
			if (lon < minLon) minLon = lon;
			if (lat < minLat) minLat = lat;
			if (lon > maxLon) maxLon = lon;
			if (lat > maxLat) maxLat = lat;
		}
	}
	if (minLon === Infinity) return null;
	return [
		[minLon, minLat],
		[maxLon, maxLat],
	];
}

/**
 * The target zoom for a near-me fly-to, scaled to the geocode precision: a full
 * address zooms in tight; a neighbourhood frames a wider area. Unknown / absent
 * precision falls back to a sensible mid zoom.
 */
export function zoomForNearMePrecision(precision?: GeocodePrecision): number {
	switch (precision) {
		case 'address':
			return 17;
		case 'street':
			return 15;
		case 'postal':
			return 14;
		case 'neighbourhood':
			return 13;
		default:
			return 14;
	}
}
