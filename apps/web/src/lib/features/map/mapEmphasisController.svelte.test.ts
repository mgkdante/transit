import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import { STOPS_SOURCE, VEHICLE_SOURCE } from '$lib/components/map';
import { createMapEmphasisController } from './mapEmphasisController.svelte';
import { createMapSelectionController } from './mapSelectionController.svelte';

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
	const map = {
		setFeatureState,
		removeFeatureState,
	} as unknown as MapLibreMap;
	return { map, states, setFeatureState, removeFeatureState };
}

describe('map emphasis controller', () => {
	it('tracks vehicle hover without writing a nonexistent GL vehicle source', () => {
		const selection = createMapSelectionController();
		const emphasis = createMapEmphasisController(selection);
		const harness = mapHarness();

		selection.setHovered({ kind: 'vehicle', id: 'bus-a' });
		emphasis.apply(harness.map);
		expect(emphasis.hoveredTarget).toEqual({ kind: 'vehicle', id: 'bus-a' });
		expect(harness.states.has(`${VEHICLE_SOURCE}:bus-a`)).toBe(false);
		harness.setFeatureState.mockClear();
		harness.removeFeatureState.mockClear();

		selection.setHovered({ kind: 'vehicle', id: 'bus-b' });
		emphasis.apply(harness.map);
		expect(emphasis.hoveredTarget).toEqual({ kind: 'vehicle', id: 'bus-b' });
		expect(harness.setFeatureState).not.toHaveBeenCalled();
		expect(harness.removeFeatureState).not.toHaveBeenCalled();

		selection.setHovered(null);
		emphasis.apply(harness.map);
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
		emphasis.apply(harness.map);
		expect(emphasis.hoveredTarget).toEqual(target);
		expect(emphasis.selectedTargets).toEqual([target]);

		selection.setHovered(null);
		emphasis.apply(harness.map);
		expect(harness.states.has(`${VEHICLE_SOURCE}:bus-a`)).toBe(false);
		expect(emphasis.hoveredTarget).toBeNull();
		expect(emphasis.selectedTargets).toEqual([target]);
	});

	it('tracks close and LIFO back without widening the selection controller API', () => {
		const selection = createMapSelectionController();
		const emphasis = createMapEmphasisController(selection);
		const harness = mapHarness();

		selection.selectPicked({ kind: 'stop', id: 'stop-a' });
		selection.selectFromDetail({ kind: 'vehicle', id: 'bus-a' });
		emphasis.apply(harness.map);
		expect(emphasis.selectedTargets).toEqual([{ kind: 'vehicle', id: 'bus-a' }]);
		expect(harness.states.has(`${VEHICLE_SOURCE}:bus-a`)).toBe(false);

		selection.goBack();
		emphasis.apply(harness.map);
		expect(harness.states.has(`${VEHICLE_SOURCE}:bus-a`)).toBe(false);
		expect(harness.states.get(`${STOPS_SOURCE}:stop-a`)).toEqual({ selected: true });

		selection.close();
		emphasis.apply(harness.map);
		expect(harness.states.size).toBe(0);
	});

	it('clears the old map on identity swap and replays current state to the new map', () => {
		const selection = createMapSelectionController();
		const emphasis = createMapEmphasisController(selection);
		const first = mapHarness();
		const second = mapHarness();

		selection.selectPicked({ kind: 'stop', id: 'stop-a' });
		selection.setHovered({ kind: 'vehicle', id: 'bus-a' });
		emphasis.apply(first.map);
		emphasis.apply(second.map);

		expect(first.states.size).toBe(0);
		expect(second.states.get(`${STOPS_SOURCE}:stop-a`)).toEqual({ selected: true });
		expect(second.states.has(`${VEHICLE_SOURCE}:bus-a`)).toBe(false);
		expect(emphasis.hoveredTarget).toEqual({ kind: 'vehicle', id: 'bus-a' });
	});

	it('replays feature state after a style reinstall without changing owned targets', () => {
		const selection = createMapSelectionController();
		const emphasis = createMapEmphasisController(selection);
		const harness = mapHarness();

		selection.selectPicked({ kind: 'stop', id: 'stop-a' });
		selection.setHovered({ kind: 'vehicle', id: 'bus-a' });
		emphasis.apply(harness.map);
		harness.states.clear();
		harness.setFeatureState.mockClear();

		emphasis.replay(harness.map);

		expect(harness.setFeatureState).toHaveBeenCalledTimes(1);
		expect(harness.states.get(`${STOPS_SOURCE}:stop-a`)).toEqual({ selected: true });
		expect(harness.states.has(`${VEHICLE_SOURCE}:bus-a`)).toBe(false);
		expect(emphasis.selectedTargets).toEqual([{ kind: 'stop', id: 'stop-a' }]);
		expect(emphasis.hoveredTarget).toEqual({ kind: 'vehicle', id: 'bus-a' });
	});

	it('retains only a pre-mutation failed feature-state receipt and clears it on retry', () => {
		const selection = createMapSelectionController();
		const emphasis = createMapEmphasisController(selection);
		const harness = mapHarness();

		selection.selectPicked({ kind: 'stop', id: 'stop-a' });
		selection.setHovered({ kind: 'vehicle', id: 'bus-a' });
		emphasis.apply(harness.map);
		const clearError = new Error('feature-state clear failed before mutation');
		harness.removeFeatureState.mockImplementationOnce(() => {
			throw clearError;
		});

		expect(() => emphasis.clear()).toThrow(clearError);
		expect(harness.states.size).toBe(1);
		expect(emphasis.selectedTargets).toEqual([{ kind: 'stop', id: 'stop-a' }]);
		expect(emphasis.hoveredTarget).toBeNull();

		expect(() => emphasis.clear()).not.toThrow();
		expect(harness.states.size).toBe(0);
		expect(emphasis.hoveredTarget).toBeNull();
	});

	it('keeps normal selected and hovered stop feature states independent', () => {
		const selection = createMapSelectionController();
		const emphasis = createMapEmphasisController(selection);
		const harness = mapHarness();

		selection.selectPicked({ kind: 'stop', id: 'stop-a' });
		selection.setHovered({ kind: 'stop', id: 'stop-b' });
		emphasis.apply(harness.map);
		expect(harness.states.get(`${STOPS_SOURCE}:stop-a`)).toEqual({ selected: true });
		expect(harness.states.get(`${STOPS_SOURCE}:stop-b`)).toEqual({ hovered: true });
		selection.setHovered(null);
		emphasis.apply(harness.map);
		expect(harness.states.get(`${STOPS_SOURCE}:stop-a`)).toEqual({ selected: true });
		expect(harness.states.has(`${STOPS_SOURCE}:stop-b`)).toBe(false);
	});

	it('ignores route hover and selection because routes remain data-driven', () => {
		const selection = createMapSelectionController();
		const emphasis = createMapEmphasisController(selection);
		const harness = mapHarness();

		selection.selectPicked({ kind: 'route', id: '24' });
		selection.setHovered({ kind: 'route', id: '24', direction: 1 });
		emphasis.apply(harness.map);

		expect(harness.setFeatureState).not.toHaveBeenCalled();
		expect(emphasis.selectedTargets).toEqual([]);
		expect(emphasis.hoveredTarget).toBeNull();
	});
});
