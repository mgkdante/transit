<script lang="ts">
	import {
		Chart as LcChart,
		Svg,
		Spline,
		Area,
		Points,
		Axis,
		Grid,
		Rule,
		Highlight,
		Tooltip,
	} from 'layerchart';
	import { scaleLinear, scalePoint } from 'd3-scale';
	import { curveMonotoneX } from 'd3-shape';
	import { cn } from '$lib/utils';
	import ChartFrame from '../ChartFrame.svelte';
	import { structuralLabels } from '../structuralLabels';
	import ChartLegend from '../../ChartLegend.svelte';
	import type { LineSpec, LineSeries } from '../ChartSpec';

	export interface LineMarkProps {
		spec: LineSpec;
		class?: string;
	}

	let { spec, class: className }: LineMarkProps = $props();
	const structure = $derived(structuralLabels(spec.locale));

	const PALETTE = ['var(--foreground)', 'var(--muted-foreground)', 'var(--dataviz-status-late)'];
	const colorOf = (s: LineSeries, i: number): string => s.colorVar ?? PALETTE[i % PALETTE.length];
	const yVal = (d: Row, key: string): number => (d[key] as number | null) ?? 0;

	type Row = { x: string; _i: number } & Record<string, number | null | string>;
	const rows = $derived<Row[]>(
		spec.xLabels.map((x, i) => {
			const row: Row = { x, _i: i };
			for (const s of spec.series) row[s.key] = s.points[i] ?? null;
			return row;
		}),
	);
	const xDomain = $derived(spec.xLabels.slice());
	const yDomain = $derived<[number, number]>([spec.domain[0], spec.domain[1]]);
	const primaryKey = $derived(spec.series[0]?.key ?? '');

	const legendItems = $derived(
		spec.series.map((s, i) => ({
			colorVar: colorOf(s, i),
			label: s.label,
			swatch: 'dot' as const,
		})),
	);

	const padding = { top: 12, right: 20, bottom: 44, left: 56 };
	const num = (v: unknown): string => (v == null ? '·' : String(v));
</script>

<figure class={cn('dv-line m-0', className)} aria-label={spec.title} data-slot="line-mark">
	<ChartLegend items={legendItems} />
	<ChartFrame height="16rem" class="dv-line-plot">
		<LcChart
			data={rows}
			x={(d: Row) => d.x}
			y={(d: Row) => (primaryKey ? yVal(d, primaryKey) : 0)}
			xScale={scalePoint()}
			{xDomain}
			yScale={scaleLinear()}
			{yDomain}
			{padding}
			tooltipContext={{ mode: 'band' }}
		>
			<Svg>
				<Grid y class="dv-line-grid" />
				<Axis placement="bottom" class="dv-line-axis" label={spec.xLabel} labelPlacement="middle" />
				<Axis
					placement="left"
					class="dv-line-axis"
					label={spec.yLabel}
					labelPlacement="middle"
					ticks={4}
				/>
				{#if spec.target != null}
					<Rule y={spec.target} class="dv-line-target" />
				{/if}
				{#each spec.series as s, i (s.key)}
					{#if s.area}
						<Area
							y1={(d: Row) => yVal(d, s.key)}
							y0={() => yDomain[0]}
							curve={curveMonotoneX}
							defined={(d: Row) => d[s.key] != null}
							style={`fill:${colorOf(s, i)};opacity:0.12`}
						/>
					{/if}
					<Spline
						y={(d: Row) => yVal(d, s.key)}
						curve={curveMonotoneX}
						defined={(d: Row) => d[s.key] != null}
						style={`stroke:${colorOf(s, i)}`}
						class={cn('dv-line-spline', s.dashed && 'dv-line-dashed')}
					/>
					<Points
						data={rows.filter((r) => r[s.key] != null)}
						y={(d: Row) => yVal(d, s.key)}
						r={3}
						style={`fill:${colorOf(s, i)}`}
						class="dv-line-dot"
					/>
				{/each}
				<Highlight points lines />
			</Svg>
			<Tooltip.Root>
				{#snippet children({ data: d }: { data: Row })}
					<Tooltip.Header>{d.x}</Tooltip.Header>
					<Tooltip.List>
						{#each spec.series as s, i (s.key)}
							<Tooltip.Item
								label={s.label}
								value={`${num(d[s.key])}${spec.unit}`}
								color={colorOf(s, i)}
							/>
						{/each}
					</Tooltip.List>
				{/snippet}
			</Tooltip.Root>
		</LcChart>
	</ChartFrame>

	<table class="sr-only">
		<caption>{spec.title}</caption>
		<thead>
			<tr>
				<th scope="col">{spec.xLabel ?? structure.x}</th>
				{#each spec.series as s (s.key)}<th scope="col">{s.label}</th>{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as r (r._i)}
				<tr>
					<th scope="row">{r.x}</th>
					{#each spec.series as s (s.key)}<td>{num(r[s.key])}</td>{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</figure>

<style>
	:global(.dv-line-spline) {
		fill: none;
		stroke-width: 2;
	}
	:global(.dv-line-dashed) {
		stroke-dasharray: 5 4;
	}
	:global(.dv-line-target) {
		stroke: var(--border);
		stroke-dasharray: 3 3;
	}
	:global(.dv-line-grid line) {
		stroke: var(--border);
		opacity: 0.5;
	}
	:global(.dv-line-axis .tick text) {
		fill: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-mono);
	}
	:global(.dv-line-axis .axis-label),
	:global(.dv-line-axis text.label) {
		fill: var(--muted-foreground);
		font-size: var(--text-mono);
	}
</style>
