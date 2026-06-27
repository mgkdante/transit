<!--
  ServiceSpanBar — the timeline layer for ServiceSpanMark, rendered INSIDE the LayerChart
  <Svg> so it can scale the first/last departure minutes through the chart context's linear
  24h x-scale. Draws the full-day baseline track, the structural 06/12/18 grid ticks, the
  first→last span bar (on the dataviz on-time scale), and an endpoint cap at each end so a
  zero-length span (first==last) still reads. The hour axis + readouts live in the parent.
-->
<script lang="ts">
	import { getChartContext } from 'layerchart';

	let {
		firstMin,
		lastMin,
		gridMins,
		title,
	}: {
		firstMin: number | null;
		lastMin: number | null;
		gridMins: readonly number[];
		title: string;
	} = $props();

	const ctx = getChartContext();
	const h = $derived((ctx.height as number) ?? 0);
	const x = (m: number): number => (ctx.xScale(m) as number) ?? 0;
	const trackY = $derived(h * 0.5);
	const barX = $derived(
		firstMin != null && lastMin != null ? Math.min(x(firstMin), x(lastMin)) : null,
	);
	const barW = $derived(
		firstMin != null && lastMin != null ? Math.abs(x(lastMin) - x(firstMin)) : 0,
	);
</script>

<!-- Structural 24h grid ticks (06/12/18) — orientation rules, not data. -->
{#each gridMins as g (g)}
	<line class="dv-span-grid" x1={x(g)} y1={trackY - 6} x2={x(g)} y2={trackY + 6} />
{/each}
<!-- The full-day baseline track (the empty hours read as absent). -->
<line class="dv-span-track" x1={x(0)} y1={trackY} x2={x(1440)} y2={trackY} />
<!-- The service-span bar (first→last) on the dataviz on-time scale. -->
{#if barX != null}
	<rect class="dv-span-bar" x={barX} y={trackY - 4} width={Math.max(barW, 2)} height={8} rx="2">
		<title>{title}</title>
	</rect>
{/if}
<!-- Endpoint caps so a zero-length span is still visible. -->
{#if firstMin != null}
	<circle class="dv-span-dot" cx={x(firstMin)} cy={trackY} r="3.5" />
{/if}
{#if lastMin != null}
	<circle class="dv-span-dot" cx={x(lastMin)} cy={trackY} r="3.5" />
{/if}
