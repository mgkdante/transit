export interface LatLon {
	readonly lat: number;
	readonly lon: number;
}

const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

export function haversineMeters(a: LatLon, b: LatLon): number {
	const dLat = toRad(b.lat - a.lat);
	const dLon = toRad(b.lon - a.lon);
	const lat1 = toRad(a.lat);
	const lat2 = toRad(b.lat);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type WithDistance<T> = T & { readonly distanceM: number };

export function nearestStops<T extends LatLon>(
	origin: LatLon,
	stops: readonly T[],
	k: number,
	maxMeters?: number,
): WithDistance<T>[] {
	const ranked: WithDistance<T>[] = [];
	for (const stop of stops) {
		const distanceM = haversineMeters(origin, stop);
		if (maxMeters != null && distanceM > maxMeters) continue;
		ranked.push({ ...stop, distanceM });
	}
	ranked.sort((a, b) => a.distanceM - b.distanceM);
	return ranked.slice(0, Math.max(0, k));
}
