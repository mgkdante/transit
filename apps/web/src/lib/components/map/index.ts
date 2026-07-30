// Public barrel for `$lib/components/map`. Keep this boundary to the map-kit
// names consumed outside this directory; leaf-only helpers stay on their modules.
//
// SSR NOTE: MapStage is browser-only — it dynamic-imports maplibre-gl/pmtiles
// inside onMount and renders nothing server-side, so importing this barrel does
// not pull WebGL into a server/SSR bundle.

export { default as MapStage } from './MapStage.svelte';

export { centerFromProviderBbox } from './viewport';
export type { MapFitPadding } from './viewport';

export { bakeVehicleSprites } from './vehicleSprites';

export {
	addVehicleSource,
	addVehicleLayers,
	setStale,
	toVehicleFeatures,
	VEHICLE_BODY_LAYER,
} from './vehicleLayer';
export type { VehicleFeature } from './vehicleLayer';
export { createVehicleMotionController } from './vehicleMotion';
export type { VehicleMotionController, ShapeResolver, FixResolver } from './vehicleMotion';
export type { Coord } from './polyline';

export { addStopsSource, addStopsLayer, setStops, STOPS_LAYER } from './stopsLayer';
export {
	addRouteLineSource,
	addRouteLineLayers,
	setRouteLines,
	ROUTE_LINE_HIT_LAYER,
} from './routeLines';
export {
	bakeLocationPinSprite,
	addNearTargetSource,
	addNearTargetLayer,
	setNearTarget,
} from './nearTargetLayer';

export { nearestStops } from './nearbyStops';
export type { LatLon, WithDistance } from './nearbyStops';

export { liveTtlS } from './vehicleSilence';
export { routeDirectionVariants } from './routeDirection';
export type { RouteDirectionVariant } from './routeDirection';
export { bestShapeForPoint, routeShapes } from './vehicleShapes';
export type { RouteShapes } from './vehicleShapes';
export { fixAgeS, isVehicleStale, STALE_CUTOFF_S } from './vehicleProjection';
