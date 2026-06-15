<!--
  ListDetailGrid — master/detail two-pane (recipe 3 of 4).

  Desktop (>= lg): a fixed-width list column beside a flexing detail pane
    [list <listWidth>] [detail 1fr]
  The list scrolls independently of the detail so an operator can keep their
  index in view while the detail pane updates (route reliability list → route
  detail, stops list → stop detail, etc.).

  Below lg the two panes STACK into one scrolling column: list first, detail
  below. The caller decides whether both render at once (stacked) or whether the
  list hides once a row is selected — drive that by simply not passing the
  `detail` snippet until there's a selection, or pass `detailActive` to let this
  component focus the detail pane (list visually de-emphasised) on mobile.

  `side` flips which pane leads ('list' default, or 'detail' for a detail-left
  reading order). Snippet-prop based; layout only, doctrine-clean.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface ListDetailGridProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		/** The index / master column. */
		list?: Snippet;
		/** The detail / focus pane. */
		detail?: Snippet;
		/** Desktop width of the list column. Any CSS length. Default 320px. */
		listWidth?: string;
		/** Which pane leads in source/visual order on desktop. Default 'list'. */
		side?: 'list' | 'detail';
		/**
		 * On mobile, prioritise the detail pane (list collapses to a thin,
		 * de-emphasised header strip). Use when a row is selected. Ignored on
		 * desktop where both panes are always visible. Default false.
		 */
		detailActive?: boolean;
		/** Accessible label for the region. */
		label?: string;
		class?: string;
	}

	let {
		list,
		detail,
		listWidth = '320px',
		side = 'list',
		detailActive = false,
		label,
		class: className,
		...restProps
	}: ListDetailGridProps = $props();
</script>

<div
	class={cn('ld-grid', `ld-grid--${side}`, className)}
	data-slot="list-detail-grid"
	data-detail-active={detailActive ? '' : undefined}
	style="--list-width: {listWidth};"
	role={label ? 'region' : undefined}
	aria-label={label}
	{...restProps}
>
	{#if list}
		<div class="ld-list" data-slot="ld-list">
			{@render list()}
		</div>
	{/if}

	{#if detail}
		<div class="ld-detail" data-slot="ld-detail">
			{@render detail()}
		</div>
	{/if}
</div>

<style>
	/* Mobile-first: stacked single column, list then detail (source order). */
	.ld-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-card-gap);
		width: 100%;
		min-height: 0;
	}

	.ld-list,
	.ld-detail {
		min-width: 0;
		min-height: 0;
	}

	/* Detail-led variant: render the detail pane visually first on mobile via
	   order, keeping DOM order list→detail for sensible tab/reading flow when
	   both are shown. */
	.ld-grid--detail .ld-detail {
		order: -1;
	}

	/* Mobile focus mode: when a row is selected the list shrinks to a quiet strip
	   and the detail takes the stage. */
	.ld-grid[data-detail-active] .ld-list {
		opacity: 0.7;
	}

	@media (min-width: 1024px) {
		.ld-grid {
			grid-template-columns: var(--list-width) minmax(0, 1fr);
			gap: 0;
			height: 100%;
		}

		.ld-grid--detail {
			grid-template-columns: minmax(0, 1fr) var(--list-width);
		}

		/* On desktop the detail-led order swap is unnecessary — the grid columns
		   already place the panes; reset so DOM order maps to columns. */
		.ld-grid--detail .ld-detail {
			order: 0;
		}

		.ld-list {
			height: 100%;
			overflow-y: auto;
			border-inline-end: 1px solid var(--border);
		}

		/* Detail-led: the divider rule lives on the list's leading edge instead. */
		.ld-grid--detail .ld-list {
			border-inline-end: none;
			border-inline-start: 1px solid var(--border);
		}

		.ld-detail {
			height: 100%;
			overflow-y: auto;
		}

		/* detailActive has no effect on desktop — both panes always full strength. */
		.ld-grid[data-detail-active] .ld-list {
			opacity: 1;
		}
	}
</style>
