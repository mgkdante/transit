import { describe, expect, it, vi, type Mock } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { createMapDisposalBarrier } from './mapDisposalBarrier';

describe('createMapDisposalBarrier', () => {
	it('keeps captured proxy access inert with safe fallbacks after disposal', () => {
		const canvas = document.createElement('canvas');
		const container = document.createElement('div');
		const source = { type: 'geojson', setData: vi.fn() };
		const unsubscribe = vi.fn();
		const receipt = { unsubscribe };
		const raw = {
			removeFeatureState: vi.fn(),
			getSource: vi.fn(() => source),
			getLayer: vi.fn(() => ({ id: 'vehicles' })),
			getStyle: vi.fn(() => ({ version: 8 })),
			queryRenderedFeatures: vi.fn(() => [{ id: 1 }]),
			querySourceFeatures: vi.fn(() => [{ id: 2 }]),
			hasImage: vi.fn(() => true),
			loaded: vi.fn(() => true),
			isStyleLoaded: vi.fn(() => true),
			areTilesLoaded: vi.fn(() => true),
			isMoving: vi.fn(() => true),
			isZooming: vi.fn(() => true),
			isRotating: vi.fn(() => true),
			listImages: vi.fn(() => ['vehicle']),
			getZoom: vi.fn(() => 12),
			getBearing: vi.fn(() => 21),
			getPitch: vi.fn(() => 34),
			getMinZoom: vi.fn(() => 3),
			getMaxZoom: vi.fn(() => 18),
			getCanvas: vi.fn(() => canvas),
			getCanvasContainer: vi.fn(() => container),
			getContainer: vi.fn(() => container),
			on: vi.fn((_type: string, _handler: (...args: unknown[]) => void) => receipt),
			off: vi.fn(),
			setStyle: vi.fn(),
			fluent: vi.fn(),
		};
		raw.fluent.mockImplementation(() => raw);
		const barrier = createMapDisposalBarrier(raw as unknown as MapLibreMap);
		const proxy = barrier.map;
		const capturedRemoveFeatureState = proxy.removeFeatureState;
		const capturedGetSource = proxy.getSource;
		const guardedSource = proxy.getSource('vehicles') as unknown as {
			setData(data: unknown): void;
		};
		const capturedSetData = guardedSource.setData;
		let callbackThis: unknown;
		let callbackTarget: unknown;
		const handler = vi.fn(function (this: unknown, event: { target: unknown }) {
			callbackThis = this;
			callbackTarget = event.target;
		});

		expect(guardedSource).not.toBe(source);
		expect(proxy.getSource('vehicles')).toBe(guardedSource);
		expect(proxy.getZoom()).toBe(12);
		expect(proxy.getCanvas()).toBe(canvas);
		expect((proxy as unknown as { fluent(): MapLibreMap }).fluent()).toBe(proxy);
		expect(raw.fluent.mock.contexts[0]).toBe(raw);
		const guardedReceipt = proxy.on('load', handler);
		expect(guardedReceipt).not.toBe(receipt);
		const wrappedHandler = raw.on.mock.calls[0]?.[1] as unknown as (
			this: unknown,
			event: { target: unknown },
		) => void;
		wrappedHandler.call(raw, { target: raw });
		expect(callbackThis).toBe(proxy);
		expect(callbackTarget).toBe(proxy);
		proxy.off('load', handler);
		expect(raw.off).toHaveBeenCalledExactlyOnceWith('load', wrappedHandler);
		barrier.dispose();
		barrier.dispose();

		expect(barrier.disposed).toBe(true);
		expect(() => capturedRemoveFeatureState({ source: 'vehicles' })).not.toThrow();
		expect(() => proxy.removeFeatureState({ source: 'vehicles' })).not.toThrow();
		expect(() => capturedSetData({ type: 'FeatureCollection', features: [] })).not.toThrow();
		expect(() => guardedSource.setData({ type: 'FeatureCollection', features: [] })).not.toThrow();
		expect(capturedGetSource('vehicles')).toBeUndefined();
		expect(proxy.getLayer('vehicles')).toBeUndefined();
		expect(proxy.getStyle()).toBeUndefined();
		expect(proxy.queryRenderedFeatures()).toEqual([]);
		expect(proxy.querySourceFeatures('vehicles')).toEqual([]);
		expect(proxy.hasImage('vehicle')).toBe(false);
		expect(proxy.loaded()).toBe(false);
		expect(proxy.isStyleLoaded()).toBe(false);
		expect(proxy.areTilesLoaded()).toBe(false);
		expect(proxy.isMoving()).toBe(false);
		expect(proxy.isZooming()).toBe(false);
		expect(proxy.isRotating()).toBe(false);
		expect(proxy.listImages()).toEqual([]);
		expect(proxy.getZoom()).toBe(12);
		expect(proxy.getBearing()).toBe(0);
		expect(proxy.getPitch()).toBe(0);
		expect(proxy.getMinZoom()).toBe(0);
		expect(proxy.getMaxZoom()).toBe(0);
		expect(proxy.getCanvas()).toBe(canvas);
		expect(proxy.getCanvas().style).toBeDefined();
		expect(proxy.getCanvasContainer()).toBeUndefined();
		expect(proxy.getContainer()).toBeUndefined();
		expect(() => guardedReceipt.unsubscribe()).not.toThrow();
		expect(proxy.on('late', vi.fn()).unsubscribe()).toBeUndefined();
		expect(() => {
			(proxy as unknown as { lateValue: number }).lateValue = 1;
		}).not.toThrow();
		expect((proxy as unknown as { fluent(): MapLibreMap }).fluent()).toBeUndefined();

		expect(raw.removeFeatureState).not.toHaveBeenCalled();
		expect(source.setData).not.toHaveBeenCalled();
		expect(raw.getSource).toHaveBeenCalledTimes(2);
		expect(raw.getLayer).not.toHaveBeenCalled();
		expect(raw.getStyle).not.toHaveBeenCalled();
		expect(raw.queryRenderedFeatures).not.toHaveBeenCalled();
		expect(raw.querySourceFeatures).not.toHaveBeenCalled();
		expect(raw.hasImage).not.toHaveBeenCalled();
		expect(raw.loaded).not.toHaveBeenCalled();
		expect(raw.isStyleLoaded).not.toHaveBeenCalled();
		expect(raw.areTilesLoaded).not.toHaveBeenCalled();
		expect(raw.isMoving).not.toHaveBeenCalled();
		expect(raw.isZooming).not.toHaveBeenCalled();
		expect(raw.isRotating).not.toHaveBeenCalled();
		expect(raw.listImages).not.toHaveBeenCalled();
		expect(raw.getZoom).toHaveBeenCalledTimes(1);
		expect(raw.getBearing).not.toHaveBeenCalled();
		expect(raw.getPitch).not.toHaveBeenCalled();
		expect(raw.getMinZoom).not.toHaveBeenCalled();
		expect(raw.getMaxZoom).not.toHaveBeenCalled();
		expect(raw.getCanvas).toHaveBeenCalledTimes(1);
		expect(raw.getCanvasContainer).not.toHaveBeenCalled();
		expect(raw.getContainer).not.toHaveBeenCalled();
		expect(raw.on).toHaveBeenCalledTimes(1);
		expect(unsubscribe).not.toHaveBeenCalled();
		expect(raw.setStyle).not.toHaveBeenCalled();
		expect(raw.fluent).toHaveBeenCalledTimes(1);
	});

	it('keeps captured public interaction handlers inert after disposal', () => {
		const handlerNames = [
			'dragPan',
			'scrollZoom',
			'boxZoom',
			'dragRotate',
			'keyboard',
			'doubleClickZoom',
			'touchZoomRotate',
			'touchPitch',
			'cooperativeGestures',
		] as const;
		type HandlerName = (typeof handlerNames)[number];
		type Handler = { disable: Mock<() => void> };
		const rawHandlers = Object.fromEntries(
			handlerNames.map((name) => [name, { disable: vi.fn() }]),
		) as Record<HandlerName, Handler>;
		const barrier = createMapDisposalBarrier(rawHandlers as unknown as MapLibreMap);
		const proxyWithHandlers = barrier.map as unknown as Record<HandlerName, Handler>;
		const guardedHandlers = Object.fromEntries(
			handlerNames.map((name) => [name, proxyWithHandlers[name]]),
		) as Record<HandlerName, Handler>;
		const capturedDisable = guardedHandlers.dragPan.disable;

		for (const name of handlerNames) {
			expect(guardedHandlers[name]).not.toBe(rawHandlers[name]);
			expect(proxyWithHandlers[name]).toBe(guardedHandlers[name]);
		}
		barrier.dispose();

		expect(() => capturedDisable()).not.toThrow();
		for (const name of handlerNames) {
			expect(() => guardedHandlers[name].disable()).not.toThrow();
			expect(() => proxyWithHandlers[name].disable()).not.toThrow();
			expect(rawHandlers[name].disable).not.toHaveBeenCalled();
		}
	});

	it('guards a promise-form once event that resolves after disposal', async () => {
		let resolveEvent!: (event: { target: unknown }) => void;
		const eventPromise = new Promise<{ target: unknown }>((resolve) => {
			resolveEvent = resolve;
		});
		const raw = {
			once: vi.fn(),
			off: vi.fn(),
			removeFeatureState: vi.fn(),
		};
		raw.once.mockImplementation((_type: string, listener?: unknown) =>
			typeof listener === 'function' ? raw : eventPromise,
		);
		raw.off.mockImplementation(() => raw);
		const barrier = createMapDisposalBarrier(raw as unknown as MapLibreMap);
		const pending = barrier.map.once('idle') as unknown as Promise<{ target: MapLibreMap }>;
		expect(barrier.map.once('active', vi.fn())).toBe(barrier.map);
		barrier.dispose();
		resolveEvent({ target: raw });

		const event = await pending;
		expect(event.target).toBe(barrier.map);
		expect(() => event.target.removeFeatureState({ source: 'vehicles' })).not.toThrow();
		const latePromise = barrier.map.once('late') as unknown as Promise<unknown>;
		const lateHandler = vi.fn();
		const lateMap = barrier.map.once('late', lateHandler) as MapLibreMap;
		expect(latePromise).toBeInstanceOf(Promise);
		await expect(latePromise).resolves.toBeUndefined();
		expect(lateMap).toBe(barrier.map);
		expect(() => lateMap.off('late', lateHandler)).not.toThrow();
		expect(raw.removeFeatureState).not.toHaveBeenCalled();
		expect(raw.once).toHaveBeenCalledTimes(2);
		expect(raw.off).not.toHaveBeenCalled();
	});
});
