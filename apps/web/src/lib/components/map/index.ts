export { default as MapStage } from './MapStage.svelte';

export { centerFromProviderBbox } from './viewport';
export type { MapFitPadding } from './viewport';

export { bakeVehicleSprites } from './vehicleSprites';
export type { VehicleSpriteReceipt } from './vehicleSprites';
export { createVehicleOverlay, VEHICLE_OVERLAY_RECEIPT } from './vehicleOverlay';
export type { VehicleOverlay, VehicleOverlayReceipt } from './vehicleOverlay';

export { toVehicleFeatures, VEHICLE_BODY_LAYER } from './vehicleLayer';
export type { VehicleFeature } from './vehicleLayer';
export { createVehicleMotionController } from './vehicleMotion';
export type { VehicleMotionController, ShapeResolver, FixResolver } from './vehicleMotion';
export type { Coord } from './polyline';

export {
	addStopsSource,
	addStopsLayer,
	setStops,
	STOP_HIGHLIGHT_LAYER,
	STOPS_LAYER,
	STOPS_SOURCE,
} from './stopsLayer';
export {
	addRouteLineSource,
	addRouteLineLayers,
	setRouteLines,
	ROUTE_LINE_HIT_LAYER,
} from './routeLines';
export { bakeLocationPinImage } from './nearTargetLayer';
export type { NearTarget } from './nearTargetLayer';

export { nearestStops } from './nearbyStops';
export type { LatLon, WithDistance } from './nearbyStops';

export { liveTtlS } from './vehicleSilence';
export { routeDirectionVariants } from './routeDirection';
export type { RouteDirectionVariant } from './routeDirection';
export { bestShapeForPoint, routeShapes } from './vehicleShapes';
export type { RouteShapes } from './vehicleShapes';
export { fixAgeS, isVehicleStale, STALE_CUTOFF_S } from './vehicleProjection';
