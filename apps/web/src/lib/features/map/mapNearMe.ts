import type { LatLon } from '$lib/components/map';
import { isInsideMontrealBounds } from '$lib/geocode/types';

export function parseCoordinateQuery(query: string): LatLon | null {
	const match = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
	if (!match) return null;
	const lat = Number(match[1]);
	const lon = Number(match[2]);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	if (!isInsideMontrealBounds(lat, lon)) return null;
	return { lat, lon };
}

export interface NearTargetKeyInput extends LatLon {
	readonly label: string;
}

export function nearTargetKey(origin: NearTargetKeyInput): string {
	return `${origin.lat.toFixed(6)},${origin.lon.toFixed(6)}:${origin.label}`;
}
