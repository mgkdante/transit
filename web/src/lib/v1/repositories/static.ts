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

import { adapter } from '$lib/v1/adapter';
import type { RouteFile, RoutesIndex, StopFile, StopsIndex } from '$lib/v1/schemas';

/** Fetch + validate the static routes discovery index. */
export async function getRoutesIndex(): Promise<RoutesIndex> {
	return adapter.static.routesIndex();
}

/**
 * Fetch + validate one route's static detail.
 * `null` = HTTP 404 (no data for this route) — render empty state, not an error.
 */
export async function getRoute(routeId: string): Promise<RouteFile | null> {
	return adapter.static.route(routeId);
}

/** Fetch + validate the static stops discovery index. */
export async function getStopsIndex(): Promise<StopsIndex> {
	return adapter.static.stopsIndex();
}

/**
 * Fetch + validate one stop's static detail.
 * `null` = HTTP 404 (no data for this stop) — render empty state, not an error.
 */
export async function getStop(stopId: string): Promise<StopFile | null> {
	return adapter.static.stop(stopId);
}
