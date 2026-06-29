<!--
  HistogramBars — the density-bar layer for HistogramMark, rendered INSIDE the LayerChart <Svg>
  so it can scale each bin's [lo,hi] seconds span through the chart context's LINEAR x-scale and
  its y-scale. Each bar spans the bin's true width on a real delay axis and its HEIGHT is the
  density (count ÷ bin-width-seconds), so the bar AREA is proportional to the trip count — the
  honest representation of an unequal-width-bin histogram (equal-pixel-per-bin over-weights the
  wide tail bins and bends the time axis). Coloured by the bin's sign group via a class.
-->
<script lang="ts">
	import { getChartContext } from 'layerchart';

	export interface HistBar {
		key: number;
		/** Bin edges in SECONDS (already filtered to the visible domain). */
		lo: number;
		hi: number;
		/** Density = count / (hi − lo) seconds — the bar height in data units. */
		density: number;
		group: 'early' | 'ontime' | 'late';
	}
	let { bars }: { bars: readonly HistBar[] } = $props();

	const ctx = getChartContext();
	const x = (v: number): number => (ctx.xScale(v) as number) ?? 0;
	const y = (v: number): number => (ctx.yScale(v) as number) ?? 0;
	const baseline = $derived(y(0));
</script>

{#each bars as b (b.key)}
	{@const xa = x(b.lo)}
	{@const xb = x(b.hi)}
	{@const yt = y(b.density)}
	<rect
		class="dv-histmark-bar dv-histmark-{b.group}"
		x={Math.min(xa, xb)}
		y={yt}
		width={Math.max(0, Math.abs(xb - xa))}
		height={Math.max(0, baseline - yt)}
	/>
{/each}
