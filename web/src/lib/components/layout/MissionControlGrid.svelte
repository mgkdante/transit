<!--
  MissionControlGrid — the operations-console shell (recipe 1 of 4).

  Desktop (>= lg / min-width:1024px): a four-track CSS grid laid out as
    [rail 60px] [list 300px] [main 1fr] [detail 360px]
  matching the nav `layout.isDesktop` contract. The middle `main` track flexes;
  the three fixed rails frame it.

  Below lg the grid collapses to a single scrolling column: rail → list → main,
  and the `detail` snippet is re-homed into a bottom sheet region (`detail-sheet`)
  so the operator pulls it up on demand instead of it stealing a column. The
  caller controls the sheet's open state via `detailOpen` (bindable) — this
  component only owns the LAYOUT, never the open/close affordance markup, so it
  composes with $lib/components/ui/sheet or a route push without conflict.

  Pure CSS responsiveness (no JS media listener) keeps it SSR-correct and
  matches the documented `(min-width:1024px)` breakpoint exactly.

  Snippet-prop based: pass `rail`, `list`, `main`, `detail`. All optional so the
  same shell serves vehicle / stop / line / network surfaces with whatever rails
  that surface needs. Doctrine-clean: no data marks, only structural tokens.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface MissionControlGridProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		/** Far-left icon rail (60px on desktop). */
		rail?: Snippet;
		/** List / index column (300px on desktop). */
		list?: Snippet;
		/** Primary working area (flex / 1fr). */
		main?: Snippet;
		/** Contextual detail column (360px on desktop; bottom-sheet below lg). */
		detail?: Snippet;
		/**
		 * Below lg, whether the re-homed `detail` region is expanded. Bindable so a
		 * parent can drive it from a toggle, a route, or openSurface(). On desktop
		 * the detail column is always shown and this is ignored.
		 */
		detailOpen?: boolean;
		/** Accessible label for the console region. */
		label?: string;
		class?: string;
	}

	let {
		rail,
		list,
		main,
		detail,
		detailOpen = $bindable(false),
		label = 'Mission control',
		class: className,
		...restProps
	}: MissionControlGridProps = $props();
</script>

<div
	class={cn('mc-grid', className)}
	data-slot="mission-control-grid"
	data-detail-open={detailOpen ? '' : undefined}
	role="region"
	aria-label={label}
	{...restProps}
>
	{#if rail}
		<div class="mc-rail" data-slot="mc-rail">
			{@render rail()}
		</div>
	{/if}

	{#if list}
		<div class="mc-list" data-slot="mc-list">
			{@render list()}
		</div>
	{/if}

	{#if main}
		<main class="mc-main" data-slot="mc-main">
			{@render main()}
		</main>
	{/if}

	{#if detail}
		<aside class="mc-detail" data-slot="mc-detail" aria-hidden={detailOpen ? undefined : true}>
			{@render detail()}
		</aside>
	{/if}
</div>

<style>
	/* Mobile-first: a single scrolling column. Source order (rail → list → main →
	   detail) is the stacking order, which reads top-down naturally. */
	.mc-grid {
		display: grid;
		grid-template-columns: 1fr;
		min-height: 0;
		width: 100%;
		background: var(--background);
	}

	.mc-rail,
	.mc-list,
	.mc-main,
	.mc-detail {
		min-width: 0;
		min-height: 0;
	}

	.mc-main {
		/* The working surface owns the page gutter on small screens. */
		padding-inline: var(--space-page-x);
		padding-block: var(--space-card-gap);
	}

	/* Below lg the detail rail becomes a pull-up bottom region. Collapsed by
	   default (height 0, contents removed from a11y tree via aria-hidden above);
	   the caller flips `detailOpen` to reveal it. It pins to the viewport bottom
	   so it reads as a sheet without this component owning overlay chrome. */
	.mc-detail {
		position: sticky;
		bottom: 0;
		z-index: var(--z-sheet);
		max-height: 0;
		overflow: hidden;
		background: var(--card);
		border-top: 1px solid var(--border);
		box-shadow: var(--shadow-sheet);
		border-start-start-radius: var(--radius-lg);
		border-start-end-radius: var(--radius-lg);
		transition: max-height 240ms cubic-bezier(0.2, 0, 0, 1);
	}

	.mc-grid[data-detail-open] .mc-detail {
		max-height: 70svh;
		overflow-y: auto;
	}

	@media (prefers-reduced-motion: reduce) {
		.mc-detail {
			transition: none;
		}
	}

	/* Desktop console: the canonical 60 / 300 / 1fr / 360 four-track grid. */
	@media (min-width: 1024px) {
		.mc-grid {
			grid-template-columns: 60px 300px minmax(0, 1fr) 360px;
			grid-template-rows: 100%;
			height: 100%;
			min-height: 0;
		}

		.mc-rail,
		.mc-list,
		.mc-detail {
			height: 100%;
			overflow-y: auto;
		}

		.mc-rail {
			border-inline-end: 1px solid var(--border);
			background: var(--card);
		}

		.mc-list {
			border-inline-end: 1px solid var(--border);
			background: var(--background);
		}

		.mc-main {
			height: 100%;
			overflow-y: auto;
			padding-inline: var(--space-page-x);
			padding-block: var(--space-section-y);
		}

		/* On desktop the detail rail is a real column again — drop all sheet
		   behaviour and always show it regardless of `detailOpen`. */
		.mc-detail {
			position: static;
			max-height: none;
			overflow-y: auto;
			background: var(--card);
			border-top: none;
			border-inline-start: 1px solid var(--border);
			box-shadow: none;
			border-radius: 0;
			transition: none;
		}
	}
</style>
