// map/stopsLayer.ts — the static stops layer.
//
// One calm colour (muted-foreground grey), a small circle, ZOOM-GATED to z≥13 so
// the 8,986-stop catalogue never blankets the city view — stops appear as you
// zoom into a neighbourhood. Rendered UNDER the vehicle layers (stops are
// context; buses ride on top). State (e.g. has-alert) will tint via the filter.

import type { Map as MapLibreMap, GeoJSONSource, LayerSpecification } from 'maplibre-gl';
import type { StopIndexEntry } from '$lib/v1/schemas';
import { STOP_ICON } from './vehicleSprites';

export const STOPS_SOURCE = 'stops';
export const STOPS_LAYER = 'stops';

interface StopFeature {
	type: 'Feature';
	geometry: { type: 'Point'; coordinates: [number, number] };
	properties: { id: string; name: string; code: string };
}
interface StopFC {
	type: 'FeatureCollection';
	features: StopFeature[];
}
const EMPTY_FC: StopFC = { type: 'FeatureCollection', features: [] };

/** Build the GeoJSON FeatureCollection for the stop catalogue. */
export function toStopFeatures(stops: readonly StopIndexEntry[]): StopFC {
	return {
		type: 'FeatureCollection',
		features: stops.map((s) => ({
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
			properties: { id: s.id, name: s.name, code: s.code ?? '' },
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
		minzoom: 13,
		layout: {
			'icon-image': STOP_ICON,
			'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.32, 16, 0.6],
			'icon-allow-overlap': true,
			'icon-ignore-placement': true,
		},
		paint: { 'icon-opacity': 0.55 },
	} as unknown as LayerSpecification);
}

/** Replace the rendered stops. */
export function setStops(map: MapLibreMap, stops: readonly StopIndexEntry[]): void {
	const src = map.getSource(STOPS_SOURCE) as GeoJSONSource | undefined;
	src?.setData(toStopFeatures(stops) as unknown as Parameters<GeoJSONSource['setData']>[0]);
}
