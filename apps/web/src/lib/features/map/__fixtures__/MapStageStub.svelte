<!--
  Test-only stub for MapStage — stands in for the WebGL GL canvas host in render-based
  tests so happy-dom never instantiates MapLibre. It mimics the MapStage contract just
  enough to drive MapHero's lifecycle: it fires `onready` with a fake MapLibre map on
  mount (so installMapLayers/installMapInteractions register their handlers), and
  exposes a hidden "pick" button that replays a registered map `click` with a stop
  feature, so a render test can exercise the real selection → detail → URL spine.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	// Import the leaf directly so this fixture stays independent of the barrel it
	// stands in for. Going through $lib/components/map would create a mock-factory
	// cycle when a MapHero render test replaces that barrel's MapStage export.
	import { STOPS_LAYER } from '$lib/components/map/stopsLayer';

	interface Props {
		class?: string;
		onready?: (map: unknown) => void;
		onstyleload?: (map: unknown) => void;
		// The rest of MapStage's props are accepted and ignored (camera/theme/etc).
		[key: string]: unknown;
	}

	let { onready, class: className }: Props = $props();

	type Handler = (e: unknown) => void;
	const handlers = new SvelteMap<string, Handler[]>();
	let pickCount = $state(0);

	// A minimal fake MapLibre map: enough surface for installMapLayers /
	// installMapInteractions / pickSelectionAt to run without WebGL.
	const fakeCanvas = { style: { cursor: '' }, addEventListener: () => {} };
	const fakeMap = {
		on: (type: string, handler: Handler) => {
			const list = handlers.get(type) ?? [];
			list.push(handler);
			handlers.set(type, list);
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

	onMount(() => {
		onready?.(fakeMap);
	});
</script>

<div class={className} data-testid="map-stage-stub" data-pick-count={pickCount}>
	<button type="button" data-testid="map-stage-stub-pick" onclick={pick} hidden>pick</button>
</div>
