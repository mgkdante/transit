<script lang="ts">
	import { getChartContext } from 'layerchart';

	let {
		elapsedMin,
		domainEnd,
		gridMins,
		title,
	}: {
		elapsedMin: number;
		domainEnd: number;
		gridMins: readonly number[];
		title: string;
	} = $props();

	const ctx = getChartContext();
	const h = $derived((ctx.height as number) ?? 0);
	const x = (min: number): number => (ctx.xScale(min) as number) ?? 0;
	const trackY = $derived(h * 0.5);
	const barW = $derived(x(elapsedMin) - x(0));
</script>

{#each gridMins as min (min)}
	<line class="dv-span-grid" x1={x(min)} y1={trackY - 6} x2={x(min)} y2={trackY + 6} />
{/each}
<line class="dv-span-track" x1={x(0)} y1={trackY} x2={x(domainEnd)} y2={trackY} />
{#if elapsedMin > 0}
	<rect class="dv-span-bar" x={x(0)} y={trackY - 4} width={barW} height={8} rx="2">
		<title>{title}</title>
	</rect>
	<circle class="dv-span-dot" cx={x(elapsedMin)} cy={trackY} r="3.5" />
{/if}
<!-- A zero-length interval is a point, not a minimum-width duration bar. -->
<circle class="dv-span-dot" cx={x(0)} cy={trackY} r="3.5" />
