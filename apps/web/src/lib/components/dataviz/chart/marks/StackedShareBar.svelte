<!--
  StackedShareBar — the segment layer for StackedShareMark, rendered INSIDE the LayerChart
  <Svg> so it can scale each segment's [start,end] share through the chart context's linear
  x-scale (LayerChart geometry treats a numeric x as a raw pixel, so we scale here). One
  rect per band on the dataviz occupancy scale; the chart's band tooltipContext drives the SHARED
  LayerChart tooltip (the mark renders <Tooltip.Root> listing every band's share, the same hover
  face as every other mark), and the labelled legend + sr-only table carry the meaning for AT.
  Operator: colour only — no on-bar glyph (the dark glyph read as an ugly black mark on the strip).
-->
<script lang="ts">
	import { getChartContext } from 'layerchart';

	export interface ShareSeg {
		key: string;
		label: string;
		share: number;
		start: number;
		end: number;
		fill: string;
	}
	let { segments }: { segments: readonly ShareSeg[] } = $props();

	const ctx = getChartContext();
	const h = $derived((ctx.height as number) ?? 0);
	const x = (v: number): number => (ctx.xScale(v) as number) ?? 0;
</script>

{#each segments as s (s.key)}
	{@const x0 = x(s.start)}
	{@const x1 = x(s.end)}
	<rect
		class="dv-share-seg"
		data-occ={s.key}
		x={x0}
		y={0}
		width={Math.max(0, x1 - x0)}
		height={h}
		fill={s.fill}
	/>
{/each}
