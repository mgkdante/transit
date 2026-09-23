import { untrack } from 'svelte';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import {
	createVehicleMotionController,
	createVehicleOverlay,
	type VehicleMotionController,
	type VehicleOverlay,
} from '$lib/components/map';
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
	let foreground: VehicleOverlay | null = null;
	let processedMotion = $state<{ tickKey: string; vehicleCount: number } | null>(null);
	let expectedMotion: { tickKey: string; vehicleCount: number } | null = null;
	let layerRevision = $state(0);
	let vehicleMotionMap: MapLibreMap | null = null;
	let interactionsMap: MapLibreMap | null = null;
	let interactionDisposers: readonly (() => void)[] = [];
	let restorationPending: MapLibreMap | null = null;
	let reportSetupFailure: (() => void) | null = null;
	const emphasis = createMapEmphasisController(options.selection);
	const layers = createMapLayerFeedController();
	const stops = $derived(options.readFeed().stops.items);

	function release(m: MapLibreMap): void {
		if (map !== m) return;
		const released = ownerCleanup.releaseMapOwnerReceipts(vehicleMotion, interactionDisposers, () =>
			emphasis.clear(m),
		);
		const errors = [...released.errors];
		try {
			foreground?.destroy();
			foreground = null;
		} catch (error) {
			errors.push(error);
		}
		vehicleMotion = released.motion;
		expectedMotion = null;
		restorationPending = null;
		reportSetupFailure = null;
		vehicleMotionMap = released.motion ? m : null;
		interactionDisposers = released.disposers;
		interactionsMap = released.disposers.length > 0 ? m : null;
		map =
			released.motion || released.disposers.length > 0 || released.emphasisPending || foreground
				? m
				: null;
		ownerCleanup.throwCleanupErrors(errors, 'Map runtime owner cleanup failed');
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
		const vehicleId = foreground?.pick(event.point);
		if (vehicleId) return { kind: 'vehicle', id: vehicleId };
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
					webglcontextrestored: () => {
						if (map !== m) return;
						restorationPending = m;
						if (m.isStyleLoaded()) restoreAfterContextLoss(m);
					},
					styleload: () => {
						if (restorationPending === m && map === m) restoreAfterContextLoss(m);
					},
				}),
			(partial) => {
				interactionDisposers = partial;
				interactionsMap = null;
			},
		);
		interactionsMap = m;
	}

	function restoreAfterContextLoss(m: MapLibreMap): void {
		if (restorationPending !== m || map !== m) return;
		try {
			reinstallAfterStyleLoad(m);
		} catch (error) {
			ownerCleanup.reportCleanupFailure('Map context restoration failed', error);
			// Stage owns map-generation cleanup and the existing user-visible retry.
			reportSetupFailure?.();
		}
	}

	function reinstallAfterStyleLoad(m: MapLibreMap): void {
		restorationPending = m;
		foreground?.hold();
		try {
			install(m);
			foreground?.resume();
			foreground?.redraw();
			restorationPending = null;
		} catch (error) {
			foreground?.hold();
			throw error;
		}
	}

	function install(m: MapLibreMap): void {
		// Static MapLibre layers and the CPU foreground share one sprite bake.
		const { sprites, pin } = retintMapLayers(m);
		if (!foreground) {
			try {
				foreground = createVehicleOverlay(
					m,
					sprites,
					pin,
					(receipt) => {
						if (
							expectedMotion &&
							receipt.drawable &&
							receipt.projectedCount === expectedMotion.vehicleCount
						) {
							processedMotion = expectedMotion;
						}
					},
					() => {
						processedMotion = null;
					},
				);
			} catch (error) {
				foreground = (error as { overlay?: VehicleOverlay }).overlay ?? null;
				throw error;
			}
		} else foreground.setSprites(sprites, pin);
		if (vehicleMotionMap !== m) {
			vehicleMotion?.destroy();
			const overlay = foreground;
			vehicleMotion = createVehicleMotionController(m, {}, (features) => overlay.draw(features));
			vehicleMotionMap = m;
		}
		ensureInteractions(m);
		// A style swap clears custom sources; force their feed before emphasis replay.
		layerRevision += 1;
		// The first projected canvas frame is painted before onready returns.
		feedNow(m);
	}

	function feedNow(m: MapLibreMap): void {
		const revision = layerRevision;
		const feed = options.readFeed();
		expectedMotion = feed.vehicles.tickKey
			? { tickKey: feed.vehicles.tickKey, vehicleCount: feed.vehicles.items.length }
			: null;
		const selected = options.selection.selected;
		const hovered = options.selection.hovered;
		const overlay = foreground;
		const before = overlay?.receipt.drawSequence ?? 0;
		const sceneChanged = overlay?.setScene(
			feed.vehicles.stale,
			feed.nearTarget.target,
			hovered?.kind === 'vehicle' ? hovered.id : null,
			selected?.kind === 'vehicle' ? selected.id : null,
		);
		layers.feed(m, { ...feed, vehicles: { ...feed.vehicles, motion: vehicleMotion } }, revision);
		if (sceneChanged && overlay?.receipt.drawSequence === before) overlay.redraw();
		// This diagnostic readiness count must correspond to a completed canvas draw.
		processedMotion =
			expectedMotion &&
			overlay?.receipt.drawable &&
			overlay.receipt.projectedCount === expectedMotion.vehicleCount
				? expectedMotion
				: null;
	}

	$effect(() => {
		const m = map;
		void layerRevision;
		if (m) feedNow(m);
		else processedMotion = null;
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
		ready(m: MapLibreMap, reportFailure?: () => void) {
			if (map && map !== m) release(map);
			map = m;
			reportSetupFailure = reportFailure ?? null;
			install(m);
		},
		styleLoad(m: MapLibreMap) {
			if (map === m) reinstallAfterStyleLoad(m);
		},
		repaint(m: MapLibreMap) {
			if (map === m) {
				const { sprites, pin } = retintMapLayers(m);
				foreground?.setSprites(sprites, pin);
				foreground?.redraw();
			}
		},
		release,
	};
}
