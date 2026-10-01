<script lang="ts">
	import { Chart as LcChart, Svg, Axis, Tooltip } from 'layerchart';
	import { scaleBand } from 'd3-scale';
	import { cn } from '$lib/utils';
	import ChartFrame from '../ChartFrame.svelte';
	import ScrollFrame from '../ScrollFrame.svelte';
	import HeatmapCells from './HeatmapCells.svelte';
	import { heatmapTier, HEATMAP_WORST_TIER } from '../heatmapTiers';
	import type { HeatmapSpec } from '../ChartSpec';
	import { absenceShort } from '$lib/site/absence';

	export interface HeatmapMarkProps {
		spec: HeatmapSpec;
		class?: string;
	}
	let { spec, class: className }: HeatmapMarkProps = $props();

	const rows = $derived(spec.rowLabels.length);
	const cols = $derived(spec.colLabels.length);
	const domain = $derived<[number, number]>([spec.domain?.[0] ?? 0, spec.domain?.[1] ?? 1]);
	const tierLabels = $derived(spec.tiers?.tierLabels ?? []);
	const noDataLabel = $derived(
		spec.tiers?.noDataLabel ?? absenceShort('no-observations', spec.locale),
	);
	const worstGlyph = $derived(spec.tiers?.worstGlyph ?? '');

	type FlatCell = {
		key: string;
		r: number;
		c: number;
		value: number | null;
		tier: number | null;
		rowLabel: string;
		fullRowLabel: string;
		colLabel: string;
		tierLabel: string;
		worst: boolean;
	};

	const fullRow = (r: number): string => spec.fullRowLabels?.[r] ?? spec.rowLabels[r] ?? `${r}`;
	const tierText = (tier: number | null): string =>
		tier == null ? noDataLabel : (tierLabels[tier] ?? `${tier}`);

	const data = $derived.by<FlatCell[]>(() => {
		const out: FlatCell[] = [];
		for (let r = 0; r < rows; r++) {
			for (let c = 0; c < cols; c++) {
				const value = spec.cells[r]?.[c]?.value ?? null;
				const tier = heatmapTier(value, domain);
				out.push({
					key: `${r}-${c}`,
					r,
					c,
					value,
					tier,
					rowLabel: spec.rowLabels[r] ?? `${r}`,
					fullRowLabel: fullRow(r),
					colLabel: spec.colLabels[c] ?? `${c}`,
					tierLabel: tierText(tier),
					worst: tier === HEATMAP_WORST_TIER,
				});
			}
		}
		return out;
	});

	const rowIdx = $derived(Array.from({ length: rows }, (_, i) => i));
	const colIdx = $derived(Array.from({ length: cols }, (_, i) => i));
	const tickIdx = $derived((spec.colTicks ?? []).map((t) => t.index));
	const tickLabel = (i: number): string =>
		(spec.colTicks ?? []).find((t) => t.index === i)?.label ?? '';

	const frameHeight = $derived(`${Math.max(3, rows) * 1.6 + 2.5}rem`);
	const gutterPadding = { top: 10, right: 0, bottom: 34, left: 44 };
	const cellPadding = { top: 10, right: 12, bottom: 34, left: 4 };
</script>

<figure
	class={cn('dv-heatmap-mark m-0', className)}
	aria-label={spec.title}
	data-slot="heatmap-mark"
>
	<ScrollFrame
		gutterWidth="3rem"
		scrollLabel={spec.colAxisLabel ?? spec.title}
		class="dv-heatmap-scroll"
	>
		{#snippet gutter()}
			<ChartFrame height={frameHeight} class="dv-heatmap-gutter">
				<LcChart
					data={[]}
					x={() => 0}
					xScale={scaleBand()}
					xDomain={[0]}
					y={(d: FlatCell) => d.r}
					yScale={scaleBand().padding(0.06)}
					yDomain={rowIdx}
					padding={gutterPadding}
				>
					<Svg>
						<Axis
							placement="left"
							ticks={rowIdx}
							format={(i: number) => spec.rowLabels[i] ?? ''}
							rule={false}
							class="dv-heatmap-axis"
						/>
					</Svg>
				</LcChart>
			</ChartFrame>
		{/snippet}
		{#snippet scroller()}
			<ChartFrame height={frameHeight} class="dv-heatmap-cells">
				<LcChart
					{data}
					x={(d: FlatCell) => d.c}
					xScale={scaleBand().padding(0.06)}
					xDomain={colIdx}
					y={(d: FlatCell) => d.r}
					yScale={scaleBand().padding(0.06)}
					yDomain={rowIdx}
					padding={cellPadding}
					tooltipContext={{ mode: 'bounds', touchEvents: 'auto' }}
				>
					<Svg>
						<Axis
							placement="bottom"
							ticks={tickIdx}
							format={(i: number) => tickLabel(i)}
							rule={false}
							label={spec.colAxisLabel}
							labelPlacement="middle"
							class="dv-heatmap-axis"
						/>
						<HeatmapCells cells={data} worstTier={HEATMAP_WORST_TIER} {worstGlyph} />
					</Svg>
					<Tooltip.Root contained="window" anchor="top">
						{#snippet children({ data: d }: { data: FlatCell })}
							<Tooltip.Header>{d.fullRowLabel} · {d.colLabel}</Tooltip.Header>
							<Tooltip.List class="grid-cols-1">
								<Tooltip.Item
									label={spec.valueLabel ?? spec.title}
									value={`${d.worst && worstGlyph ? worstGlyph + ' ' : ''}${d.tierLabel}`}
								/>
							</Tooltip.List>
						{/snippet}
					</Tooltip.Root>
				</LcChart>
			</ChartFrame>
		{/snippet}
	</ScrollFrame>

	<table class="sr-only">
		<caption>{spec.title}</caption>
		<thead>
			<tr>
				<th scope="col">{spec.rowAxisLabel ?? ''}</th>
				{#each spec.colLabels as col, c (c)}
					<th scope="col">{col}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rowIdx as r (r)}
				<tr>
					<th scope="row">{fullRow(r)}</th>
					{#each colIdx as c (c)}
						{@const tier = heatmapTier(spec.cells[r]?.[c]?.value ?? null, domain)}
						<td
							>{tier === HEATMAP_WORST_TIER && worstGlyph ? worstGlyph + ' ' : ''}{tierText(
								tier,
							)}</td
						>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</figure>

<style>
	:global(.dv-heatmap-cells) {
		min-width: 27rem;
	}
	:global(rect.dv-heatmap-cell) {
		stroke: var(--card);
		stroke-width: 0.5;
	}
	:global(rect.dv-hm-tier-0) {
		fill: var(--dataviz-heatmap-tier-0);
	}
	:global(rect.dv-hm-tier-1) {
		fill: var(--dataviz-heatmap-tier-1);
	}
	:global(rect.dv-hm-tier-2) {
		fill: var(--dataviz-heatmap-tier-2);
	}
	:global(rect.dv-hm-tier-3) {
		fill: var(--dataviz-heatmap-tier-3);
	}
	:global(rect.dv-hm-nodata) {
		fill: var(--dataviz-heatmap-nodata);
	}
	:global(rect.dv-heatmap-worst) {
		stroke: var(--foreground);
		stroke-width: 1.25;
	}
	.dv-heatmap-glyph {
		fill: var(--background);
		pointer-events: none;
		font-family: var(--font-mono);
	}
	:global(.dv-heatmap-axis .tick text) {
		fill: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-mono);
	}
	:global(.dv-heatmap-axis .axis-label),
	:global(.dv-heatmap-axis text.label) {
		fill: var(--muted-foreground);
		font-size: var(--text-mono);
	}
</style>
