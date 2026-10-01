import type { RouteIndexEntry, StopIndexEntry, Vehicle } from '$lib/v1/schemas';
import { FILTER_SEARCH_PARAM_KEYS, fromSearchParams, toSearchString } from '$lib/filters';
import type { GeocodePrecision, GeocodeSuggestion } from '$lib/geocode/types';
import { routeFor } from '$lib/nav';
import { dedupeBy, foldSearchText, tokenMatchScore } from '$lib/search/normalize';
import { routeModeKey, stopGroupKey, stopModeKey, type TransitModeKey } from '$lib/search/stopMode';
import { setMapFocusSearchParams, type MapFocusKind } from '$lib/search/mapFocus';
import {
	copyNearTargetSearchParams,
	mapNearId,
	setNearTargetSearchParams,
} from '$lib/search/mapNear';

export type ChromeSearchKind = 'route' | 'stop' | 'vehicle' | 'address';

export type ChromeSearchScope = 'route' | 'stop' | 'map' | 'all';

export interface ChromeSearchOptions {
	readonly scope?: ChromeSearchScope;
	readonly modes?: ReadonlySet<TransitModeKey>;
}

export interface ChromeSearchResult {
	readonly kind: ChromeSearchKind;
	readonly id: string;
	readonly label: string;
	readonly meta?: string;
	readonly priority: number;
	readonly lat?: number;
	readonly lon?: number;
	readonly precision?: GeocodePrecision;
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
	options: ChromeSearchOptions = {},
): ChromeSearchResult[] {
	const q = foldSearchText(query);
	if (!q) return [];

	const scope = options.scope ?? 'all';
	const modes = options.modes?.size ? options.modes : null;
	const keepsMode = (mode: TransitModeKey | null): boolean => !modes || (!!mode && modes.has(mode));

	const routes = (sources.routes ?? [])
		.map((route): ChromeSearchResult | null => {
			const score = tokenMatchScore([route.id, route.short, route.long], q);
			if (score == null || !keepsMode(routeModeKey(route.type))) return null;
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
		.filter((m) => keepsMode(stopModeKey(m.stop)))
		.sort((a, b) => a.score - b.score);
	const stops = dedupeBy(stopMatches, (m) => stopGroupKey(m.stop))
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

	const vehicles = (keepsMode('bus') ? (sources.vehicles ?? []) : [])
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

	const addresses = (modes ? [] : (sources.addresses ?? []))
		.map(
			(address, index): ChromeSearchResult => ({
				kind: 'address',
				id: addressResultId(address),
				label: address.label,
				meta: precisionLabel(address.precision),
				priority: 30 + index,
				lat: address.lat,
				lon: address.lon,
				precision: address.precision,
			}),
		)
		.sort(collate)
		.slice(0, 3);

	if (scope === 'route') return routes.slice(0, 8);
	if (scope === 'stop') return stops.slice(0, 8);
	return [...routes, ...stops, ...vehicles, ...addresses].sort(collate).slice(0, 8);
}

export function scopeForPath(delocalizedPath: string): ChromeSearchScope {
	if (delocalizedPath === '/lines' || delocalizedPath.startsWith('/lines/')) return 'route';
	if (delocalizedPath === '/stops' || delocalizedPath.startsWith('/stop/')) return 'stop';
	if (delocalizedPath === '/map') return 'map';
	return 'all';
}

export function chromeSearchResultHref(
	result: ChromeSearchResult,
	scope: ChromeSearchScope,
	currentSearchParams?: URLSearchParams,
): string {
	if (scope === 'route' && result.kind === 'route') {
		return routeFor({ kind: 'line', id: result.id });
	}
	if (scope === 'stop' && result.kind === 'stop') {
		return routeFor({ kind: 'stop', id: result.id });
	}
	return chromeSearchHref(result, currentSearchParams, scope);
}

export function chromeSearchHref(
	result: Pick<ChromeSearchResult, 'kind' | 'id'> &
		Partial<Pick<ChromeSearchResult, 'label' | 'lat' | 'lon' | 'precision'>>,
	currentSearchParams: URLSearchParams = new URLSearchParams(),
	scope: ChromeSearchScope = 'all',
): string {
	const state = fromSearchParams(currentSearchParams);
	if (result.kind === 'route') {
		state.routes.add(result.id);
	} else if (result.kind === 'stop') {
		state.stops.add(result.id);
	} else if (result.kind === 'vehicle') {
		state.vehicles.add(result.id);
	}

	const canonicalFilters = new URLSearchParams(toSearchString(state));
	const searchParams =
		scope === 'map' ? new URLSearchParams(currentSearchParams) : canonicalFilters;
	if (scope === 'map') {
		for (const key of FILTER_SEARCH_PARAM_KEYS) searchParams.delete(key);
		for (const key of FILTER_SEARCH_PARAM_KEYS) {
			for (const value of canonicalFilters.getAll(key)) searchParams.append(key, value);
		}
	}
	if (result.kind === 'address') {
		const target = addressTargetFromResult(result);
		if (target) setNearTargetSearchParams(searchParams, target);
	} else {
		if (scope !== 'map') copyNearTargetSearchParams(currentSearchParams, searchParams);
		setMapFocusSearchParams(searchParams, result.kind as MapFocusKind, result.id);
	}

	const search = searchParams.toString();
	return search ? `/map?${search}` : '/map';
}

function addressResultId(address: GeocodeSuggestion): string {
	return mapNearId(address.lat, address.lon);
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
