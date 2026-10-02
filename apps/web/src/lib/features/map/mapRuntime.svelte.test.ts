import { tick } from 'svelte';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyFilterState } from '$lib/filters';
import { createMapRuntime, type MapRuntimeFeed } from './mapRuntime.svelte';
import { createMapSelectionController } from './mapSelectionController.svelte';

const rendering = vi.hoisted(() => ({
	retint: vi.fn(),
	feed: vi.fn(),
	createMotion: vi.fn(),
	createOverlay: vi.fn(),
}));

vi.mock('$lib/components/map', async () => ({
	...(await vi.importActual<typeof import('$lib/components/map')>('$lib/components/map')),
	createVehicleMotionController: rendering.createMotion,
	createVehicleOverlay: rendering.createOverlay,
}));

vi.mock('./mapLayerModules', async () => ({
	...(await vi.importActual<typeof import('./mapLayerModules')>('./mapLayerModules')),
	retintMapLayers: rendering.retint,
	createMapLayerFeedController: () => ({ feed: rendering.feed }),
}));

type Handler = (event: MapMouseEvent) => void;

function mapHarness() {
	const canvas = document.createElement('canvas');
	const handlers = new Map<string, Set<Handler>>();
	const on = vi.fn((type: string, handler: Handler) => {
		const current = handlers.get(type) ?? new Set<Handler>();
		current.add(handler);
		handlers.set(type, current);
	});
	const off = vi.fn((type: string, handler: Handler) => handlers.get(type)?.delete(handler));
	let styleLoaded = false;
	const removeCanvasListener = vi.spyOn(canvas, 'removeEventListener');
	return {
		map: {
			on,
			off,
			getCanvas: () => canvas,
			isStyleLoaded: () => styleLoaded,
			getSource: () => undefined,
			setFeatureState: vi.fn(),
			removeFeatureState: vi.fn(),
		} as unknown as MapLibreMap,
		on,
		off,
		handlers,
		removeCanvasListener,
		setStyleLoaded(value: boolean) {
			styleLoaded = value;
		},
	};
}

const cleanups: Array<() => void> = [];

function runtimeHarness() {
	let runtime: ReturnType<typeof createMapRuntime>;
	const selection = createMapSelectionController();
	const feed: MapRuntimeFeed = {
		routes: { items: [], selected: null },
		vehicles: {
			items: [],
			filter: emptyFilterState(),
			alertIds: new Set<string>(),
			selectedId: null,
			serverNow: 0,
			ttlS: 90,
			tickKey: 'generation-a',
			stale: false,
			fixFor: () => null,
			shapeFor: undefined,
			serverNowFn: () => 0,
			animate: false,
		},
		stops: { items: [], filter: emptyFilterState(), alertIds: new Set<string>(), selectedId: null },
		nearTarget: { target: null },
	};
	const dispose = $effect.root(() => {
		runtime = createMapRuntime({ selection, readFeed: () => feed, onpick: vi.fn() });
	});
	cleanups.push(dispose);
	return { runtime: runtime!, dispose };
}

beforeEach(() => {
	rendering.createMotion.mockImplementation(() => ({ set: vi.fn(), destroy: vi.fn() }));
	rendering.createOverlay.mockImplementation((...args: unknown[]) => {
		const onPaint = args[3] as (receipt: {
			drawSequence: number;
			drawable: boolean;
			projectedCount: number;
		}) => void;
		const receipt = { drawSequence: 0, drawable: false, projectedCount: 0 };
		return {
			receipt,
			draw: vi.fn((features: { features: unknown[] }) => {
				receipt.drawSequence += 1;
				receipt.drawable = true;
				receipt.projectedCount = features.features.length;
				onPaint(receipt);
			}),
			redraw: vi.fn(),
			setScene: vi.fn(() => false),
			setSprites: vi.fn(),
			pick: vi.fn(() => null),
			hold: vi.fn(),
			resume: vi.fn(),
			destroy: vi.fn(),
		};
	});
	rendering.retint.mockImplementation(() => ({ sprites: {}, pin: {} }));
});

afterEach(() => {
	for (const dispose of cleanups.splice(0)) dispose();
	vi.restoreAllMocks();
	vi.resetAllMocks();
});

describe('map runtime ownership', () => {
	it('reinstalls static layers and the foreground after MapLibre internally restores its style', () => {
		const { runtime } = runtimeHarness();
		const target = mapHarness();
		runtime.ready(target.map);
		const foreground = rendering.createOverlay.mock.results[0].value;
		expect(rendering.retint).toHaveBeenCalledTimes(1);
		target.handlers.get('webglcontextrestored')?.forEach((handler) => handler({} as MapMouseEvent));
		expect(rendering.retint).toHaveBeenCalledTimes(1);
		target.handlers.get('style.load')?.forEach((handler) => handler({} as MapMouseEvent));
		expect(rendering.retint).toHaveBeenCalledTimes(2);
		expect(rendering.createMotion).toHaveBeenCalledOnce();
		expect(foreground.resume).toHaveBeenCalledOnce();
		expect(rendering.feed).toHaveBeenCalledTimes(2);
		target.setStyleLoaded(true);
		target.handlers.get('webglcontextrestored')?.forEach((handler) => handler({} as MapMouseEvent));
		expect(rendering.retint).toHaveBeenCalledTimes(3);
		runtime.release(target.map);
		expect(target.handlers.get('webglcontextrestored')?.size).toBe(0);
		expect(target.handlers.get('style.load')?.size).toBe(0);
	});

	it('reports a failed internal restore to the stage after only one style-load event', () => {
		const { runtime } = runtimeHarness();
		const target = mapHarness();
		const reportSetupFailure = vi.fn();
		runtime.ready(target.map, reportSetupFailure);
		const foreground = rendering.createOverlay.mock.results[0].value;
		const failure = new Error('sprite retint failed');
		rendering.retint.mockImplementationOnce(() => {
			throw failure;
		});
		const report = vi.spyOn(console, 'error').mockImplementation(() => {});
		target.handlers.get('webglcontextrestored')?.forEach((handler) => handler({} as MapMouseEvent));
		target.handlers.get('style.load')?.forEach((handler) => handler({} as MapMouseEvent));
		expect(report).toHaveBeenCalledWith('Map context restoration failed', failure);
		expect(foreground.hold).toHaveBeenCalled();
		expect(foreground.resume).not.toHaveBeenCalled();
		expect(rendering.feed).toHaveBeenCalledTimes(1);
		expect(reportSetupFailure).toHaveBeenCalledOnce();
		runtime.release(target.map);
	});

	it('publishes the first projected frame synchronously before ready returns', () => {
		const { runtime } = runtimeHarness();
		const target = mapHarness();
		const projected = { type: 'FeatureCollection', features: [] };
		rendering.createMotion.mockImplementation((...args: unknown[]) => {
			const publish = args[2] as (value: typeof projected) => void;
			return { set: vi.fn(() => publish(projected)), destroy: vi.fn() };
		});
		rendering.feed.mockImplementation((...args: unknown[]) => {
			const context = args[1] as { vehicles: { motion: { set: () => void } } };
			context.vehicles.motion.set();
		});
		runtime.ready(target.map);
		const overlay = rendering.createOverlay.mock.results[0].value;
		expect(overlay.draw).toHaveBeenCalledExactlyOnceWith(projected);
		expect(runtime.processedMotion).toEqual({ tickKey: 'generation-a', vehicleCount: 0 });
	});

	it('replaces a map and ignores stale style, repaint and release callbacks from its predecessor', async () => {
		const { runtime } = runtimeHarness();
		const first = mapHarness();
		const second = mapHarness();
		runtime.ready(first.map);
		await tick();
		const firstMotion = rendering.createMotion.mock.results[0].value;

		runtime.ready(second.map);
		await tick();
		expect(firstMotion.destroy).toHaveBeenCalledOnce();
		expect(first.handlers.get('click')?.size).toBe(0);
		expect(first.handlers.get('mousemove')?.size).toBe(0);
		expect(first.removeCanvasListener).toHaveBeenCalledOnce();
		expect(runtime.map).toBe(second.map);
		expect(rendering.createMotion).toHaveBeenCalledTimes(2);
		const secondMotion = rendering.createMotion.mock.results[1].value;
		rendering.retint.mockClear();
		rendering.feed.mockClear();

		runtime.styleLoad(first.map);
		runtime.repaint(first.map);
		runtime.release(first.map);
		await tick();
		expect(runtime.map).toBe(second.map);
		expect(rendering.retint).not.toHaveBeenCalled();
		expect(rendering.feed).not.toHaveBeenCalled();
		expect(secondMotion.destroy).not.toHaveBeenCalled();
		expect(second.handlers.get('click')?.size).toBe(1);
		expect(second.handlers.get('mousemove')?.size).toBe(1);
	});

	it('retains failed registration rollbacks until owner destruction can release them', async () => {
		const { runtime, dispose } = runtimeHarness();
		const target = mapHarness();
		const registrationError = new Error('mousemove registration failed after mutation');
		const rollbackError = new Error('mousemove rollback failed before mutation');
		const register = target.on.getMockImplementation()!;
		target.on.mockImplementation((type, handler) => {
			register(type, handler);
			if (type === 'mousemove') throw registrationError;
		});
		target.off.mockImplementationOnce(() => {
			throw rollbackError;
		});

		expect(() => runtime.ready(target.map)).toThrow(AggregateError);
		expect(target.handlers.get('click')?.size).toBe(0);
		expect(target.handlers.get('mousemove')?.size).toBe(1);
		await tick();
		dispose();
		expect(target.handlers.get('mousemove')?.size).toBe(0);
		expect(rendering.createMotion.mock.results[0].value.destroy).toHaveBeenCalledOnce();
		expect(runtime.map).toBeNull();
	});

	it('keeps a failed owner reachable and defers replacement until its motion can be released', async () => {
		const { runtime } = runtimeHarness();
		const first = mapHarness();
		const second = mapHarness();
		runtime.ready(first.map);
		await tick();
		const motion = rendering.createMotion.mock.results[0].value;
		const cleanupError = new Error('motion remains owned');
		motion.destroy.mockImplementationOnce(() => {
			throw cleanupError;
		});
		motion.destroy.mockImplementationOnce(() => {
			throw cleanupError;
		});

		expect(() => runtime.ready(second.map)).toThrow(AggregateError);
		expect(runtime.map).toBe(first.map);
		expect(second.on).not.toHaveBeenCalled();
		expect(rendering.createMotion).toHaveBeenCalledOnce();

		runtime.ready(second.map);
		await tick();
		expect(runtime.map).toBe(second.map);
		expect(motion.destroy).toHaveBeenCalledTimes(3);
		expect(rendering.createMotion).toHaveBeenCalledTimes(2);
		expect(second.handlers.get('click')?.size).toBe(1);
		expect(second.handlers.get('mousemove')?.size).toBe(1);
	});

	it('keeps a failed foreground disposal reachable until a later replacement retries it', () => {
		const { runtime } = runtimeHarness();
		const first = mapHarness();
		const second = mapHarness();
		runtime.ready(first.map);
		const overlay = rendering.createOverlay.mock.results[0].value;
		const failure = new Error('foreground detach failed');
		overlay.destroy.mockImplementationOnce(() => {
			throw failure;
		});
		expect(() => runtime.ready(second.map)).toThrow(failure);
		expect(runtime.map).toBe(first.map);
		expect(second.on).not.toHaveBeenCalled();
		runtime.ready(second.map);
		expect(overlay.destroy).toHaveBeenCalledTimes(2);
		expect(runtime.map).toBe(second.map);
	});
});
