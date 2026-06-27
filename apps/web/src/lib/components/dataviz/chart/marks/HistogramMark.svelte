<!--
  HistogramMark — the LayerChart renderer for a `kind: 'histogram'` ChartSpec (A1, S7).

  The signed-delay distribution: bins on a category x-axis, count on y. Diverging colour
  anchored at 0 — early bins (entirely ≤ -60 s) ride the early hue, the on-time band (the
  -60 s…+300 s window, the OTP definition) rides a light neutral, late bins (entirely
  ≥ +300 s) ride the late hue. THREE `<Bars>` over the three sign-filtered subsets share
  one band-x + linear-y, so each group colours via a class on its rects. The median + p90
  are vertical reference rules (NO mean — skew makes a mean lie).

  CLEAR AXES + MAX DATA: a labelled DELAY x-axis (ticked at the minute landmarks −5/−1/0/
  +1/+5/+10/+30) and a labelled COUNT y-axis + grid; a hover tooltip surfaces each bin's
  exact range, count, and share. The count axis is the distribution's own peak
  (spec.countDomain), a within-distribution shape, not a cross-view magnitude.
-->
<script lang="ts">
	import { Chart as LcChart, Svg, Bars, Rule, Axis, Grid, Highlight, Tooltip } from 'layerchart';
	import { scaleBand, scaleLinear } from 'd3-scale';
	import { cn } from '$lib/utils';
	import ChartFrame from '../ChartFrame.svelte';
	import type { HistogramBin, HistogramSpec } from '../ChartSpec';

	export interface HistogramMarkProps {
		spec: HistogramSpec;
		class?: string;
	}

	let { spec, class: className }: HistogramMarkProps = $props();

	const ON_TIME_LO = -60;
	const ON_TIME_HI = 300;
	/** The minute landmarks (in seconds) to tick on the x-axis. */
	const LANDMARKS_SEC = [-300, -60, 0, 60, 300, 600, 1800];

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
	const total = $derived(spec.bins.reduce((s, b) => s + b.count, 0));

	/** Bin indices whose lower edge is a minute landmark → the x-axis ticks. */
	const tickIdx = $derived(
		spec.bins
			.map((b, i) => (b.lo != null && LANDMARKS_SEC.includes(b.lo) ? i : -1))
			.filter((i) => i >= 0),
	);
	/** Format a bin index → its lower edge in minutes (the landmark label). */
	const xTickFormat = (i: number): string => {
		const lo = spec.bins[i]?.lo;
		return lo == null ? '' : `${Math.round(lo / 60)}`;
	};

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

	const padding = { top: 8, right: 12, bottom: 30, left: 40 };
	const xOf = (d: Row) => d.idx;
	const yOf = (d: Row) => d.count;

	const fmtRange = (b: HistogramBin): string =>
		`${b.lo == null ? '-∞' : Math.round(b.lo / 60)} to ${b.hi == null ? '+∞' : Math.round(b.hi / 60)} min`;
	const sharePct = (count: number): string =>
		total > 0 ? `${Math.round((count / total) * 100)}%` : '';
</script>

<figure class={cn('dv-histmark m-0', className)} aria-label={spec.title} data-slot="histogram-mark">
	<ChartFrame height="9rem" class="dv-histmark-plot">
		<LcChart
			{data}
			x={xOf}
			xScale={scaleBand().padding(0.12)}
			xDomain={idxDomain}
			y={yOf}
			yScale={scaleLinear()}
			{yDomain}
			{padding}
			tooltipContext={{ mode: 'band' }}
		>
			<Svg>
				<Grid y class="dv-histmark-grid" />
				<Axis
					placement="left"
					label={spec.yLabel}
					labelPlacement="middle"
					ticks={4}
					format={(v) => `${v}`}
					class="dv-histmark-axis"
				/>
				<Axis
					placement="bottom"
					label={spec.xLabel}
					labelPlacement="middle"
					ticks={tickIdx}
					format={xTickFormat}
					class="dv-histmark-axis"
				/>
				<Bars data={early} class="dv-histmark-early" />
				<Bars data={ontime} class="dv-histmark-ontime" />
				<Bars data={late} class="dv-histmark-late" />
				{#if medianIdx != null}
					<Rule x={medianIdx} class="dv-histmark-median" />
				{/if}
				{#if p90Idx != null}
					<Rule x={p90Idx} class="dv-histmark-p90" />
				{/if}
				<Highlight area />
			</Svg>
			<Tooltip.Root>
				{#snippet children({ data: d }: { data: Row })}
					<Tooltip.Header>{fmtRange(spec.bins[d.idx])}</Tooltip.Header>
					<Tooltip.List>
						<Tooltip.Item label="Trips" value={`${d.count}`} />
						<Tooltip.Item label="Share" value={sharePct(d.count)} />
					</Tooltip.List>
				{/snippet}
			</Tooltip.Root>
		</LcChart>
	</ChartFrame>

	<!-- AT fallback: the distribution as a table. -->
	<table class="sr-only">
		<caption>{spec.title}</caption>
		<thead>
			<tr><th scope="col">bin (min)</th><th scope="col">trips</th></tr>
		</thead>
		<tbody>
			{#each spec.bins as b, i (i)}
				<tr><th scope="row">{fmtRange(b)}</th><td>{b.count}</td></tr>
			{/each}
		</tbody>
	</table>
</figure>

<style>
	/* LayerChart puts the class ON each rect/line; target the element directly + beat
	   LayerChart's .lc-bar default fill. :global because LayerChart renders the marks. */
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
	:global(line.dv-histmark-median) {
		stroke: var(--border-strong, var(--border));
		stroke-width: 1;
	}
	:global(line.dv-histmark-p90) {
		stroke: var(--border-strong, var(--border));
		stroke-width: 0.75;
		stroke-dasharray: 3 3;
	}
	/* Axes: muted mono labels + titles; faint grid. */
	:global(.dv-histmark-axis .tick text) {
		fill: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-mono);
	}
	:global(.dv-histmark-axis .axis-label),
	:global(.dv-histmark-axis text.label) {
		fill: var(--muted-foreground);
		font-size: var(--text-mono);
	}
	:global(.dv-histmark-grid line) {
		stroke: var(--border);
		opacity: 0.5;
	}
</style>
