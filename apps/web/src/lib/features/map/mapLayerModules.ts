import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import {
	addRouteLineLayers,
	addRouteLineSource,
	addStopsLayer,
	addStopsSource,
	bakeLocationPinImage,
	bakeVehicleSprites,
	ROUTE_LINE_HIT_LAYER,
	setRouteLines,
	setStops,
	STOP_EXCEPTION_LAYER,
	STOPS_LAYER,
	toVehicleFeatures,
	type VehicleSpriteReceipt,
	type NearTarget,
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
		target: NearTarget | null;
	}>;
}>;

export interface LayerModule {
	readonly id: string;
	install?(map: MapLibreMap, beforeId?: string): void;
	invalidationKey(ctx: MapLayerFeedContext): readonly unknown[];
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
	invalidationKey(ctx) {
		const selected = ctx.routes.selected;
		return [...ctx.routes.items, selected?.id, selected?.direction, selected?.variantKey];
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
		addStopsLayer(map);
	},
	invalidationKey(ctx) {
		const { alertIds, filter, items, selectedId } = ctx.stops;
		const alertFilterActive = (filter?.alerts?.length ?? 0) > 0;
		return [
			items,
			filter?.stops.size ? null : selectedId,
			[...(filter?.stops ?? [])].sort().join('\u0000'),
			!filter?.entities?.length || filter.entities.includes('stop'),
			alertFilterActive,
			alertFilterActive ? [...(alertIds ?? [])].sort().join('\u0000') : '',
		];
	},
	feed(map, ctx) {
		const stops = ctx.stops;
		setStops(map, stops.items, stops.filter, stops.alertIds, stops.selectedId);
	},
	pick: { layerIds: [STOPS_LAYER, STOP_EXCEPTION_LAYER], priority: 20 },
};

const vehiclesModule: LayerModule = {
	id: 'vehicles',
	invalidationKey(ctx) {
		const vehicles = ctx.vehicles;
		const filter = vehicles.filter;
		const alertFilterActive = (filter.alerts?.length ?? 0) > 0;
		const join = (values: Iterable<string>): string => [...values].sort().join('\u0000');
		return [
			vehicles.motion,
			vehicles.tickKey ?? vehicles.items,
			join(filter.routes),
			join(filter.stops),
			join(filter.trips),
			join(filter.vehicles),
			join(filter.status ?? []),
			join(filter.occupancy ?? []),
			join(filter.entities ?? []),
			alertFilterActive,
			alertFilterActive ? join(vehicles.alertIds ?? []) : '',
			vehicles.selectedId,
			vehicles.ttlS,
			vehicles.stale,
			vehicles.shapeFor,
			vehicles.animate,
		];
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
	},
};

/** Install order is visual stack order; pick priority is an independent contract. */
export const MAP_LAYER_MODULES: readonly LayerModule[] = Object.freeze([
	routesModule,
	stopsModule,
	vehiclesModule,
]);

function sameInvalidationKey(previous: readonly unknown[], next: readonly unknown[]): boolean {
	return (
		previous.length === next.length &&
		previous.every((value, index) => Object.is(value, next[index]))
	);
}

export interface MapLayerFeedController {
	feed(map: MapLibreMap, ctx: MapLayerFeedContext, layerRevision: number): void;
}

export function createMapLayerFeedController(): MapLayerFeedController {
	let previousMap: MapLibreMap | null = null;
	let previousRevision = -1;
	const previousKeys = new Map<string, readonly unknown[]>();

	return {
		feed(map, ctx, layerRevision) {
			const force = map !== previousMap || layerRevision !== previousRevision;
			for (const module of MAP_LAYER_MODULES) {
				const nextKey = module.invalidationKey(ctx);
				const previousKey = previousKeys.get(module.id);
				if (force || !previousKey || !sameInvalidationKey(previousKey, nextKey)) {
					module.feed(map, ctx);
				}
				previousKeys.set(module.id, nextKey);
			}
			previousMap = map;
			previousRevision = layerRevision;
		},
	};
}

// Bake once before installing stops, which consume STOP_ICON. Vehicle and pin
// sprite bytes remain in the CPU foreground; only the stop image reaches GL.
export function retintMapLayers(
	map: MapLibreMap,
	beforeId?: string,
): { sprites: VehicleSpriteReceipt; pin: ImageData } {
	// The stop icon remains MapLibre-owned; moving images stay in one CPU atlas.
	const sprites = bakeVehicleSprites(map, false);
	const pin = bakeLocationPinImage();
	for (const module of MAP_LAYER_MODULES) module.install?.(map, beforeId);
	return { sprites, pin };
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
		webglcontextrestored?: () => void;
		styleload?: () => void;
	}>,
): readonly (() => void)[] {
	const canvas = map.getCanvas();
	const rollbacks: Array<() => void> = [];
	const once = (rollback: () => void): (() => void) => {
		let pending = true;
		return () => {
			if (!pending) return;
			rollback();
			pending = false;
		};
	};
	const register = (install: () => void, rollback: () => void): void => {
		// Ledger first: a hostile Evented/DOM implementation may mutate and then throw.
		rollbacks.push(once(rollback));
		install();
	};

	try {
		register(
			() => map.on('click', handlers.click),
			() => map.off('click', handlers.click),
		);
		register(
			() => map.on('mousemove', handlers.mousemove),
			() => map.off('mousemove', handlers.mousemove),
		);
		register(
			() => canvas.addEventListener('mouseleave', handlers.mouseleave),
			() => canvas.removeEventListener('mouseleave', handlers.mouseleave),
		);
		if (handlers.webglcontextrestored) {
			register(
				() => map.on('webglcontextrestored', handlers.webglcontextrestored!),
				() => map.off('webglcontextrestored', handlers.webglcontextrestored!),
			);
		}
		if (handlers.styleload) {
			register(
				() => map.on('style.load', handlers.styleload!),
				() => map.off('style.load', handlers.styleload!),
			);
		}
	} catch (registrationError) {
		const rollbackErrors: unknown[] = [];
		for (const rollback of [...rollbacks].reverse()) {
			try {
				rollback();
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		if (rollbackErrors.length > 0) {
			throw Object.assign(
				new AggregateError(
					[registrationError, ...rollbackErrors],
					'Map interaction registration and rollback failed',
				),
				{ disposers: rollbacks },
			) as AggregateError & { readonly disposers: readonly (() => void)[] };
		}
		throw registrationError;
	}

	return rollbacks;
}
