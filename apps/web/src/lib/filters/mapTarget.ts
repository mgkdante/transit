// mapTarget.ts — build the /map filter query for a drilldown target.
//
// Every "view on the map" affordance (route detail, stop detail, the lines/stops
// indexes, the network status bar) builds the SAME chain: empty filter state →
// add one entity → toSearchString. This centralizes it so any surface (including
// slice-9.4's) gets a map drilldown in one call instead of a hand-rolled copy.
// Pure: no DOM, no nav, no i18n — see `mapHrefFor` in $lib/nav for the localized
// href wrapper.

import type { StatusCode } from '$lib/v1/schemas';
import { emptyFilterState } from './state';
import { toSearchString } from './url';

export interface MapFilterTarget {
	/** Focus a single route (métro/bus line id). */
	readonly route?: string;
	/** Focus a single stop id. */
	readonly stop?: string;
	/** Focus a single vehicle id. */
	readonly vehicle?: string;
	/** Pre-apply on-time status chips. */
	readonly status?: readonly StatusCode[];
}

/** Serialize a map drilldown target to the /map query string (no leading '?'). */
export function mapSearchFor(target: MapFilterTarget): string {
	const state = emptyFilterState();
	if (target.route) state.routes.add(target.route);
	if (target.stop) state.stops.add(target.stop);
	if (target.vehicle) state.vehicles.add(target.vehicle);
	if (target.status?.length) state.status = [...target.status];
	return toSearchString(state);
}
