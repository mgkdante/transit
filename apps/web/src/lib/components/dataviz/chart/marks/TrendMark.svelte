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
	import { cn, fmtCount, fmtNumber } from '$lib/utils';
	import { absenceShort } from '$lib/site/absence';
	import { prefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
	import { trendTimeAxis } from '../trendTimeAxis';
	import ChartFrame from '../ChartFrame.svelte';
	import { structuralLabels } from '../structuralLabels';
	import ChartLegend from '../../ChartLegend.svelte';
	import type { TrendDatum, TrendSpec } from '../ChartSpec';

	export interface TrendMarkProps {
		spec: TrendSpec;
		class?: string;
	}

	let { spec, class: className }: TrendMarkProps = $props();

	const data = $derived(spec.points.map((p) => ({ ...p })));
	const isTime = $derived(spec.xScale === 'time');
	const structure = $derived(structuralLabels(spec.locale));
	const xOf = $derived((d: TrendDatum) => (isTime ? Number(d.x) : String(d.x)));

	const timeAxis = $derived(trendTimeAxis(spec.points, spec.locale));
	const xDomain = $derived(isTime ? timeAxis.domain : spec.points.map((p) => String(p.x)));

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
	const padding = { top: 12, right: 48, bottom: 40, left: 48 };

	const yDefined = (d: TrendDatum) => d.y != null && !Number.isNaN(d.y);
	const y2Defined = (d: TrendDatum) => d.y2 != null && !Number.isNaN(d.y2);
	const bandDefined = (d: TrendDatum) =>
		d.bandLo != null && d.bandHi != null && !Number.isNaN(d.bandLo) && !Number.isNaN(d.bandHi);

	const noData = $derived(absenceShort('no-observations', spec.locale));
	const num = (value: number | null | undefined): string | null =>
		fmtNumber(value, { rounding: 'auto', locale: spec.locale });
	const valueLabel = (value: number | null | undefined, unit: string): string => {
		const formatted = num(value);
		return formatted == null ? noData : `${formatted}${unit}`;
	};
	const primaryColor = $derived(spec.colorVar ?? 'var(--dataviz-status-on-time)');

	// Confidence Comet: the OTP dot SIZE encodes the sample size (3 fixed-radius buckets —
	// LayerChart's per-point r-scale is unreliable, but the Points `r` prop is a stable
	// fixed override), so a small dot + a fat Wilson band BOTH read as "low confidence" at a
	// glance. Only DEFINED points get a dot — a null-y gap never dots at 0.
	const otpReals = $derived(data.filter((p) => p.y != null));
	const dotsLowN = $derived(otpReals.filter((p) => (p.n ?? 0) < 30));
	const dotsMidN = $derived(otpReals.filter((p) => (p.n ?? 0) >= 30 && (p.n ?? 0) < 100));
	const dotsHighN = $derived(otpReals.filter((p) => (p.n ?? 0) >= 100));

	const xTickFormat = $derived(isTime ? timeAxis.format : (value: string) => value);

	const legendItems = $derived([
		{ colorVar: primaryColor, label: spec.label, swatch: 'dot' as const },
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
					ticks={isTime ? timeAxis.ticks : undefined}
					tickSpacing={isTime ? undefined : 96}
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
					style={`stroke:${primaryColor}`}
					class="dv-trendmark-otp"
				/>
				<!-- Confidence Comet: a dot per real point, radius bucketed by observation_count. -->
				<Points
					data={dotsLowN}
					r={2.5}
					style={`fill:${primaryColor}`}
					class="dv-trendmark-otp-dot"
				/>
				<Points data={dotsMidN} r={4} style={`fill:${primaryColor}`} class="dv-trendmark-otp-dot" />
				<Points
					data={dotsHighN}
					r={6}
					style={`fill:${primaryColor}`}
					class="dv-trendmark-otp-dot"
				/>
				<Highlight points lines />
			</Svg>
			{#key $prefersReducedMotion}
				<Tooltip.Root
					contained="window"
					motion={$prefersReducedMotion ? 'none' : 'spring'}
					fadeDuration={$prefersReducedMotion ? 0 : 100}
				>
					{#snippet children({ data: d }: { data: TrendDatum })}
						<Tooltip.Header>{d.xLabel}</Tooltip.Header>
						<Tooltip.List>
							<Tooltip.Item
								label={spec.label}
								value={valueLabel(d.y, spec.unit)}
								color={primaryColor}
							/>
							{#if spec.secondary}
								<Tooltip.Item
									label={spec.secondary.label}
									value={valueLabel(d.y2, spec.secondary.unit)}
									color="var(--dataviz-status-late)"
								/>
							{/if}
							{#if num(d.bandLo) != null && num(d.bandHi) != null}
								<Tooltip.Item
									label={structure.confidenceInterval95}
									value={`${num(d.bandLo)}-${num(d.bandHi)}${spec.unit}`}
								/>
							{/if}
							{#if d.n != null}
								<Tooltip.Item label="n" value={fmtCount(d.n, { locale: spec.locale, noData })} />
							{/if}
						</Tooltip.List>
					{/snippet}
				</Tooltip.Root>
			{/key}
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
				<th scope="col">{structure.x}</th>
				<th scope="col">{spec.label}</th>
				{#if spec.secondary}<th scope="col">{spec.secondary.label}</th>{/if}
			</tr>
		</thead>
		<tbody>
			{#each spec.points as p (p.xLabel)}
				<tr>
					<th scope="row">{p.xLabel}</th>
					<td>{valueLabel(p.y, spec.unit)}</td>
					{#if spec.secondary}<td>{valueLabel(p.y2, spec.secondary.unit)}</td>{/if}
				</tr>
			{/each}
		</tbody>
	</table>
</figure>

<style>
	.dv-trendmark-overlay {
		position: absolute;
		inset: 0;
		/* The secondary (right-axis) chart is purely visual + aria-hidden — let pointer
		   events pass THROUGH to the primary chart underneath, or it eats the hover and the
		   trend reads as "not hoverable". The primary tooltip already lists the y2 series. */
		pointer-events: none;
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
		font-size: var(--text-mono);
	}
	:global(.dv-trendmark-axis .axis-label),
	:global(.dv-trendmark-axis text.label) {
		fill: var(--muted-foreground);
		font-size: var(--text-mono);
	}
	:global(.dv-trendmark-grid line) {
		stroke: var(--border);
		opacity: 0.5;
	}
</style>
