import type { Map as MapLibreMap, ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
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
export const VEHICLE_HEADING_LAYER = 'vehicle-heading';
export const VEHICLE_STATE_BADGE_LAYER = 'vehicle-state-badge';
export const VEHICLE_SILENT_LAYER = 'vehicle-silent';

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

const EMPTY_FC: VehicleFC = { type: 'FeatureCollection', features: [] };

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

export function addVehicleSource(map: MapLibreMap): void {
	if (map.getSource(VEHICLE_SOURCE)) return;
	map.addSource(VEHICLE_SOURCE, { type: 'geojson', data: EMPTY_FC, promoteId: 'id' });
}

export const ICON_SIZE_Z11_DEFAULT = VEHICLE_MARKER_GEOMETRY.bodyIconSize.z11;

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

export function mapLibreRawIconOffset(
	semanticOffset: readonly [number, number],
	overlayScale: number,
): readonly [number, number] {
	if (!(overlayScale > 0)) throw new Error('MapLibre icon offset scale must be positive');
	return [semanticOffset[0] / overlayScale, semanticOffset[1] / overlayScale];
}

function badgeOffset(
	badge: typeof VEHICLE_MARKER_GEOMETRY.stateBadge | typeof VEHICLE_MARKER_GEOMETRY.silentBadge,
	pairedWhen: unknown,
): unknown {
	const offset = (value: readonly [number, number]) => [
		'literal',
		mapLibreRawIconOffset(value, badge.scale),
	];
	return ['case', pairedWhen, offset(badge.pairedOffset), offset(badge.offset)];
}

const GLOBAL_STALE_OPACITY = 0.45;

const FEATURE_HOVERED: ExpressionSpecification = ['boolean', ['feature-state', 'hovered'], false];
const FEATURE_SELECTED: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];

function iconOpacityExpr(globalStale: boolean): ExpressionSpecification {
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
			filter: ['==', ['get', 'matched'], 1],
			layout: {
				'icon-image': ['get', 'body'],
				'icon-rotation-alignment': 'viewport',
				'icon-allow-overlap': true,
				'icon-ignore-placement': true,
				'icon-size': ICON_SIZE,
			},
			paint: { 'icon-opacity': iconOpacityExpr(false) },
		} as unknown as LayerSpecification);
	}

	if (!map.getLayer(VEHICLE_HEADING_LAYER)) {
		map.addLayer({
			id: VEHICLE_HEADING_LAYER,
			type: 'symbol',
			source: VEHICLE_SOURCE,
			filter: ['all', ['==', ['get', 'matched'], 1], ['==', ['get', 'hasHeading'], 1]],
			layout: {
				'icon-image': HEADING_ICON,
				'icon-offset': VEHICLE_MARKER_GEOMETRY.headingOffset,
				'icon-rotate': ['coalesce', ['get', 'bearing'], 0],
				'icon-rotation-alignment': 'map',
				'icon-pitch-alignment': 'viewport',
				'icon-allow-overlap': true,
				'icon-ignore-placement': true,
				'icon-size': ICON_SIZE,
			},
			paint: { 'icon-opacity': iconOpacityExpr(false) },
		} as unknown as LayerSpecification);
	}

	if (!map.getLayer(VEHICLE_STATE_BADGE_LAYER)) {
		map.addLayer(
			{
				id: VEHICLE_STATE_BADGE_LAYER,
				type: 'symbol',
				source: VEHICLE_SOURCE,
				filter: ['all', ['==', ['get', 'matched'], 1], ['!=', ['get', 'mark'], '']],
				layout: {
					'icon-image': ['get', 'mark'],
					'icon-offset': badgeOffset(VEHICLE_MARKER_GEOMETRY.stateBadge, [
						'==',
						['get', 'stale'],
						1,
					]),
					'icon-size': STATE_BADGE_ICON_SIZE,
					'icon-allow-overlap': true,
					'icon-ignore-placement': true,
				},
				paint: { 'icon-opacity': iconOpacityExpr(false) },
			} as unknown as LayerSpecification,
			map.getLayer(VEHICLE_SILENT_LAYER) ? VEHICLE_SILENT_LAYER : undefined,
		);
	}

	if (!map.getLayer(VEHICLE_SILENT_LAYER)) {
		map.addLayer({
			id: VEHICLE_SILENT_LAYER,
			type: 'symbol',
			source: VEHICLE_SOURCE,
			filter: ['all', ['==', ['get', 'matched'], 1], ['==', ['get', 'stale'], 1]],
			layout: {
				'icon-image': SILENT_ICON,
				'icon-offset': badgeOffset(VEHICLE_MARKER_GEOMETRY.silentBadge, [
					'!=',
					['coalesce', ['get', 'mark'], ''],
					'',
				]),
				'icon-size': SILENT_ICON_SIZE,
				'icon-allow-overlap': true,
				'icon-ignore-placement': true,
			},
			paint: { 'icon-opacity': 1 },
		} as unknown as LayerSpecification);
	}
}

export function setStale(map: MapLibreMap, stale: boolean): void {
	const opacity = iconOpacityExpr(stale);
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
