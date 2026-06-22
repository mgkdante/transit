// mapNearMe — pure near-me query parsing + identity helpers for the /map hero.
//
// Side-effect-free string/coordinate logic extracted from MapHero so the
// near-me input parsing and the URL-dedupe key are unit-testable. Nothing here
// touches the map, stores, or reactive state; MapHero owns the stateful flow
// (geocoding fetches, fly-to, URL sync) and calls these for the plain bits.

import type { LatLon } from '$lib/components/map';
import { isInsideMontrealBounds } from '$lib/geocode/types';

/**
 * Parse a raw near-me query as a manual "lat, lon" (or "lat lon") coordinate
 * pair. Returns the coordinate only when it is well-formed AND inside the
 * Montréal bias rectangle; otherwise null so the caller falls through to the
 * geocoder. Accepts optional whitespace and a comma OR space separator.
 */
export function parseCoordinateQuery(query: string): LatLon | null {
	const match = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
	if (!match) return null;
	const lat = Number(match[1]);
	const lon = Number(match[2]);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	if (!isInsideMontrealBounds(lat, lon)) return null;
	return { lat, lon };
}

/** The minimal origin shape the dedupe key reads (a LatLon plus its label). */
export interface NearTargetKeyInput extends LatLon {
	readonly label: string;
}

/**
 * A stable identity string for a near-me origin, used to dedupe URL-sync round
 * trips (an unchanged target should not re-fly or re-push). Coordinates are
 * fixed to 6 decimals so float jitter never produces a spurious new key.
 */
export function nearTargetKey(origin: NearTargetKeyInput): string {
	return `${origin.lat.toFixed(6)},${origin.lon.toFixed(6)}:${origin.label}`;
}
