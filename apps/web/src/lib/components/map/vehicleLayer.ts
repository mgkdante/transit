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
		// Per-vehicle opacity — now always 1 (buses are solid in normal operation).
		// The old "going stale" fade was removed: `updated_utc` is the uniform
		// snapshot capture time, so a per-vehicle fade could never single out a stuck
		// bus and only flickered on poll jitter. Staleness is a global signal now
		// (feed-not-responding banner + the global stale-dim). Still driven
		// data-driven into icon-opacity; `silenceOpacity` just resolves to 1.
		opacity: number;
		// Seconds since the snapshot capture time (`updated_utc`, uniform across
		// every vehicle on this feed), on the server clock. Carried for debugging /
		// a future "last seen" hover; no longer drives opacity (the fade is gone).
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

/** Skew-free "now" + live ttl, once used to measure per-vehicle silence. The fade
 * was removed, so this no longer affects opacity (always 1); it is still passed so
 * `silenceAgeS` is computed on the server clock and the refresher stays wired. */
export interface VehicleSilenceContext {
	/** `sharedClock.serverNow` (epoch ms) — skew-corrected, server timeline. */
	serverNow: number;
	/** Live tier ttl (seconds) from the manifest; default 30s. */
	ttlS?: number;
	/**
	 * Prefers-reduced-motion flag. It once chose the discrete vs continuous silence
	 * ramp; both now resolve to a constant 1, so it no longer changes opacity. Kept
	 * so the call site's reduced-motion branch need not be rewired.
	 */
	reduceMotion?: boolean;
}

/** Build the GeoJSON FeatureCollection for the current vehicles under the filter.
 *
 * `silence` (optional) carries the skew-free clock + live ttl, but the per-vehicle
 * fade it once drove was REMOVED: `silenceOpacity` now always returns 1, so every
 * bus's `opacity` is a constant 1 whether or not `silence` is supplied (see
 * vehicleSilence.ts for why — uniform snapshot capture time). `silence` is kept so
 * the per-frame refresher + `silenceAgeS` ("last seen" data) stay wired; it no
 * longer changes what's drawn. Staleness is signalled globally instead. */
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
			// Snapshot capture age (uniform across vehicles); 0 when no clock is
			// supplied. Carried as `silenceAgeS` for debugging — opacity is constant 1.
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

// Resting (default) z11 size is raised so an UNHOVERED bus reads SOLID on its own
// — hover is now a modest ACCENT over a solid base, not the thing that first makes
// a bus appear (the old 0.55→1.05 jump was the real "only solid on hover" cause).
// Exported so the test asserts the resting size + accent ratio without parsing the
// expression. Tune live in the GL eyeball loop.
export const ICON_SIZE_Z11_DEFAULT = 0.78;
export const ICON_SIZE_Z11_SELECTED = 0.88;
export const ICON_SIZE_Z11_HOVER = 1.0;

const ICON_SIZE = [
	'interpolate',
	['linear'],
	['zoom'],
	11,
	[
		'case',
		['==', ['get', 'hovered'], 1],
		ICON_SIZE_Z11_HOVER,
		['==', ['get', 'selected'], 1],
		ICON_SIZE_Z11_SELECTED,
		ICON_SIZE_Z11_DEFAULT,
	],
	15,
	['case', ['==', ['get', 'hovered'], 1], 1.75, ['==', ['get', 'selected'], 1], 1.5, 1.3],
];

// The feature's `opacity` property, read data-driven. The per-vehicle silence fade
// was removed, so `opacity` is now a constant 1 (see toVehicleFeatures); `coalesce`
// still defaults to full strength when the property is absent (legacy/no-clock
// data). This is multiplied by the GLOBAL stale-dim via setStale, which is now the
// ONLY thing that can move opacity below 1.
const SILENCE_OPACITY = ['coalesce', ['get', 'opacity'], 1];

/** Global stale-dim multiplier: 45% when the WHOLE live tier is behind, else 1. */
const GLOBAL_STALE_OPACITY = 0.45;

/**
 * Composed icon-opacity = the GLOBAL stale-dim factor.
 *
 * Since the per-vehicle fade was removed, `SILENCE_OPACITY` is a constant 1, so
 * this is now just the global stale multiplier: 1 in normal operation, 0.45 when
 * the WHOLE live tier is behind (every bus dims together, still faintly visible —
 * never erased). The `* SILENCE_OPACITY` term is retained as a harmless ×1 so the
 * expression shape stays stable if a per-vehicle signal is ever reintroduced.
 */
function composedOpacity(globalStale: boolean): unknown {
	const factor = globalStale ? GLOBAL_STALE_OPACITY : 1;
	return factor === 1 ? SILENCE_OPACITY : ['*', SILENCE_OPACITY, factor];
}

/**
 * icon-opacity with a hover/selected branch (mirrors stopsLayer): a HOVERED bus
 * pops to full strength and a SELECTED one to 0.95, otherwise the global stale-dim
 * factor (composedOpacity). Buses are SOLID by default now — there is no
 * per-vehicle aging fade to override — so this branch only ensures a hovered or
 * selected bus stays at full strength even while the whole tier is globally dimmed.
 */
function iconOpacityExpr(globalStale: boolean): unknown {
	return [
		'case',
		['==', ['get', 'hovered'], 1],
		1,
		['==', ['get', 'selected'], 1],
		0.95,
		composedOpacity(globalStale),
	];
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
		// Opacity is a constant 1 by default (the per-vehicle fade was removed);
		// setStale swaps in the global stale-dim multiplier when the tier is behind.
		paint: { 'icon-opacity': iconOpacityExpr(false) },
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
		paint: { 'icon-opacity': iconOpacityExpr(false) },
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

/** Apply the GLOBAL stale-dim (whole live tier behind). When stale, every bus is
 * multiplied by 45% together (the per-vehicle `opacity` property is a constant 1
 * now that the silence fade is gone, so this is the only signal that dims a bus).
 * Never extrapolate — this only dims, it never moves a bus. */
export function setStale(map: MapLibreMap, stale: boolean): void {
	const opacity = iconOpacityExpr(stale) as Parameters<MapLibreMap['setPaintProperty']>[2];
	if (map.getLayer(VEHICLE_BODY_LAYER)) {
		map.setPaintProperty(VEHICLE_BODY_LAYER, 'icon-opacity', opacity);
	}
	if (map.getLayer(VEHICLE_HEADING_LAYER)) {
		map.setPaintProperty(VEHICLE_HEADING_LAYER, 'icon-opacity', opacity);
	}
}
