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
import {
	DEFAULT_LIVE_TTL_S,
	silenceAgeS,
	silenceOpacity,
	silenceOpacityDiscrete,
} from './vehicleSilence';

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
		// Per-vehicle silence fade in [SILENCE_FLOOR_OPACITY, 1]: full when the bus
		// just reported, fading toward the floor the longer ITS OWN last fix is.
		// Driven data-driven into icon-opacity so one quiet bus dims independently
		// of the global stale-dim. NEVER 0 (the feed still lists it = "last seen N").
		opacity: number;
		// Seconds since the vehicle's own last report (server clock). Carried for
		// debugging / a future "last seen" hover; the fade reads `opacity`.
		silenceAgeS: number;
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

/** Skew-free "now" + live ttl so per-vehicle silence is measured honestly. */
export interface VehicleSilenceContext {
	/** `sharedClock.serverNow` (epoch ms) — skew-corrected, server timeline. */
	serverNow: number;
	/** Live tier ttl (seconds) from the manifest; default 30s. */
	ttlS?: number;
	/**
	 * When true (prefers-reduced-motion), the silence opacity is set DISCRETELY
	 * (a single mid step) instead of a continuous ramp — still honest, no
	 * per-frame fade.
	 */
	reduceMotion?: boolean;
}

/** Build the GeoJSON FeatureCollection for the current vehicles under the filter.
 *
 * `silence` (optional) carries the skew-free clock + live ttl so each vehicle's
 * OWN report age maps to a per-vehicle fade (see vehicleSilence.ts). Omitting it
 * (e.g. legacy callers / tests) leaves every bus at full opacity — the fade is
 * additive, never a regression. */
export function toVehicleFeatures(
	vehicles: readonly Vehicle[],
	filter: FilterState,
	alertVehicleIds: ReadonlySet<string> = new Set(),
	selectedVehicleId: string | null = null,
	hoveredVehicleId: string | null = null,
	silence?: VehicleSilenceContext,
): VehicleFC {
	const dim = colourDimension(filter);
	const ttlS = silence?.ttlS ?? DEFAULT_LIVE_TTL_S;
	return {
		type: 'FeatureCollection',
		features: vehicles.map((v) => {
			const { body, matched } = iconFor(v, filter, dim, alertVehicleIds);
			// Per-vehicle silence: 0 age (full opacity) when no clock is supplied.
			const ageS = silence ? silenceAgeS(v.updated_utc, silence.serverNow) : 0;
			const opacity = !silence
				? 1
				: silence.reduceMotion
					? silenceOpacityDiscrete(ageS, ttlS)
					: silenceOpacity(ageS, ttlS);
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
					opacity,
					silenceAgeS: Number.isFinite(ageS) ? Math.round(ageS) : -1,
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

// Per-vehicle silence fade, read from the feature's `opacity` property (computed
// in toVehicleFeatures from each bus's OWN report age). `coalesce` defaults to
// full strength when the property is absent (legacy/no-clock data), so the layer
// is correct even before the first silence-aware setData. This composes with the
// GLOBAL stale-dim via setStale (which multiplies the whole layer) — taking the
// per-vehicle value as the primary signal and the global dim as a layer-wide
// floor so we never double-darken a bus into invisibility.
const SILENCE_OPACITY = ['coalesce', ['get', 'opacity'], 1];

/** Global stale-dim multiplier: 45% when the WHOLE live tier is behind, else 1. */
const GLOBAL_STALE_OPACITY = 0.45;

/**
 * Composed icon-opacity = per-vehicle silence × global stale multiplier.
 *
 * The per-vehicle fade is the primary signal (one quiet bus dims on its own);
 * the global stale-dim is a layer-wide multiplier on top. We MULTIPLY rather
 * than `min` so the two honest signals stack continuously — but because the
 * silence floor is already ~0.25 and the stale factor 0.45, the deepest a bus
 * can go is ~0.11, still faintly visible (never erased). When NOT globally stale
 * the multiplier is 1, so silence is shown exactly as computed.
 */
function composedOpacity(globalStale: boolean): unknown {
	const factor = globalStale ? GLOBAL_STALE_OPACITY : 1;
	return factor === 1 ? SILENCE_OPACITY : ['*', SILENCE_OPACITY, factor];
}

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
		// Per-vehicle silence fade (data-driven); setStale multiplies the global
		// stale-dim on top.
		paint: { 'icon-opacity': composedOpacity(false) },
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
		paint: { 'icon-opacity': composedOpacity(false) },
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
	silence?: VehicleSilenceContext,
): void {
	const src = map.getSource(VEHICLE_SOURCE) as GeoJSONSource | undefined;
	src?.setData(
		toVehicleFeatures(
			vehicles,
			filter,
			alertVehicleIds,
			selectedVehicleId,
			hoveredVehicleId,
			silence,
		) as unknown as Parameters<GeoJSONSource['setData']>[0],
	);
}

/** Apply the GLOBAL stale-dim (whole live tier behind) ON TOP of each vehicle's
 * per-vehicle silence fade. When stale, every bus is multiplied by 45%; the
 * per-vehicle `opacity` property still carries each bus's own silence, so the two
 * honest signals compose (see composedOpacity). Never extrapolate — this only
 * dims, it never moves a bus. */
export function setStale(map: MapLibreMap, stale: boolean): void {
	const opacity = composedOpacity(stale) as Parameters<MapLibreMap['setPaintProperty']>[2];
	if (map.getLayer(VEHICLE_BODY_LAYER)) {
		map.setPaintProperty(VEHICLE_BODY_LAYER, 'icon-opacity', opacity);
	}
	if (map.getLayer(VEHICLE_HEADING_LAYER)) {
		map.setPaintProperty(VEHICLE_HEADING_LAYER, 'icon-opacity', opacity);
	}
}
