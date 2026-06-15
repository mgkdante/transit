// Barrel for `$lib/components/map`. The MapLibre stage + the null-safe basemap
// style resolver.
//
// SSR NOTE: MapStage is browser-only — it dynamic-imports maplibre-gl/pmtiles
// inside onMount and renders nothing server-side. `basemap.ts` is pure and
// SSR-safe (no window, no runtime maplibre import), so importing the resolver
// or its types from this barrel will NOT pull WebGL into a server/SSR bundle.

export { default as MapStage } from './MapStage.svelte';

export {
	resolveBasemapStyle,
	minimalDarkStyle,
	vectorStyleFromBasemap,
	graticuleGeoJson,
	toPmtilesUrl,
	BASEMAP_SOURCE_ID,
} from './basemap';

// Live vehicle layer kit (slice-9.3) — sprite baker + source/layers + feature
// builder + the near-me geo util. The runtime pieces touch the map only after
// MapStage's onready; the geo helpers are pure + SSR-safe.
export { bakeVehicleSprites, bodyIconId, glyphIconId, OCC_NODATA } from './vehicleSprites';

export {
	addVehicleSource,
	addVehicleLayers,
	setVehicles,
	setStale,
	applyFilter,
	toVehicleFeatures,
	VEHICLE_SOURCE,
	VEHICLE_BODY_LAYER,
	VEHICLE_GLYPH_LAYER,
	type VehicleMode,
} from './vehicleLayer';

export { addStopsSource, addStopsLayer, setStops, STOPS_SOURCE, STOPS_LAYER } from './stopsLayer';

export { haversineMeters, nearestStops, type LatLon, type WithDistance } from './nearbyStops';
