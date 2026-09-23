import type { Map as MapLibreMap } from 'maplibre-gl';
import { STOPS_SOURCE } from '$lib/components/map';
import type { MapSelection } from './mapSelection';
import type { MapSelectionController } from './mapSelectionController.svelte';

export type MapEmphasisTarget =
	| { readonly kind: 'vehicle'; readonly id: string }
	| { readonly kind: 'stop'; readonly id: string };

type ReadonlySelectionController = Pick<MapSelectionController, 'hovered' | 'selected'>;

export interface MapEmphasisController {
	get hoveredTarget(): MapEmphasisTarget | null;
	get selectedTargets(): readonly MapEmphasisTarget[];
	apply(map: MapLibreMap): void;
	clear(map?: MapLibreMap): void;
	replay(map: MapLibreMap): void;
}

function emphasisTarget(selection: MapSelection | null): MapEmphasisTarget | null {
	return selection?.kind === 'vehicle' || selection?.kind === 'stop'
		? { kind: selection.kind, id: selection.id }
		: null;
}

function sameTarget(a: MapEmphasisTarget | null, b: MapEmphasisTarget | null): boolean {
	return a?.kind === b?.kind && a?.id === b?.id;
}

function setState(
	map: MapLibreMap,
	target: MapEmphasisTarget,
	property: 'hovered' | 'selected',
): void {
	// Vehicle emphasis is painted by the moving foreground, without a GL source.
	if (target.kind === 'stop') {
		map.setFeatureState({ source: STOPS_SOURCE, id: target.id }, { [property]: true });
	}
}

function removeState(
	map: MapLibreMap,
	target: MapEmphasisTarget,
	property: 'hovered' | 'selected',
): void {
	if (target.kind === 'stop')
		map.removeFeatureState({ source: STOPS_SOURCE, id: target.id }, property);
}

export function createMapEmphasisController(
	selection: ReadonlySelectionController,
): MapEmphasisController {
	let hoveredTarget = $state<MapEmphasisTarget | null>(null);
	let selectedTargets = $state<MapEmphasisTarget[]>([]);
	let activeMap: MapLibreMap | null = null;
	function clearMap(map: MapLibreMap): void {
		const errors: unknown[] = [];
		if (hoveredTarget) {
			try {
				removeState(map, hoveredTarget, 'hovered');
				hoveredTarget = null;
			} catch (error) {
				errors.push(error);
			}
		}
		const retainedSelected: MapEmphasisTarget[] = [];
		for (const target of selectedTargets) {
			try {
				removeState(map, target, 'selected');
			} catch (error) {
				errors.push(error);
				retainedSelected.push(target);
			}
		}
		selectedTargets = retainedSelected;
		if (errors.length === 1) throw errors[0];
		if (errors.length > 1) throw new AggregateError(errors, 'Map emphasis cleanup failed');
	}

	function apply(map: MapLibreMap): void {
		const nextHovered = emphasisTarget(selection.hovered);
		const selected = emphasisTarget(selection.selected);
		const nextSelected = selected ? [selected] : [];
		const mapChanged = activeMap != null && activeMap !== map;
		if (mapChanged && activeMap) clearMap(activeMap);

		if (!mapChanged && activeMap === map) {
			if (hoveredTarget && !sameTarget(hoveredTarget, nextHovered)) {
				removeState(map, hoveredTarget, 'hovered');
			}
			for (const target of selectedTargets) {
				if (!nextSelected.some((candidate) => sameTarget(candidate, target))) {
					removeState(map, target, 'selected');
				}
			}
		}

		const hoverChanged = mapChanged || !sameTarget(hoveredTarget, nextHovered);
		const selectedChanged =
			mapChanged ||
			selectedTargets.length !== nextSelected.length ||
			selectedTargets.some((target, index) => !sameTarget(target, nextSelected[index] ?? null));

		hoveredTarget = nextHovered;
		selectedTargets = nextSelected;
		activeMap = map;

		if (selectedChanged) {
			for (const target of selectedTargets) setState(map, target, 'selected');
		}
		if (hoverChanged && hoveredTarget) setState(map, hoveredTarget, 'hovered');
	}

	function clear(map: MapLibreMap | null = activeMap): void {
		if (!map) return;
		clearMap(map);
		if (map === activeMap && hoveredTarget == null && selectedTargets.length === 0) {
			activeMap = null;
		}
	}

	function replay(map: MapLibreMap): void {
		if (activeMap && activeMap !== map) clearMap(activeMap);
		activeMap = map;
		for (const target of selectedTargets) setState(map, target, 'selected');
		if (hoveredTarget) setState(map, hoveredTarget, 'hovered');
	}

	return {
		get hoveredTarget() {
			return hoveredTarget;
		},
		get selectedTargets() {
			return selectedTargets;
		},
		apply,
		clear,
		replay,
	};
}
