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
import { bodyIconId, BUS_ICON, HEADING_ICON, SILENT_ICON } from './vehicleSprites';
import {
	DEFAULT_LIVE_TTL_S,
	isSilent,
	silenceAgeS,
	silenceOpacity,
	silenceOpacityDiscrete,
} from './vehicleSilence';

export const VEHICLE_SOURCE = 'vehicles';
export const VEHICLE_BODY_LAYER = 'vehicle-body';
/** The rotated chevron overlay; same source, filtered to vehicles with a heading. */
export const VEHICLE_HEADING_LAYER = 'vehicle-heading';
/** The "!" not-reporting badge overlay; same source, filtered to matched + silent. */
export const VEHICLE_SILENT_LAYER = 'vehicle-silent';

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
		// Per-vehicle opacity in [AGING_FLOOR_OPACITY, 1]: full when fresh, a gentle
		// "going stale" fade through the aging window, then back to full once silent
		// (silence is carried by the marker, not a dim). Driven data-driven into
		// icon-opacity so one bus's aging cue is independent of the global stale-dim.
		opacity: number;
		// 1 = past the silent threshold → frozen, gets the "!" marker, full opacity.
		silent: number;
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
			const silent = silence ? (isSilent(ageS, ttlS) ? 1 : 0) : 0;
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
					silent,
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
 * aging floor is already ~0.6 and the stale factor 0.45, the deepest a bus
 * can go is ~0.27, still faintly visible (never erased). When NOT globally stale
 * the multiplier is 1, so silence is shown exactly as computed.
 */
function composedOpacity(globalStale: boolean): unknown {
	const factor = globalStale ? GLOBAL_STALE_OPACITY : 1;
	return factor === 1 ? SILENCE_OPACITY : ['*', SILENCE_OPACITY, factor];
}

/**
 * icon-opacity with a hover/selected branch (mirrors stopsLayer): a HOVERED bus
 * pops to full strength and a SELECTED one to 0.95, otherwise the composed
 * silence × global-stale fade. This is the core "only solid on hover" fix — the
 * default leg already renders a fresh bus solid (silence=1), and hover now
 * overrides the aging fade so a going-stale bus brightens when you point at it,
 * instead of hover being the ONLY thing that made a bus read as alive.
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
		// Per-vehicle silence fade (data-driven); setStale multiplies the global
		// stale-dim on top.
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

	if (map.getLayer(VEHICLE_SILENT_LAYER)) return;
	// The "!" not-reporting badge — drawn ABOVE the body + heading so a frozen,
	// no-longer-reporting bus is FLAGGED (full opacity), never hidden. Shown only
	// for matched + silent vehicles; silence is carried by this marker, not a dim.
	map.addLayer({
		id: VEHICLE_SILENT_LAYER,
		type: 'symbol',
		source: VEHICLE_SOURCE,
		filter: ['all', ['==', ['get', 'matched'], 1], ['==', ['get', 'silent'], 1]],
		layout: {
			'icon-image': SILENT_ICON,
			// Float the badge just above the bus glyph.
			'icon-offset': [0, -15],
			'icon-size': 0.62,
			'icon-allow-overlap': true,
			'icon-ignore-placement': true,
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
	const opacity = iconOpacityExpr(stale) as Parameters<MapLibreMap['setPaintProperty']>[2];
	if (map.getLayer(VEHICLE_BODY_LAYER)) {
		map.setPaintProperty(VEHICLE_BODY_LAYER, 'icon-opacity', opacity);
	}
	if (map.getLayer(VEHICLE_HEADING_LAYER)) {
		map.setPaintProperty(VEHICLE_HEADING_LAYER, 'icon-opacity', opacity);
	}
}
