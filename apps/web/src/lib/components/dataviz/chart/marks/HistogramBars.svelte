<script lang="ts">
	import { getChartContext } from 'layerchart';

	export interface HistBar {
		key: number;
		lo: number;
		hi: number;
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
