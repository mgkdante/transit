import type { RouteFile } from '$lib/v1';
import type { GeocodePrecision } from '$lib/geocode/types';

export type MapBounds = [[number, number], [number, number]];

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
