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

	// Polymorphic (`as`), so the rest-props use the generic HTMLElement attribute set
	// rather than HTMLDivElement — a caller rendering `as="ul"` then passes <ul>-typed
	// attributes (e.g. aria-label) without a div/ul handler-type mismatch.
	interface DashboardGridProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
		/** The KPI tiles. */
		children?: Snippet;
		/**
		 * The element the grid renders as. Default 'div'. Pass a list element
		 * ('ul' / 'ol') so a caller can render a SEMANTIC ranked/entity list on the
		 * SAME auto-fit grid track — the track recipe + minTile live ONLY here while
		 * the caller keeps its `<li>` rows. The grid is layout-only; list semantics
		 * come from the element + the caller's items (NOT a `role`/`label`).
		 */
		as?: 'div' | 'ul' | 'ol' | 'section';
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
		/**
		 * Vertical alignment of each tile WITHIN its grid row. Default 'stretch' —
		 * cells fill the tallest sibling so an equal-height board reads as a clean
		 * row of cards (the home explore/pillar boards rely on this). Pass 'start'
		 * to let each tile take its NATURAL height (no elongation) when the tiles
		 * carry uneven content — e.g. the /network readout board.
		 */
		align?: 'start' | 'stretch';
		/** Apply the symmetric page gutter (--space-page-x). Default true. */
		gutter?: boolean;
		/**
		 * Opt the grid IN to being a named `role="region"` landmark with this
		 * accessible name. OMIT it (the default) so the grid stays a plain layout
		 * container — the surrounding `<section aria-label>` already names the region,
		 * and a list (`as="ul"`) brings its own list semantics, so a region landmark
		 * here would only add redundant/nested-landmark noise.
		 */
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

	// A list element brings its own list semantics, so it must NOT also become a
	// `role="region"` landmark (that would be redundant/nested) even if a `label`
	// is passed — guard the landmark emission on a non-list element.
	const isListElement = $derived(as === 'ul' || as === 'ol');
</script>

<!--
  Render as the requested element (default <div>) so a caller can put the SAME
  auto-fit recipe on a semantic <ul>/<ol> while owning its own <li> rows. The
  region landmark is OPT-IN (a `label` is passed) and is suppressed on a list
  element so a `<ul aria-label>` never doubles as a redundant region landmark.
-->
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
		/* Per-row vertical alignment of the cells. Defaults to `stretch` (equal-height
		   cards) via the --board-align fallback so every existing consumer is
		   unchanged; a caller passing align="start" lets tiles take natural height. */
		align-items: var(--board-align, stretch);
		/* Neutral list reset so an `as="ul"`/`"ol"` render is a clean grid container
		   (no default bullets/indent/margin) while the caller's <li> rows ride the
		   cells. A <div> is unaffected by these. */
		list-style: none;
		padding-inline-start: 0;
	}

	.dashboard-grid--gutter {
		padding-inline: var(--space-page-x);
	}
</style>
