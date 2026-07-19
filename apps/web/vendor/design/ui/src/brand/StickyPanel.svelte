<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '../cn/index.js';

	export type StickyPanelProps = WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
		top?: string;
		children: Snippet;
		class?: string;
	};

	let {
		ref = $bindable(null),
		top = '6rem',
		children,
		class: className,
		...restProps
	}: StickyPanelProps = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (the overflowing panel must be keyboard-scrollable) -->
<div
	bind:this={ref}
	class={cn('panel scrollbar-hidden', className)}
	data-slot="sticky-panel"
	style="top: {top};"
	tabindex={0}
	{...restProps}
>
	{@render children()}
</div>

<style>
	.panel {
		position: sticky;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
		box-shadow: var(--shadow-card);
		padding: 1.25rem;
		overflow-y: auto;
		max-height: calc(100dvh - 8rem);
		scrollbar-width: none;
		-ms-overflow-style: none;
	}

	.panel::-webkit-scrollbar {
		display: none;
	}
</style>
