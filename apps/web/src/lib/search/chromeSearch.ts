import type { RouteIndexEntry, StopIndexEntry, Vehicle } from '$lib/v1/schemas';
import { fromSearchParams, toSearchString } from '$lib/filters';
import type { GeocodePrecision, GeocodeSource, GeocodeSuggestion } from '$lib/geocode/types';
import { dedupeBy, foldSearchText, tokenMatchScore } from '$lib/search/normalize';
import { setMapFocusSearchParams, type MapFocusKind } from '$lib/search/mapFocus';
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
	// Carried through from the picked GeocodeSuggestion so a coordinate-less
	// (Google) address can be resolved by placeId on selection instead of being
	// re-text-searched by its label.
	readonly placeId?: string;
	readonly source?: GeocodeSource;
}

interface ChromeSearchSources {
	readonly routes?: readonly RouteIndexEntry[] | null;
	readonly stops?: readonly StopIndexEntry[] | null;
	readonly vehicles?: readonly Vehicle[] | null;
	readonly addresses?: readonly GeocodeSuggestion[] | null;
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
	const q = foldSearchText(query);
	if (!q) return [];

	const routes = (sources.routes ?? [])
		.map((route): ChromeSearchResult | null => {
			const score = tokenMatchScore([route.id, route.short, route.long], q);
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

	const stopMatches = (sources.stops ?? [])
		.map((stop) => ({ stop, score: tokenMatchScore([stop.code, stop.id, stop.name], q) }))
		.filter((m): m is { stop: StopIndexEntry; score: number } => m.score != null)
		.sort((a, b) => a.score - b.score);
	// Collapse the métro interchange's duplicate platform stops (shared code) to one.
	const stops = dedupeBy(stopMatches, (m) => m.stop.code ?? m.stop.id)
		.map(
			({ stop, score }): ChromeSearchResult => ({
				kind: 'stop',
				id: stop.id,
				label: stop.name,
				meta: stop.code ?? 'Stop',
				priority: 4 + score,
			}),
		)
		.slice(0, 5);

	const vehicles = (sources.vehicles ?? [])
		.filter((vehicle) => foldSearchText(vehicle.id) === q)
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
				placeId: address.placeId,
				source: address.source,
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
		// Tell the map to zoom to the picked entity (one-shot; the map strips it).
		setMapFocusSearchParams(searchParams, result.kind as MapFocusKind, result.id);
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
