// map/vehicleLayer.ts — the live vehicle GPU layer.
//
// ONE GeoJSON source + TWO symbol layers, no clustering (clustering would
// destroy the per-vehicle heading/status story for ~600 buses, which GPU
// symbols render trivially):
//   · vehicle-body  — the coloured kite/disc, rotated by `bearing` (alignment
//     'map'), UNDER the glyph.
//   · vehicle-glyph — the upright status/occupancy glyph (alignment 'viewport').
//
// Honesty is encoded in the icon ids (see vehicleSprites): a null bearing → the
// bearing-less disc body (never a north-pointing arrow); a null occupancy → the
// ◌ no-data glyph (never the 'empty' band).

import type {
	Map as MapLibreMap,
	GeoJSONSource,
	FilterSpecification,
	LayerSpecification,
} from 'maplibre-gl';
import type { Vehicle } from '$lib/v1/schemas';
import { bodyIconId, glyphIconId, OCC_NODATA, BUS_ICON, BUS_ICON_ND } from './vehicleSprites';

// 'single' = the calm default (one bus colour, no status glyph). 'status' /
// 'occupancy' colour matches by state — used when a filter lights a subset up.
export type VehicleMode = 'single' | 'status' | 'occupancy';

export const VEHICLE_SOURCE = 'vehicles';
export const VEHICLE_BODY_LAYER = 'vehicle-body';
export const VEHICLE_GLYPH_LAYER = 'vehicle-glyph';

interface VehicleFeature {
	type: 'Feature';
	geometry: { type: 'Point'; coordinates: [number, number] };
	properties: {
		id: string;
		body: string;
		glyph: string;
		bearing: number;
		route: string;
	};
}
interface VehicleFC {
	type: 'FeatureCollection';
	features: VehicleFeature[];
}

const EMPTY_FC: VehicleFC = { type: 'FeatureCollection', features: [] };

/** Map a vehicle to its body + glyph icon ids for the active mode. */
function iconIds(v: Vehicle, mode: VehicleMode): { body: string; glyph: string } {
	const directional = v.bearing != null;
	// Default: one calm colour, no glyph (state lives in the filter, not the paint).
	if (mode === 'single') {
		return { body: directional ? BUS_ICON : BUS_ICON_ND, glyph: '' };
	}
	if (mode === 'status') {
		return { body: bodyIconId('status', v.status, directional), glyph: glyphIconId('status', v.status) };
	}
	const code = v.occupancy ?? OCC_NODATA;
	return { body: bodyIconId('occupancy', code, directional), glyph: glyphIconId('occupancy', code) };
}

/** Build the GeoJSON FeatureCollection for the current vehicles + mode. */
export function toVehicleFeatures(vehicles: readonly Vehicle[], mode: VehicleMode): VehicleFC {
	return {
		type: 'FeatureCollection',
		features: vehicles.map((v) => {
			const { body, glyph } = iconIds(v, mode);
			return {
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
				properties: { id: v.id, body, glyph, bearing: v.bearing ?? 0, route: v.route ?? '' },
			};
		}),
	};
}

/** Register the (initially empty) vehicle source. Idempotent. */
export function addVehicleSource(map: MapLibreMap): void {
	if (map.getSource(VEHICLE_SOURCE)) return;
	map.addSource(VEHICLE_SOURCE, { type: 'geojson', data: EMPTY_FC, promoteId: 'id' });
}

const ICON_SIZE = ['interpolate', ['linear'], ['zoom'], 11, 0.55, 15, 1] as const;

/** Add the body + glyph symbol layers. Idempotent. */
export function addVehicleLayers(map: MapLibreMap): void {
	if (!map.getLayer(VEHICLE_BODY_LAYER)) {
		map.addLayer({
			id: VEHICLE_BODY_LAYER,
			type: 'symbol',
			source: VEHICLE_SOURCE,
			layout: {
				'icon-image': ['get', 'body'],
				'icon-rotate': ['coalesce', ['get', 'bearing'], 0],
				'icon-rotation-alignment': 'map',
				'icon-allow-overlap': true,
				'icon-ignore-placement': true,
				'icon-size': ICON_SIZE,
			},
			// maplibre's layout expression types are invariant + mutable; our literal
			// is structurally correct, so cast through unknown.
		} as unknown as LayerSpecification);
	}
	if (!map.getLayer(VEHICLE_GLYPH_LAYER)) {
		map.addLayer({
			id: VEHICLE_GLYPH_LAYER,
			type: 'symbol',
			source: VEHICLE_SOURCE,
			// Skip features with no glyph (single/default mode) — avoids empty-image lookups.
			filter: ['!=', ['get', 'glyph'], ''],
			layout: {
				'icon-image': ['get', 'glyph'],
				'icon-rotation-alignment': 'viewport',
				'icon-allow-overlap': true,
				'icon-ignore-placement': true,
				'icon-size': ICON_SIZE,
			},
			// maplibre's layout expression types are invariant + mutable; our literal
			// is structurally correct, so cast through unknown.
		} as unknown as LayerSpecification);
	}
}

/** Replace the rendered vehicles (the jump path; the reduced-motion fallback). */
export function setVehicles(map: MapLibreMap, vehicles: readonly Vehicle[], mode: VehicleMode): void {
	const src = map.getSource(VEHICLE_SOURCE) as GeoJSONSource | undefined;
	src?.setData(
		toVehicleFeatures(vehicles, mode) as unknown as Parameters<GeoJSONSource['setData']>[0],
	);
}

/** Dim both layers to 45% when the live feed is stale (never extrapolate). */
export function setStale(map: MapLibreMap, stale: boolean): void {
	const opacity = stale ? 0.45 : 1;
	for (const id of [VEHICLE_BODY_LAYER, VEHICLE_GLYPH_LAYER]) {
		if (map.getLayer(id)) map.setPaintProperty(id, 'icon-opacity', opacity);
	}
}

/**
 * Apply a layer filter (Phase 3 filtered-map). `null` clears the filter (show
 * all). Phase 3 will prefer an opacity expression over hard-hide so the network
 * context is never destroyed; this hard-filter helper backs the simple cases.
 */
export function applyFilter(map: MapLibreMap, expr: FilterSpecification | null): void {
	for (const id of [VEHICLE_BODY_LAYER, VEHICLE_GLYPH_LAYER]) {
		if (map.getLayer(id)) map.setFilter(id, expr);
	}
}
