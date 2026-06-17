import type { RouteIndexEntry, StopIndexEntry, Vehicle } from '$lib/v1/schemas';
import { fromSearchParams, toSearchString } from '$lib/filters';
import type { GeocodePrecision, GeocodeSuggestion } from '$lib/geocode/types';
import {
	copyNearTargetSearchParams,
	mapNearId,
	setNearTargetSearchParams,
} from '$lib/search/mapNear';

export type ChromeSearchKind = 'route' | 'stop' | 'vehicle' | 'address';

export interface ChromeSearchResult {
	readonly kind: ChromeSearchKind;
	readonly id: string;
	readonly label: string;
	readonly meta?: string;
	readonly priority: number;
	readonly lat?: number;
	readonly lon?: number;
	readonly precision?: GeocodePrecision;
	readonly attribution?: 'google';
}

interface ChromeSearchSources {
	readonly routes?: readonly RouteIndexEntry[] | null;
	readonly stops?: readonly StopIndexEntry[] | null;
	readonly vehicles?: readonly Vehicle[] | null;
	readonly addresses?: readonly GeocodeSuggestion[] | null;
}

function normalize(value: string | null | undefined): string {
	return (value ?? '').trim().toLowerCase();
}

function includes(value: string | null | undefined, query: string): boolean {
	return normalize(value).includes(query);
}

function matchScore(values: readonly (string | null | undefined)[], query: string): number | null {
	for (const value of values) {
		if (normalize(value) === query) return 0;
	}
	for (const value of values) {
		if (normalize(value).startsWith(query)) return 1;
	}
	for (const value of values) {
		if (includes(value, query)) return 2;
	}
	return null;
}

function routeLabel(route: RouteIndexEntry): string {
	return route.long ? `${route.short} ${route.long}` : route.short;
}

function collate(a: ChromeSearchResult, b: ChromeSearchResult): number {
	return (
		a.priority - b.priority ||
		a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
	);
}

export function chromeSearchResults(
	query: string,
	sources: ChromeSearchSources,
): ChromeSearchResult[] {
	const q = normalize(query);
	if (!q) return [];

	const routes = (sources.routes ?? [])
		.map((route): ChromeSearchResult | null => {
			const score = matchScore([route.id, route.short, route.long], q);
			if (score == null) return null;
			return {
				kind: 'route',
				id: route.id,
				label: routeLabel(route),
				priority: score,
			};
		})
		.filter((result): result is ChromeSearchResult => result != null)
		.sort(collate)
		.slice(0, 5);

	const stops = (sources.stops ?? [])
		.map((stop): ChromeSearchResult | null => {
			const score = matchScore([stop.code, stop.id, stop.name], q);
			if (score == null) return null;
			return {
				kind: 'stop',
				id: stop.id,
				label: stop.name,
				meta: stop.code ?? 'Stop',
				priority: 4 + score,
			};
		})
		.filter((result): result is ChromeSearchResult => result != null)
		.sort(collate)
		.slice(0, 5);

	const vehicles = (sources.vehicles ?? [])
		.filter((vehicle) => normalize(vehicle.id) === q)
		.map(
			(vehicle): ChromeSearchResult => ({
				kind: 'vehicle',
				id: vehicle.id,
				label: vehicle.id,
				meta: vehicle.route ? `Route ${vehicle.route}` : 'Live bus',
				priority: 20,
			}),
		)
		.sort(collate)
		.slice(0, 3);

	const addresses = (sources.addresses ?? [])
		.map(
			(address, index): ChromeSearchResult => ({
				kind: 'address',
				id: addressResultId(address, index),
				label: address.label,
				meta: precisionLabel(address.precision),
				priority: 30 + index,
				lat: address.lat,
				lon: address.lon,
				precision: address.precision,
				attribution: address.attribution,
			}),
		)
		.sort(collate)
		.slice(0, 3);

	return [...routes, ...stops, ...vehicles, ...addresses].sort(collate).slice(0, 8);
}

export function chromeSearchHref(
	result: Pick<ChromeSearchResult, 'kind' | 'id'> &
		Partial<Pick<ChromeSearchResult, 'label' | 'lat' | 'lon' | 'precision'>>,
	currentSearchParams: URLSearchParams = new URLSearchParams(),
): string {
	const state = fromSearchParams(currentSearchParams);
	if (result.kind === 'route') {
		state.routes.add(result.id);
	} else if (result.kind === 'stop') {
		state.stops.add(result.id);
	} else if (result.kind === 'vehicle') {
		state.vehicles.add(result.id);
	}

	const searchParams = new URLSearchParams(toSearchString(state));
	if (result.kind === 'address') {
		const target = addressTargetFromResult(result);
		if (target) setNearTargetSearchParams(searchParams, target);
	} else {
		copyNearTargetSearchParams(currentSearchParams, searchParams);
	}

	const search = searchParams.toString();
	return search ? `/map?${search}` : '/map';
}

function addressResultId(address: GeocodeSuggestion, index: number): string {
	if (typeof address.lat === 'number' && typeof address.lon === 'number') {
		return mapNearId(address.lat, address.lon);
	}
	if (address.placeId)
		return `${address.source === 'google_places' ? 'google' : address.source}:${address.placeId}`;
	return `address:${index}:${address.label}`;
}

function addressTargetFromResult(
	result: Pick<ChromeSearchResult, 'id'> &
		Partial<Pick<ChromeSearchResult, 'label' | 'lat' | 'lon' | 'precision'>>,
) {
	if (typeof result.lat === 'number' && typeof result.lon === 'number') {
		return {
			lat: result.lat,
			lon: result.lon,
			label: result.label ?? 'Selected place',
			precision: result.precision,
		};
	}

	const match = result.id.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
	if (!match) return null;

	const lat = Number(match[1]);
	const lon = Number(match[2]);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	return { lat, lon, label: result.label ?? 'Selected place', precision: result.precision };
}

function precisionLabel(precision: GeocodePrecision): string {
	switch (precision) {
		case 'address':
			return 'Address';
		case 'street':
			return 'Street';
		case 'postal':
			return 'Postal code';
		case 'neighbourhood':
			return 'Neighbourhood';
		case 'place':
			return 'Place';
	}
}
