<!--
  TrendMark — the LayerChart renderer for a `kind: 'trend'` ChartSpec (S7).

  Two series over a shared x-scale: a primary line (e.g. on-time %) on its own pinned
  absolute domain, and an optional secondary line (e.g. retard min) on a SECOND pinned
  domain. LayerChart marks only read the primary y-scale, so the two domains are kept
  honest by rendering TWO overlaid `<LcChart>` contexts that share x-scale + padding +
  width — each owns its `yDomain`, so neither squashes the other (the alternative,
  plotting minutes on the 0–100 % axis, flattens the delay line against the floor).

  Domains come from the SPEC (the selector supplies the `domains.ts` literal); this mark
  never derives an extent. `defined` breaks the line/band over `null` (a gap, never
  bridged). Colours ride the dataviz scale (status-on-time / status-late); the Wilson
  band is a solid pre-mixed muted green (not runtime alpha, so the page texture never
  bleeds through); the target rule is neutral chrome. A visually-hidden data table is the
  AT fallback every chart ships (Chart Doctrine).

  LayerChart renders its marks inside its OWN components, so this component's scoped
  styles can't reach the emitted SVG — the mark classes are namespaced `:global`.
-->
<script lang="ts">
	import { Chart as LcChart, Svg, Spline, Area, Rule } from 'layerchart';
	import { scaleLinear, scalePoint, scaleTime } from 'd3-scale';
	import { curveMonotoneX } from 'd3-shape';
	import { cn } from '$lib/utils';
	import ChartFrame from '../ChartFrame.svelte';
	import type { TrendDatum, TrendSpec } from '../ChartSpec';

	export interface TrendMarkProps {
		spec: TrendSpec;
		class?: string;
	}

	let { spec, class: className }: TrendMarkProps = $props();

	const data = $derived(spec.points.map((p) => ({ ...p })));
	const isTime = $derived(spec.xScale === 'time');

	// x accessor: epoch-number (time) or label (band). One accessor, switched by scale.
	const xOf = $derived((d: TrendDatum) => (isTime ? Number(d.x) : String(d.x)));

	// Explicit x-domain — never inferred-from-extent in a way the renderer controls:
	// time → [minEpoch, maxEpoch]; band → the ordered point labels (scalePoint domain).
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

	const padding = { top: 8, right: 10, bottom: 8, left: 10 };

	const yDefined = (d: TrendDatum) => d.y != null && !Number.isNaN(d.y);
	const y2Defined = (d: TrendDatum) => d.y2 != null && !Number.isNaN(d.y2);
	const bandDefined = (d: TrendDatum) =>
		d.bandLo != null && d.bandHi != null && !Number.isNaN(d.bandLo) && !Number.isNaN(d.bandHi);

	const num = (v: number | null | undefined): string => (v == null ? '' : String(v));
</script>

<figure class={cn('dv-trendmark m-0', className)} aria-label={spec.title} data-slot="trend-mark">
	<ChartFrame height="7.5rem" class="dv-trendmark-plot">
		<!-- Primary context: the on-time line on its pinned domain + Wilson band + target. -->
		<LcChart
			{data}
			x={xOf}
			xScale={isTime ? scaleTime() : scalePoint()}
			{xDomain}
			yScale={scaleLinear()}
			{yDomain}
			{padding}
		>
			<Svg>
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
			</Svg>
		</LcChart>

		{#if hasSecondary && secYDomain}
			<!-- Secondary context overlaid (same x-scale + padding + box) on its OWN domain. -->
			<div class="dv-trendmark-overlay" aria-hidden="true">
				<LcChart
					{data}
					x={xOf}
					xScale={isTime ? scaleTime() : scalePoint()}
					{xDomain}
					yScale={scaleLinear()}
					yDomain={secYDomain}
					{padding}
				>
					<Svg>
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

	<!-- AT fallback: the chart as a table (Chart Doctrine — every chart ships one). -->
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
	/* The plot box (height + position:relative) is owned by ChartFrame. */
	.dv-trendmark-overlay {
		position: absolute;
		inset: 0;
	}

	/* LayerChart renders the marks in its own components, so these reach the emitted
	   SVG via :global. Namespaced to this mark so they don't leak as utilities. */
	:global(.dv-trendmark-otp) {
		fill: none;
		stroke: var(--dataviz-status-on-time);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
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
	/* Wilson band: a SOLID pre-mixed muted on-time green (mixed toward the signage bg,
	   never runtime alpha on a surface) so the page grid never bleeds through. */
	:global(.dv-trendmark-band) {
		fill: color-mix(in oklab, var(--dataviz-status-on-time) 20%, var(--signage-bg));
		stroke: none;
	}
	/* Target rule (e.g. 80% OTP): neutral chrome, never a data/affordance token. */
	:global(.dv-trendmark-target) {
		stroke: var(--border-strong, var(--border));
		stroke-width: 0.75;
		stroke-dasharray: 4 3;
	}
</style>
