<!--
  Test-only stub for MapStage — stands in for the WebGL GL canvas host in render-based
  tests so happy-dom never instantiates MapLibre. It mimics the MapStage contract just
  enough to drive MapHero's lifecycle: it fires `onready` with a fake MapLibre map on
  mount, exposes a hidden style-load trigger that invokes `onstyleload`, and exposes a
  hidden "pick" trigger that replays a registered map `click` with a stop feature so a
  render test can exercise the real selection → detail → URL spine.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import type { Map as MapLibreMap } from 'maplibre-gl';
	import { mapHeroReceiptSignals } from './MapHeroReceiptSignals.svelte';
	// Test-only deep-import exception: this fixture is loaded from inside the
	// MapHero suite's vi.mock factory. Going through $lib/components/map would
	// cycle back into that factory while it is replacing the barrel's MapStage.
	import { STOP_EXCEPTION_LAYER, STOPS_LAYER } from '$lib/components/map/stopsLayer';
	import { VEHICLE_BODY_LAYER } from '$lib/components/map/vehicleLayer';

	interface Props {
		class?: string;
		onready?: (map: unknown) => void;
		onstyleload?: (map: unknown) => void;
		onthemerepaint?: (map: unknown) => void;
		onerror?: (failure: { kind: 'construct'; retry: () => Promise<void> } | null) => void;
		onbeforeremove?: (map: unknown) => void;
		oncleanupfailure?: (error: unknown) => void;
		locale?: Record<string, string>;
		// The rest of MapStage's props are accepted and ignored (camera/theme/etc).
		[key: string]: unknown;
	}

	let {
		onready,
		onstyleload,
		onthemerepaint,
		onerror,
		onbeforeremove,
		oncleanupfailure,
		locale,
		class: className,
	}: Props = $props();

	type Handler = (e: unknown) => void;
	const receipt = mapHeroReceiptSignals.createMapStageReceipt();
	const handlers = new SvelteMap<string, Handler[]>();
	const canvasHandlers = new SvelteMap<string, Handler[]>();
	let pickCount = $state(0);
	let featureStateSetCount = $state(0);
	let featureStateRemoveCount = $state(0);
	let retryCount = $state(0);
	let fitBoundsCount = $state(0);
	let easeToCount = $state(0);
	let flyToCount = $state(0);
	let setMaxBoundsCount = $state(0);
	let pickLayer = STOPS_LAYER;
	const sources = new SvelteMap<string, { setData: (data: unknown) => void }>();
	let style:
		| { getSource: (id: string) => { setData: (data: unknown) => void } | undefined }
		| undefined;

	// A minimal fake MapLibre map: enough surface for installMapLayers /
	// installMapInteractions / pickSelectionAt to run without WebGL.
	const fakeCanvas = {
		style: { cursor: '' },
		addEventListener: (type: string, handler: Handler) => {
			const list = canvasHandlers.get(type) ?? [];
			list.push(handler);
			canvasHandlers.set(type, list);
			receipt.recordListenerCount(`canvas:${type}`, list.length);
		},
		removeEventListener: (type: string, handler: Handler) => {
			const list = (canvasHandlers.get(type) ?? []).filter((candidate) => candidate !== handler);
			canvasHandlers.set(type, list);
			receipt.recordListenerCount(`canvas:${type}`, list.length);
			mapHeroReceiptSignals.throwCleanupFault(`canvas:${type}`);
		},
	};
	function removeRawMap(): void {
		// Real MapLibre remove() tears down its resources but retains Evented
		// listener registries. Listener zero must come from explicit owner disposal.
		for (const sourceId of [...sources.keys()]) {
			sources.delete(sourceId);
			receipt.recordSourceCount(sourceId, 0);
		}
		style = undefined;
	}

	const rawFakeMap = {
		getSource: (id: string) => style!.getSource(id),
		on: (type: string, handler: Handler) => {
			const list = handlers.get(type) ?? [];
			list.push(handler);
			handlers.set(type, list);
			receipt.recordListenerCount(type, list.length);
			return { unsubscribe: () => rawFakeMap.off(type, handler) };
		},
		off: (type: string, handler: Handler) => {
			const list = (handlers.get(type) ?? []).filter((candidate) => candidate !== handler);
			handlers.set(type, list);
			receipt.recordListenerCount(type, list.length);
			mapHeroReceiptSignals.throwCleanupFault(`map:${type}`);
		},
		addSource: (id: string, source: { setData: (data: unknown) => void }) => {
			if (sources.has(id)) return;
			sources.set(id, source);
			receipt.recordSourceCount(id, 1);
		},
		removeSource: (id: string) => {
			if (!sources.delete(id)) return;
			receipt.recordSourceCount(id, 0);
		},
		getCanvas: () => fakeCanvas,
		getLayer: (id: string) =>
			id === STOPS_LAYER || id === STOP_EXCEPTION_LAYER || id === VEHICLE_BODY_LAYER
				? { id }
				: undefined,
		queryRenderedFeatures: () => [
			{
				layer: { id: pickLayer },
				properties: { id: pickLayer === STOPS_LAYER ? 'stop-1' : 'bus-1' },
			},
		],
		setFeatureState: (
			target: { source: string; id: string | number },
			state: Record<string, boolean>,
		) => {
			featureStateSetCount += 1;
			mapHeroReceiptSignals.recordFeatureState({
				operation: 'set',
				target: { ...target },
				state: { ...state },
			});
		},
		removeFeatureState: (target: { source: string; id: string | number }, property?: string) => {
			featureStateRemoveCount += 1;
			mapHeroReceiptSignals.recordFeatureState({
				operation: 'remove',
				target: { ...target },
				property,
			});
			mapHeroReceiptSignals.throwCleanupFault('emphasis:removeFeatureState');
		},
		fitBounds: () => {
			fitBoundsCount += 1;
		},
		easeTo: () => {
			easeToCount += 1;
		},
		flyTo: () => {
			flyToCount += 1;
		},
		setMaxBounds: () => {
			setMaxBoundsCount += 1;
		},
		remove: removeRawMap,
	};
	const map = rawFakeMap as unknown as MapLibreMap;

	function pick(nextLayer = STOPS_LAYER): void {
		pickLayer = nextLayer;
		pickCount += 1;
		for (const handler of handlers.get('click') ?? []) {
			handler({ point: { x: 10, y: 10 } });
		}
	}

	function styleLoad(): void {
		onstyleload?.(map);
	}

	function themeRepaint(): void {
		onthemerepaint?.(map);
	}

	function fail(): void {
		onerror?.({
			kind: 'construct',
			retry: async () => {
				retryCount += 1;
				onerror?.(null);
			},
		});
	}

	function move(nextLayer: string): void {
		pickLayer = nextLayer;
		for (const handler of handlers.get('mousemove') ?? []) {
			handler({ point: { x: 10, y: 10 } });
		}
	}

	function leave(): void {
		for (const handler of canvasHandlers.get('mouseleave') ?? []) handler({});
	}

	const mapStageHandlers: ReadonlyArray<readonly [string, Handler]> = [
		['load', () => {}],
		['styledata', () => {}],
		['sourcedata', () => {}],
		['movestart', () => {}],
		['boxzoomend', () => {}],
	];

	onMount(() => {
		style = { getSource: (id) => sources.get(id) };
		for (const [type, handler] of mapStageHandlers) rawFakeMap.on(type, handler);
		onready?.(map);
		return () => {
			const cleanupErrors: unknown[] = [];
			try {
				onbeforeremove?.(map);
			} catch (error) {
				cleanupErrors.push(error);
			}
			for (const [type, handler] of mapStageHandlers) {
				try {
					rawFakeMap.off(type, handler);
				} catch (error) {
					cleanupErrors.push(error);
				}
			}
			try {
				rawFakeMap.remove();
			} catch (error) {
				cleanupErrors.push(error);
			}
			for (const error of cleanupErrors) {
				try {
					if (oncleanupfailure) oncleanupfailure(error);
					else console.error('MapStage cleanup failed', error);
				} catch {
					// Fault reporting cannot reopen the Svelte destructor boundary.
				}
			}
		};
	});
</script>

<div
	class={className}
	data-testid="map-stage-stub"
	data-pick-count={pickCount}
	data-feature-state-set-count={featureStateSetCount}
	data-feature-state-remove-count={featureStateRemoveCount}
	data-retry-count={retryCount}
	data-fit-bounds-count={fitBoundsCount}
	data-ease-to-count={easeToCount}
	data-fly-to-count={flyToCount}
	data-set-max-bounds-count={setMaxBoundsCount}
	data-locale={JSON.stringify(locale)}
>
	<button type="button" data-testid="map-stage-stub-pick" onclick={() => pick()} hidden>pick</button
	>
	<button
		type="button"
		data-testid="map-stage-stub-pick-vehicle"
		onclick={() => pick(VEHICLE_BODY_LAYER)}
		hidden
	>
		pick vehicle
	</button>
	<button type="button" data-testid="map-stage-stub-style-load" onclick={styleLoad} hidden>
		style load
	</button>
	<button type="button" data-testid="map-stage-stub-theme-repaint" onclick={themeRepaint} hidden>
		theme repaint
	</button>
	<button type="button" data-testid="map-stage-stub-error" onclick={fail} hidden>error</button>
	<button
		type="button"
		data-testid="map-stage-stub-hover-vehicle"
		onclick={() => move(VEHICLE_BODY_LAYER)}
		hidden
	>
		hover vehicle
	</button>
	<button
		type="button"
		data-testid="map-stage-stub-hover-stop"
		onclick={() => move(STOPS_LAYER)}
		hidden
	>
		hover stop
	</button>
	<button type="button" data-testid="map-stage-stub-mouseleave" onclick={leave} hidden>
		mouseleave
	</button>
</div>
