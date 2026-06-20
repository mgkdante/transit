<!--
  EntityList — a keyed, separated list of entity rows.

  Surface-agnostic list scaffold: the caller supplies the items, a stable key
  fn, and a `row` snippet (usually an <EntityRow>). The list caps at `max` rows
  and, when truncated, shows a caller-localized "+N more" note (the caller owns
  the localized string — this primitive stays copy-free). Rows are separated by
  thin token rules, no bullets.
-->
<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	interface EntityListProps extends Omit<HTMLAttributes<HTMLUListElement>, 'children'> {
		/** The full item set (sliced to `max` for render). */
		items: readonly T[];
		/** Stable key for each item (keyed `{#each}`). */
		key: (item: T) => string;
		/** Renders one item (typically an <EntityRow>). */
		row: Snippet<[T]>;
		/** Max rows to render. Default 200. */
		max?: number;
		/**
		 * Caller-localized "+N more" note shown when items exceed `max`. Omit to
		 * suppress the note entirely.
		 */
		truncatedLabel?: string;
		/** Optional extra classes on the list root. */
		class?: string;
	}

	let {
		items,
		key,
		row,
		max = 200,
		truncatedLabel,
		class: className,
		...restProps
	}: EntityListProps = $props();

	const visible = $derived(items.slice(0, max));
	const truncated = $derived(items.length > max);
</script>

<ul class={cn('entity-list', className)} data-slot="entity-list" {...restProps}>
	{#each visible as item (key(item))}
		<li class="entity-list-item">{@render row(item)}</li>
	{/each}
	{#if truncated && truncatedLabel}
		<li class="entity-list-more" aria-hidden="true">{truncatedLabel}</li>
	{/if}
</ul>

<style>
	.entity-list {
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
	.entity-list-more {
		padding: 0.75rem 0.875rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
</style>
