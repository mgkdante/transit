<!--
  An auto-fitting tile grid: as many columns as fit at `minTile` wide, one column on narrow
  screens. With `label` and a non-list element it is a named region.
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface DashboardGridProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
		as?: 'div' | 'ul' | 'ol' | 'section';
		/** Narrowest tile width, any CSS length. */
		minTile?: string;
		/** Pads the grid with the page gutter. */
		gutter?: boolean;
		label?: string;
		children?: Snippet;
		class?: string;
	}
</script>

<script lang="ts">
	import { cn } from '../cn/index.js';

	let {
		as = 'div',
		minTile = '240px',
		gutter = true,
		label,
		children,
		class: className,
		...restProps
	}: DashboardGridProps = $props();

	const region = $derived(Boolean(label) && as !== 'ul' && as !== 'ol');
</script>

<svelte:element
	this={as}
	class={cn('dashboard-grid', gutter && 'dashboard-grid--gutter', className)}
	data-slot="dashboard-grid"
	style:--min-tile={minTile}
	role={region ? 'region' : undefined}
	aria-label={region ? label : undefined}
	{...restProps}
>
	{@render children?.()}
</svelte:element>

<style>
	.dashboard-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(var(--min-tile), 100%), 1fr));
		gap: var(--space-card-gap);
		width: 100%;
		margin: 0 auto;
		list-style: none;
		padding-inline-start: 0;
	}

	.dashboard-grid--gutter {
		padding-inline: var(--space-page-x);
	}
</style>
