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
	// Test-only deep-import exception: this fixture is loaded from inside the
	// MapHero suite's vi.mock factory. Going through $lib/components/map would
	// cycle back into that factory while it is replacing the barrel's MapStage.
	import { STOPS_LAYER } from '$lib/components/map/stopsLayer';

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
	let pickCount = $state(0);

	// A minimal fake MapLibre map: enough surface for installMapLayers /
	// installMapInteractions / pickSelectionAt to run without WebGL.
	const fakeCanvas = {
		style: { cursor: '' },
		addEventListener: () => {},
		removeEventListener: () => {},
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
		getLayer: (id: string) => (id === STOPS_LAYER ? { id } : undefined),
		queryRenderedFeatures: () => [{ layer: { id: STOPS_LAYER }, properties: { id: 'stop-1' } }],
	};

	function pick(): void {
		pickCount += 1;
		for (const handler of handlers.get('click') ?? []) {
			handler({ point: { x: 10, y: 10 } });
		}
	}

	function styleLoad(): void {
		onstyleload?.(fakeMap);
	}

	onMount(() => {
		onready?.(fakeMap);
	});
</script>

<div class={className} data-testid="map-stage-stub" data-pick-count={pickCount}>
	<button type="button" data-testid="map-stage-stub-pick" onclick={pick} hidden>pick</button>
	<button type="button" data-testid="map-stage-stub-style-load" onclick={styleLoad} hidden>
		style load
	</button>
</div>
