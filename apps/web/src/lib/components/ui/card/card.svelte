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
		 * E1 glow map: an INTERACTIVE (navigable/activatable) card gets the shipped
		 * button hover recipe — a 1px lift + --shadow-glow-sm — on top of the
		 * default content-card hover (border firm + --shadow-section, §C1). A static
		 * content card leaves this off and never lifts. PRM-guarded in CSS.
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
	/* Unified card surface — the panel lifts off the schematic board.
	   --surface-2 (= --card) is one solid step above the page (SOLID hex
	   always; alpha on the card bg is forbidden so the circuit grid never
	   bleeds through), a 2px --border-brand rule draws the panel edge, and a
	   1px inset top bevel (--edge-highlight) catches the lamp light. Hover
	   firms the rule to --border-brand-active and floats the panel with
	   --shadow-section. */
	.card-surface {
		background: var(--surface-2);
		border: 2px solid var(--border-brand);
		border-radius: var(--radius-lg);
		box-shadow: inset 0 1px 0 var(--edge-highlight);
		transition:
			border-color var(--duration-normal) var(--ease-default),
			box-shadow var(--duration-normal) var(--ease-default),
			transform var(--duration-normal) var(--ease-default);
	}
	.card-surface:hover {
		border-color: var(--border-brand-active);
		box-shadow:
			var(--shadow-section),
			inset 0 1px 0 var(--edge-highlight);
	}
	/* E1 interactive card: the shipped button lift — a 1px rise + --shadow-glow-sm
	   layered on the content-card hover — so a navigable card reads as clickable. */
	.card-surface[data-interactive='true']:hover {
		transform: translateY(-1px);
		box-shadow:
			var(--shadow-glow-sm),
			var(--shadow-section),
			inset 0 1px 0 var(--edge-highlight);
	}
	@media (prefers-reduced-motion: reduce) {
		.card-surface[data-interactive='true']:hover {
			transform: none;
		}
	}
</style>
