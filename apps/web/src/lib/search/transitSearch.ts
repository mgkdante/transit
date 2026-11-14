import { stopDisplayName, lineLabel } from '#lib/site/transitDisplay.ts';
import type { RouteIndexEntry, StopIndexEntry, Vehicle } from '#lib/v1/schemas/index.ts';
import { FILTER_SEARCH_PARAM_KEYS, fromSearchParams, toSearchString } from '#lib/filters/index.ts';
import type { GeocodePrecision, GeocodeSuggestion } from '#lib/geocode/types.ts';
import { routeFor } from '#lib/nav/index.ts';
import { dedupeBy, foldSearchText, tokenMatchScore } from '#lib/search/normalize.ts';
import {
	routeModeKey,
	stopGroupKey,
	stopModeKey,
	type TransitModeKey,
} from '#lib/search/stopMode.ts';
import { setMapFocusSearchParams, type MapFocusKind } from '#lib/search/mapFocus.ts';
import {
	copyNearTargetSearchParams,
	mapNearId,
	setNearTargetSearchParams,
} from '#lib/search/mapNear.ts';

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

export interface SearchSources {
	readonly routes?: readonly RouteIndexEntry[] | null;
	readonly stops?: readonly StopIndexEntry[] | null;
	readonly vehicles?: readonly Vehicle[] | null;
	readonly addresses?: readonly GeocodeSuggestion[] | null;
}

export interface HeaderSearchRequest extends ChromeSearchOptions {
	readonly query: string;
	readonly surface: 'header';
}
export interface PageSearchRequest {
	readonly query: string;
	readonly surface: 'page';
	readonly modes?: ReadonlySet<TransitModeKey>;
}
export interface PageSearchResults {
	readonly query: string;
	readonly routes: RouteIndexEntry[];
	readonly stops: StopIndexEntry[];
	readonly vehicles: Vehicle[];
}
interface Candidate<T> {
	value: T;
	score: number;
}
interface Candidates {
	routes: Candidate<RouteIndexEntry>[];
	stops: Candidate<StopIndexEntry>[];
	vehicles: Vehicle[];
}

function scoredCandidates<T>(
	values: readonly T[],
	query: string,
	fields: (value: T) => readonly (string | null | undefined)[],
): Candidate<T>[] {
	return values
		.map((value) => ({ value, score: tokenMatchScore(fields(value), query) }))
		.filter((match): match is Candidate<T> => match.score != null);
}
function byScore(a: { score: number }, b: { score: number }): number {
	return a.score - b.score;
}

function candidates(
	request: HeaderSearchRequest | PageSearchRequest,
	sources: SearchSources,
	query: string,
): Candidates {
	const modes = request.modes?.size ? request.modes : null;
	const keepsMode = (mode: TransitModeKey | null): boolean => !modes || (!!mode && modes.has(mode));
	const routes = scoredCandidates(sources.routes ?? [], query, (route) => [
		route.id,
		route.short,
		route.long,
	])
		.filter(({ value }) => keepsMode(routeModeKey(value.type)))
		.sort(byScore);
	const stopMatches = scoredCandidates(sources.stops ?? [], query, (stop) => [
		stop.code,
		stop.id,
		stop.name,
	])
		.filter(({ value }) => request.surface === 'page' || keepsMode(stopModeKey(value)))
		.sort(byScore);
	// Header selects a representative from allowed modes; page selects it before filtering.
	const stops = dedupeBy(stopMatches, ({ value }) => stopGroupKey(value)).filter(({ value }) =>
		keepsMode(stopModeKey(value)),
	);
	const vehicles = keepsMode('bus')
		? (sources.vehicles ?? []).filter((vehicle) => foldSearchText(vehicle.id) === query)
		: [];
	return { routes, stops, vehicles };
}

function collate(a: ChromeSearchResult, b: ChromeSearchResult): number {
	return (
		a.priority - b.priority ||
		a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
	);
}
function headerRoutes(routes: Candidates['routes']): ChromeSearchResult[] {
	return routes
		.map(
			({ value: route, score }): ChromeSearchResult => ({
				kind: 'route',
				id: route.id,
				label: route.long ? `${route.short} ${route.long}` : route.short,
				priority: score,
			}),
		)
		.sort(collate)
		.slice(0, 5);
}
function headerStops(stops: Candidates['stops']): ChromeSearchResult[] {
	return stops
		.map(
			({ value: stop, score }): ChromeSearchResult => ({
				kind: 'stop',
				id: stop.id,
				label: stopDisplayName(stop.name),
				meta: stop.code ?? 'Stop',
				priority: 4 + score,
			}),
		)
		.slice(0, 5);
}
function headerVehicles(
	vehicles: Candidates['vehicles'],
	routes: SearchSources['routes'],
): ChromeSearchResult[] {
	return [...vehicles]
		.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }))
		.slice(0, 3)
		.map(
			(vehicle): ChromeSearchResult => ({
				kind: 'vehicle',
				id: vehicle.id,
				label: vehicle.id,
				meta: vehicle.route ? `Line ${lineLabel(vehicle.route, routes ?? [])}` : 'Live bus',
				priority: 20,
			}),
		);
}
function headerAddresses(
	request: HeaderSearchRequest,
	sources: SearchSources,
): ChromeSearchResult[] {
	return (request.modes?.size ? [] : (sources.addresses ?? [])).slice(0, 3).map(
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
	);
}
function headerResults(
	request: HeaderSearchRequest,
	sources: SearchSources,
	matches: Candidates,
): ChromeSearchResult[] {
	const routes = headerRoutes(matches.routes);
	const stops = headerStops(matches.stops);
	if (request.scope === 'route') return routes;
	if (request.scope === 'stop') return stops;
	return [
		...routes,
		...stops,
		...headerVehicles(matches.vehicles, sources.routes),
		...headerAddresses(request, sources),
	]
		.sort(collate)
		.slice(0, 8);
}

export function searchTransit(
	request: HeaderSearchRequest,
	sources: SearchSources,
): ChromeSearchResult[];
export function searchTransit(
	request: PageSearchRequest,
	sources: SearchSources,
): PageSearchResults;
export function searchTransit(
	request: HeaderSearchRequest | PageSearchRequest,
	sources: SearchSources,
): ChromeSearchResult[] | PageSearchResults {
	const query = foldSearchText(request.query);
	const matches = query
		? candidates(request, sources, query)
		: { routes: [], stops: [], vehicles: [] };
	if (request.surface === 'header') return query ? headerResults(request, sources, matches) : [];
	return {
		query,
		routes: matches.routes.map(({ value }) => value),
		stops: matches.stops.map(({ value }) => value),
		vehicles: matches.vehicles,
	};
}

export function scopeForPath(delocalizedPath: string): ChromeSearchScope {
	if (delocalizedPath === '/lines' || delocalizedPath.startsWith('/lines/')) return 'route';
	if (delocalizedPath === '/stops' || delocalizedPath.startsWith('/stop/')) return 'stop';
	if (delocalizedPath === '/map') return 'map';
	return 'all';
}

/** Where the reader searches from: the delocalized path and its query. */
export interface SearchOrigin {
	readonly path: string;
	readonly params: URLSearchParams;
}

/** The tab and period a line or stop page reads from its URL. */
const RECORD_VIEW_PARAMS = ['tab', 'grain', 'from', 'to'] as const;

/**
 * The record a result opens. On the map a result keeps map focus. From a line
 * page another line opens on the same tab and period; the same for stops.
 */
export function searchHitHref(
	hit: Pick<ChromeSearchResult, 'kind' | 'id'> &
		Partial<Pick<ChromeSearchResult, 'label' | 'lat' | 'lon' | 'precision'>>,
	from: SearchOrigin,
): string {
	const record =
		from.path === '/map'
			? null
			: hit.kind === 'route'
				? { href: routeFor({ kind: 'line', id: hit.id }), page: '/lines/' }
				: hit.kind === 'stop'
					? { href: routeFor({ kind: 'stop', id: hit.id }), page: '/stop/' }
					: null;
	if (!record) return chromeSearchHref(hit, from.params, from.path === '/map' ? 'map' : 'all');
	const view = new URLSearchParams();
	if (from.path.startsWith(record.page)) {
		for (const key of RECORD_VIEW_PARAMS) {
			const value = from.params.get(key);
			if (value != null) view.set(key, value);
		}
	}
	const search = view.toString();
	return search ? `${record.href}?${search}` : record.href;
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
