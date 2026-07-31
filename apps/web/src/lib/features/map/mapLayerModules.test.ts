import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import { minimalDarkStyle } from '$lib/components/map/basemap';
import { firstSymbolLayerId, installMapInteractions } from './mapLayerModules';

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
