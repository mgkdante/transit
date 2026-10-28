<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '../../cn/index.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		size = 'default',
		interactive = false,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		size?: 'default' | 'sm';
		/** Navigable or activatable cards lift by 1px on hover. */
		interactive?: boolean;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="card"
	data-size={size}
	data-interactive={interactive ? 'true' : undefined}
	class={cn(
		'card-surface text-card-foreground gap-4 overflow-hidden py-4 text-sm has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl group/card flex flex-col',
		className,
	)}
	{...restProps}
>
	{@render children?.()}
</div>

<style>
	/* A solid panel one step above the page (never alpha, so the grid can't bleed through) with a
	   lit top bevel. Hover firms the border and adds the section shadow. */
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
	.card-surface[data-interactive='true']:hover {
		transform: translateY(-1px);
	}
	@media (prefers-reduced-motion: reduce) {
		.card-surface[data-interactive='true']:hover {
			transform: none;
		}
	}
</style>
