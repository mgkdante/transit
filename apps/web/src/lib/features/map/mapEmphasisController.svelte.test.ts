import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import { STOP_EXCEPTION_SOURCE, STOPS_SOURCE, VEHICLE_SOURCE } from '$lib/components/map';
import { createMapEmphasisController } from './mapEmphasisController.svelte';
import { createMapSelectionController } from './mapSelectionController.svelte';

const stops = [
	{ id: 'stop-a', name: 'Stop A', code: '1001', lat: 45.5, lon: -73.6 },
	{ id: 'stop-b', name: 'Stop B', code: '1002', lat: 45.51, lon: -73.61 },
];

type FeatureState = Record<string, boolean>;

function mapHarness() {
	const states = new Map<string, FeatureState>();
	const setFeatureState = vi.fn(
		(target: { source: string; id: string | number }, patch: FeatureState) => {
			const key = `${target.source}:${String(target.id)}`;
			states.set(key, { ...states.get(key), ...patch });
		},
	);
	const removeFeatureState = vi.fn(
		(target: { source: string; id: string | number }, property?: string) => {
			const key = `${target.source}:${String(target.id)}`;
			if (property == null) {
				states.delete(key);
				return;
			}
			const next = { ...states.get(key) };
			delete next[property];
			if (Object.keys(next).length === 0) states.delete(key);
			else states.set(key, next);
		},
	);
	const setExceptionData = vi.fn();
	const map = {
		setFeatureState,
		removeFeatureState,
		getSource: (id: string) =>
			id === STOP_EXCEPTION_SOURCE ? { setData: setExceptionData } : undefined,
	} as unknown as MapLibreMap;
	return { map, states, setFeatureState, removeFeatureState, setExceptionData };
}

describe('map emphasis controller', () => {
	it('retires hover A before applying B and clears B on mouseleave', () => {
		const selection = createMapSelectionController();
		const emphasis = createMapEmphasisController(selection);
		const harness = mapHarness();

		selection.setHovered({ kind: 'vehicle', id: 'bus-a' });
		emphasis.apply(harness.map, stops);
		expect(harness.states.get(`${VEHICLE_SOURCE}:bus-a`)).toEqual({ hovered: true });
		harness.setFeatureState.mockClear();
		harness.removeFeatureState.mockClear();

		selection.setHovered({ kind: 'vehicle', id: 'bus-b' });
		emphasis.apply(harness.map, stops);
		expect(harness.removeFeatureState).toHaveBeenCalledExactlyOnceWith(
			{ source: VEHICLE_SOURCE, id: 'bus-a' },
			'hovered',
		);
		expect(harness.setFeatureState).toHaveBeenCalledExactlyOnceWith(
			{ source: VEHICLE_SOURCE, id: 'bus-b' },
			{ hovered: true },
		);
		expect(harness.removeFeatureState.mock.invocationCallOrder[0]).toBeLessThan(
			harness.setFeatureState.mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY,
		);
		expect(harness.states.has(`${VEHICLE_SOURCE}:bus-a`)).toBe(false);
		expect(harness.states.get(`${VEHICLE_SOURCE}:bus-b`)).toEqual({ hovered: true });

		selection.setHovered(null);
		emphasis.apply(harness.map, stops);
		expect(harness.states.size).toBe(0);
		expect(emphasis.hoveredTarget).toBeNull();
	});

	it('keeps selected state when the same feature loses hover', () => {
		const selection = createMapSelectionController();
		const emphasis = createMapEmphasisController(selection);
		const harness = mapHarness();
		const target = { kind: 'vehicle', id: 'bus-a' } as const;

		selection.selectPicked(target);
		selection.setHovered(target);
		emphasis.apply(harness.map, stops);
		expect(harness.states.get(`${VEHICLE_SOURCE}:bus-a`)).toEqual({
			hovered: true,
			selected: true,
		});

		selection.setHovered(null);
		emphasis.apply(harness.map, stops);
		expect(harness.states.get(`${VEHICLE_SOURCE}:bus-a`)).toEqual({ selected: true });
		expect(emphasis.selectedTargets).toEqual([target]);
	});

	it('tracks close and LIFO back without widening the selection controller API', () => {
		const selection = createMapSelectionController();
		const emphasis = createMapEmphasisController(selection);
		const harness = mapHarness();

		selection.selectPicked({ kind: 'stop', id: 'stop-a' });
		selection.selectFromDetail({ kind: 'vehicle', id: 'bus-a' });
		emphasis.apply(harness.map, stops);
		expect(harness.states.get(`${VEHICLE_SOURCE}:bus-a`)).toEqual({ selected: true });

		selection.goBack();
		emphasis.apply(harness.map, stops);
		expect(harness.states.has(`${VEHICLE_SOURCE}:bus-a`)).toBe(false);
		expect(harness.states.get(`${STOPS_SOURCE}:stop-a`)).toEqual({ selected: true });

		selection.close();
		emphasis.apply(harness.map, stops);
		expect(harness.states.size).toBe(0);
	});

	it('clears the old map on identity swap and replays current state to the new map', () => {
		const selection = createMapSelectionController();
		const emphasis = createMapEmphasisController(selection);
		const first = mapHarness();
		const second = mapHarness();

		selection.selectPicked({ kind: 'stop', id: 'stop-a' });
		selection.setHovered({ kind: 'vehicle', id: 'bus-a' });
		emphasis.apply(first.map, stops);
		emphasis.apply(second.map, stops);

		expect(first.states.size).toBe(0);
		expect(
			(
				first.setExceptionData.mock.lastCall?.[0] as {
					features: unknown[];
				}
			).features,
		).toEqual([]);
		expect(second.states.get(`${STOPS_SOURCE}:stop-a`)).toEqual({ selected: true });
		expect(second.states.get(`${VEHICLE_SOURCE}:bus-a`)).toEqual({ hovered: true });
	});

	it('replays feature state after a style reinstall without changing owned targets', () => {
		const selection = createMapSelectionController();
		const emphasis = createMapEmphasisController(selection);
		const harness = mapHarness();

		selection.selectPicked({ kind: 'stop', id: 'stop-a' });
		selection.setHovered({ kind: 'vehicle', id: 'bus-a' });
		emphasis.apply(harness.map, stops);
		harness.states.clear();
		harness.setFeatureState.mockClear();

		emphasis.replay(harness.map);

		expect(harness.setFeatureState).toHaveBeenCalledTimes(2);
		expect(harness.states.get(`${STOPS_SOURCE}:stop-a`)).toEqual({ selected: true });
		expect(harness.states.get(`${VEHICLE_SOURCE}:bus-a`)).toEqual({ hovered: true });
		expect(emphasis.selectedTargets).toEqual([{ kind: 'stop', id: 'stop-a' }]);
		expect(emphasis.hoveredTarget).toEqual({ kind: 'vehicle', id: 'bus-a' });
	});

	it('retains only a pre-mutation failed feature-state receipt and clears it on retry', () => {
		const selection = createMapSelectionController();
		const emphasis = createMapEmphasisController(selection);
		const harness = mapHarness();

		selection.selectPicked({ kind: 'stop', id: 'stop-a' });
		selection.setHovered({ kind: 'vehicle', id: 'bus-a' });
		emphasis.apply(harness.map, stops);
		const clearError = new Error('feature-state clear failed before mutation');
		harness.removeFeatureState.mockImplementationOnce(() => {
			throw clearError;
		});

		expect(() => emphasis.clear()).toThrow(clearError);
		expect(harness.states.size).toBe(1);
		expect(emphasis.selectedTargets).toEqual([]);
		expect(emphasis.hoveredTarget).toEqual({ kind: 'vehicle', id: 'bus-a' });

		expect(() => emphasis.clear()).not.toThrow();
		expect(harness.states.size).toBe(0);
		expect(emphasis.hoveredTarget).toBeNull();
	});

	it('keeps the low-zoom exception bounded for selected and hovered stops', () => {
		const selection = createMapSelectionController();
		const emphasis = createMapEmphasisController(selection);
		const harness = mapHarness();

		selection.selectPicked({ kind: 'stop', id: 'stop-a' });
		selection.setHovered({ kind: 'stop', id: 'stop-b' });
		emphasis.apply(harness.map, stops);

		const collection = harness.setExceptionData.mock.calls.at(-1)?.[0] as {
			features: Array<{ properties: { id: string } }>;
		};
		expect(collection.features.map((feature) => feature.properties.id)).toEqual([
			'stop-a',
			'stop-b',
		]);
		expect(collection.features).toHaveLength(2);
	});

	it('ignores route hover and selection because routes remain data-driven', () => {
		const selection = createMapSelectionController();
		const emphasis = createMapEmphasisController(selection);
		const harness = mapHarness();

		selection.selectPicked({ kind: 'route', id: '24' });
		selection.setHovered({ kind: 'route', id: '24', direction: 1 });
		emphasis.apply(harness.map, stops);

		expect(harness.setFeatureState).not.toHaveBeenCalled();
		expect(emphasis.selectedTargets).toEqual([]);
		expect(emphasis.hoveredTarget).toBeNull();
	});

	it('indexes the stop catalogue once and skips exception writes for vehicle-only retargets', () => {
		let idReads = 0;
		const indexedStops = stops.map((stop) => ({
			...stop,
			get id() {
				idReads += 1;
				return stop.id;
			},
		}));
		const selection = createMapSelectionController();
		const emphasis = createMapEmphasisController(selection);
		const harness = mapHarness();

		selection.setHovered({ kind: 'vehicle', id: 'bus-a' });
		emphasis.apply(harness.map, indexedStops);
		const readsAfterFirstApply = idReads;
		const writesAfterFirstApply = harness.setExceptionData.mock.calls.length;

		selection.setHovered({ kind: 'vehicle', id: 'bus-b' });
		emphasis.apply(harness.map, indexedStops);

		expect(idReads).toBe(readsAfterFirstApply);
		expect(harness.setExceptionData).toHaveBeenCalledTimes(writesAfterFirstApply);
	});
});
