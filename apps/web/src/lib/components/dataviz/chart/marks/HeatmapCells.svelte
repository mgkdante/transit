<!--
  HeatmapCells — the cell layer for HeatmapMark, rendered INSIDE the LayerChart <Svg> so it
  can read the chart context's band scales (LayerChart's <Cell> treats a numeric x/y as a raw
  pixel, not a scaled band position, so we scale here via ctx.xScale / ctx.yScale). One tier-
  classed <rect> per (day, hour); the worst tier gets a contrasting outline AND a centred ◆
  glyph (colour is never the sole channel). Hover/value lives on the parent's LayerChart
  Tooltip (bounds mode reads the same scales), so this layer is purely the visual grid.
-->
<script lang="ts">
	import { getChartContext } from 'layerchart';
	import { cn } from '$lib/utils';
	import { heatmapTierClass } from '../heatmapTiers';

	export interface HeatmapCellDatum {
		key: string;
		c: number;
		r: number;
		tier: number | null;
	}
	let {
		cells,
		worstTier,
		worstGlyph = '',
	}: {
		cells: readonly HeatmapCellDatum[];
		worstTier: number;
		worstGlyph?: string;
	} = $props();

	const ctx = getChartContext();
	const bw = $derived(
		typeof (ctx.xScale as { bandwidth?: () => number })?.bandwidth === 'function'
			? (ctx.xScale as { bandwidth: () => number }).bandwidth()
			: 0,
	);
	const bh = $derived(
		typeof (ctx.yScale as { bandwidth?: () => number })?.bandwidth === 'function'
			? (ctx.yScale as { bandwidth: () => number }).bandwidth()
			: 0,
	);
	const px = (c: number): number => (ctx.xScale(c) as number) ?? 0;
	const py = (r: number): number => (ctx.yScale(r) as number) ?? 0;
	const glyphSize = $derived(Math.max(6, Math.min(bw, bh) * 0.7));
</script>

{#each cells as d (d.key)}
	<rect
		x={px(d.c)}
		y={py(d.r)}
		width={bw}
		height={bh}
		rx="1"
		class={cn(
			'dv-heatmap-cell',
			heatmapTierClass(d.tier),
			d.tier === worstTier && 'dv-heatmap-worst',
		)}
	></rect>
{/each}
{#if worstGlyph}
	{#each cells as d (d.key)}
		{#if d.tier === worstTier}
			<text
				class="dv-heatmap-glyph"
				x={px(d.c) + bw / 2}
				y={py(d.r) + bh / 2}
				font-size={glyphSize}
				text-anchor="middle"
				dominant-baseline="central"
				aria-hidden="true">{worstGlyph}</text
			>
		{/if}
	{/each}
{/if}
