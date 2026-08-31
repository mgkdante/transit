import type { RouteIndexEntry, StopIndexEntry, Vehicle } from '$lib/v1/schemas';
import { FILTER_SEARCH_PARAM_KEYS, fromSearchParams, toSearchString } from '$lib/filters';
import type { GeocodePrecision, GeocodeSource, GeocodeSuggestion } from '$lib/geocode/types';
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

/**
 * The surface context the chrome search runs in — derived from the active
 * (delocalized) path. It RESTRICTS the result blend and steers selection:
 *   `route` (/lines, /lines/*) → only lines, deep-link to /lines/<id>
 *   `stop`  (/stops, /stop/*)  → only stops, deep-link to /stop/<id>
 *   `map`   (/map)             → the full blend, every pick filters the map
 *   `all`   (hub/network/search/else) → today's blend, map deep-links
 */
export type ChromeSearchScope = 'route' | 'stop' | 'map' | 'all';

export interface ChromeSearchOptions {
	/** Active surface context (delocalized). Default `'all'` (today's blend). */
	readonly scope?: ChromeSearchScope;
	/**
	 * Combinable transit-mode narrowing — the SAME control the search surface
	 * offers, so the chrome dropdown's chips narrow real matches. Empty (or
	 * omitted) = every mode. A row whose mode is unknown, and an address (which
	 * has no transit mode at all), stand down while the set is non-empty rather
	 * than be guessed into a transit-mode answer.
	 */
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
	options: ChromeSearchOptions = {},
): ChromeSearchResult[] {
	const q = foldSearchText(query);
	if (!q) return [];

	const scope = options.scope ?? 'all';
	// The mode narrowing runs on the MATCH set, before each family's slice — a
	// post-slice filter would silently shrink a family below its cap.
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
	// One row per logical stop: métro/station names collapse to a single station;
	// ordinary stops collapse only true code duplicates.
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

	// A vehicle has no mode field — it is always a bus, so an active mode set
	// keeps buses only when 'bus' is among the picked modes.
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

	// An address is not a transit mode, so it stands down while modes are picked.
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
				source: address.source,
			}),
		)
		.sort(collate)
		.slice(0, 3);

	// Scope RESTRICTS, not merely re-ranks: a rider on /lines wants a line, so a
	// stop here is noise (and an address can never deep-link). `map`/`all` keep
	// the full blend — the map filters by every entity type.
	if (scope === 'route') return routes.slice(0, 8);
	if (scope === 'stop') return stops.slice(0, 8);
	return [...routes, ...stops, ...vehicles, ...addresses].sort(collate).slice(0, 8);
}

/**
 * Scope for the active (DELOCALIZED) path. Mirrors `nav.ts` `activePrefixes`
 * (`/lines/`, `/stop/`) EXACTLY so search scope and nav highlight never disagree.
 */
export function scopeForPath(delocalizedPath: string): ChromeSearchScope {
	if (delocalizedPath === '/lines' || delocalizedPath.startsWith('/lines/')) return 'route';
	if (delocalizedPath === '/stops' || delocalizedPath.startsWith('/stop/')) return 'stop';
	if (delocalizedPath === '/map') return 'map';
	return 'all';
}

/**
 * Context-aware destination for a picked result. In `route`/`stop` scope a
 * matching entity deep-links to its DETAIL page (`/lines/<id>`, `/stop/<id>`)
 * via the shared `routeFor` canonical map; everything else — `map`/`all` scope,
 * addresses, or a kind that does not match its scope — falls through to the
 * EXISTING `chromeSearchHref` map-filter behavior (unchanged). Returns an
 * UNLOCALIZED path; the caller localizes at the navigation boundary.
 */
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
		// Tell the map to zoom to the picked entity (one-shot; the map strips it).
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
