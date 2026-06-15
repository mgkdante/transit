<!--
  EdgeStateGrid — three equal cells, desktop row / mobile stack (recipe 4 of 4).

  A simple, explicit three-up grid for "edge state" content: the trio of panels
  that frame a surface when there's no live data to fill the working area —
  empty / error / offline explainers, a what-this-shows / how-to-read /
  data-freshness triptych, or three peer call-to-action cards.

  Desktop (>= lg): three equal 1fr columns in a row.
  Below lg: a single stacked column (a → b → c source order).

  Unlike DashboardGrid's fluid auto-fit, this recipe is deliberately FIXED at
  three so the composition reads as an intentional triptych rather than a
  reflowing field. Pass exactly the `a`, `b`, `c` snippets; any that are omitted
  simply leave their cell empty (the remaining cells still hold their thirds, so
  partial triptychs don't lurch). `align`/`justify` tune cell content placement
  for centred empty-state art. Layout only, doctrine-clean.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface EdgeStateGridProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		/** First cell. */
		a?: Snippet;
		/** Second cell. */
		b?: Snippet;
		/** Third cell. */
		c?: Snippet;
		/** Cross-axis placement of each cell's content. Default 'stretch'. */
		align?: 'start' | 'center' | 'end' | 'stretch';
		/** Main-axis placement of each cell's content. Default 'start'. */
		justify?: 'start' | 'center' | 'end' | 'stretch';
		/** Apply the symmetric page gutter (--space-page-x). Default true. */
		gutter?: boolean;
		/** Accessible label for the region. */
		label?: string;
		class?: string;
	}

	let {
		a,
		b,
		c,
		align = 'stretch',
		justify = 'start',
		gutter = true,
		label,
		class: className,
		...restProps
	}: EdgeStateGridProps = $props();
</script>

<div
	class={cn('edge-grid', gutter && 'edge-grid--gutter', className)}
	data-slot="edge-state-grid"
	style="--edge-align: {align}; --edge-justify: {justify};"
	role={label ? 'region' : undefined}
	aria-label={label}
	{...restProps}
>
	<div class="edge-cell" data-slot="edge-cell-a">
		{@render a?.()}
	</div>
	<div class="edge-cell" data-slot="edge-cell-b">
		{@render b?.()}
	</div>
	<div class="edge-cell" data-slot="edge-cell-c">
		{@render c?.()}
	</div>
</div>

<style>
	/* Mobile-first: single stacked column. */
	.edge-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-card-gap);
		width: 100%;
	}

	.edge-grid--gutter {
		padding-inline: var(--space-page-x);
	}

	.edge-cell {
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: var(--edge-align);
		justify-content: var(--edge-justify);
	}

	/* Desktop: three equal columns. */
	@media (min-width: 1024px) {
		.edge-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
</style>
