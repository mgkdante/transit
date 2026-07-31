<script lang="ts">
	import type { MapNearMeController } from '../mapNearMeController.svelte';

	interface Props {
		controller: MapNearMeController;
	}

	let { controller }: Props = $props();

	function ingest(): void {
		controller.syncFromUrl(new URLSearchParams('near=45.501000%2C-73.601000'));
	}
</script>

<label>
	<input aria-label="near open" type="checkbox" bind:checked={controller.open} />
</label>
<label>
	Near query
	<input aria-label="near query" bind:value={controller.query} />
</label>
<button type="button" onclick={ingest}>ingest near target</button>
