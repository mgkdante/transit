<script lang="ts">
	import type { MapSelectionController } from '../mapSelectionController.svelte';

	interface Props {
		controller: MapSelectionController;
	}

	let { controller }: Props = $props();

	// S5-385 B2: the inline template read shares ONE effect with the other
	// outputs, so a co-updating rune masks a de-runed stack. This $derived's
	// only dependency is the stack itself — it goes stale (and the pin red)
	// unless stack is genuinely reactive. Mirrors MapHero's real consumption
	// (const selectionStack = $derived(selectionController.stack)).
	const stackSize = $derived(controller.stack.length);
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
<output data-testid="stack-size">{stackSize}</output>
