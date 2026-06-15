// map/nearbyStops.ts — client-side "Arrêts près de moi" geo helpers.
//
// Pure + SSR-safe (no window, no map): ranking the 8,986-stop static index
// against a geolocation fix is a haversine sort, no server round-trip. The
// MapHero loads the stops_index once (createResource, client-only) and calls
// nearestStops() on a successful geolocation result.

/** A geographic point. Matches StopIndexEntry's `{ lat, lon }`. */
export interface LatLon {
	readonly lat: number;
	readonly lon: number;
}

/** Mean Earth radius (metres) — WGS-84 spherical approximation. */
const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Great-circle distance between two points in METRES (haversine). Spherical
 * approximation — accurate to well under 1% at city scale, which is all the
 * "nearest stops" ranking needs.
 */
export function haversineMeters(a: LatLon, b: LatLon): number {
	const dLat = toRad(b.lat - a.lat);
	const dLon = toRad(b.lon - a.lon);
	const lat1 = toRad(a.lat);
	const lat2 = toRad(b.lat);
	const h =
		Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A stop annotated with its distance (metres) from the query origin. */
export type WithDistance<T> = T & { readonly distanceM: number };

/**
 * The `k` stops nearest `origin`, ascending by distance. Stops beyond
 * `maxMeters` (when given) are excluded — so "nothing within range" returns an
 * empty list rather than far-flung results. Stable: ties keep input order.
 *
 * @param origin    the geolocation fix.
 * @param stops     the full stop catalogue (each carries lat/lon).
 * @param k         max results to return.
 * @param maxMeters optional radius cap (metres).
 */
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
