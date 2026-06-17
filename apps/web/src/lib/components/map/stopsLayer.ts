// map/stopsLayer.ts — the static stops layer.
//
// One calm orange diamond, ZOOM-GATED to z≥9 so stops appear as soon as the
// low-zoom street network appears, with a tiny early ramp to avoid blanketing.
// Rendered UNDER the vehicle layers (stops are context; buses ride on top).
// State (e.g. alert=has_alert) will tint via the filter.

import type { Map as MapLibreMap, GeoJSONSource, LayerSpecification } from 'maplibre-gl';
import type { StopIndexEntry } from '$lib/v1/schemas';
import type { FilterState } from '$lib/filters';
import { STOP_ICON } from './vehicleSprites';

export const STOPS_SOURCE = 'stops';
export const STOPS_LAYER = 'stops';

interface StopFeature {
	type: 'Feature';
	geometry: { type: 'Point'; coordinates: [number, number] };
	properties: { id: string; name: string; code: string; selected: number; hovered: number };
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
	hoveredStopId: string | null = null,
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
				name: s.name,
				code: s.code ?? '',
				selected: selectedStopId === s.id || (filter?.stops.has(s.id) ?? false) ? 1 : 0,
				hovered: hoveredStopId === s.id ? 1 : 0,
			},
		})),
	};
}

/** Register the (initially empty) stops source. Idempotent. */
export function addStopsSource(map: MapLibreMap): void {
	if (map.getSource(STOPS_SOURCE)) return;
	map.addSource(STOPS_SOURCE, { type: 'geojson', data: EMPTY_FC, promoteId: 'id' });
}

/** Add the stops layer — orange DIAMOND sprite, single colour, zoom-gated.
 * Dimmer + smaller than the buses so the live vehicles keep primacy (hierarchy
 * by weight + shape, not hue). Idempotent. */
export function addStopsLayer(map: MapLibreMap): void {
	if (map.getLayer(STOPS_LAYER)) return;
	map.addLayer({
		id: STOPS_LAYER,
		type: 'symbol',
		source: STOPS_SOURCE,
		minzoom: 0,
		layout: {
			'icon-image': STOP_ICON,
			'icon-size': [
				'interpolate',
				['linear'],
				['zoom'],
				0,
				['case', ['==', ['get', 'hovered'], 1], 1.3, ['==', ['get', 'selected'], 1], 0.62, 0],
				8,
				['case', ['==', ['get', 'hovered'], 1], 1.55, ['==', ['get', 'selected'], 1], 0.95, 0],
				9,
				['case', ['==', ['get', 'hovered'], 1], 0.42, ['==', ['get', 'selected'], 1], 0.19, 0.13],
				10,
				['case', ['==', ['get', 'hovered'], 1], 0.52, ['==', ['get', 'selected'], 1], 0.23, 0.16],
				11,
				['case', ['==', ['get', 'hovered'], 1], 0.72, ['==', ['get', 'selected'], 1], 0.32, 0.22],
				12,
				['case', ['==', ['get', 'hovered'], 1], 1.05, ['==', ['get', 'selected'], 1], 0.49, 0.34],
				13,
				['case', ['==', ['get', 'hovered'], 1], 1.35, ['==', ['get', 'selected'], 1], 0.67, 0.46],
				16,
				['case', ['==', ['get', 'hovered'], 1], 1.9, ['==', ['get', 'selected'], 1], 1.1, 0.76],
			],
			'icon-allow-overlap': true,
			'icon-ignore-placement': true,
		},
		paint: {
			'icon-opacity': [
				'interpolate',
				['linear'],
				['zoom'],
				0,
				['case', ['==', ['get', 'hovered'], 1], 1, ['==', ['get', 'selected'], 1], 0.95, 0],
				8,
				['case', ['==', ['get', 'hovered'], 1], 1, ['==', ['get', 'selected'], 1], 0.95, 0],
				9,
				['case', ['==', ['get', 'hovered'], 1], 1, ['==', ['get', 'selected'], 1], 0.95, 0.14],
				10,
				['case', ['==', ['get', 'hovered'], 1], 1, ['==', ['get', 'selected'], 1], 0.95, 0.18],
				11,
				['case', ['==', ['get', 'hovered'], 1], 1, ['==', ['get', 'selected'], 1], 0.95, 0.26],
				12,
				['case', ['==', ['get', 'hovered'], 1], 1, ['==', ['get', 'selected'], 1], 0.95, 0.42],
				13,
				['case', ['==', ['get', 'hovered'], 1], 1, ['==', ['get', 'selected'], 1], 0.95, 0.62],
				16,
				['case', ['==', ['get', 'hovered'], 1], 1, ['==', ['get', 'selected'], 1], 0.95, 0.7],
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
	hoveredStopId?: string | null,
): void {
	const src = map.getSource(STOPS_SOURCE) as GeoJSONSource | undefined;
	src?.setData(
		toStopFeatures(
			stops,
			filter,
			alertStopIds,
			selectedStopId,
			hoveredStopId,
		) as unknown as Parameters<GeoJSONSource['setData']>[0],
	);
}
