<!--
  DotStripMark — the LayerChart renderer for a `kind: 'dot-strip'` ChartSpec (A8, S7).

  A Cleveland dot plot: one dot per group (e.g. the 5 time-of-day shifts) on ONE shared,
  fixed value axis (the spec's absolute domain). The dot's POSITION encodes the value (the
  primary channel); its colour is the severity band (secondary). Dots are NEVER connected.
  The all-day mean is a vertical reference rule. A null-value group is an honest gap.

  CLEAR AXES + MAX DATA: a labelled value x-axis (with its title + unit + grid) and a
  labelled group y-axis; a hover tooltip surfaces the exact value per dot. Dots split into
  per-severity `<Points>` so each colours via a class on its circles. Domains from the
  spec; ChartFrame-gated; sr-table fallback.
-->
<script lang="ts">
	import { Chart as LcChart, Svg, Points, Rule, Axis, Grid, Highlight, Tooltip } from 'layerchart';
	import { scaleBand, scaleLinear } from 'd3-scale';
	import { cn } from '$lib/utils';
	import ChartFrame from '../ChartFrame.svelte';
	import type { DotStripDatum, DotStripSpec } from '../ChartSpec';
	import type { SeverityCode } from '$lib/v1/schemas';

	export interface DotStripMarkProps {
		spec: DotStripSpec;
		class?: string;
	}

	let { spec, class: className }: DotStripMarkProps = $props();

	const groups = $derived([...new Set(spec.points.map((p) => p.group))]);
	const reals = $derived(spec.points.filter((p) => p.value != null));
	const xDomain = $derived<[number, number]>([spec.domain[0], spec.domain[1]]);

	const bySeverity = (sev: SeverityCode): DotStripDatum[] =>
		reals.filter((p) => (p.severity ?? 'watch') === sev);

	const xOf = (d: DotStripDatum) => d.value ?? 0;
	const yOf = (d: DotStripDatum) => d.group;

	const frameHeight = $derived(`${Math.max(3, groups.length) * 1.5 + 3.25}rem`);
	const padding = { top: 8, right: 16, bottom: 40, left: 80 };

	const fmtVal = (v: number | null): string => (v == null ? '' : String(v));
</script>

<figure
	class={cn('dv-stripmark m-0', className)}
	aria-label={spec.title}
	data-slot="dot-strip-mark"
>
	<ChartFrame height={frameHeight} class="dv-stripmark-plot">
		<LcChart
			data={reals}
			x={xOf}
			xScale={scaleLinear()}
			{xDomain}
			y={yOf}
			yScale={scaleBand().padding(0.4)}
			yDomain={groups}
			{padding}
			tooltipContext={{ mode: 'band' }}
		>
			<Svg>
				<Grid x class="dv-stripmark-grid" />
				<!-- Value x-axis: the severe-share scale, titled + units, with grid ticks. -->
				<Axis
					placement="bottom"
					label={spec.unit ? `${spec.title} (${spec.unit})` : spec.title}
					labelPlacement="middle"
					ticks={5}
					format={(v) => `${v}`}
					class="dv-stripmark-axis"
				/>
				<!-- Group y-axis: the row labels (no rule line — the dots carry the read). -->
				<Axis placement="left" rule={false} class="dv-stripmark-axis" />
				{#if spec.medianRef != null}
					<Rule x={spec.medianRef} class="dv-stripmark-mean" />
				{/if}
				<Points data={bySeverity('watch')} r={4.5} class="dv-stripmark-watch" />
				<Points data={bySeverity('high')} r={4.5} class="dv-stripmark-high" />
				<Points data={bySeverity('critical')} r={4.5} class="dv-stripmark-critical" />
				<Highlight points axis="y" />
			</Svg>
			<Tooltip.Root>
				{#snippet children({ data }: { data: DotStripDatum })}
					<Tooltip.Header>{data.group}</Tooltip.Header>
					<Tooltip.List>
						<Tooltip.Item label={spec.title} value={`${fmtVal(data.value)}${spec.unit}`} />
					</Tooltip.List>
				{/snippet}
			</Tooltip.Root>
		</LcChart>
	</ChartFrame>

	<!-- AT fallback: the strip as a table (value per group + honest absence). -->
	<table class="sr-only">
		<caption>{spec.title}</caption>
		<thead>
			<tr><th scope="col">group</th><th scope="col">{spec.unit}</th></tr>
		</thead>
		<tbody>
			{#each spec.points as p (p.key)}
				<tr><th scope="row">{p.group}</th><td>{fmtVal(p.value)}</td></tr>
			{/each}
		</tbody>
	</table>
</figure>

<style>
	/* LayerChart renders these in its own components → :global. The class lands on the
	   circle (Points) / line (Rule) / axis group (Axis) / grid line. */
	:global(circle.dv-stripmark-watch) {
		fill: var(--dataviz-severity-watch);
	}
	:global(circle.dv-stripmark-high) {
		fill: var(--dataviz-severity-high);
	}
	:global(circle.dv-stripmark-critical) {
		fill: var(--dataviz-severity-critical);
	}
	:global(line.dv-stripmark-mean) {
		stroke: var(--border-strong, var(--border));
		stroke-width: 0.75;
		stroke-dasharray: 3 3;
	}
	/* Axis: muted mono labels + a faint axis rule + title; grid a faint neutral. */
	:global(.dv-stripmark-axis .tick text) {
		fill: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-mono);
	}
	:global(.dv-stripmark-axis .axis-label),
	:global(.dv-stripmark-axis text.label) {
		fill: var(--muted-foreground);
		font-size: var(--text-mono);
	}
	:global(.dv-stripmark-grid line) {
		stroke: var(--border);
		opacity: 0.5;
	}
</style>
