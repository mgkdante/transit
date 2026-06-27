<!--
  HeatmapMark — the LayerChart renderer for a `kind: 'heatmap'` ChartSpec (B10, S7 P4).

  A day × hour grid where each cell's value is BINNED onto N discrete, plain-language tiers
  (heatmapTiers.ts) over the spec's FIXED absolute domain — never a per-row / in-view scale,
  so the same value reads the same tier on every route and refresh. The tier colour is a
  perceptually-uniform, CVD-safe sequential ramp (the `--dataviz-heatmap-tier-*` tokens,
  luminance-inverted per theme); the WORST tier ALSO carries a contrasting outline + the ◆
  glyph (in the tooltip / legend / table) so the read never rests on hue alone (WCAG 1.4.1).
  A null cell paints the dedicated no-data swatch, never bucket-0.

  Hover/focus reveals the day, hour, and plain-language tier via a LayerChart tooltip (bounds
  mode → the cell under the pointer). A full sr-only <table> is the accessible fallback.
-->
<script lang="ts">
	import { Chart as LcChart, Svg, Axis, Tooltip } from 'layerchart';
	import { scaleBand } from 'd3-scale';
	import { cn } from '$lib/utils';
	import ChartFrame from '../ChartFrame.svelte';
	import HeatmapCells from './HeatmapCells.svelte';
	import { heatmapTier, HEATMAP_WORST_TIER } from '../heatmapTiers';
	import type { HeatmapSpec } from '../ChartSpec';

	export interface HeatmapMarkProps {
		spec: HeatmapSpec;
		class?: string;
	}
	let { spec, class: className }: HeatmapMarkProps = $props();

	const rows = $derived(spec.rowLabels.length);
	const cols = $derived(spec.colLabels.length);
	const domain = $derived<[number, number]>([spec.domain?.[0] ?? 0, spec.domain?.[1] ?? 1]);
	const tierLabels = $derived(spec.tiers?.tierLabels ?? []);
	const noDataLabel = $derived(spec.tiers?.noDataLabel ?? 'no data');
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

	// A tier band's height grows the frame so cells stay tappable; the section scroller
	// gives the 24-hour width room (min-width) so columns never squash on a phone.
	const frameHeight = $derived(`${Math.max(3, rows) * 1.6 + 2.5}rem`);
	const padding = { top: 10, right: 12, bottom: 34, left: 44 };
</script>

<figure
	class={cn('dv-heatmap-mark m-0', className)}
	aria-label={spec.title}
	data-slot="heatmap-mark"
>
	<ChartFrame height={frameHeight} class="dv-heatmap-plot">
		<LcChart
			{data}
			x={(d: FlatCell) => d.c}
			xScale={scaleBand().padding(0.06)}
			xDomain={colIdx}
			y={(d: FlatCell) => d.r}
			yScale={scaleBand().padding(0.06)}
			yDomain={rowIdx}
			{padding}
			tooltipContext={{ mode: 'bounds' }}
		>
			<Svg>
				<!-- Day (row) axis — short labels, no rule (the cells carry the read). -->
				<Axis
					placement="left"
					ticks={rowIdx}
					format={(i: number) => spec.rowLabels[i] ?? ''}
					rule={false}
					class="dv-heatmap-axis"
				/>
				<!-- Hour (col) axis — a sparse clock-tick subset so 24 columns stay legible. -->
				<Axis
					placement="bottom"
					ticks={tickIdx}
					format={(i: number) => tickLabel(i)}
					rule={false}
					label={spec.colAxisLabel}
					labelPlacement="middle"
					class="dv-heatmap-axis"
				/>
				<!-- Cells: one tier-classed rect per (day, hour), scaled via the band context.
				     null cells render the no-data swatch; the worst tier gets a contrasting
				     outline + the centred ◆ glyph. -->
				<HeatmapCells cells={data} worstTier={HEATMAP_WORST_TIER} {worstGlyph} />
			</Svg>
			<Tooltip.Root>
				{#snippet children({ data: d }: { data: FlatCell })}
					<Tooltip.Header>{d.fullRowLabel} · {d.colLabel}</Tooltip.Header>
					<Tooltip.List>
						<Tooltip.Item
							label={spec.valueLabel ?? spec.title}
							value={`${d.worst && worstGlyph ? worstGlyph + ' ' : ''}${d.tierLabel}`}
						/>
					</Tooltip.List>
				{/snippet}
			</Tooltip.Root>
		</LcChart>
	</ChartFrame>

	<!-- AT fallback: the grid as a table (tier word per day × hour + honest absence). -->
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
	/* The classed-tier ramp (CVD-safe blue, luminance-inverted per theme). LayerChart puts
	   the class on the cell <rect>, so target the rect directly; :where() in the lib default
	   has 0 specificity, so these win. */
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
	/* Worst tier: a contrasting outline so it pops via a SECOND channel, not hue alone. */
	:global(rect.dv-heatmap-worst) {
		stroke: var(--foreground);
		stroke-width: 1.25;
	}
	/* The ◆ glyph stamped on each worst cell — a THIRD channel. `--background` flips with
	   the theme so it always contrasts the worst-tier fill (bright on dark / deep on light). */
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
