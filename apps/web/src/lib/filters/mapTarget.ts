import type { OccupancyCode, StatusCode } from '$lib/v1/schemas';
import { setMapFocusSearchParams } from '$lib/search/mapFocus';
import { emptyFilterState } from './state';
import { toSearchString } from './url';

export interface MapFilterTarget {
	readonly route?: string;
	readonly stop?: string;
	readonly trip?: string;
	readonly vehicle?: string;
	readonly status?: readonly StatusCode[];
	readonly occupancy?: readonly OccupancyCode[];
}

export function mapSearchFor(target: MapFilterTarget): string {
	const state = emptyFilterState();
	if (target.route) state.routes.add(target.route);
	if (target.stop) state.stops.add(target.stop);
	if (target.trip) state.trips.add(target.trip);
	if (target.vehicle) state.vehicles.add(target.vehicle);
	if (target.status?.length) state.status = [...target.status];
	if (target.occupancy?.length) state.occupancy = [...target.occupancy];

	const search = new URLSearchParams(toSearchString(state));
	if (target.stop) setMapFocusSearchParams(search, 'stop', target.stop);
	else if (target.vehicle) setMapFocusSearchParams(search, 'vehicle', target.vehicle);
	else if (target.route) setMapFocusSearchParams(search, 'route', target.route);
	return search.toString();
}
