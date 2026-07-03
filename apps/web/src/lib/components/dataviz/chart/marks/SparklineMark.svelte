<!--
  SparklineMark — the LayerChart renderer for a `kind: 'sparkline'` ChartSpec (A5, P5.2).
  The inline mini-trend: ONE series, NO axes/grid, drawn small inside a KPI card, pane or
  context row. Still a magnitude mark: y rides the spec's explicit zero-based absolute
  domain (never /max), so the same value reads the same height on every card/refresh.
  Nulls are honest GAPS (the spline breaks, never bridged). Hover/focus lists the hovered
  point in the SHARED LayerChart tooltip; an sr-only table is the AT mirror. Colour is a
  dataviz token var from the spec — never an affordance token.
-->
<script lang="ts">
	import { Chart as LcChart, Svg, Spline, Points, Highlight, Tooltip } from 'layerchart';
	import { scaleLinear, scalePoint } from 'd3-scale';
	import { curveMonotoneX } from 'd3-shape';
	import { cn } from '$lib/utils';
	import type { SparklineSpec } from '../ChartSpec';

	export interface SparklineMarkProps {
		spec: SparklineSpec;
		class?: string;
	}

	let { spec, class: className }: SparklineMarkProps = $props();

	const color = $derived(spec.colorVar ?? 'var(--dataviz-status-on-time)');
	const width = $derived(spec.width ?? 96);
	const height = $derived(spec.height ?? 24);

	type Row = { _i: number; x: string; y: number | null };
	const rows = $derived<Row[]>(
		spec.values.map((y, i) => ({ _i: i, x: spec.xLabels?.[i] ?? String(i + 1), y })),
	);
	const yDomain = $derived<[number, number]>([spec.domain[0], spec.domain[1]]);
	const lastReal = $derived.by<Row | null>(() => {
		for (let i = rows.length - 1; i >= 0; i--) {
			const r = rows[i];
			if (r && r.y != null) return r;
		}
		return null;
	});

	// Null → the brand no-data glyph (never an em-dash, never a fabricated 0).
	const num = (v: number | null): string => (v == null ? '·' : String(v));
	const summary = $derived(
		lastReal ? `${spec.label}: ${num(lastReal.y)}${spec.unit}` : `${spec.label}: ·`,
	);
</script>

<figure
	class={cn('dv-sparkline m-0 inline-block', className)}
	aria-label={summary}
	data-slot="sparkline-mark"
>
	<div class="dv-sparkline-plot" style="width: {width}px; height: {height}px;">
		<LcChart
			data={rows}
			x={(d: Row) => d.x}
			y={(d: Row) => d.y ?? yDomain[0]}
			xScale={scalePoint()}
			xDomain={rows.map((r) => r.x)}
			yScale={scaleLinear()}
			{yDomain}
			padding={{ top: 3, right: 3, bottom: 3, left: 3 }}
			tooltipContext={{ mode: 'band' }}
		>
			<Svg>
				<Spline
					y={(d: Row) => d.y ?? yDomain[0]}
					curve={curveMonotoneX}
					defined={(d: Row) => d.y != null}
					style={`stroke:${color}`}
					class="dv-sparkline-spline"
				/>
				{#if spec.showLast && lastReal}
					<Points data={[lastReal]} r={2.5} style={`fill:${color}`} class="dv-sparkline-last" />
				{/if}
				<Highlight points />
			</Svg>
			<Tooltip.Root>
				{#snippet children({ data: d }: { data: Row })}
					<Tooltip.Header>{d.x}</Tooltip.Header>
					<Tooltip.List>
						<Tooltip.Item label={spec.label} value={`${num(d.y)}${spec.unit}`} {color} />
					</Tooltip.List>
				{/snippet}
			</Tooltip.Root>
		</LcChart>
	</div>

	<table class="sr-only">
		<caption>{spec.title}</caption>
		<tbody>
			{#each rows as r (r._i)}
				<tr><th scope="row">{r.x}</th><td>{num(r.y)}{r.y == null ? '' : spec.unit}</td></tr>
			{/each}
		</tbody>
	</table>
</figure>

<style>
	:global(.dv-sparkline-spline) {
		fill: none;
		stroke-width: 1.5;
	}
</style>
