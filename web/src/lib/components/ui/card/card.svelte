<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils';

	let {
		ref = $bindable(null),
		class: className,
		children,
		size = 'default',
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & { size?: 'default' | 'sm' } = $props();
</script>

<div
	bind:this={ref}
	data-slot="card"
	data-size={size}
	class={cn(
		'card-surface text-card-foreground gap-4 overflow-hidden py-4 text-small has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl group/card flex flex-col',
		className,
	)}
	{...restProps}
>
	{@render children?.()}
</div>

<style>
	/* Unified card surface — the panel lifts off the schematic board. --card is
	   one solid step above the page (SOLID hex always; alpha on the card bg is
	   forbidden so the circuit grid never bleeds through), a 2px --border-brand
	   rule draws the panel edge, and a 1px inset top bevel (--edge-highlight)
	   catches the lamp light. Hover firms the rule to --border-brand-active and
	   floats the panel with --shadow-section. */
	.card-surface {
		background: var(--card);
		border: 2px solid var(--border-brand);
		border-radius: var(--radius-lg);
		box-shadow: inset 0 1px 0 var(--edge-highlight);
		transition:
			border-color var(--duration-normal) var(--ease-default),
			box-shadow var(--duration-normal) var(--ease-default);
	}
	.card-surface:hover {
		border-color: var(--border-brand-active);
		box-shadow:
			var(--shadow-section),
			inset 0 1px 0 var(--edge-highlight);
	}
</style>
