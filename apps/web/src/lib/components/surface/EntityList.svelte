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
	import { DashboardGrid } from '$lib/components/layout';
	import { Card } from '$lib/components/ui/card';

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
		/**
		 * Lay the rows on the SHARED DashboardGrid auto-fit board (semantic <ul>)
		 * instead of the default single stacked column — for a catalogue that should
		 * use the desktop width as a 2-up board reflowing to one column on a phone.
		 * The row semantics (<li> per item) are unchanged; only the track recipe is
		 * owned by DashboardGrid, never re-rolled here.
		 */
		grid?: boolean;
		/** Min tile width for the grid board (grid mode only). Default 360px. */
		minTile?: string;
		/** Wrap every row in the shared Yesid-style listing Card chassis. */
		cards?: boolean;
		/** Optional extra classes on the list root. */
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

	// In grid mode the rows still ride a <ul> (DashboardGrid as="ul"), so the
	// <ul>-typed pass-through attributes apply at runtime — but DashboardGrid's props
	// are the polymorphic HTMLElement set, so widen the rest-props' element type for
	// the spread (the <ul>-specific event-handler `currentTarget` is contravariantly
	// incompatible with the generic element otherwise).
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
	<!-- Grid mode: the SAME <li> rows ride the shared DashboardGrid auto-fit board
	     (rendered as a semantic <ul>), so the list>listitem semantics survive and the
	     auto-fit recipe lives ONLY in DashboardGrid. -->
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
	/* Default (single-column) list mode. Grid mode (`.entity-list--grid`) inherits its
	   display:grid + list reset from DashboardGrid, so the flex base is scoped OUT of
	   it to avoid a cross-component cascade race on `display`. */
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
	/* Grid mode: each row becomes a bordered tile that fills its auto-fit cell — the
	   stacked per-row rules give way to the card-gap rhythm. The board's grid track
	   recipe is DashboardGrid's (only the list-mode flex defaults are overridden by
	   the .dashboard-grid display:grid). */
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
