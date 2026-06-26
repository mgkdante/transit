<!--
  HistogramMark — the LayerChart renderer for a `kind: 'histogram'` ChartSpec (A1, S7).

  The signed-delay distribution: bins on a category x-axis, count on y. Diverging colour
  anchored at 0 — early bins (entirely ≤ -60 s) ride the early hue, the on-time band (the
  -60 s…+300 s window, the OTP definition) rides a light neutral, late bins (entirely
  ≥ +300 s) ride the late hue. Rendered as THREE `<Bars>` over the three sign-filtered
  subsets sharing ONE band x-scale + linear y-scale, so each group is coloured without a
  per-bar fill accessor. The median + p90 are vertical reference rules at their bin (NO
  mean — skew makes a mean lie). The count axis is the distribution's own peak
  (spec.countDomain), a within-distribution shape, not a cross-view magnitude.

  Domains come from the spec; LayerChart never derives an extent. A visually-hidden table
  is the AT fallback. Styles reach the LayerChart-emitted SVG via namespaced :global.
-->
<script lang="ts">
	import { Chart as LcChart, Svg, Bars, Rule } from 'layerchart';
	import { scaleBand, scaleLinear } from 'd3-scale';
	import { cn } from '$lib/utils';
	import ChartFrame from '../ChartFrame.svelte';
	import type { HistogramBin, HistogramSpec } from '../ChartSpec';

	export interface HistogramMarkProps {
		spec: HistogramSpec;
		class?: string;
	}

	let { spec, class: className }: HistogramMarkProps = $props();

	/** The OTP on-time window (seconds): -60 s early tolerance … +300 s late tolerance. */
	const ON_TIME_LO = -60;
	const ON_TIME_HI = 300;

	function groupOf(b: HistogramBin): 'early' | 'ontime' | 'late' {
		if (b.hi != null && b.hi <= ON_TIME_LO) return 'early';
		if (b.lo != null && b.lo >= ON_TIME_HI) return 'late';
		return 'ontime';
	}

	type Row = { idx: number; count: number; group: 'early' | 'ontime' | 'late' };
	const data = $derived<Row[]>(
		spec.bins.map((b, i) => ({ idx: i, count: b.count, group: groupOf(b) })),
	);
	const idxDomain = $derived(data.map((d) => d.idx));
	const yDomain = $derived<[number, number]>([spec.countDomain[0], spec.countDomain[1]]);
	const early = $derived(data.filter((d) => d.group === 'early'));
	const ontime = $derived(data.filter((d) => d.group === 'ontime'));
	const late = $derived(data.filter((d) => d.group === 'late'));

	/** The bin index whose [lo, hi) contains a reference value (median / p90), or null. */
	function binIndexFor(ref: number | null | undefined): number | null {
		if (ref == null) return null;
		for (let i = 0; i < spec.bins.length; i++) {
			const lo = spec.bins[i].lo ?? Number.NEGATIVE_INFINITY;
			const hi = spec.bins[i].hi ?? Number.POSITIVE_INFINITY;
			if (ref >= lo && ref < hi) return i;
		}
		return null;
	}
	const medianIdx = $derived(binIndexFor(spec.medianRef));
	const p90Idx = $derived(binIndexFor(spec.p90Ref));

	const padding = { top: 8, right: 8, bottom: 8, left: 8 };
	const xOf = (d: Row) => d.idx;
	const yOf = (d: Row) => d.count;

	const fmtRange = (b: HistogramBin): string => `${b.lo ?? '-∞'} to ${b.hi ?? '+∞'}${spec.unit}`;
</script>

<figure class={cn('dv-histmark m-0', className)} aria-label={spec.title} data-slot="histogram-mark">
	<ChartFrame height="7.5rem" class="dv-histmark-plot">
		<LcChart
			{data}
			x={xOf}
			xScale={scaleBand().padding(0.12)}
			xDomain={idxDomain}
			y={yOf}
			yScale={scaleLinear()}
			{yDomain}
			{padding}
		>
			<Svg>
				<Bars data={early} class="dv-histmark-early" />
				<Bars data={ontime} class="dv-histmark-ontime" />
				<Bars data={late} class="dv-histmark-late" />
				{#if medianIdx != null}
					<Rule x={medianIdx} class="dv-histmark-median" />
				{/if}
				{#if p90Idx != null}
					<Rule x={p90Idx} class="dv-histmark-p90" />
				{/if}
			</Svg>
		</LcChart>
	</ChartFrame>

	<!-- AT fallback: the distribution as a table. -->
	<table class="sr-only">
		<caption>{spec.title}</caption>
		<thead>
			<tr><th scope="col">bin</th><th scope="col">count</th></tr>
		</thead>
		<tbody>
			{#each spec.bins as b, i (i)}
				<tr><th scope="row">{fmtRange(b)}</th><td>{b.count}</td></tr>
			{/each}
		</tbody>
	</table>
</figure>

<style>
	/* The diverging delay distribution: early ride the early hue, the on-time band a light
	   neutral, late the late hue. LayerChart puts the class ON each rect (alongside .lc-bar),
	   so target the rect directly (rect.class beats LayerChart's .lc-bar default fill).
	   :global because LayerChart renders the bars in its own component. */
	:global(rect.dv-histmark-early) {
		fill: var(--dataviz-status-early);
	}
	:global(rect.dv-histmark-ontime) {
		fill: var(--dataviz-status-on-time);
		opacity: 0.45;
	}
	:global(rect.dv-histmark-late) {
		fill: var(--dataviz-status-late);
	}
	/* Median (solid) + p90 (dashed) reference rules — neutral chrome, never a data hue.
	   LayerChart's Rule renders a <line>; the class lands on it. */
	:global(line.dv-histmark-median) {
		stroke: var(--border-strong, var(--border));
		stroke-width: 1;
	}
	:global(line.dv-histmark-p90) {
		stroke: var(--border-strong, var(--border));
		stroke-width: 0.75;
		stroke-dasharray: 3 3;
	}
</style>
