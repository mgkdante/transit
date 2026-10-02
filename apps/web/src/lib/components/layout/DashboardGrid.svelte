<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface DashboardGridProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
		children?: Snippet;
		as?: 'div' | 'ul' | 'ol' | 'section';
		minTile?: string;
		maxWidth?: 'content' | 'wide' | 'none' | (string & {});
		align?: 'start' | 'stretch';
		gutter?: boolean;
		label?: string;
		class?: string;
	}

	let {
		children,
		as = 'div',
		minTile = '240px',
		maxWidth = 'none',
		align = 'stretch',
		gutter = true,
		label,
		class: className,
		...restProps
	}: DashboardGridProps = $props();

	const maxWidthValue = $derived(
		maxWidth === 'content'
			? 'var(--container-content)'
			: maxWidth === 'wide'
				? 'var(--container-wide)'
				: maxWidth === 'none'
					? 'none'
					: maxWidth,
	);

	const isListElement = $derived(as === 'ul' || as === 'ol');
</script>

<svelte:element
	this={as}
	class={cn('dashboard-grid', gutter && 'dashboard-grid--gutter', className)}
	data-slot="dashboard-grid"
	style="--min-tile: {minTile}; --board-max: {maxWidthValue}; --board-align: {align};"
	role={label && !isListElement ? 'region' : undefined}
	aria-label={label && !isListElement ? label : undefined}
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
		max-width: var(--board-max);
		margin: 0 auto;
		align-items: var(--board-align, stretch);
		list-style: none;
		padding-inline-start: 0;
	}

	.dashboard-grid--gutter {
		padding-inline: var(--space-page-x);
	}
</style>
