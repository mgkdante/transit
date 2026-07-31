import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import {
	addNearTargetLayer,
	addNearTargetSource,
	addRouteLineLayers,
	addRouteLineSource,
	addStopExceptionLayer,
	addStopExceptionSource,
	addStopsLayer,
	addStopsSource,
	addVehicleLayers,
	addVehicleSource,
	bakeLocationPinSprite,
	bakeVehicleSprites,
	ROUTE_LINE_HIT_LAYER,
	setNearTarget,
	setRouteLines,
	setStale,
	setStops,
	STOP_EXCEPTION_LAYER,
	STOPS_LAYER,
	toVehicleFeatures,
	VEHICLE_BODY_LAYER,
	type FixResolver,
	type ShapeResolver,
	type VehicleMotionController,
} from '$lib/components/map';

export type MapLayerFeedContext = Readonly<{
	routes: Readonly<{
		items: Parameters<typeof setRouteLines>[1];
		selected: Parameters<typeof setRouteLines>[2];
	}>;
	vehicles: Readonly<{
		motion: VehicleMotionController | null;
		items: Parameters<typeof toVehicleFeatures>[0];
		filter: Parameters<typeof toVehicleFeatures>[1];
		alertIds: Parameters<typeof toVehicleFeatures>[2];
		selectedId: Parameters<typeof toVehicleFeatures>[3];
		serverNow: number;
		ttlS: number;
		tickKey: string | null;
		stale: boolean;
		fixFor: FixResolver;
		shapeFor: ShapeResolver | undefined;
		serverNowFn: () => number;
		animate: boolean;
	}>;
	stops: Readonly<{
		items: Parameters<typeof setStops>[1];
		filter: Parameters<typeof setStops>[2];
		alertIds: Parameters<typeof setStops>[3];
		selectedId: Parameters<typeof setStops>[4];
	}>;
	nearTarget: Readonly<{
		target: Parameters<typeof setNearTarget>[1];
	}>;
}>;

export interface LayerModule {
	readonly id: string;
	/** Must complete synchronously so installs and the first feed cannot race assets. */
	prepare?(map: MapLibreMap): void;
	install(map: MapLibreMap, beforeId?: string): void;
	feed(map: MapLibreMap, ctx: MapLayerFeedContext): void;
	readonly pick?: {
		readonly layerIds: readonly string[];
		readonly priority: number;
	};
}

const routesModule: LayerModule = {
	id: 'routes',
	install(map, beforeId) {
		addRouteLineSource(map);
		addRouteLineLayers(map, beforeId);
	},
	feed(map, ctx) {
		setRouteLines(map, ctx.routes.items, ctx.routes.selected);
	},
	pick: { layerIds: [ROUTE_LINE_HIT_LAYER], priority: 10 },
};

const stopsModule: LayerModule = {
	id: 'stops',
	install(map) {
		addStopsSource(map);
		addStopExceptionSource(map);
		addStopsLayer(map);
		addStopExceptionLayer(map);
	},
	feed(map, ctx) {
		const stops = ctx.stops;
		setStops(map, stops.items, stops.filter, stops.alertIds, stops.selectedId);
	},
	pick: { layerIds: [STOPS_LAYER, STOP_EXCEPTION_LAYER], priority: 20 },
};

const vehiclesModule: LayerModule = {
	id: 'vehicles',
	prepare(map) {
		// bakeVehicleSprites also installs STOP_ICON, which the stops module consumes.
		// All prepares run before any installs so that cross-module asset is ready.
		bakeVehicleSprites(map);
	},
	install(map) {
		addVehicleSource(map);
		addVehicleLayers(map);
	},
	feed(map, ctx) {
		const vehicles = ctx.vehicles;
		vehicles.motion?.set(
			toVehicleFeatures(vehicles.items, vehicles.filter, vehicles.alertIds, vehicles.selectedId, {
				serverNow: vehicles.serverNow,
				ttlS: vehicles.ttlS,
			}),
			{
				tickKey: vehicles.tickKey,
				stale: vehicles.stale,
				fixFor: vehicles.fixFor,
				shapeFor: vehicles.shapeFor,
				serverNowFn: vehicles.serverNowFn,
				animate: vehicles.animate,
			},
		);
		setStale(map, vehicles.stale);
	},
	pick: { layerIds: [VEHICLE_BODY_LAYER], priority: 30 },
};

const nearTargetModule: LayerModule = {
	id: 'near-target',
	prepare(map) {
		bakeLocationPinSprite(map);
	},
	install(map) {
		addNearTargetSource(map);
		addNearTargetLayer(map);
	},
	feed(map, ctx) {
		setNearTarget(map, ctx.nearTarget.target);
	},
};

/** Install order is visual stack order; pick priority is an independent contract. */
export const MAP_LAYER_MODULES: readonly LayerModule[] = Object.freeze([
	routesModule,
	stopsModule,
	vehiclesModule,
	nearTargetModule,
]);

export function retintMapLayers(map: MapLibreMap, beforeId?: string): void {
	for (const module of MAP_LAYER_MODULES) module.prepare?.(map);
	for (const module of MAP_LAYER_MODULES) module.install(map, beforeId);
}

export const PICKABLE_MAP_LAYERS: readonly string[] = Object.freeze(
	MAP_LAYER_MODULES.flatMap((module) =>
		module.pick
			? module.pick.layerIds.map((layerId) => ({
					layerId,
					priority: module.pick!.priority,
				}))
			: [],
	)
		.sort((a, b) => b.priority - a.priority)
		.map(({ layerId }) => layerId),
);

export function firstSymbolLayerId(map: MapLibreMap): string | undefined {
	return map.getStyle()?.layers?.find((layer) => layer.type === 'symbol')?.id;
}

export function installMapInteractions(
	map: MapLibreMap,
	handlers: Readonly<{
		click: (event: MapMouseEvent) => void;
		mousemove: (event: MapMouseEvent) => void;
		mouseleave: () => void;
	}>,
): readonly (() => void)[] {
	const canvas = map.getCanvas();
	map.on('click', handlers.click);
	map.on('mousemove', handlers.mousemove);
	canvas.addEventListener('mouseleave', handlers.mouseleave);

	return [
		() => map.off('click', handlers.click),
		() => map.off('mousemove', handlers.mousemove),
		() => canvas.removeEventListener('mouseleave', handlers.mouseleave),
	];
}
