import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FilterState } from '$lib/filters';
import { minimalDarkStyle } from '$lib/components/map/basemap';
import { STOP_EXCEPTION_LAYER } from '$lib/components/map/stopsLayer';
import {
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
		const register = (target: Map<string, Set<Handler>>, type: string, handler: Handler) => {
			const handlers = target.get(type) ?? new Set<Handler>();
			handlers.add(handler);
			target.set(type, handlers);
		};
		const unregister = (target: Map<string, Set<Handler>>, type: string, handler: Handler) => {
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

		for (const dispose of disposers) dispose();

		expect(mapHandlers.get('click')?.size).toBe(0);
		expect(mapHandlers.get('mousemove')?.size).toBe(0);
		expect(canvasHandlers.get('mouseleave')?.size).toBe(0);
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

	it('registers the low-zoom stop exception as a sibling pick target', () => {
		expect(PICKABLE_MAP_LAYERS).toContain(STOP_EXCEPTION_LAYER);
	});
});
