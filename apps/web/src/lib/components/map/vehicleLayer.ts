// map/vehicleLayer.ts — the live vehicle GPU layers (an UPRIGHT bus body + a
// SEPARATE rotated heading chevron).
//
// A vehicle is a single PAINTED BUS pictogram (vehicleSprites) baked UPRIGHT so
// it reads at every bearing; heading is a SEPARATE chevron layer that rotates by
// bearing and floats just ahead of the bus. NO state glyph — the FILTER carries
// state by REPAINTING the bus colour and HIDING non-matches:
//   · NO filter → everything shows, plain default orange (easy on the eye);
//   · ALL of a dimension selected → everything shows, every state PAINTED in its
//     own colour (the full picture, for the technical / curious);
//   · a PARTIAL selection (e.g. 2 statuses) → only those repaint + show, the rest
//     DISAPPEAR (a real layer filter, not a dim).
// Status × crowding × routes combine (AND). No clustering — ~600 GPU symbols.

import type { Map as MapLibreMap, GeoJSONSource, LayerSpecification } from 'maplibre-gl';
import type { Vehicle } from '$lib/v1/schemas';
import type { EntityKind, FilterState } from '$lib/filters';
import { bodyIconId, BUS_ICON, HEADING_ICON } from './vehicleSprites';

export const VEHICLE_SOURCE = 'vehicles';
export const VEHICLE_BODY_LAYER = 'vehicle-body';
/** The rotated chevron overlay; same source, filtered to vehicles with a heading. */
export const VEHICLE_HEADING_LAYER = 'vehicle-heading';

export interface VehicleFeature {
	type: 'Feature';
	geometry: { type: 'Point'; coordinates: readonly [number, number] };
	properties: {
		id: string;
		body: string;
		bearing: number;
		// 1 = the vehicle reports a real heading (so the chevron layer shows + rotates).
		hasHeading: number;
		route: string;
		selected: number;
		hovered: number;
		// 1 = visible (matches the filter, or no narrowing filter); 0 = hidden.
		matched: number;
	};
}
export interface VehicleFC {
	type: 'FeatureCollection';
	features: readonly VehicleFeature[];
}

const EMPTY_FC: VehicleFC = { type: 'FeatureCollection', features: [] };

// A dimension is ACTIVE when ANY of it is selected. None → no filter (plain
// orange, all shown). All selected → every match shows, painted (rainbow).
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

/** The state dimension that repaints matches (status wins over crowding); null = default orange. */
function colourDimension(f: FilterState): 'status' | 'occupancy' | null {
	if (activeStatus(f)) return 'status';
	if (activeOccupancy(f)) return 'occupancy';
	return null;
}

/** True when the vehicle satisfies EVERY active dimension (AND-combined). */
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

/** Body icon id + match flag for a vehicle. Matched + a colour dim → the state-
 * coloured bus; otherwise the default orange bus. ONE bus glyph (no directional
 * variants); the chevron layer carries heading on top. */
function iconFor(
	v: Vehicle,
	f: FilterState,
	dim: 'status' | 'occupancy' | null,
	alertVehicleIds: ReadonlySet<string>,
): {
	body: string;
	matched: number;
} {
	const matched = matchesFilter(v, f, alertVehicleIds);
	if (matched && dim === 'status') {
		return { body: bodyIconId('status', v.status), matched: 1 };
	}
	if (matched && dim === 'occupancy' && v.occupancy != null) {
		return { body: bodyIconId('occupancy', v.occupancy), matched: 1 };
	}
	return { body: BUS_ICON, matched: matched ? 1 : 0 };
}

/** Build the GeoJSON FeatureCollection for the current vehicles under the filter. */
export function toVehicleFeatures(
	vehicles: readonly Vehicle[],
	filter: FilterState,
	alertVehicleIds: ReadonlySet<string> = new Set(),
	selectedVehicleId: string | null = null,
	hoveredVehicleId: string | null = null,
): VehicleFC {
	const dim = colourDimension(filter);
	return {
		type: 'FeatureCollection',
		features: vehicles.map((v) => {
			const { body, matched } = iconFor(v, filter, dim, alertVehicleIds);
			return {
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
				properties: {
					id: v.id,
					body,
					bearing: v.bearing ?? 0,
					// A bus with no reported heading shows NO chevron (an honest "no
					// heading", never a fake forward arrow).
					hasHeading: v.bearing != null ? 1 : 0,
					route: v.route ?? '',
					selected: selectedVehicleId === v.id || filter.vehicles.has(v.id) ? 1 : 0,
					hovered: hoveredVehicleId === v.id ? 1 : 0,
					matched,
				},
			};
		}),
	};
}

/** Register the (initially empty) vehicle source. Idempotent. */
export function addVehicleSource(map: MapLibreMap): void {
	if (map.getSource(VEHICLE_SOURCE)) return;
	map.addSource(VEHICLE_SOURCE, { type: 'geojson', data: EMPTY_FC, promoteId: 'id' });
}

const ICON_SIZE = [
	'interpolate',
	['linear'],
	['zoom'],
	11,
	['case', ['==', ['get', 'hovered'], 1], 1.05, ['==', ['get', 'selected'], 1], 0.78, 0.55],
	15,
	['case', ['==', ['get', 'hovered'], 1], 1.95, ['==', ['get', 'selected'], 1], 1.42, 1],
];

/** Add the vehicle body + heading symbol layers. Non-matched features are
 * filtered OUT (they disappear); opacity carries only the stale dim. The bus
 * body is UPRIGHT (it reads at every bearing); the chevron is a SEPARATE layer
 * that rotates by bearing and shows ONLY for vehicles reporting a heading.
 * Idempotent. */
export function addVehicleLayers(map: MapLibreMap): void {
	if (map.getLayer(VEHICLE_BODY_LAYER)) return;
	map.addLayer({
		id: VEHICLE_BODY_LAYER,
		type: 'symbol',
		source: VEHICLE_SOURCE,
		// Hide non-matched: a real filter (they disappear), not a dim.
		filter: ['==', ['get', 'matched'], 1],
		layout: {
			'icon-image': ['get', 'body'],
			// The bus glyph stays UPRIGHT — heading is the separate chevron layer.
			'icon-rotation-alignment': 'viewport',
			'icon-allow-overlap': true,
			'icon-ignore-placement': true,
			'icon-size': ICON_SIZE,
		},
		paint: { 'icon-opacity': 1 },
		// maplibre's expression types are invariant + mutable; the literal is
		// structurally correct, so cast through unknown.
	} as unknown as LayerSpecification);

	if (map.getLayer(VEHICLE_HEADING_LAYER)) return;
	// Drawn ABOVE the bus body so the direction tick is never occluded.
	map.addLayer({
		id: VEHICLE_HEADING_LAYER,
		type: 'symbol',
		source: VEHICLE_SOURCE,
		// Matched AND reporting a heading — no fake arrows for headingless buses.
		filter: ['all', ['==', ['get', 'matched'], 1], ['==', ['get', 'hasHeading'], 1]],
		layout: {
			'icon-image': HEADING_ICON,
			'icon-rotate': ['coalesce', ['get', 'bearing'], 0],
			'icon-rotation-alignment': 'map',
			'icon-allow-overlap': true,
			'icon-ignore-placement': true,
			'icon-size': ICON_SIZE,
		},
		paint: { 'icon-opacity': 1 },
	} as unknown as LayerSpecification);
}

/** Replace the rendered vehicles, repainted/filtered under the active filter. */
export function setVehicles(
	map: MapLibreMap,
	vehicles: readonly Vehicle[],
	filter: FilterState,
	alertVehicleIds?: ReadonlySet<string>,
	selectedVehicleId?: string | null,
	hoveredVehicleId?: string | null,
): void {
	const src = map.getSource(VEHICLE_SOURCE) as GeoJSONSource | undefined;
	src?.setData(
		toVehicleFeatures(
			vehicles,
			filter,
			alertVehicleIds,
			selectedVehicleId,
			hoveredVehicleId,
		) as unknown as Parameters<GeoJSONSource['setData']>[0],
	);
}

/** Dim the layers to 45% when the live feed is stale (never extrapolate). */
export function setStale(map: MapLibreMap, stale: boolean): void {
	const opacity = stale ? 0.45 : 1;
	if (map.getLayer(VEHICLE_BODY_LAYER)) {
		map.setPaintProperty(VEHICLE_BODY_LAYER, 'icon-opacity', opacity);
	}
	if (map.getLayer(VEHICLE_HEADING_LAYER)) {
		map.setPaintProperty(VEHICLE_HEADING_LAYER, 'icon-opacity', opacity);
	}
}
