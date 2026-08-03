import type { Map as MapLibreMap } from 'maplibre-gl';
import type { SlimStopEntry } from '$lib/v1';
import { setStopException, STOPS_SOURCE, VEHICLE_SOURCE } from '$lib/components/map';
import type { MapSelection } from './mapSelection';
import type { MapSelectionController } from './mapSelectionController.svelte';

export type MapEmphasisTarget =
	| { readonly kind: 'vehicle'; readonly id: string }
	| { readonly kind: 'stop'; readonly id: string };

type ReadonlySelectionController = Pick<MapSelectionController, 'hovered' | 'selected'>;

export interface MapEmphasisController {
	get hoveredTarget(): MapEmphasisTarget | null;
	get selectedTargets(): readonly MapEmphasisTarget[];
	apply(map: MapLibreMap, stops: readonly SlimStopEntry[]): void;
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

function sourceFor(target: MapEmphasisTarget): string {
	return target.kind === 'vehicle' ? VEHICLE_SOURCE : STOPS_SOURCE;
}

function setState(
	map: MapLibreMap,
	target: MapEmphasisTarget,
	property: 'hovered' | 'selected',
): void {
	map.setFeatureState({ source: sourceFor(target), id: target.id }, { [property]: true });
}

function removeState(
	map: MapLibreMap,
	target: MapEmphasisTarget,
	property: 'hovered' | 'selected',
): void {
	map.removeFeatureState({ source: sourceFor(target), id: target.id }, property);
}

export function createMapEmphasisController(
	selection: ReadonlySelectionController,
): MapEmphasisController {
	let hoveredTarget = $state<MapEmphasisTarget | null>(null);
	let selectedTargets = $state<MapEmphasisTarget[]>([]);
	let activeMap: MapLibreMap | null = null;
	let stopEntries: readonly SlimStopEntry[] = [];
	let stopsById: Readonly<Record<string, SlimStopEntry>> = {};
	let exceptionMap: MapLibreMap | null = null;
	let exceptionSelectedStopId: string | null = null;
	let exceptionHoveredStopId: string | null = null;

	function updateStopIndex(stops: readonly SlimStopEntry[]): boolean {
		if (stops === stopEntries) return false;
		stopEntries = stops;
		stopsById = Object.fromEntries(stops.map((stop) => [stop.id, stop]));
		return true;
	}

	function syncStopException(map: MapLibreMap, force = false): void {
		const selectedStopId = selectedTargets.find((target) => target.kind === 'stop')?.id ?? null;
		const hoveredStopId = hoveredTarget?.kind === 'stop' ? hoveredTarget.id : null;
		if (
			!force &&
			exceptionMap === map &&
			exceptionSelectedStopId === selectedStopId &&
			exceptionHoveredStopId === hoveredStopId
		) {
			return;
		}
		setStopException(map, stopsById, selectedStopId, hoveredStopId);
		exceptionMap = map;
		exceptionSelectedStopId = selectedStopId;
		exceptionHoveredStopId = hoveredStopId;
	}

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
		if (
			exceptionMap === map &&
			(exceptionSelectedStopId != null || exceptionHoveredStopId != null)
		) {
			try {
				setStopException(map, stopsById, null, null);
				exceptionSelectedStopId = null;
				exceptionHoveredStopId = null;
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length === 1) throw errors[0];
		if (errors.length > 1) throw new AggregateError(errors, 'Map emphasis cleanup failed');
	}

	function apply(map: MapLibreMap, stops: readonly SlimStopEntry[]): void {
		const nextHovered = emphasisTarget(selection.hovered);
		const selected = emphasisTarget(selection.selected);
		const nextSelected = selected ? [selected] : [];
		const mapChanged = activeMap != null && activeMap !== map;
		const stopsChanged = updateStopIndex(stops);

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

		syncStopException(map, mapChanged || stopsChanged);
	}

	function clear(map: MapLibreMap | null = activeMap): void {
		if (!map) return;
		clearMap(map);
		if (
			map === activeMap &&
			hoveredTarget == null &&
			selectedTargets.length === 0 &&
			exceptionSelectedStopId == null &&
			exceptionHoveredStopId == null
		) {
			activeMap = null;
			exceptionMap = null;
		}
	}

	function replay(map: MapLibreMap): void {
		if (activeMap && activeMap !== map) clearMap(activeMap);
		activeMap = map;
		for (const target of selectedTargets) setState(map, target, 'selected');
		if (hoveredTarget) setState(map, hoveredTarget, 'hovered');
		syncStopException(map, true);
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
