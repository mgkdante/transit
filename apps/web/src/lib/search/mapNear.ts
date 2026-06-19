import type { GeocodePrecision } from '$lib/geocode/types';
import { isInsideMontrealBounds } from '$lib/geocode/types';

export interface MapNearTarget {
	readonly lat: number;
	readonly lon: number;
	readonly label: string;
	readonly precision?: GeocodePrecision;
}

export const MAP_NEAR_PARAM = 'near';
export const MAP_NEAR_LABEL_PARAM = 'nearLabel';
export const MAP_NEAR_PRECISION_PARAM = 'nearPrecision';

const VALID_PRECISIONS = new Set<GeocodePrecision>([
	'address',
	'street',
	'neighbourhood',
	'postal',
	'place',
]);

export function mapNearId(lat: number, lon: number): string {
	return `${lat.toFixed(6)},${lon.toFixed(6)}`;
}

export function nearTargetFromSearchParams(searchParams: URLSearchParams): MapNearTarget | null {
	const raw = searchParams.get(MAP_NEAR_PARAM);
	if (!raw) return null;

	const match = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
	if (!match) return null;

	const lat = Number(match[1]);
	const lon = Number(match[2]);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	if (!isInsideMontrealBounds(lat, lon)) return null;

	const label = searchParams.get(MAP_NEAR_LABEL_PARAM)?.trim() || 'Selected place';
	const precision = parsePrecision(searchParams.get(MAP_NEAR_PRECISION_PARAM));
	return precision ? { lat, lon, label, precision } : { lat, lon, label };
}

export function setNearTargetSearchParams(
	searchParams: URLSearchParams,
	target: MapNearTarget,
): void {
	searchParams.set(MAP_NEAR_PARAM, mapNearId(target.lat, target.lon));
	searchParams.set(MAP_NEAR_LABEL_PARAM, target.label);
	if (target.precision) {
		searchParams.set(MAP_NEAR_PRECISION_PARAM, target.precision);
	} else {
		searchParams.delete(MAP_NEAR_PRECISION_PARAM);
	}
}

export function clearNearTargetSearchParams(searchParams: URLSearchParams): void {
	searchParams.delete(MAP_NEAR_PARAM);
	searchParams.delete(MAP_NEAR_LABEL_PARAM);
	searchParams.delete(MAP_NEAR_PRECISION_PARAM);
}

export function copyNearTargetSearchParams(from: URLSearchParams, to: URLSearchParams): void {
	const target = nearTargetFromSearchParams(from);
	if (!target) return;
	setNearTargetSearchParams(to, target);
}

function parsePrecision(value: string | null): GeocodePrecision | undefined {
	if (!value) return undefined;
	return VALID_PRECISIONS.has(value as GeocodePrecision) ? (value as GeocodePrecision) : undefined;
}
