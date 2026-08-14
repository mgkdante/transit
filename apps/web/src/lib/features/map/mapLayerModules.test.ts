import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FilterState } from '$lib/filters';
import { minimalDarkStyle } from '$lib/components/map/basemap';
import { STOP_EXCEPTION_LAYER } from '$lib/components/map/stopsLayer';
import {
	createMapLayerFeedController,
	firstSymbolLayerId,
	installMapInteractions,
	MAP_LAYER_MODULES,
	PICKABLE_MAP_LAYERS,
	type MapLayerFeedContext,
} from './mapLayerModules';

function mapWithStyle(style: StyleSpecification): MapLibreMap {
	return { getStyle: () => style } as unknown as MapLibreMap;
}

describe('firstSymbolLayerId', () => {
	it('returns the first symbol layer in style order', () => {
		const style = {
			version: 8,
			sources: {},
			layers: [
				{ id: 'background', type: 'background' },
				{ id: 'roads', type: 'line', source: 'roads' },
				{ id: 'first-label', type: 'symbol', source: 'labels' },
				{ id: 'later-label', type: 'symbol', source: 'labels' },
			],
		} as StyleSpecification;

		expect(firstSymbolLayerId(mapWithStyle(style))).toBe('first-label');
	});

	it('returns undefined for the symbol-free minimal style', () => {
		expect(firstSymbolLayerId(mapWithStyle(minimalDarkStyle()))).toBeUndefined();
	});
});

describe('installMapInteractions', () => {
	it('returns disposers for every registered map and canvas handler', () => {
		type Handler = (event: never) => void;
		const mapHandlers = new Map<string, Set<Handler>>();
		const canvasHandlers = new Map<string, Set<Handler>>();
		const unregisterCalls = new Map<string, number>();
		const register = (target: Map<string, Set<Handler>>, type: string, handler: Handler) => {
			const handlers = target.get(type) ?? new Set<Handler>();
			handlers.add(handler);
			target.set(type, handlers);
		};
		const unregister = (target: Map<string, Set<Handler>>, type: string, handler: Handler) => {
			unregisterCalls.set(type, (unregisterCalls.get(type) ?? 0) + 1);
			target.get(type)?.delete(handler);
		};
		const canvas = {
			addEventListener: (type: string, handler: Handler) => register(canvasHandlers, type, handler),
			removeEventListener: (type: string, handler: Handler) =>
				unregister(canvasHandlers, type, handler),
		};
		const map = {
			on: (type: string, handler: Handler) => register(mapHandlers, type, handler),
			off: (type: string, handler: Handler) => unregister(mapHandlers, type, handler),
			getCanvas: () => canvas,
		} as unknown as MapLibreMap;

		const disposers = installMapInteractions(map, {
			click: vi.fn(),
			mousemove: vi.fn(),
			mouseleave: vi.fn(),
		});

		expect(mapHandlers.get('click')?.size).toBe(1);
		expect(mapHandlers.get('mousemove')?.size).toBe(1);
		expect(canvasHandlers.get('mouseleave')?.size).toBe(1);

		for (const dispose of disposers) {
			dispose();
			dispose();
		}

		expect(mapHandlers.get('click')?.size).toBe(0);
		expect(mapHandlers.get('mousemove')?.size).toBe(0);
		expect(canvasHandlers.get('mouseleave')?.size).toBe(0);
		expect(Object.fromEntries(unregisterCalls)).toEqual({
			click: 1,
			mousemove: 1,
			mouseleave: 1,
		});
	});

	it('rolls back a click when the second map registration mutates then throws', () => {
		type Handler = (event: never) => void;
		const registrationError = new Error('mousemove registration failed');
		const mapHandlers = new Map<string, Set<Handler>>();
		const register = (type: string, handler: Handler) => {
			const handlers = mapHandlers.get(type) ?? new Set<Handler>();
			handlers.add(handler);
			mapHandlers.set(type, handlers);
			if (type === 'mousemove') throw registrationError;
		};
		const map = {
			on: register,
			off: (type: string, handler: Handler) => mapHandlers.get(type)?.delete(handler),
			getCanvas: () => ({
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			}),
		} as unknown as MapLibreMap;

		expect(() =>
			installMapInteractions(map, {
				click: vi.fn(),
				mousemove: vi.fn(),
				mouseleave: vi.fn(),
			}),
		).toThrow(registrationError);
		expect(mapHandlers.get('click')?.size).toBe(0);
		expect(mapHandlers.get('mousemove')?.size).toBe(0);
	});

	it('rolls every map handler back when canvas registration mutates then throws', () => {
		type Handler = (event: never) => void;
		const registrationError = new Error('canvas registration failed');
		const rollbackError = new Error('canvas rollback failed');
		const mapHandlers = new Map<string, Set<Handler>>();
		const canvasHandlers = new Map<string, Set<Handler>>();
		let canvasRollbackAttempts = 0;
		const register = (target: Map<string, Set<Handler>>, type: string, handler: Handler) => {
			const handlers = target.get(type) ?? new Set<Handler>();
			handlers.add(handler);
			target.set(type, handlers);
		};
		const canvas = {
			addEventListener: (type: string, handler: Handler) => {
				register(canvasHandlers, type, handler);
				throw registrationError;
			},
			removeEventListener: (type: string, handler: Handler) => {
				canvasRollbackAttempts += 1;
				if (canvasRollbackAttempts === 1) throw rollbackError;
				canvasHandlers.get(type)?.delete(handler);
			},
		};
		const map = {
			on: (type: string, handler: Handler) => register(mapHandlers, type, handler),
			off: (type: string, handler: Handler) => mapHandlers.get(type)?.delete(handler),
			getCanvas: () => canvas,
		} as unknown as MapLibreMap;

		let failure: unknown;
		try {
			installMapInteractions(map, {
				click: vi.fn(),
				mousemove: vi.fn(),
				mouseleave: vi.fn(),
			});
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(AggregateError);
		expect((failure as AggregateError).errors).toEqual([registrationError, rollbackError]);
		const disposers = (failure as AggregateError & { readonly disposers: readonly (() => void)[] })
			.disposers;
		expect(disposers).toHaveLength(3);
		expect(mapHandlers.get('click')?.size).toBe(0);
		expect(mapHandlers.get('mousemove')?.size).toBe(0);
		expect(canvasHandlers.get('mouseleave')?.size).toBe(1);

		disposers[2]!();
		disposers[2]!();
		expect(canvasHandlers.get('mouseleave')?.size).toBe(0);
		expect(canvasRollbackAttempts).toBe(2);
	});
});

describe('map layer feed invariants', () => {
	it('retints through every prepare before install without feeding any module', async () => {
		const api = (await import('./mapLayerModules')) as typeof import('./mapLayerModules') & {
			retintMapLayers?: (map: MapLibreMap) => void;
		};
		const trace: string[] = [];
		const feedSpies = [];
		for (const module of MAP_LAYER_MODULES) {
			if (module.prepare) {
				vi.spyOn(module, 'prepare').mockImplementation(() => trace.push(`prepare:${module.id}`));
			}
			vi.spyOn(module, 'install').mockImplementation(() => trace.push(`install:${module.id}`));
			feedSpies.push(vi.spyOn(module, 'feed'));
		}

		(api.retintMapLayers ?? (() => {}))({} as MapLibreMap);

		expect(trace).toEqual([
			'prepare:vehicles',
			'prepare:near-target',
			'install:routes',
			'install:stops',
			'install:vehicles',
			'install:near-target',
		]);
		for (const feed of feedSpies) expect(feed).not.toHaveBeenCalled();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('passes the frozen motion option shape unchanged', () => {
		const set = vi.fn();
		const fixFor = vi.fn(() => null);
		const shapeFor = vi.fn(() => null);
		const serverNowFn = vi.fn(() => 123_456);
		const filter: FilterState = {
			routes: new Set(),
			stops: new Set(),
			trips: new Set(),
			vehicles: new Set(),
		};
		const context = {
			routes: { items: [], selected: null },
			vehicles: {
				motion: { set },
				items: [],
				filter,
				alertIds: new Set(),
				selectedId: null,
				serverNow: 123_456,
				ttlS: 30,
				tickKey: 'tick-1',
				stale: false,
				fixFor,
				shapeFor,
				serverNowFn,
				animate: true,
			},
			stops: {
				items: [],
				filter,
				alertIds: new Set(),
				selectedId: null,
			},
			nearTarget: { target: null },
		} as unknown as MapLayerFeedContext;
		const map = {
			getLayer: () => undefined,
			setPaintProperty: vi.fn(),
		} as unknown as MapLibreMap;

		MAP_LAYER_MODULES.find((module) => module.id === 'vehicles')?.feed(map, context);

		expect(set).toHaveBeenCalledWith(
			{ type: 'FeatureCollection', features: [] },
			{
				tickKey: 'tick-1',
				stale: false,
				fixFor,
				shapeFor,
				serverNowFn,
				animate: true,
			},
		);
	});

	it('feeds only modules whose semantic input changed, but force-feeds after reinstall', () => {
		const filter: FilterState = {
			routes: new Set(),
			stops: new Set(),
			trips: new Set(),
			vehicles: new Set(),
		};
		const context = {
			routes: { items: [], selected: null },
			vehicles: {
				motion: null,
				items: [],
				filter,
				alertIds: new Set(),
				selectedId: null,
				serverNow: 123_456,
				ttlS: 30,
				tickKey: 'tick-1',
				stale: false,
				fixFor: vi.fn(() => null),
				shapeFor: undefined,
				serverNowFn: vi.fn(() => 123_456),
				animate: false,
			},
			stops: { items: [], filter, alertIds: new Set(), selectedId: null },
			nearTarget: { target: null },
		} as unknown as MapLayerFeedContext;
		const feeds = Object.fromEntries(
			MAP_LAYER_MODULES.map((module) => [
				module.id,
				vi.spyOn(module, 'feed').mockImplementation(() => {}),
			]),
		);
		const controller = createMapLayerFeedController();
		const map = {} as MapLibreMap;

		controller.feed(map, context, 1);
		const nextVehicles = {
			...context,
			vehicles: { ...context.vehicles, items: [{}], tickKey: 'tick-2' },
		} as unknown as MapLayerFeedContext;
		controller.feed(map, nextVehicles, 1);

		expect(feeds.routes).toHaveBeenCalledTimes(1);
		expect(feeds.stops).toHaveBeenCalledTimes(1);
		expect(feeds.vehicles).toHaveBeenCalledTimes(2);
		expect(feeds['near-target']).toHaveBeenCalledTimes(1);

		const nextFilter: FilterState = { ...filter, stops: new Set(['stop-1']) };
		const filtered = {
			...nextVehicles,
			vehicles: { ...nextVehicles.vehicles, filter: nextFilter },
			stops: { ...nextVehicles.stops, filter: nextFilter },
		} as MapLayerFeedContext;
		controller.feed(map, filtered, 1);

		expect(feeds.routes).toHaveBeenCalledTimes(1);
		expect(feeds.stops).toHaveBeenCalledTimes(2);
		expect(feeds.vehicles).toHaveBeenCalledTimes(3);
		expect(feeds['near-target']).toHaveBeenCalledTimes(1);

		controller.feed(map, filtered, 2);

		expect(feeds.routes).toHaveBeenCalledTimes(2);
		expect(feeds.stops).toHaveBeenCalledTimes(3);
		expect(feeds.vehicles).toHaveBeenCalledTimes(4);
		expect(feeds['near-target']).toHaveBeenCalledTimes(2);

		controller.feed({} as MapLibreMap, filtered, 2);

		expect(feeds.routes).toHaveBeenCalledTimes(3);
		expect(feeds.stops).toHaveBeenCalledTimes(4);
		expect(feeds.vehicles).toHaveBeenCalledTimes(5);
		expect(feeds['near-target']).toHaveBeenCalledTimes(3);
	});

	it('registers both bulk stop render modes and the low-zoom exception at stop priority', () => {
		expect(PICKABLE_MAP_LAYERS).toContain('stops-overview');
		expect(PICKABLE_MAP_LAYERS).toContain(STOP_EXCEPTION_LAYER);
		expect(PICKABLE_MAP_LAYERS.indexOf('stops-overview')).toBeLessThan(
			PICKABLE_MAP_LAYERS.indexOf('route-lines-hit'),
		);
	});
});
