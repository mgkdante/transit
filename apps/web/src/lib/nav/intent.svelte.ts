// Navigation-as-intent. Callers express a semantic `SurfaceTarget`; `routeFor`
// owns canonical route construction and `openSurface` performs the localized
// SvelteKit navigation. Keeping that boundary centralized prevents route rules
// from drifting across tiles, rows, search results, and deep links.

import { goto } from '$app/navigation';
import { getLocale, localizeHref, type Locale } from '$lib/i18n';
import { mapSearchFor, type MapFilterTarget } from '$lib/filters';

/**
 * The kinds of navigable surface in the app. A `vehicle`/`stop`/`line` carries an
 * `id`; `search`, `network-health`, and `home` are singletons. Matches the
 * SHARED nav contract exactly — other agents construct these.
 */
export type SurfaceKind =
	| 'vehicle'
	| 'trip'
	| 'stop'
	| 'line'
	| 'search'
	| 'network-health'
	| 'map'
	| 'home';

/**
 * A navigation intent: which surface, and (for id-bearing kinds) which entity.
 * `id` is required in practice for `vehicle`/`stop`/`line` and ignored for the
 * singleton kinds; `routeFor` falls back to the surface root if it is absent.
 */
export interface SurfaceTarget {
	kind: SurfaceKind;
	id?: string;
	search?: string;
}

/** Canonical (unlocalized, EN) INDEX / singleton route root per surface kind. */
const SURFACE_ROOT: Record<SurfaceKind, string> = {
	home: '/',
	'network-health': '/network',
	map: '/map',
	search: '/search',
	line: '/lines',
	stop: '/stops',
	vehicle: '/map',
	// A trip has no index surface; an idless trip target falls back to the map.
	trip: '/map',
};

/**
 * Per-entity DETAIL route roots. The stop detail root DELIBERATELY differs from
 * its plural index (`/stops` index, `/stop/[id]` detail). The line surface was
 * CONSOLIDATED in S6 so both its index AND its detail live under `/lines`
 * (`/lines` index, `/lines/[id]` detail; the old `/route/[id]` 301-redirects).
 * A kind absent here has no detail route yet (vehicle) and falls back to its
 * index root — so `line` MUST stay listed even though it now equals the index
 * root: drop the entry and an id-bearing line target falls through to the bare
 * `/lines` index, silently losing the id.
 */
const ENTITY_DETAIL_ROOT: Partial<Record<SurfaceKind, string>> = {
	line: '/lines',
	stop: '/stop',
	trip: '/trip',
};

/** True for kinds whose canonical route addresses a single entity by id. */
function isEntityKind(kind: SurfaceKind): boolean {
	return kind === 'vehicle' || kind === 'stop' || kind === 'line' || kind === 'trip';
}

/**
 * The canonical, UNLOCALIZED page route for a target. An entity kind WITH an
 * `id` resolves to its DETAIL route `/{detailRoot}/{id}` (id
 * URI-encoded). A stop's detail root differs from its plural index
 * (`/stop/[id]` under the `/stops` index); the line surface was consolidated in
 * S6 so its detail SHARES the index root (`/lines/[id]`). Without an id, or for
 * singleton kinds, it resolves to the surface (index) root.
 *
 * Localize at the navigation boundary with `localizeHref(routeFor(t), locale)` —
 * this function deliberately stays locale-agnostic so it is reusable for
 * canonical/sitemap/SSR contexts.
 */
export function routeFor(target: SurfaceTarget): string {
	const id = target.id?.trim();
	const search = target.search?.replace(/^\?+/, '').trim();
	const withSearch = (path: string): string => (search ? `${path}?${search}` : path);
	if (target.kind === 'vehicle') {
		if (!id) return withSearch(SURFACE_ROOT.vehicle);
		const vehicleSearch = `vehicle=${encodeURIComponent(id)}`;
		return `${SURFACE_ROOT.vehicle}?${search ? `${search}&${vehicleSearch}` : vehicleSearch}`;
	}
	if (isEntityKind(target.kind) && id) {
		const detailRoot = ENTITY_DETAIL_ROOT[target.kind];
		if (detailRoot) return withSearch(`${detailRoot}/${encodeURIComponent(id)}`);
		// No detail route for this kind yet (vehicle) — fall back to the index root.
	}
	return withSearch(SURFACE_ROOT[target.kind]);
}

/**
 * Localized href to the live map, pre-filtered to a drilldown target (a route,
 * stop, vehicle, or status set). The one helper behind every "view on map"
 * affordance — replaces the per-screen `emptyFilterState → add → toSearchString →
 * routeFor → localizeHref` chain that was copy-pasted across the surfaces.
 */
export function mapHrefFor(target: MapFilterTarget, locale: Locale): string {
	return localizeHref(routeFor({ kind: 'map', search: mapSearchFor(target) }), locale);
}

/**
 * Resolve a navigation intent to a destination.
 *
 * Pushes the localized canonical route for the target via SvelteKit `goto`. This
 * is the single entry point every call site uses, so navigation stays uniform
 * across viewport sizes and every target remains represented by a shareable URL.
 *
 * SSR-safe: `goto` is client-only and call sites invoke `openSurface` from event
 * handlers, so it never runs during server render.
 */
export function openSurface(target: SurfaceTarget): void {
	void goto(localizeHref(routeFor(target), getLocale()));
}
