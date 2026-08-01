// map/vehicleLayer.ts — the live vehicle GPU layers (an UPRIGHT bus body + a
// SEPARATE rotated heading chevron).
//
// A vehicle is a single PAINTED BUS pictogram (vehicleSprites) baked UPRIGHT so
// it reads at every bearing; heading is a SEPARATE chevron layer that rotates by
// bearing and floats just ahead of the bus. A separate state-badge layer carries
// the matching status/crowding glyph while the FILTER repaints the bus and hides
// non-matches:
//   · NO filter → everything shows, plain default orange (easy on the eye);
//   · ALL of a dimension selected → everything shows, every state PAINTED in its
//     own colour (the full picture, for the technical / curious);
//   · a PARTIAL selection (e.g. 2 statuses) → only those repaint + show, the rest
//     DISAPPEAR (a real layer filter, not a dim).
// Status × crowding × routes combine (AND). No clustering — ~600 GPU symbols.

import type { Map as MapLibreMap, LayerSpecification } from 'maplibre-gl';
import type { Vehicle } from '$lib/v1/schemas';
import type { EntityKind, FilterState } from '$lib/filters';
import {
	bodyIconId,
	BUS_ICON,
	HEADING_ICON,
	resolveColor,
	SILENT_ICON,
	stateBadgeIconId,
	VEHICLE_MARKER_GEOMETRY,
} from './vehicleSprites';
import { fixAgeS, isVehicleStale } from './vehicleProjection';

export const VEHICLE_SOURCE = 'vehicles';
export const VEHICLE_HIGHLIGHT_LAYER = 'vehicle-highlight';
export const VEHICLE_BODY_LAYER = 'vehicle-body';
/** The rotated chevron overlay; same source, filtered to vehicles with a heading. */
export const VEHICLE_HEADING_LAYER = 'vehicle-heading';
/** The status/crowding shape-channel overlay; dynamically reads the feature's badge id. */
export const VEHICLE_STATE_BADGE_LAYER = 'vehicle-state-badge';
/** The per-bus "!" not-reporting badge overlay; same source, filtered to matched + stale. */
export const VEHICLE_SILENT_LAYER = 'vehicle-silent';

export interface VehicleFeature {
	type: 'Feature';
	geometry: { type: 'Point'; coordinates: readonly [number, number] };
	properties: {
		id: string;
		body: string;
		// Optional on the structural type so protected external test harnesses that
		// construct VehicleFeature directly stay source-compatible. Production
		// features from toVehicleFeatures always serialize a string.
		mark?: string;
		bearing: number;
		// 1 = the vehicle reports a real heading (so the chevron layer shows + rotates).
		hasHeading: number;
		route: string;
		selected: number;
		// 1 = visible (matches the filter, or no narrowing filter); 0 = hidden.
		matched: number;
		// 1 = this bus's OWN fix (reported_utc, fallback updated_utc) is past the
		// staleness cutoff → it gets the per-bus "!" flag and is frozen (the S5
		// reshape dropped this; it is back, now correctly per-bus). 0 = fresh, or
		// no silence context to measure against.
		stale: number;
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

/** Body icon id + state-badge id + match flag for a vehicle. Matched + a colour
 * dimension → the state-coloured bus and its shape-channel badge; otherwise the
 * default orange bus and an empty badge id. ONE bus glyph (no directional
 * variants); the chevron layer carries heading on top. */
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

/** Skew-free "now" + live ttl retained for the per-bus staleness cutoff. */
export interface VehicleSilenceContext {
	/** `sharedClock.serverNow` (epoch ms) — skew-corrected, server timeline. */
	serverNow: number;
	/** Live tier ttl (seconds) from the manifest; default 30s. */
	ttlS?: number;
}

/** Build the GeoJSON FeatureCollection for the current vehicles under the filter.
 *
 * `silence` carries the skew-free clock used to derive the per-bus `stale` flag.
 * The retired per-vehicle opacity and debug-age properties are not serialized. */
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
			// Per-bus staleness off this bus's OWN fix time (reported_utc, falling
			// back to updated_utc) — NOT the uniform snapshot age above. When a
			// clock is supplied and the fix is past the cutoff, the bus is frozen +
			// flagged with the "!" badge (VEHICLE_SILENT_LAYER). 0 with no clock.
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
					// A bus with no reported heading shows NO chevron (an honest "no
					// heading", never a fake forward arrow).
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
export const ICON_SIZE_Z11_DEFAULT = VEHICLE_MARKER_GEOMETRY.bodyIconSize.z11;

// Bus body zoom legs (the DEFAULT, unhovered/unselected size at each zoom stop).
// The silent "!" badge is sized as a fixed FRACTION of these so it scales with the
// bus and stays ~75% of the bus icon at every zoom. Exported for the test.
const ICON_SIZE_Z15_DEFAULT = VEHICLE_MARKER_GEOMETRY.bodyIconSize.z15;

const ICON_SIZE = [
	'interpolate',
	['linear'],
	['zoom'],
	11,
	ICON_SIZE_Z11_DEFAULT,
	15,
	ICON_SIZE_Z15_DEFAULT,
];

// The silent "!" badge is ~75% of the bus icon — big and prominent (it FILLS most
// of its sprite box, see silentBadgeImage), yet still reads as an overlay flag on
// the bus, not a replacement for it. Sized off the bus DEFAULT legs × 0.75 and
// interpolated over the same zoom range so it tracks the bus at every zoom.
// Exported (z11) so the test asserts the ~75% ratio without parsing the expression.
export const SILENT_BADGE_SCALE = VEHICLE_MARKER_GEOMETRY.silentBadge.scale;
export const SILENT_ICON_SIZE_Z11 = ICON_SIZE_Z11_DEFAULT * SILENT_BADGE_SCALE;
export const SILENT_ICON_SIZE_Z15 = ICON_SIZE_Z15_DEFAULT * SILENT_BADGE_SCALE;

const SILENT_ICON_SIZE = [
	'interpolate',
	['linear'],
	['zoom'],
	11,
	SILENT_ICON_SIZE_Z11,
	15,
	SILENT_ICON_SIZE_Z15,
];

const STATE_BADGE_ICON_SIZE = [
	'interpolate',
	['linear'],
	['zoom'],
	11,
	ICON_SIZE_Z11_DEFAULT * VEHICLE_MARKER_GEOMETRY.stateBadge.scale,
	15,
	ICON_SIZE_Z15_DEFAULT * VEHICLE_MARKER_GEOMETRY.stateBadge.scale,
];

/**
 * Convert a semantic icon displacement to MapLibre's raw `icon-offset` space.
 * MapLibre multiplies the raw offset by `icon-size`, so a separately scaled
 * overlay divides out only its overlay scale here. The frozen geometry table
 * remains the sole source of the intended displacement and scale.
 */
export function mapLibreRawIconOffset(
	semanticOffset: readonly [number, number],
	overlayScale: number,
): readonly [number, number] {
	if (!(overlayScale > 0)) throw new Error('MapLibre icon offset scale must be positive');
	return [semanticOffset[0] / overlayScale, semanticOffset[1] / overlayScale];
}

/** Global stale-dim multiplier: 45% when the WHOLE live tier is behind, else 1. */
const GLOBAL_STALE_OPACITY = 0.45;

const FEATURE_HOVERED = ['boolean', ['feature-state', 'hovered'], false];
const FEATURE_SELECTED = ['boolean', ['feature-state', 'selected'], false];

/**
 * Hover and committed selection ride feature-state; the serialized `selected`
 * branch remains for URL/filter-only emphasis with no open detail.
 */
function iconOpacityExpr(globalStale: boolean): unknown {
	return [
		'case',
		FEATURE_HOVERED,
		1,
		FEATURE_SELECTED,
		0.95,
		['==', ['get', 'selected'], 1],
		0.95,
		globalStale ? GLOBAL_STALE_OPACITY : 1,
	];
}

/** Owner-retunable first ring candidate: primary outer stroke, separated from the
 * primary bus fill by a background casing disc. */
export const VEHICLE_HIGHLIGHT_STYLE = Object.freeze({
	casingToken: 'var(--background)',
	ringToken: 'var(--primary)',
	hoverStrokeWidth: 2.5,
	selectedStrokeWidth: 2,
	hoverOpacity: 1,
	selectedOpacity: 0.92,
});

const VEHICLE_HIGHLIGHT_RADIUS = [
	'interpolate',
	['linear'],
	['zoom'],
	11,
	['case', FEATURE_HOVERED, 15, FEATURE_SELECTED, 13, 0],
	15,
	['case', FEATURE_HOVERED, 22, FEATURE_SELECTED, 19, 0],
];

function vehicleHighlightLayer(): LayerSpecification {
	const casing = resolveColor(VEHICLE_HIGHLIGHT_STYLE.casingToken, 'rgb(20, 20, 20)');
	const ring = resolveColor(VEHICLE_HIGHLIGHT_STYLE.ringToken, 'rgb(255, 95, 87)');
	return {
		id: VEHICLE_HIGHLIGHT_LAYER,
		type: 'circle',
		source: VEHICLE_SOURCE,
		filter: ['==', ['get', 'matched'], 1],
		paint: {
			'circle-radius': VEHICLE_HIGHLIGHT_RADIUS,
			'circle-color': casing,
			'circle-stroke-color': ring,
			'circle-stroke-width': [
				'case',
				FEATURE_HOVERED,
				VEHICLE_HIGHLIGHT_STYLE.hoverStrokeWidth,
				FEATURE_SELECTED,
				VEHICLE_HIGHLIGHT_STYLE.selectedStrokeWidth,
				0,
			],
			'circle-opacity': [
				'case',
				FEATURE_HOVERED,
				VEHICLE_HIGHLIGHT_STYLE.hoverOpacity,
				FEATURE_SELECTED,
				VEHICLE_HIGHLIGHT_STYLE.selectedOpacity,
				0,
			],
		},
	} as unknown as LayerSpecification;
}

function retintVehicleHighlight(map: MapLibreMap): void {
	map.setPaintProperty(
		VEHICLE_HIGHLIGHT_LAYER,
		'circle-color',
		resolveColor(VEHICLE_HIGHLIGHT_STYLE.casingToken, 'rgb(20, 20, 20)'),
	);
	map.setPaintProperty(
		VEHICLE_HIGHLIGHT_LAYER,
		'circle-stroke-color',
		resolveColor(VEHICLE_HIGHLIGHT_STYLE.ringToken, 'rgb(255, 95, 87)'),
	);
}

/** Add the vehicle body + heading + state badge + per-bus silent-flag symbol layers. Non-matched
 * features are filtered OUT (they disappear); opacity carries only the stale dim.
 * The bus body is UPRIGHT (it reads at every bearing); the chevron is a SEPARATE
 * layer that rotates by bearing and shows ONLY for vehicles reporting a heading;
 * the state badge shows ONLY for a matched active status/crowding dimension;
 * the silent "!" badge shows ONLY for matched + per-bus-stale vehicles (frozen
 * buses whose own fix is past the cutoff). Idempotent. */
export function addVehicleLayers(map: MapLibreMap): void {
	if (map.getLayer(VEHICLE_HIGHLIGHT_LAYER)) {
		retintVehicleHighlight(map);
	} else {
		map.addLayer(
			vehicleHighlightLayer(),
			map.getLayer(VEHICLE_BODY_LAYER) ? VEHICLE_BODY_LAYER : undefined,
		);
	}
	if (!map.getLayer(VEHICLE_BODY_LAYER)) {
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
			paint: { 'icon-opacity': iconOpacityExpr(false) },
		} as unknown as LayerSpecification);
	}

	// Drawn ABOVE the bus body so the direction tick is never occluded.
	if (!map.getLayer(VEHICLE_HEADING_LAYER)) {
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

	// The compact state badge is drawn ABOVE the heading and BELOW the silent
	// alert. Its dynamic sprite id is empty outside matched state-filter modes,
	// and the filter excludes those empty ids before MapLibre requests an image.
	if (!map.getLayer(VEHICLE_STATE_BADGE_LAYER)) {
		map.addLayer(
			{
				id: VEHICLE_STATE_BADGE_LAYER,
				type: 'symbol',
				source: VEHICLE_SOURCE,
				filter: ['all', ['==', ['get', 'matched'], 1], ['!=', ['get', 'mark'], '']],
				layout: {
					'icon-image': ['get', 'mark'],
					'icon-offset': mapLibreRawIconOffset(
						VEHICLE_MARKER_GEOMETRY.stateBadge.offset,
						VEHICLE_MARKER_GEOMETRY.stateBadge.scale,
					),
					'icon-size': STATE_BADGE_ICON_SIZE,
					'icon-allow-overlap': true,
					'icon-ignore-placement': true,
				},
				paint: { 'icon-opacity': iconOpacityExpr(false) },
			} as unknown as LayerSpecification,
			map.getLayer(VEHICLE_SILENT_LAYER) ? VEHICLE_SILENT_LAYER : undefined,
		);
	}

	// The per-bus "!" not-reporting badge — drawn ABOVE the body + heading so a
	// frozen, no-longer-reporting bus is FLAGGED (full opacity), never hidden.
	// Shown only for matched + stale vehicles; staleness is per-bus now (each
	// bus's own reported_utc age, set in toVehicleFeatures), not a global signal.
	if (!map.getLayer(VEHICLE_SILENT_LAYER)) {
		map.addLayer({
			id: VEHICLE_SILENT_LAYER,
			type: 'symbol',
			source: VEHICLE_SOURCE,
			filter: ['all', ['==', ['get', 'matched'], 1], ['==', ['get', 'stale'], 1]],
			layout: {
				'icon-image': SILENT_ICON,
				// Float the big "!" just above the bus glyph (icon-offset is in icon px,
				// applied before icon-size, so it tracks the glyph as it scales).
				'icon-offset': VEHICLE_MARKER_GEOMETRY.silentBadge.offset,
				// ~75% of the bus icon — a prominent alert flag, scaling with zoom.
				'icon-size': SILENT_ICON_SIZE,
				'icon-allow-overlap': true,
				'icon-ignore-placement': true,
			},
			paint: { 'icon-opacity': 1 },
		} as unknown as LayerSpecification);
	}
}

/** Apply the GLOBAL stale-dim (whole live tier behind). When stale, every bus is
 * dimmed to 45% together.
 * Never extrapolate — this only dims, it never moves a bus.
 * BY DESIGN: VEHICLE_SILENT_LAYER is intentionally NOT dimmed here — it stays at
 * opacity 1 through a global stale so the per-bus not-reporting "!" flags remain
 * legible on top of the dimmed fleet. This is deliberate, NOT a missed layer. */
export function setStale(map: MapLibreMap, stale: boolean): void {
	const opacity = iconOpacityExpr(stale) as Parameters<MapLibreMap['setPaintProperty']>[2];
	if (map.getLayer(VEHICLE_BODY_LAYER)) {
		map.setPaintProperty(VEHICLE_BODY_LAYER, 'icon-opacity', opacity);
	}
	if (map.getLayer(VEHICLE_HEADING_LAYER)) {
		map.setPaintProperty(VEHICLE_HEADING_LAYER, 'icon-opacity', opacity);
	}
	if (map.getLayer(VEHICLE_STATE_BADGE_LAYER)) {
		map.setPaintProperty(VEHICLE_STATE_BADGE_LAYER, 'icon-opacity', opacity);
	}
}
