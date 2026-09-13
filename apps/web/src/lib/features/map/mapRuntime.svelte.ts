import { untrack } from 'svelte';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { createVehicleMotionController, type VehicleMotionController } from '$lib/components/map';
import { createMapEmphasisController } from './mapEmphasisController.svelte';
import {
	createMapLayerFeedController,
	installMapInteractions,
	PICKABLE_MAP_LAYERS,
	retintMapLayers,
	type MapLayerFeedContext,
} from './mapLayerModules';
import * as ownerCleanup from './mapOwnerCleanup';
import { pickMapSelection } from './mapPicking';
import type { MapSelection } from './mapSelection';
import type { MapSelectionController } from './mapSelectionController.svelte';

export type MapRuntimeFeed = Omit<MapLayerFeedContext, 'vehicles'> & {
	readonly vehicles: Omit<MapLayerFeedContext['vehicles'], 'motion'>;
};

/** Owns the custom layers for one mounted map; create inside the Svelte owner. */
export function createMapRuntime(options: {
	selection: Pick<MapSelectionController, 'selected' | 'hovered' | 'setHovered'>;
	readFeed: () => MapRuntimeFeed;
	onpick: (selection: MapSelection) => void;
}) {
	let map = $state.raw<MapLibreMap | null>(null);
	let vehicleMotion = $state<VehicleMotionController | null>(null);
	let processedMotion = $state<{ tickKey: string; vehicleCount: number } | null>(null);
	let layerRevision = $state(0);
	let vehicleMotionMap: MapLibreMap | null = null;
	let interactionsMap: MapLibreMap | null = null;
	let interactionDisposers: readonly (() => void)[] = [];
	const emphasis = createMapEmphasisController(options.selection);
	const layers = createMapLayerFeedController();
	const stops = $derived(options.readFeed().stops.items);

	function release(m: MapLibreMap): void {
		if (map !== m) return;
		const released = ownerCleanup.releaseMapOwnerReceipts(vehicleMotion, interactionDisposers, () =>
			emphasis.clear(m),
		);
		vehicleMotion = released.motion;
		vehicleMotionMap = released.motion ? m : null;
		interactionDisposers = released.disposers;
		interactionsMap = released.disposers.length > 0 ? m : null;
		map = released.motion || released.disposers.length > 0 || released.emphasisPending ? m : null;
		ownerCleanup.throwCleanupErrors(released.errors, 'Map runtime owner cleanup failed');
	}

	$effect(() => () => {
		const ownedMap = untrack(() => map);
		if (!ownedMap) return;
		try {
			release(ownedMap);
		} catch (error) {
			// Parent-first destruction and receipts still pending after MapStage's cleanup.
			ownerCleanup.reportCleanupFailure('Map runtime cleanup failed', error);
		}
	});

	function pick(m: MapLibreMap, event: MapMouseEvent): MapSelection | null {
		const pickable = PICKABLE_MAP_LAYERS.filter((layer) => m.getLayer(layer));
		return pickable.length > 0
			? pickMapSelection(m.queryRenderedFeatures(event.point, { layers: pickable }))
			: null;
	}

	function ensureInteractions(m: MapLibreMap): void {
		if (interactionsMap === m) return;
		const previousMap = interactionsMap;
		const released = ownerCleanup.releaseCleanupReceipts(interactionDisposers);
		interactionDisposers = released.pending;
		interactionsMap = released.pending.length > 0 ? previousMap : null;
		ownerCleanup.throwCleanupErrors(released.errors, 'Map interaction replacement cleanup failed');
		interactionDisposers = ownerCleanup.installCleanupReceipts(
			() =>
				installMapInteractions(m, {
					click: (event) => {
						const next = pick(m, event);
						if (next) options.onpick(next);
					},
					mousemove: (event) => {
						const next = pick(m, event);
						if (options.selection.setHovered(next)) {
							m.getCanvas().style.cursor = next ? 'pointer' : '';
						}
					},
					mouseleave: () => {
						options.selection.setHovered(null);
						m.getCanvas().style.cursor = '';
					},
				}),
			(partial) => {
				interactionDisposers = partial;
				interactionsMap = null;
			},
		);
		interactionsMap = m;
	}

	function install(m: MapLibreMap): void {
		// Prepares all shared sprites before installing layers, retaining append order.
		retintMapLayers(m);
		if (vehicleMotionMap !== m) {
			vehicleMotion?.destroy();
			vehicleMotion = createVehicleMotionController(m);
			vehicleMotionMap = m;
		}
		ensureInteractions(m);
		// A style swap clears custom sources; force their feed before emphasis replay.
		layerRevision += 1;
	}

	$effect(() => {
		const m = map;
		const revision = layerRevision;
		if (!m) {
			processedMotion = null;
			return;
		}
		const feed = options.readFeed();
		layers.feed(m, { ...feed, vehicles: { ...feed.vehicles, motion: vehicleMotion } }, revision);
		// Publish only after every synchronous source upload has completed.
		processedMotion = feed.vehicles.tickKey
			? { tickKey: feed.vehicles.tickKey, vehicleCount: feed.vehicles.items.length }
			: null;
	});

	$effect(() => {
		const m = map;
		const entries = stops;
		void options.selection.selected;
		void options.selection.hovered;
		if (m) untrack(() => emphasis.apply(m, entries));
	});

	let replayMap: MapLibreMap | null = null;
	let replayRevision = -1;
	$effect(() => {
		const m = map;
		const revision = layerRevision;
		if (!m) return;
		const shouldReplay = replayMap === m && replayRevision !== revision;
		replayMap = m;
		replayRevision = revision;
		if (shouldReplay) untrack(() => emphasis.replay(m));
	});

	return {
		get map() {
			return map;
		},
		get processedMotion() {
			return processedMotion;
		},
		ready(m: MapLibreMap) {
			if (map && map !== m) release(map);
			map = m;
			install(m);
		},
		styleLoad(m: MapLibreMap) {
			if (map === m) install(m);
		},
		repaint(m: MapLibreMap) {
			if (map === m) retintMapLayers(m);
		},
		release,
	};
}
