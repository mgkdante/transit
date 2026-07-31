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
		// The rest of MapStage's props are accepted and ignored (camera/theme/etc).
		[key: string]: unknown;
	}

	let { onready, onstyleload, class: className }: Props = $props();

	type Handler = (e: unknown) => void;
	const handlers = new SvelteMap<string, Handler[]>();
	const canvasHandlers = new SvelteMap<string, Handler[]>();
	let pickCount = $state(0);
	let featureStateSetCount = $state(0);
	let featureStateRemoveCount = $state(0);
	let pickLayer = STOPS_LAYER;

	// A minimal fake MapLibre map: enough surface for installMapLayers /
	// installMapInteractions / pickSelectionAt to run without WebGL.
	const fakeCanvas = {
		style: { cursor: '' },
		addEventListener: (type: string, handler: Handler) => {
			const list = canvasHandlers.get(type) ?? [];
			list.push(handler);
			canvasHandlers.set(type, list);
		},
		removeEventListener: (type: string, handler: Handler) => {
			canvasHandlers.set(
				type,
				(canvasHandlers.get(type) ?? []).filter((candidate) => candidate !== handler),
			);
		},
	};
	const fakeMap = {
		on: (type: string, handler: Handler) => {
			const list = handlers.get(type) ?? [];
			list.push(handler);
			handlers.set(type, list);
		},
		off: (type: string, handler: Handler) => {
			handlers.set(
				type,
				(handlers.get(type) ?? []).filter((candidate) => candidate !== handler),
			);
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
		},
	};

	function pick(nextLayer = STOPS_LAYER): void {
		pickLayer = nextLayer;
		pickCount += 1;
		for (const handler of handlers.get('click') ?? []) {
			handler({ point: { x: 10, y: 10 } });
		}
	}

	function styleLoad(): void {
		onstyleload?.(fakeMap);
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

	onMount(() => {
		onready?.(fakeMap);
	});
</script>

<div
	class={className}
	data-testid="map-stage-stub"
	data-pick-count={pickCount}
	data-feature-state-set-count={featureStateSetCount}
	data-feature-state-remove-count={featureStateRemoveCount}
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
