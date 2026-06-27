<!--
  StackedShareBar — the segment layer for StackedShareMark, rendered INSIDE the LayerChart
  <Svg> so it can scale each segment's [start,end] share through the chart context's linear
  x-scale (LayerChart geometry treats a numeric x as a raw pixel, so we scale here). One
  rect per band on the dataviz occupancy scale; a native <title> carries the per-segment
  readout on hover. Operator: colour + hover only — no on-bar glyph (the dark glyph read as
  an ugly black mark on the purple strip). The labelled legend + the hover carry the meaning.
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
	const round = (v: number): number => Math.round(v);
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
	>
		<title>{s.label}: {round(s.share)}%</title>
	</rect>
{/each}
