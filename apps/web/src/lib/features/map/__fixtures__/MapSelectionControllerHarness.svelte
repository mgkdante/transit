<script lang="ts">
	import type { MapSelectionController } from '../mapSelectionController.svelte';

	interface Props {
		controller: MapSelectionController;
	}

	let { controller }: Props = $props();
</script>

<button type="button" onclick={() => controller.selectPicked({ kind: 'stop', id: 'stop-1' })}>
	pick stop
</button>
<button
	type="button"
	onclick={() => controller.selectFromDetail({ kind: 'route', id: '24', direction: 0 })}
>
	drill route
</button>
<button type="button" onclick={() => controller.setHovered({ kind: 'vehicle', id: 'bus-1' })}>
	hover bus
</button>
<button type="button" onclick={() => controller.goBack()}>back</button>
<label>
	<input aria-label="detail open" type="checkbox" bind:checked={controller.detailOpen} />
</label>

<output data-testid="selected">{controller.selected?.id ?? ''}</output>
<output data-testid="hovered">{controller.hovered?.id ?? ''}</output>
<output data-testid="stack-size">{controller.stack.length}</output>
