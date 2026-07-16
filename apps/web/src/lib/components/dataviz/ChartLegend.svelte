<!--
  ChartLegend — reusable swatch + label legend for the dataviz kit.

  Extracts the shared legend pattern that StackedBar (<ul class="dv-legend-list">)
  and TrendLine (<figcaption> swatch row) hand-rolled, so charts share ONE
  decorative legend. The chart's own role=img / figure aria-label already
  enumerates the series for assistive tech, so this list is aria-hidden=true
  (purely visual — never the a11y source of truth).

  Each item is a swatch (dot or square) tinted from the dataviz scale via
  `colorVar`, an optional glyph char (status charts pair colour + glyph), a
  label, and an optional formatted value (mono). DOCTRINE: swatches carry data
  colours (--dataviz-*), NEVER --primary.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	/** One legend entry: a coloured swatch (or glyph) + label + optional value. */
	export interface ChartLegendItem {
		/** Swatch colour, a dataviz token e.g. 'var(--dataviz-status-on-time)'. */
		colorVar: string;
		/** Series / category label (already localized upstream). */
		label: string;
		/** Optional formatted value (rendered mono, e.g. a share or count). */
		value?: string;
		/** Swatch shape. Default 'dot' (round). 'square' for proportion bars. */
		swatch?: 'dot' | 'square';
		/** Optional glyph char rendered in place of the swatch fill (status icons). */
		glyph?: string;
	}

	export interface ChartLegendProps extends WithElementRef<HTMLAttributes<HTMLUListElement>> {
		/** The legend entries, in render order. */
		items: ChartLegendItem[];
		/** 'wrap' = inline flex-wrap row (default); 'stack' = vertical column. */
		layout?: 'wrap' | 'stack';
		/** Swatch + gap sizing. Default 'sm'. */
		size?: 'sm' | 'md';
		class?: string;
	}

	let {
		items,
		layout = 'wrap',
		size = 'sm',
		class: className,
		ref = $bindable(null),
		...restProps
	}: ChartLegendProps = $props();
</script>

<ul
	bind:this={ref}
	class={cn(
		'dv-legend flex text-caption text-muted-foreground',
		layout === 'stack' ? 'flex-col gap-y-1' : 'flex-wrap gap-x-3 gap-y-1',
		size === 'md' ? 'text-small gap-x-4' : '',
		className,
	)}
	data-slot="chart-legend"
	data-card-interactive
	aria-hidden="true"
	{...restProps}
>
	{#each items as item, i (item.label + '-' + i)}
		<li class="inline-flex min-h-6 items-center gap-1.5">
			{#if item.glyph}
				<span
					class="inline-flex size-2.5 items-center justify-center leading-none"
					style="color: {item.colorVar};"
					aria-hidden="true">{item.glyph}</span
				>
			{:else}
				<span
					class={cn(
						'inline-block size-2.5',
						item.swatch === 'square' ? 'rounded-sm' : 'rounded-full',
					)}
					style="background: {item.colorVar};"
					aria-hidden="true"
				></span>
			{/if}
			<span class="text-foreground">{item.label}</span>
			{#if item.value != null}
				<span class="font-mono tabular-nums">{item.value}</span>
			{/if}
		</li>
	{/each}
</ul>
