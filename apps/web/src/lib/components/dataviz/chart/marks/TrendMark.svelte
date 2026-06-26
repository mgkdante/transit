<!--
  TrendMark — the LayerChart renderer for a `kind: 'trend'` ChartSpec (A3, S7).

  Two series over a shared x-scale: a primary line (on-time %) on its own pinned absolute
  domain, and an optional secondary line (avg delay, min) on a SECOND pinned domain.
  LayerChart marks only read the primary y-scale, so the two domains are kept honest by
  TWO overlaid `<LcChart>` contexts that share x-scale + padding + width — each owns its
  `yDomain`, so neither squashes the other.

  CLEAR AXES + MAX DATA: a labelled bottom x-axis (dates / time-of-day), a labelled LEFT
  y-axis (On-time %) on the primary context, a labelled RIGHT y-axis (Avg delay, min) on
  the secondary context, a y-grid, a legend, and a hover tooltip that reads the FULL datum
  (OTP %, avg delay, the Wilson interval, the sample n). `defined` breaks the line/band
  over null (a gap). Domains from the spec; ChartFrame-gated; sr-table fallback.
-->
<script lang="ts">
	import {
		Chart as LcChart,
		Svg,
		Spline,
		Points,
		Area,
		Rule,
		Axis,
		Grid,
		Highlight,
		Tooltip,
	} from 'layerchart';
	import { scaleLinear, scalePoint, scaleTime } from 'd3-scale';
	import { curveMonotoneX } from 'd3-shape';
	import { cn } from '$lib/utils';
	import ChartFrame from '../ChartFrame.svelte';
	import ChartLegend from '../../ChartLegend.svelte';
	import type { TrendDatum, TrendSpec } from '../ChartSpec';

	export interface TrendMarkProps {
		spec: TrendSpec;
		class?: string;
	}

	let { spec, class: className }: TrendMarkProps = $props();

	const data = $derived(spec.points.map((p) => ({ ...p })));
	const isTime = $derived(spec.xScale === 'time');
	const xOf = $derived((d: TrendDatum) => (isTime ? Number(d.x) : String(d.x)));

	const xDomain = $derived.by<number[] | string[]>(() => {
		if (isTime) {
			const xs = spec.points.map((p) => Number(p.x)).filter((v) => Number.isFinite(v));
			return xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 1];
		}
		return spec.points.map((p) => String(p.x));
	});

	const yDomain = $derived<[number, number]>([spec.domain[0], spec.domain[1]]);
	const secYDomain = $derived<[number, number] | null>(
		spec.secondary ? [spec.secondary.domain[0], spec.secondary.domain[1]] : null,
	);

	const hasBand = $derived(
		spec.hasBand && spec.points.some((p) => p.bandLo != null && p.bandHi != null),
	);
	const hasSecondary = $derived(!!spec.secondary && spec.points.some((p) => p.y2 != null));

	// Both overlaid contexts share IDENTICAL padding so their plot areas align (left axis
	// on the primary, right axis on the secondary, shared bottom axis).
	const padding = { top: 8, right: 46, bottom: 30, left: 44 };

	const yDefined = (d: TrendDatum) => d.y != null && !Number.isNaN(d.y);
	const y2Defined = (d: TrendDatum) => d.y2 != null && !Number.isNaN(d.y2);
	const bandDefined = (d: TrendDatum) =>
		d.bandLo != null && d.bandHi != null && !Number.isNaN(d.bandLo) && !Number.isNaN(d.bandHi);

	const num = (v: number | null | undefined): string => (v == null ? '' : String(v));

	// Confidence Comet: the OTP dot SIZE encodes the sample size (3 fixed-radius buckets —
	// LayerChart's per-point r-scale is unreliable, but the Points `r` prop is a stable
	// fixed override), so a small dot + a fat Wilson band BOTH read as "low confidence" at a
	// glance. Only DEFINED points get a dot — a null-y gap never dots at 0.
	const otpReals = $derived(data.filter((p) => p.y != null));
	const dotsLowN = $derived(otpReals.filter((p) => (p.n ?? 0) < 30));
	const dotsMidN = $derived(otpReals.filter((p) => (p.n ?? 0) >= 30 && (p.n ?? 0) < 100));
	const dotsHighN = $derived(otpReals.filter((p) => (p.n ?? 0) >= 100));

	// Label a time-x tick (epoch ms) compactly; band-x ticks are the labels themselves.
	const xTickFormat = $derived(
		isTime
			? (v: number) =>
					new Date(v).toLocaleDateString(spec.locale, { month: 'short', day: 'numeric' })
			: (v: string) => v,
	);

	const legendItems = $derived([
		{ colorVar: 'var(--dataviz-status-on-time)', label: spec.label, swatch: 'dot' as const },
		...(spec.secondary
			? [
					{
						colorVar: 'var(--dataviz-status-late)',
						label: spec.secondary.label,
						swatch: 'dot' as const,
					},
				]
			: []),
	]);
</script>

<figure class={cn('dv-trendmark m-0', className)} aria-label={spec.title} data-slot="trend-mark">
	<ChartFrame height="9rem" class="dv-trendmark-plot">
		<!-- Primary context: on-time line + Wilson band + target, with the LEFT y-axis. -->
		<LcChart
			{data}
			x={xOf}
			y={(d: TrendDatum) => d.y ?? 0}
			xScale={isTime ? scaleTime() : scalePoint()}
			{xDomain}
			yScale={scaleLinear()}
			{yDomain}
			{padding}
			tooltipContext={{ mode: isTime ? 'bisect-x' : 'band' }}
		>
			<Svg>
				<Grid y class="dv-trendmark-grid" />
				<Axis
					placement="left"
					label={spec.label}
					labelPlacement="middle"
					ticks={5}
					format={(v) => `${v}`}
					class="dv-trendmark-axis"
				/>
				<Axis
					placement="bottom"
					ticks={isTime ? 5 : undefined}
					format={xTickFormat}
					class="dv-trendmark-axis"
				/>
				{#if hasBand}
					<Area
						y0={(d: TrendDatum) => d.bandLo ?? 0}
						y1={(d: TrendDatum) => d.bandHi ?? 0}
						curve={curveMonotoneX}
						defined={bandDefined}
						class="dv-trendmark-band"
					/>
				{/if}
				{#if spec.target != null}
					<Rule y={spec.target} class="dv-trendmark-target" />
				{/if}
				<Spline
					y={(d: TrendDatum) => d.y ?? 0}
					curve={curveMonotoneX}
					defined={yDefined}
					class="dv-trendmark-otp"
				/>
				<!-- Confidence Comet: a dot per real point, radius bucketed by observation_count. -->
				<Points data={dotsLowN} r={2.5} class="dv-trendmark-otp-dot" />
				<Points data={dotsMidN} r={4} class="dv-trendmark-otp-dot" />
				<Points data={dotsHighN} r={6} class="dv-trendmark-otp-dot" />
				<Highlight points lines />
			</Svg>
			<Tooltip.Root>
				{#snippet children({ data: d }: { data: TrendDatum })}
					<Tooltip.Header>{d.xLabel}</Tooltip.Header>
					<Tooltip.List>
						<Tooltip.Item
							label={spec.label}
							value={`${num(d.y)}${spec.unit}`}
							color="var(--dataviz-status-on-time)"
						/>
						{#if spec.secondary}
							<Tooltip.Item
								label={spec.secondary.label}
								value={`${num(d.y2)}${spec.secondary.unit}`}
								color="var(--dataviz-status-late)"
							/>
						{/if}
						{#if d.bandLo != null && d.bandHi != null}
							<Tooltip.Item
								label="95% CI"
								value={`${num(d.bandLo)}-${num(d.bandHi)}${spec.unit}`}
							/>
						{/if}
						{#if d.n != null}
							<Tooltip.Item label="n" value={num(d.n)} />
						{/if}
					</Tooltip.List>
				{/snippet}
			</Tooltip.Root>
		</LcChart>

		{#if spec.secondary && hasSecondary && secYDomain}
			<!-- Secondary context overlaid (same x + padding + box) on its OWN domain + RIGHT axis. -->
			<div class="dv-trendmark-overlay" aria-hidden="true">
				<LcChart
					{data}
					x={xOf}
					y={(d: TrendDatum) => d.y2 ?? 0}
					xScale={isTime ? scaleTime() : scalePoint()}
					{xDomain}
					yScale={scaleLinear()}
					yDomain={secYDomain}
					{padding}
				>
					<Svg>
						<Axis
							placement="right"
							label={spec.secondary.label}
							labelPlacement="middle"
							ticks={4}
							format={(v) => `${v}`}
							class="dv-trendmark-axis dv-trendmark-axis--retard"
						/>
						<Spline
							y={(d: TrendDatum) => d.y2 ?? 0}
							curve={curveMonotoneX}
							defined={y2Defined}
							class="dv-trendmark-retard"
						/>
					</Svg>
				</LcChart>
			</div>
		{/if}
	</ChartFrame>

	<ChartLegend class="mt-1.5" items={legendItems} />

	<!-- AT fallback: the chart as a table. -->
	<table class="sr-only">
		<caption>{spec.title}</caption>
		<thead>
			<tr>
				<th scope="col">x</th>
				<th scope="col">{spec.label}{spec.unit}</th>
				{#if spec.secondary}<th scope="col">{spec.secondary.label}{spec.secondary.unit}</th>{/if}
			</tr>
		</thead>
		<tbody>
			{#each spec.points as p (p.xLabel)}
				<tr>
					<th scope="row">{p.xLabel}</th>
					<td>{num(p.y)}</td>
					{#if spec.secondary}<td>{num(p.y2)}</td>{/if}
				</tr>
			{/each}
		</tbody>
	</table>
</figure>

<style>
	.dv-trendmark-overlay {
		position: absolute;
		inset: 0;
	}

	/* Mark fills/strokes reach the LayerChart-emitted SVG via :global. */
	:global(.dv-trendmark-otp) {
		fill: none;
		stroke: var(--dataviz-status-on-time);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	/* Confidence Comet dots — radius (set via the Chart r accessor) encodes sample size. */
	:global(circle.dv-trendmark-otp-dot) {
		fill: var(--dataviz-status-on-time);
	}
	:global(.dv-trendmark-retard) {
		fill: none;
		stroke: var(--dataviz-status-late);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-dasharray: 4 3;
		opacity: 0.95;
	}
	:global(.dv-trendmark-band) {
		fill: color-mix(in oklab, var(--dataviz-status-on-time) 20%, var(--signage-bg));
		stroke: none;
	}
	:global(.dv-trendmark-target) {
		stroke: var(--border-strong, var(--border));
		stroke-width: 0.75;
		stroke-dasharray: 4 3;
	}
	/* Axes: muted mono tick labels + titles; faint grid. */
	:global(.dv-trendmark-axis .tick text) {
		fill: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
	}
	:global(.dv-trendmark-axis .axis-label),
	:global(.dv-trendmark-axis text.label) {
		fill: var(--muted-foreground);
		font-size: var(--text-micro);
	}
	:global(.dv-trendmark-grid line) {
		stroke: var(--border);
		opacity: 0.5;
	}
</style>
