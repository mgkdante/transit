import type { Vehicle } from '$lib/v1/schemas';
import type { EntityKind, FilterState } from '$lib/filters';
import { bodyIconId, BUS_ICON, stateBadgeIconId } from './vehicleSprites';
import { fixAgeS, isVehicleStale } from './vehicleProjection';

export const VEHICLE_BODY_LAYER = 'vehicle-body';

export interface VehicleFeature {
	type: 'Feature';
	geometry: { type: 'Point'; coordinates: readonly [number, number] };
	properties: {
		id: string;
		body: string;
		mark?: string;
		bearing: number;
		hasHeading: number;
		route: string;
		selected: number;
		matched: number;
		stale: number;
	};
}
export interface VehicleFC {
	type: 'FeatureCollection';
	features: readonly VehicleFeature[];
}

function activeStatus(f: FilterState): readonly string[] | null {
	return f.status && f.status.length > 0 ? f.status : null;
}
function activeOccupancy(f: FilterState): readonly string[] | null {
	return f.occupancy && f.occupancy.length > 0 ? f.occupancy : null;
}
function activeEntities(f: FilterState): readonly EntityKind[] | null {
	return f.entities && f.entities.length > 0 ? f.entities : null;
}
function activeAlerts(f: FilterState): readonly string[] | null {
	return f.alerts && f.alerts.length > 0 ? f.alerts : null;
}

function colourDimension(f: FilterState): 'status' | 'occupancy' | null {
	if (activeStatus(f)) return 'status';
	if (activeOccupancy(f)) return 'occupancy';
	return null;
}

function matchesFilter(v: Vehicle, f: FilterState, alertVehicleIds: ReadonlySet<string>): boolean {
	const as = activeStatus(f);
	if (as && !as.includes(v.status)) return false;
	const ao = activeOccupancy(f);
	if (ao && !(v.occupancy != null && ao.includes(v.occupancy))) return false;
	if (f.routes.size > 0 && !(v.route != null && f.routes.has(v.route))) return false;
	if (f.stops.size > 0 && !(v.next_stop != null && f.stops.has(v.next_stop))) return false;
	if (f.trips.size > 0 && !(v.trip != null && f.trips.has(v.trip))) return false;
	if (f.vehicles.size > 0 && !f.vehicles.has(v.id)) return false;
	const aa = activeAlerts(f);
	if (aa && !alertVehicleIds.has(v.id)) return false;
	const ae = activeEntities(f);
	if (ae && !ae.includes('bus')) return false;
	return true;
}

function iconFor(
	v: Vehicle,
	f: FilterState,
	dim: 'status' | 'occupancy' | null,
	alertVehicleIds: ReadonlySet<string>,
): {
	body: string;
	mark: string;
	matched: number;
} {
	const matched = matchesFilter(v, f, alertVehicleIds);
	if (matched && dim === 'status') {
		return {
			body: bodyIconId('status', v.status),
			mark: stateBadgeIconId('status', v.status),
			matched: 1,
		};
	}
	if (matched && dim === 'occupancy' && v.occupancy != null) {
		return {
			body: bodyIconId('occupancy', v.occupancy),
			mark: stateBadgeIconId('occupancy', v.occupancy),
			matched: 1,
		};
	}
	return { body: BUS_ICON, mark: '', matched: matched ? 1 : 0 };
}

export interface VehicleSilenceContext {
	serverNow: number;
	ttlS?: number;
}

export function toVehicleFeatures(
	vehicles: readonly Vehicle[],
	filter: FilterState,
	alertVehicleIds: ReadonlySet<string> = new Set(),
	selectedVehicleId: string | null = null,
	silence?: VehicleSilenceContext,
): VehicleFC {
	const dim = colourDimension(filter);
	return {
		type: 'FeatureCollection',
		features: vehicles.map((v) => {
			const { body, mark, matched } = iconFor(v, filter, dim, alertVehicleIds);
			const stale =
				silence && isVehicleStale(fixAgeS(v.reported_utc, v.updated_utc, silence.serverNow))
					? 1
					: 0;
			return {
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
				properties: {
					id: v.id,
					body,
					mark,
					bearing: v.bearing ?? 0,
					hasHeading: v.bearing != null ? 1 : 0,
					route: v.route ?? '',
					selected: selectedVehicleId === v.id || filter.vehicles.has(v.id) ? 1 : 0,
					matched,
					stale,
				},
			};
		}),
	};
}

export const VEHICLE_HIGHLIGHT_STYLE = Object.freeze({
	casingToken: 'var(--background)',
	ringToken: 'var(--primary)',
	hoverStrokeWidth: 2.5,
	selectedStrokeWidth: 2,
	hoverOpacity: 1,
	selectedOpacity: 0.92,
});
