<!--
  HistogramMark — the LayerChart renderer for a `kind: 'histogram'` ChartSpec (A1, S7).

  The signed-delay distribution on a TRUE LINEAR delay axis (seconds, clipped to the decision
  window supplied by the chart spec). Each contract bin is unequal width (30 s near 0 → minutes in
  the tail), so a bar spans its real [lo,hi] and its HEIGHT is the density (count ÷ bin-width):
  the bar AREA is proportional to the trip count — the honest unequal-bin histogram. (Rendering
  one equal-pixel bar per bin would over-weight the wide tail bins and bend the time axis.)

  Diverging colour anchored at 0 — early bins (≤ -60 s) ride the early hue, the on-time band
  (-60 s…+300 s, the OTP definition) a light neutral, late bins (≥ +300 s) the late hue. The
  median + p90 are vertical reference rules (NO mean — skew makes a mean lie). A hover tooltip
  surfaces each bin's exact range, count, and share; an sr-only table is the AT fallback (it
  carries EVERY bin, including the rare extreme-early / -late ones the clipped view omits). The
  y-axis is the distribution's own shape (density), so it carries no cross-view magnitude scale.
-->
<script lang="ts">
	import { Chart as LcChart, Svg, Rule, Axis, Grid, Tooltip } from 'layerchart';
	import { scaleLinear } from 'd3-scale';
	import { cn } from '$lib/utils';
	import ChartFrame from '../ChartFrame.svelte';
	import { structuralLabels } from '../structuralLabels';
	import HistogramBars from './HistogramBars.svelte';
	import type { HistogramBin, HistogramSpec } from '../ChartSpec';

	export interface HistogramMarkProps {
		spec: HistogramSpec;
		class?: string;
	}

	let { spec, class: className }: HistogramMarkProps = $props();
	const structure = $derived(structuralLabels(spec.locale));

	const ON_TIME_LO = -60;
	const ON_TIME_HI = 300;
	const xDomain = $derived<[number, number]>([spec.domain[0], spec.domain[1]]);
	/** The minute landmarks (in seconds) to tick on the linear x-axis (those inside the window). */
	const landmarksSec = $derived(
		[-300, -60, 0, 60, 300, 600, 1800].filter((s) => s >= xDomain[0] && s <= xDomain[1]),
	);

	function groupOf(b: HistogramBin): 'early' | 'ontime' | 'late' {
		if (b.hi != null && b.hi <= ON_TIME_LO) return 'early';
		if (b.lo != null && b.lo >= ON_TIME_HI) return 'late';
		return 'ontime';
	}

	type Bar = {
		key: number;
		lo: number;
		hi: number;
		center: number;
		count: number;
		density: number;
		group: 'early' | 'ontime' | 'late';
	};
	// Only bins that fall WHOLLY inside the clipped delay window render — the rare extreme-early /
	// extreme-late tail bins are omitted from the plot (the p90 rule + the sr-table carry them) so
	// no bar is partially clipped and every bar's area stays an exact trip count.
	const bars = $derived<Bar[]>(
		spec.bins
			.map((b, i) => ({ b, i }))
			.filter(
				({ b }) =>
					b.lo != null && b.hi != null && b.lo >= xDomain[0] && b.hi <= xDomain[1] && b.hi > b.lo,
			)
			.map(({ b, i }) => {
				const lo = b.lo as number;
				const hi = b.hi as number;
				return {
					key: i,
					lo,
					hi,
					center: (lo + hi) / 2,
					count: b.count,
					density: b.count / (hi - lo),
					group: groupOf(b),
				};
			}),
	);
	const maxDensity = $derived(bars.reduce((m, b) => Math.max(m, b.density), 0));
	const yDomain = $derived<[number, number]>([0, maxDensity > 0 ? maxDensity : 1]);
	const total = $derived(spec.bins.reduce((s, b) => s + b.count, 0));

	/** Median / p90 reference positions (seconds), only when inside the visible window. */
	const medianRef = $derived(
		spec.medianRef != null && spec.medianRef >= xDomain[0] && spec.medianRef <= xDomain[1]
			? spec.medianRef
			: null,
	);
	const p90Ref = $derived(
		spec.p90Ref != null && spec.p90Ref >= xDomain[0] && spec.p90Ref <= xDomain[1]
			? spec.p90Ref
			: null,
	);

	const padding = { top: 12, right: 14, bottom: 40, left: 16 };

	const fmtRange = (b: { lo: number | null; hi: number | null }): string =>
		`${b.lo == null ? '-∞' : Math.round(b.lo / 60)} ${structure.rangeTo} ${b.hi == null ? '+∞' : Math.round(b.hi / 60)} min`;
	const sharePct = (count: number): string =>
		total > 0 ? `${Math.round((count / total) * 100)}%` : '';
	const minutesTick = (sec: number): string => `${Math.round(sec / 60)}`;
</script>

<figure class={cn('dv-histmark m-0', className)} aria-label={spec.title} data-slot="histogram-mark">
	<ChartFrame height="9rem" class="dv-histmark-plot">
		<LcChart
			data={bars}
			x={(d: Bar) => d.center}
			xScale={scaleLinear()}
			{xDomain}
			y={(d: Bar) => d.density}
			yScale={scaleLinear()}
			{yDomain}
			{padding}
			tooltipContext={{ mode: 'bisect-x' }}
		>
			<Svg>
				<Grid y class="dv-histmark-grid" />
				<!-- A real LINEAR delay axis (minutes), ticked at the landmark minute marks. -->
				<Axis
					placement="bottom"
					label={spec.xLabel}
					labelPlacement="middle"
					ticks={landmarksSec}
					format={minutesTick}
					class="dv-histmark-axis"
				/>
				<HistogramBars {bars} />
				{#if medianRef != null}
					<Rule x={medianRef} class="dv-histmark-median" />
				{/if}
				{#if p90Ref != null}
					<Rule x={p90Ref} class="dv-histmark-p90" />
				{/if}
			</Svg>
			<Tooltip.Root>
				{#snippet children({ data: d }: { data: Bar })}
					<Tooltip.Header>{fmtRange(d)}</Tooltip.Header>
					<Tooltip.List>
						<Tooltip.Item label={structure.tripsTitle} value={`${d.count}`} />
						<Tooltip.Item label={structure.share} value={sharePct(d.count)} />
					</Tooltip.List>
				{/snippet}
			</Tooltip.Root>
		</LcChart>
	</ChartFrame>

	<!-- AT fallback: the full distribution as a table (EVERY bin, incl. the clipped tail bins). -->
	<table class="sr-only">
		<caption>{spec.title}</caption>
		<thead>
			<tr><th scope="col">{structure.binMinutes}</th><th scope="col">{structure.tripsLower}</th></tr
			>
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
	   LayerChart's default fill. :global because LayerChart renders the marks. */
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
	:global(rect.dv-histmark-bar) {
		stroke: var(--card);
		stroke-width: 0.5;
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
	/* Axis: muted mono labels + title; faint grid. */
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
