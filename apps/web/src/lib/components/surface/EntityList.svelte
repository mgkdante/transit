<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';
	import { DashboardGrid } from '$lib/components/layout';
	import { Card } from '@yesid/ui/card';

	interface EntityListProps extends Omit<HTMLAttributes<HTMLUListElement>, 'children'> {
		items: readonly T[];
		key: (item: T) => string;
		row: Snippet<[T]>;
		max?: number;
		truncatedLabel?: string;
		grid?: boolean;
		minTile?: string;
		cards?: boolean;
		class?: string;
	}

	let {
		items,
		key,
		row,
		max = 200,
		truncatedLabel,
		grid = false,
		minTile = '360px',
		cards = false,
		class: className,
		...restProps
	}: EntityListProps = $props();

	const visible = $derived(items.slice(0, max));
	const truncated = $derived(items.length > max);

	const gridRest = $derived(restProps as Omit<HTMLAttributes<HTMLElement>, 'class'>);
</script>

{#snippet renderItem(item: T)}
	{#if cards}
		<Card class="entity-list-card h-full gap-0 py-0" interactive={false}>
			{@render row(item)}
		</Card>
	{:else}
		{@render row(item)}
	{/if}
{/snippet}

{#if grid}
	<DashboardGrid
		as="ul"
		{minTile}
		gutter={false}
		class={cn('entity-list', 'entity-list--grid', cards && 'entity-list--cards', className)}
		data-slot="entity-list"
		{...gridRest}
	>
		{#each visible as item (key(item))}
			<li class="entity-list-item">{@render renderItem(item)}</li>
		{/each}
		{#if truncated && truncatedLabel}
			<li class="entity-list-more">{truncatedLabel}</li>
		{/if}
	</DashboardGrid>
{:else}
	<ul
		class={cn('entity-list', cards && 'entity-list--cards', className)}
		data-slot="entity-list"
		{...restProps}
	>
		{#each visible as item (key(item))}
			<li class="entity-list-item">{@render renderItem(item)}</li>
		{/each}
		{#if truncated && truncatedLabel}
			<li class="entity-list-more">{truncatedLabel}</li>
		{/if}
	</ul>
{/if}

<style>
	.entity-list:not(.entity-list--grid) {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.entity-list-item {
		border-bottom: 1px solid var(--border-subtle, var(--border));
	}
	.entity-list-item:last-child {
		border-bottom: none;
	}
	.entity-list--cards:not(.entity-list--grid) {
		gap: 1rem;
	}
	.entity-list--cards .entity-list-item {
		border-bottom: none;
	}
	:global(.card-surface.entity-list-card) {
		border-width: 3px;
	}
	.entity-list--grid:not(.entity-list--cards) .entity-list-item {
		border-bottom: none;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
	}
	.entity-list-more {
		padding: 0.75rem 0.875rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
</style>
