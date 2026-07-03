// Static repository — thin async delegation over adapter.static.
//
// The static tier is the slow-moving GTFS reference dataset (daily ttl):
//   routes_index.json        — array of RouteIndexEntry (discovery)
//   routes/{route_id}.json    — per-route detail (404 => empty state)
//   stops_index.json         — array of StopIndexEntry (discovery)
//   stops/{stop_id}.json      — per-stop detail (404 => empty state)
//
// Per-entity 404 is a render-empty-state signal, NOT an error — the adapter
// surfaces that as `null`. The adapter owns the {prefix}{id}.json URL assembly
// and parsePort validation; this module just delegates.

import { adapter, type AdapterCtx } from '$lib/v1/adapter';
import type { RouteFile, RoutesIndex, StopFile, StopsIndex } from '$lib/v1/schemas';
import { isSlimStopsIndex, toSlimStopsIndex, type SlimStopsIndex } from './stopsSlim';

/**
 * Fetch + validate the static routes discovery index.
 * `ctx` threads the SSR/binding fetch (e.g. the sitemap handler's bindingFetch).
 */
export async function getRoutesIndex(ctx?: AdapterCtx): Promise<RoutesIndex> {
	return adapter.static.routesIndex(ctx);
}

/**
 * Fetch + validate one route's static detail.
 * `null` = HTTP 404 (no data for this route) — render empty state, not an error.
 */
export async function getRoute(routeId: string, ctx?: AdapterCtx): Promise<RouteFile | null> {
	return adapter.static.route(routeId, ctx);
}

/**
 * Fetch + validate the static stops discovery index.
 * `ctx` threads the SSR/binding fetch (e.g. the sitemap handler's bindingFetch).
 */
export async function getStopsIndex(ctx?: AdapterCtx): Promise<StopsIndex> {
	return adapter.static.stopsIndex(ctx);
}

/**
 * Fetch the SLIM stops index ({id,name,lat,lon,code}) — the map + near-me
 * fast-path (§C8 item 3). The `/api/stops/slim` endpoint projects the full
 * catalogue server-side, so the client parses a fraction of the 1.15 MB payload.
 *
 * ADDITIVE + honest-absence: on any endpoint failure we fall back to projecting
 * the FULL index client-side, so the map still resolves every stop (never a
 * fabricated empty catalogue). Client-only path (browser fetch of a same-origin
 * API route); an explicit `ctx.fetch` (SSR/tests) still works.
 */
export async function getStopsIndexSlim(ctx?: AdapterCtx): Promise<SlimStopsIndex> {
	const fetchFn = ctx?.fetch ?? fetch;
	try {
		const res = await fetchFn('/api/stops/slim', { signal: ctx?.signal });
		if (res.ok) {
			const body: unknown = await res.json();
			if (isSlimStopsIndex(body)) return body;
		}
	} catch {
		// fall through to the full-index projection
	}
	return toSlimStopsIndex(await adapter.static.stopsIndex(ctx));
}

/**
 * Fetch + validate one stop's static detail.
 * `null` = HTTP 404 (no data for this stop) — render empty state, not an error.
 */
export async function getStop(stopId: string, ctx?: AdapterCtx): Promise<StopFile | null> {
	return adapter.static.stop(stopId, ctx);
}
