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
	applyBasemapTheme,
	graticuleGeoJson,
	toPmtilesUrl,
	BASEMAP_SOURCE_ID,
} from './basemap';
export { centerFromProviderBbox, mapViewportOptions, MONTREAL_MAP_BOUNDS } from './viewport';
export type { MapFitPadding } from './viewport';
export type { MapViewportOptions } from './viewport';

// Live vehicle layer kit (slice-9.3) — sprite baker + source/layers + feature
// builder + the near-me geo util. The runtime pieces touch the map only after
// MapStage's onready; the geo helpers are pure + SSR-safe.
export {
	bakeVehicleSprites,
	bodyIconId,
	BUS_ICON,
	HEADING_ICON,
	STOP_ICON,
} from './vehicleSprites';

export {
	addVehicleSource,
	addVehicleLayers,
	setVehicles,
	setStale,
	toVehicleFeatures,
	VEHICLE_SOURCE,
	VEHICLE_BODY_LAYER,
	VEHICLE_HEADING_LAYER,
} from './vehicleLayer';
export type { VehicleFC, VehicleFeature } from './vehicleLayer';
export {
	createVehicleMotionController,
	type VehicleMotionController,
	type ShapeResolver,
	type FixResolver,
	type VehicleFix,
} from './vehicleMotion';
export type { Coord } from './polyline';

export { addStopsSource, addStopsLayer, setStops, STOPS_SOURCE, STOPS_LAYER } from './stopsLayer';
export {
	addRouteLineSource,
	addRouteLineLayers,
	setRouteLines,
	toRouteLineFeatures,
	ROUTE_LINE_SOURCE,
	ROUTE_LINE_CASING_LAYER,
	ROUTE_LINE_LAYER,
	ROUTE_LINE_HIT_LAYER,
} from './routeLines';
export {
	bakeLocationPinSprite,
	addNearTargetSource,
	addNearTargetLayer,
	setNearTarget,
	toNearTargetFeatures,
	NEAR_TARGET_SOURCE,
	NEAR_TARGET_LAYER,
	LOCATION_PIN_ICON,
} from './nearTargetLayer';

export { haversineMeters, nearestStops, type LatLon, type WithDistance } from './nearbyStops';
