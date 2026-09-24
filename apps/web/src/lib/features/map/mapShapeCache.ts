// mapShapeCache — the forward-projection route-shape supply for the /map hero.
//
// The kinetic-motion controller's per-frame `shapeFor` resolver needs the route
// polyline a bus is currently driving so it can project the dot FORWARD along the
// street (until a shape resolves the bus FREEZES at its fix — we never dead-reckon
// on the raw GTFS-RT bearing). This manager owns that cache: it lazily fetches the
// direction-variant shapes for the routes that currently have live buses (deduped
// by route id), caps the cache to bound memory over a long session, and resolves
// the best-fit shape for a painted vehicle feature.
//
// Pulled out of MapHero so the cache/prefetch/resolve logic is a plain, testable
// unit with no Svelte reactivity: the caches are deliberately NON-reactive plain
// Map/Set (a SvelteMap would make every `.set()` reactive and thrash the feed
// effect). MapHero owns only the thin `$effect` that calls `prefetch` each poll.

import type { RouteFile } from '$lib/v1';
import type { Vehicle } from '$lib/v1/schemas';
import {
	bestShapeForPoint,
	routeShapes,
	type Coord,
	type RouteShapes,
	type ShapeResolver,
} from '$lib/components/map';

/** Cap distinct cached routes to bound memory over a long session; the visible
 *  set is small, so eviction is rare. LRU-ish: oldest insertion dropped first. */
export const MAX_CACHED_ROUTE_SHAPES = 200;

export interface ShapeCacheManager {
	/** Retain an already loaded route without fetching it again for motion. */
	remember(route: RouteFile): void;
	/**
	 * Lazily fetch route shapes for the routes that currently have live buses
	 * (deduped). Each route is requested at most once while ledgered/resident;
	 * evicted routes may refetch. A resolved shape is dropped into the cache, which
	 * `shapeFor` reads — so that route's buses upgrade from frozen to FORWARD
	 * projection on the next rAF frame, no re-feed needed. Fetches are fire-and-
	 * forget + fail-soft (a failed/absent shape simply leaves the bus frozen at its
	 * fix — never blocks). We do NOT bulk-fetch all routes: only the distinct routes
	 * in the current vehicle set, which is small.
	 */
	prefetch(vehicles: readonly Vehicle[]): void;
	/**
	 * Per-vehicle route-shape resolver passed into the motion controller. For a
	 * vehicle feature, return the cached route-shape variant its CURRENT point sits
	 * on (least projection error), or null → FREEZE (no shape ⇒ no forward dead-
	 * reckoning; we never project on the raw GTFS-RT bearing). Read EACH FRAME by the
	 * controller (a cheap cache lookup), so a route shape that resolves mid-flight
	 * upgrades the bus from frozen to projected without waiting for a re-feed.
	 */
	shapeFor: ShapeResolver & { revision?: () => number };
}

/**
 * Create a route-shape cache manager backed by `getRoute` (the same on-demand
 * loader MapHero uses for the selected-route linework). The caches are plain
 * (non-reactive) collections: a route is requested once while ledgered/resident,
 * and a resolved shape reaches the next frame's `shapeFor` lookup with no re-feed.
 */
export function createShapeCacheManager(
	getRoute: (routeId: string) => Promise<RouteFile | null>,
): ShapeCacheManager {
	// Per-route direction-variant polylines, fetched on-demand for routes with live
	// buses. A PLAIN (non-reactive) Map: a SvelteMap would make every .set() reactive
	// and thrash the feed effect; the controller's per-frame shapeFor reads it
	// directly, so a newly-cached shape is picked up on the very next rAF frame.
	const routeShapeCache = new Map<string, { generatedUtc: string; shapes: RouteShapes }>();
	// Tokens deduplicate requests and reject completions after replacement or eviction.
	const routeShapeRequested = new Map<string, symbol>();
	// Do not retain complete route responses after their resources release them.
	const rememberedRoutes = new WeakSet<RouteFile>();
	let revision = 0;

	function cacheRoute(id: string, route: RouteFile): void {
		const cached = routeShapeCache.get(id);
		if (
			cached &&
			((cached.generatedUtc === route.generated_utc && rememberedRoutes.has(route)) ||
				Date.parse(route.generated_utc) < Date.parse(cached.generatedUtc))
		)
			return;
		const shapes = routeShapes(route);
		rememberedRoutes.add(route);
		// Accepted resource data retires any older request still in flight.
		routeShapeRequested.set(id, Symbol());
		if (!cached && routeShapeCache.size >= MAX_CACHED_ROUTE_SHAPES) {
			const oldest = routeShapeCache.keys().next().value;
			if (oldest != null) {
				routeShapeCache.delete(oldest);
				routeShapeRequested.delete(oldest);
				revision += 1;
			}
		}
		routeShapeCache.set(id, { generatedUtc: route.generated_utc, shapes });
		if (shapes.length > 0 || (cached?.shapes.length ?? 0) > 0) revision += 1;
	}

	function prefetch(vehicles: readonly Vehicle[]): void {
		for (const v of vehicles) {
			const id = v.route;
			if (id == null || id === '') continue;
			if (routeShapeRequested.has(id)) continue;
			const request = Symbol();
			routeShapeRequested.set(id, request);
			void getRoute(id)
				.then((route) => {
					if (routeShapeRequested.get(id) !== request) return;
					if (route) cacheRoute(id, route);
				})
				.catch(() => {
					if (routeShapeRequested.get(id) !== request) return;
					routeShapeRequested.delete(id);
					revision += 1;
				});
		}
	}

	const shapeFor: ShapeCacheManager['shapeFor'] = (feature) => {
		const routeId = feature.properties.route;
		if (!routeId) return null;
		const shapes = routeShapeCache.get(routeId)?.shapes;
		if (!shapes || shapes.length === 0) return null;
		return bestShapeForPoint(shapes, feature.geometry.coordinates as Coord);
	};
	shapeFor.revision = () => revision;

	return { prefetch, remember: (route) => cacheRoute(route.id, route), shapeFor };
}
