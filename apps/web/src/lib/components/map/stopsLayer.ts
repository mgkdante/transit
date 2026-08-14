// map/stopsLayer.ts — the static stops layer.
//
// One calm yellow diamond, ZOOM-GATED to z≥9 so stops appear as soon as the
// low-zoom street network appears, with a tiny early ramp to avoid blanketing.
// Rendered UNDER the vehicle layers (stops are context; buses ride on top).
// State (e.g. alert=has_alert) will tint via the filter.

import type { Map as MapLibreMap, GeoJSONSource, LayerSpecification } from 'maplibre-gl';
import type { StopIndexEntry } from '$lib/v1/schemas';
import type { FilterState } from '$lib/filters';
import { resolveColor, STOP_ICON } from './vehicleSprites';

export const STOPS_SOURCE = 'stops';
export const STOP_HIGHLIGHT_LAYER = 'stop-highlight';
export const STOPS_LAYER = 'stops';
export const STOP_EXCEPTION_SOURCE = 'stop-exception';
export const STOP_EXCEPTION_LAYER = 'stop-exception';

interface StopFeature {
	type: 'Feature';
	geometry: { type: 'Point'; coordinates: [number, number] };
	properties: { id: string; selected: number };
}
interface StopFC {
	type: 'FeatureCollection';
	features: StopFeature[];
}
const EMPTY_FC: StopFC = { type: 'FeatureCollection', features: [] };

function showsStops(filter?: FilterState): boolean {
	return !(filter?.entities && filter.entities.length > 0) || filter.entities.includes('stop');
}

function matchesAlertFilter(
	stop: StopIndexEntry,
	filter: FilterState | undefined,
	alertStopIds: ReadonlySet<string>,
): boolean {
	if (!filter?.alerts || filter.alerts.length === 0) return true;
	return alertStopIds.has(stop.id);
}

function matchesStopFilter(stop: StopIndexEntry, filter: FilterState | undefined): boolean {
	return !filter || filter.stops.size === 0 || filter.stops.has(stop.id);
}

/** Build the GeoJSON FeatureCollection for the stop catalogue. */
export function toStopFeatures(
	stops: readonly StopIndexEntry[],
	filter?: FilterState,
	alertStopIds: ReadonlySet<string> = new Set(),
	selectedStopId: string | null = null,
): StopFC {
	const visibleStops = showsStops(filter)
		? stops.filter(
				(stop) => matchesAlertFilter(stop, filter, alertStopIds) && matchesStopFilter(stop, filter),
			)
		: [];
	return {
		type: 'FeatureCollection',
		features: visibleStops.map((s) => ({
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
			properties: {
				id: s.id,
				selected: selectedStopId === s.id || (filter?.stops.has(s.id) ?? false) ? 1 : 0,
			},
		})),
	};
}

/** Register the (initially empty) stops source. Idempotent. */
export function addStopsSource(map: MapLibreMap): void {
	if (map.getSource(STOPS_SOURCE)) return;
	map.addSource(STOPS_SOURCE, { type: 'geojson', data: EMPTY_FC, promoteId: 'id' });
}

const FEATURE_HOVERED = ['boolean', ['feature-state', 'hovered'], false];
const FEATURE_SELECTED = ['boolean', ['feature-state', 'selected'], false];

/** Owner-retunable companion to the vehicle candidate: a primary outer stroke
 * separated from the stop glyph by a background casing disc. */
export const STOP_HIGHLIGHT_STYLE = Object.freeze({
	casingToken: 'var(--background)',
	ringToken: 'var(--primary)',
	hoverStrokeWidth: 2.25,
	selectedStrokeWidth: 1.75,
	hoverOpacity: 1,
	selectedOpacity: 0.92,
});

const STOP_HIGHLIGHT_RADIUS = [
	'interpolate',
	['linear'],
	['zoom'],
	8,
	['case', FEATURE_HOVERED, 8, FEATURE_SELECTED, 6, 0],
	12,
	['case', FEATURE_HOVERED, 13, FEATURE_SELECTED, 10, 0],
	16,
	['case', FEATURE_HOVERED, 18, FEATURE_SELECTED, 14, 0],
];

function retintStopHighlight(map: MapLibreMap): void {
	map.setPaintProperty(
		STOP_HIGHLIGHT_LAYER,
		'circle-color',
		resolveColor(STOP_HIGHLIGHT_STYLE.casingToken, 'rgb(20, 20, 20)'),
	);
	map.setPaintProperty(
		STOP_HIGHLIGHT_LAYER,
		'circle-stroke-color',
		resolveColor(STOP_HIGHLIGHT_STYLE.ringToken, 'rgb(255, 95, 87)'),
	);
}

function addStopHighlightLayer(map: MapLibreMap): void {
	if (map.getLayer(STOP_HIGHLIGHT_LAYER)) {
		retintStopHighlight(map);
		return;
	}
	const casing = resolveColor(STOP_HIGHLIGHT_STYLE.casingToken, 'rgb(20, 20, 20)');
	const ring = resolveColor(STOP_HIGHLIGHT_STYLE.ringToken, 'rgb(255, 95, 87)');
	map.addLayer(
		{
			id: STOP_HIGHLIGHT_LAYER,
			type: 'circle',
			source: STOPS_SOURCE,
			minzoom: 8,
			paint: {
				'circle-radius': STOP_HIGHLIGHT_RADIUS,
				'circle-color': casing,
				'circle-stroke-color': ring,
				'circle-stroke-width': [
					'case',
					FEATURE_HOVERED,
					STOP_HIGHLIGHT_STYLE.hoverStrokeWidth,
					FEATURE_SELECTED,
					STOP_HIGHLIGHT_STYLE.selectedStrokeWidth,
					0,
				],
				'circle-opacity': [
					'case',
					FEATURE_HOVERED,
					STOP_HIGHLIGHT_STYLE.hoverOpacity,
					FEATURE_SELECTED,
					STOP_HIGHLIGHT_STYLE.selectedOpacity,
					0,
				],
			},
		} as unknown as LayerSpecification,
		map.getLayer(STOPS_LAYER) ? STOPS_LAYER : undefined,
	);
}

/** Add the stops layer — yellow DIAMOND sprite, single colour, zoom-gated.
 * Dimmer + smaller than the buses so the live vehicles keep primacy (hierarchy
 * by weight + shape, not hue). Idempotent. */
export function addStopsLayer(map: MapLibreMap): void {
	addStopHighlightLayer(map);
	if (map.getLayer(STOPS_LAYER)) return;
	map.addLayer({
		id: STOPS_LAYER,
		type: 'symbol',
		source: STOPS_SOURCE,
		minzoom: 8,
		layout: {
			'icon-image': STOP_ICON,
			'icon-size': [
				'interpolate',
				['linear'],
				['zoom'],
				8,
				0,
				9,
				0.13,
				10,
				0.16,
				11,
				0.22,
				12,
				0.34,
				13,
				0.46,
				16,
				0.76,
			],
			'icon-allow-overlap': true,
			'icon-ignore-placement': true,
		},
		paint: {
			'icon-opacity': [
				'interpolate',
				['linear'],
				['zoom'],
				8,
				[
					'case',
					FEATURE_HOVERED,
					1,
					FEATURE_SELECTED,
					0.95,
					['==', ['get', 'selected'], 1],
					0.95,
					0,
				],
				9,
				[
					'case',
					FEATURE_HOVERED,
					1,
					FEATURE_SELECTED,
					0.95,
					['==', ['get', 'selected'], 1],
					0.95,
					0.14,
				],
				10,
				[
					'case',
					FEATURE_HOVERED,
					1,
					FEATURE_SELECTED,
					0.95,
					['==', ['get', 'selected'], 1],
					0.95,
					0.18,
				],
				11,
				[
					'case',
					FEATURE_HOVERED,
					1,
					FEATURE_SELECTED,
					0.95,
					['==', ['get', 'selected'], 1],
					0.95,
					0.26,
				],
				12,
				[
					'case',
					FEATURE_HOVERED,
					1,
					FEATURE_SELECTED,
					0.95,
					['==', ['get', 'selected'], 1],
					0.95,
					0.42,
				],
				13,
				[
					'case',
					FEATURE_HOVERED,
					1,
					FEATURE_SELECTED,
					0.95,
					['==', ['get', 'selected'], 1],
					0.95,
					0.62,
				],
				16,
				[
					'case',
					FEATURE_HOVERED,
					1,
					FEATURE_SELECTED,
					0.95,
					['==', ['get', 'selected'], 1],
					0.95,
					0.7,
				],
			],
		},
	} as unknown as LayerSpecification);
}

/** Replace the rendered stops. */
export function setStops(
	map: MapLibreMap,
	stops: readonly StopIndexEntry[],
	filter?: FilterState,
	alertStopIds?: ReadonlySet<string>,
	selectedStopId?: string | null,
): void {
	const src = map.getSource(STOPS_SOURCE) as GeoJSONSource | undefined;
	src?.setData(
		toStopFeatures(stops, filter, alertStopIds, selectedStopId) as unknown as Parameters<
			GeoJSONSource['setData']
		>[0],
	);
}

interface StopExceptionFeature {
	type: 'Feature';
	geometry: { type: 'Point'; coordinates: [number, number] };
	properties: {
		id: string;
		name: string;
		code: string;
		selected: number;
		hovered: number;
	};
}

interface StopExceptionFC {
	type: 'FeatureCollection';
	features: StopExceptionFeature[];
}

const EMPTY_EXCEPTION_FC: StopExceptionFC = { type: 'FeatureCollection', features: [] };

export function addStopExceptionSource(map: MapLibreMap): void {
	if (map.getSource(STOP_EXCEPTION_SOURCE)) return;
	map.addSource(STOP_EXCEPTION_SOURCE, { type: 'geojson', data: EMPTY_EXCEPTION_FC });
}

export function addStopExceptionLayer(map: MapLibreMap): void {
	if (map.getLayer(STOP_EXCEPTION_LAYER)) return;
	map.addLayer({
		id: STOP_EXCEPTION_LAYER,
		type: 'symbol',
		source: STOP_EXCEPTION_SOURCE,
		maxzoom: 8,
		layout: {
			'icon-image': STOP_ICON,
			'icon-size': [
				'interpolate',
				['linear'],
				['zoom'],
				0,
				['case', ['==', ['get', 'selected'], 1], 0.62, ['==', ['get', 'hovered'], 1], 1.3, 0],
				8,
				['case', ['==', ['get', 'selected'], 1], 0.95, ['==', ['get', 'hovered'], 1], 1.55, 0],
			],
			'icon-allow-overlap': true,
			'icon-ignore-placement': true,
		},
		paint: {
			'icon-opacity': [
				'case',
				['==', ['get', 'selected'], 1],
				0.95,
				['==', ['get', 'hovered'], 1],
				1,
				0,
			],
		},
	} as unknown as LayerSpecification);
}

export function setStopException(
	map: MapLibreMap,
	stopsById: Readonly<Record<string, StopIndexEntry>>,
	selectedStopId: string | null,
	hoveredStopId: string | null,
): void {
	const features: StopExceptionFeature[] = [];
	const add = (id: string, selected: number, hovered: number) => {
		const stop = Object.hasOwn(stopsById, id) ? stopsById[id] : undefined;
		if (!stop) return;
		features.push({
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
			properties: {
				id: stop.id,
				name: stop.name,
				code: stop.code ?? '',
				selected,
				hovered,
			},
		});
	};

	if (selectedStopId) add(selectedStopId, 1, 0);
	if (hoveredStopId && hoveredStopId !== selectedStopId) add(hoveredStopId, 0, 1);

	const source = map.getSource(STOP_EXCEPTION_SOURCE) as GeoJSONSource | undefined;
	source?.setData({
		type: 'FeatureCollection',
		features,
	} as unknown as Parameters<GeoJSONSource['setData']>[0]);
}
