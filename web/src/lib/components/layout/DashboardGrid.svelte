<!--
  DashboardGrid — auto-fit KPI tile field (recipe 2 of 4).

  A single fluid grid of equal-weight tiles using
    grid-template-columns: repeat(auto-fit, minmax(<min>, 1fr))
  so KPI cards reflow from a wide multi-column board down to one column on a
  phone WITHOUT any breakpoint bookkeeping — the track count derives from how
  many `min`-wide columns fit the container. Gap and the page gutter come from
  brand spacing tokens (--space-card-gap / --space-page-x).

  Caller passes a single `children` snippet containing the tiles (any card
  component); this owns only the grid. `minTile` tunes the per-tile minimum so a
  dense numeric board (smaller min) and a sparse hero-metric board (larger min)
  share one recipe. `maxWidth` optionally centres the board within the content
  measure for legibility on ultra-wide displays.

  Doctrine-clean: layout only, no colour data marks. Surfaces stay solid (the
  tiles bring their own bg-card).
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface DashboardGridProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		/** The KPI tiles. */
		children?: Snippet;
		/**
		 * Minimum tile width before the grid drops a column. Any CSS length.
		 * Default 240px — comfortable for a label + large metric value.
		 */
		minTile?: string;
		/**
		 * Cap the board width and centre it. Use 'content' (--container-content,
		 * the brand content measure that --width-content aliases), 'wide'
		 * (--container-wide), 'none' (fill), or any CSS length.
		 */
		maxWidth?: 'content' | 'wide' | 'none' | (string & {});
		/** Apply the symmetric page gutter (--space-page-x). Default true. */
		gutter?: boolean;
		/** Accessible label for the dashboard region. */
		label?: string;
		class?: string;
	}

	let {
		children,
		minTile = '240px',
		maxWidth = 'none',
		gutter = true,
		label,
		class: className,
		...restProps
	}: DashboardGridProps = $props();

	// `--width-content`/`--width-wide` are Tailwind v4 `@theme inline` aliases:
	// they inline into utilities but are NOT emitted as runtime custom props, so
	// var() can't read them in scoped CSS. Reference the underlying runtime
	// tokens (--container-content / --container-wide) that they alias instead.
	const maxWidthValue = $derived(
		maxWidth === 'content'
			? 'var(--container-content)'
			: maxWidth === 'wide'
				? 'var(--container-wide)'
				: maxWidth === 'none'
					? 'none'
					: maxWidth,
	);
</script>

<div
	class={cn('dashboard-grid', gutter && 'dashboard-grid--gutter', className)}
	data-slot="dashboard-grid"
	style="--min-tile: {minTile}; --board-max: {maxWidthValue};"
	role={label ? 'region' : undefined}
	aria-label={label}
	{...restProps}
>
	{@render children?.()}
</div>

<style>
	.dashboard-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(var(--min-tile), 100%), 1fr));
		gap: var(--space-card-gap);
		width: 100%;
		max-width: var(--board-max);
		margin-inline: auto;
	}

	.dashboard-grid--gutter {
		padding-inline: var(--space-page-x);
	}
</style>
