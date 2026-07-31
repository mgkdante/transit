<script lang="ts">
	import type { MapFocus } from '$lib/search/mapFocus';
	import { createMapFocusController } from '../mapFocusController.svelte';

	interface Props {
		readFocus: (searchParams: URLSearchParams) => MapFocus | null;
		clearFocus: () => void;
		resolveFocus: (focus: MapFocus) => boolean;
	}

	let props: Props = $props();
	let mapReady = $state(false);
	const controller = createMapFocusController({
		readFocus: (searchParams) => props.readFocus(searchParams),
		clearFocus: () => props.clearFocus(),
	});

	$effect(() => {
		if (!mapReady) return;
		controller.consume(props.resolveFocus);
	});

	function ingest(): void {
		controller.syncFromUrl(new URLSearchParams('focus=stop:STOP1'));
	}

	function markMapReady(): void {
		mapReady = true;
	}
</script>

<button type="button" onclick={ingest}>ingest focus</button>
<button type="button" onclick={markMapReady}>mark map ready</button>
<output data-testid="pending-focus">{controller.pending?.id ?? ''}</output>
