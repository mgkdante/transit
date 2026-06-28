<!--
  StackedShareBar — the segment layer for StackedShareMark, rendered INSIDE the LayerChart
  <Svg> so it can scale each segment's [start,end] share through the chart context's linear
  x-scale (LayerChart geometry treats a numeric x as a raw pixel, so we scale here). One
  rect per band on the dataviz occupancy scale. Pointer-move over a segment reports its band +
  share + pixel centre up to the mark, which renders a STYLED tooltip (the same hover face as
  every other chart); the labelled legend + the sr-only table carry the meaning for AT. Operator:
  colour + hover only — no on-bar glyph (the dark glyph read as an ugly black mark on the strip).
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
	export interface ShareHover {
		label: string;
		share: number;
		cx: number;
	}
	let {
		segments,
		onhover,
	}: { segments: readonly ShareSeg[]; onhover?: (h: ShareHover | null) => void } = $props();

	const ctx = getChartContext();
	const h = $derived((ctx.height as number) ?? 0);
	const x = (v: number): number => (ctx.xScale(v) as number) ?? 0;
</script>

{#each segments as s (s.key)}
	{@const x0 = x(s.start)}
	{@const x1 = x(s.end)}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<rect
		class="dv-share-seg"
		data-occ={s.key}
		x={x0}
		y={0}
		width={Math.max(0, x1 - x0)}
		height={h}
		fill={s.fill}
		onpointermove={() => onhover?.({ label: s.label, share: s.share, cx: (x0 + x1) / 2 })}
	/>
{/each}
