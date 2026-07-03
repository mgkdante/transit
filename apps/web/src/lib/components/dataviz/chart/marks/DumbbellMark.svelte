<!--
  DumbbellMark — the LayerChart renderer for a `kind: 'dumbbell'` ChartSpec (A8, S7). One
  row per category; two endpoints (scheduled ● —— ● observed) joined by a connector so the
  GAP reads at a glance (e.g. "scheduled every 8 min, actually every 13"). Both endpoints
  share ONE fixed zero-based value domain (never /max). The connector is a thin floating
  <Bar> (x→x1); the endpoints are <Points> (scheduled = muted reference, observed =
  severity-coloured). CLEAR AXES + MAX DATA: a labelled value x-axis + the category y-axis
  + grid + a two-endpoint legend + a hover tooltip (scheduled · observed · gap). Honest
  absence: a row missing either endpoint keeps its labelled row but reads "no data" (the
  selector bakes the marker into the label) — never a fabricated bar. ChartFrame-gated;
  sr-table fallback.
-->
<script lang="ts">
	import { Chart as LcChart, Svg, Bar, Points, Axis, Grid, Tooltip } from 'layerchart';
	import { scaleBand, scaleLinear } from 'd3-scale';
	import { cn } from '$lib/utils';
	import ChartFrame from '../ChartFrame.svelte';
	import { categoryGutter } from '../axisGutter';
	import type { DumbbellSpec, DumbbellDatum } from '../ChartSpec';
	import type { SeverityCode } from '$lib/v1/schemas';

	export interface DumbbellMarkProps {
		spec: DumbbellSpec;
		class?: string;
	}

	let { spec, class: className }: DumbbellMarkProps = $props();

	const labels = $derived(spec.rows.map((r) => r.label));
	// A row needs BOTH endpoints to draw a connector + both dots.
	const reals = $derived(spec.rows.filter((r) => r.scheduled != null && r.observed != null));
	const xDomain = $derived<[number, number]>([spec.domain[0], spec.domain[1]]);

	const obsBySeverity = (sev: SeverityCode): DumbbellDatum[] =>
		reals.filter((r) => (r.severity ?? 'watch') === sev);

	const schedOf = (d: DumbbellDatum) => d.scheduled ?? 0;
	const obsOf = (d: DumbbellDatum) => d.observed ?? 0;
	const yOf = (d: DumbbellDatum) => d.label;

	const frameHeight = $derived(`${Math.max(3, spec.rows.length) * 1.5 + 4}rem`);
	// Operator: size the category gutter FROM the labels so short shift labels don't waste room and
	// a longer "AM peak · dir 0" variant still fits (truncated to the gutter when it can't).
	const gutter = $derived(categoryGutter(labels, { min: 88, max: 168 }));
	const padding = $derived({ top: 12, right: 18, bottom: 42, left: gutter.left });

	const fmt = (v: number | null | undefined): string => (v == null ? '' : String(v));
</script>

<figure class={cn('dv-dumbbell m-0', className)} aria-label={spec.title} data-slot="dumbbell-mark">
	<!-- Two-endpoint legend: which dot is scheduled vs observed. -->
	<div class="dv-dumbbell-legend" aria-hidden="true">
		<span class="dv-dumbbell-key"
			><span class="dv-dumbbell-swatch sched"></span>{spec.scheduledLabel}</span
		>
		<span class="dv-dumbbell-key"
			><span class="dv-dumbbell-swatch obs"></span>{spec.observedLabel}</span
		>
	</div>

	<ChartFrame height={frameHeight} class="dv-dumbbell-plot">
		<LcChart
			data={reals}
			x={schedOf}
			y={yOf}
			xScale={scaleLinear().clamp(true)}
			{xDomain}
			yScale={scaleBand().padding(0.5)}
			yDomain={labels}
			{padding}
			tooltipContext={{ mode: 'band' }}
		>
			<Svg>
				<Grid x class="dv-dumbbell-grid" />
				<Axis
					placement="bottom"
					label={spec.xLabel}
					labelPlacement="middle"
					ticks={5}
					format={(v) => `${v}`}
					class="dv-dumbbell-axis"
				/>
				<Axis
					placement="left"
					rule={false}
					format={(l: string) => gutter.truncate(l)}
					class="dv-dumbbell-axis"
				/>
				<!-- Connectors: a thin floating bar from scheduled (chart x) to observed (x1). -->
				{#each reals as row (row.key)}
					<Bar data={row} x1={obsOf} radius={2} class="dv-dumbbell-conn" />
				{/each}
				<!-- Scheduled endpoint (muted reference). -->
				<Points r={4} class="dv-dumbbell-sched" />
				<!-- Observed endpoint, severity-coloured (the "is it bad" signal). -->
				<Points data={obsBySeverity('watch')} x={obsOf} r={5} class="dv-dumbbell-obs-watch" />
				<Points data={obsBySeverity('high')} x={obsOf} r={5} class="dv-dumbbell-obs-high" />
				<Points data={obsBySeverity('critical')} x={obsOf} r={5} class="dv-dumbbell-obs-critical" />
			</Svg>
			<Tooltip.Root>
				{#snippet children({ data }: { data: DumbbellDatum })}
					<Tooltip.Header>{data.label}</Tooltip.Header>
					<Tooltip.List>
						<Tooltip.Item
							label={spec.scheduledLabel}
							value={`${fmt(data.scheduled)}${spec.unit}`}
						/>
						<Tooltip.Item label={spec.observedLabel} value={`${fmt(data.observed)}${spec.unit}`} />
						{#if data.excess != null}
							<Tooltip.Item label="gap" value={`${fmt(data.excess)}${spec.unit}`} />
						{/if}
						{#if data.note}<Tooltip.Item label="" value={data.note} />{/if}
					</Tooltip.List>
				{/snippet}
			</Tooltip.Root>
		</LcChart>
	</ChartFrame>

	<table class="sr-only">
		<caption>{spec.title}</caption>
		<thead>
			<tr>
				<th scope="col">row</th>
				<th scope="col">{spec.scheduledLabel}</th>
				<th scope="col">{spec.observedLabel}</th>
			</tr>
		</thead>
		<tbody>
			{#each spec.rows as r (r.key)}
				<tr data-key={r.key}>
					<th scope="row">{r.label}</th>
					<td>{fmt(r.scheduled)}</td>
					<td>{fmt(r.observed)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</figure>

<style>
	.dv-dumbbell-legend {
		display: flex;
		gap: var(--spacing-4, 1rem);
		margin-bottom: var(--spacing-1, 0.25rem);
		font-size: var(--text-mono);
		color: var(--muted-foreground);
	}
	.dv-dumbbell-key {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.dv-dumbbell-swatch {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
	}
	.dv-dumbbell-swatch.sched {
		background: var(--muted-foreground);
	}
	.dv-dumbbell-swatch.obs {
		background: var(--dataviz-severity-high);
	}
	/* Connector + endpoints (LayerChart puts the class on each rect/circle). */
	:global(rect.dv-dumbbell-conn) {
		fill: var(--border);
		opacity: 0.7;
	}
	:global(circle.dv-dumbbell-sched) {
		fill: var(--muted-foreground);
	}
	:global(circle.dv-dumbbell-obs-watch) {
		fill: var(--dataviz-severity-watch);
	}
	:global(circle.dv-dumbbell-obs-high) {
		fill: var(--dataviz-severity-high);
	}
	:global(circle.dv-dumbbell-obs-critical) {
		fill: var(--dataviz-severity-critical);
	}
	:global(.dv-dumbbell-axis .tick text) {
		fill: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-mono);
	}
	:global(.dv-dumbbell-axis .axis-label),
	:global(.dv-dumbbell-axis text.label) {
		fill: var(--muted-foreground);
		font-size: var(--text-mono);
	}
	:global(.dv-dumbbell-grid line) {
		stroke: var(--border);
		opacity: 0.5;
	}
</style>
