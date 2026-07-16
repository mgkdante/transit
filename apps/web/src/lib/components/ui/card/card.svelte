<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils';

	let {
		ref = $bindable(null),
		class: className,
		children,
		size = 'default',
		interactive = false,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		size?: 'default' | 'sm';
		/**
		 * Navigable/activatable cards may lift by 1px. Their border carries the
		 * interaction state; data surfaces never add a decorative outer glow.
		 */
		interactive?: boolean;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="card"
	data-size={size}
	data-interactive={interactive ? 'true' : undefined}
	class={cn(
		'card-surface text-card-foreground gap-4 overflow-hidden py-4 text-small has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl group/card flex flex-col',
		className,
	)}
	{...restProps}
>
	{@render children?.()}
</div>

<style>
	/* Unified flat card surface over the schematic board.
	   --surface-2 (= --card) is one solid step above the page (SOLID hex
	   always; alpha on the card bg is forbidden so the circuit grid never
	   bleeds through), and one uniform --border-brand rule draws every edge.
	   Hover firms that same four-sided rule without adding a halo or bevel. */
	.card-surface {
		background: var(--surface-2);
		border: 2px solid var(--border-brand);
		border-radius: var(--radius-lg);
		transition:
			border-color var(--duration-normal) var(--ease-default),
			transform var(--duration-normal) var(--ease-default);
	}
	.card-surface:hover {
		border-color: var(--border-brand-active);
	}
	/* Interactive card: a restrained 1px rise; border + movement carry affordance. */
	.card-surface[data-interactive='true']:hover {
		transform: translateY(-1px);
	}
	@media (prefers-reduced-motion: reduce) {
		.card-surface[data-interactive='true']:hover {
			transform: none;
		}
	}
</style>
