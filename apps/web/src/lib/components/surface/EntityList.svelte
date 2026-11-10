<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '#lib/utils/index.ts';
	import { Card } from '@yesid/ui/card';

	interface EntityListProps extends Omit<HTMLAttributes<HTMLUListElement>, 'children'> {
		items: readonly T[];
		key: (item: T) => string;
		row: Snippet<[T]>;
		max?: number;
		truncatedLabel?: string;
		grid?: boolean;
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
		cards = false,
		class: className,
		...restProps
	}: EntityListProps = $props();

	const visible = $derived(items.slice(0, max));
	const truncated = $derived(items.length > max);
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

<div class="entity-list-container">
	<ul
		class={cn('entity-list', grid && 'entity-list--grid', cards && 'entity-list--cards', className)}
		data-slot="entity-list"
		{...restProps}
	>
		{#each visible as item (key(item))}<li class="entity-list-item">
				{@render renderItem(item)}
			</li>{/each}
		{#if truncated && truncatedLabel}<li class="entity-list-more">{truncatedLabel}</li>{/if}
	</ul>
</div>

<style>
	.entity-list-container {
		container-type: inline-size;
	}
	.entity-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.entity-list--cards {
		gap: var(--space-card-gap);
	}
	.entity-list:not(.entity-list--cards) .entity-list-item:not(:last-child) {
		border-bottom: 1px solid var(--border-subtle, var(--border));
	}
	.entity-list-item {
		min-width: 0;
	}
	.entity-list--grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-card-gap);
		align-items: stretch;
	}
	:global(.card-surface.entity-list-card) {
		container: entity-card / inline-size;
		--entity-gap: 0.75rem;
		--entity-padding: 1rem;
		--entity-title-size: var(--text-card-title);
		--entity-body-size: var(--text-card-body);
		--entity-meta-size: var(--text-card-meta);
		--entity-radius: var(--radius-lg);
		border-radius: var(--radius-lg);
		box-shadow:
			var(--shadow-card),
			inset 0 1px 0 var(--edge-highlight);
	}
	:global(.entity-list-card:has(:focus-visible)) {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.entity-list-more {
		grid-column: 1 / -1;
		padding: 1rem;
		font-size: var(--text-card-meta);
		color: var(--muted-foreground);
	}
	@container (min-width:46.5rem) {
		.entity-list--grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@container (min-width:70.5rem) {
		.entity-list--grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
</style>
