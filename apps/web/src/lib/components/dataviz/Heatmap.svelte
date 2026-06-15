<!--
  Heatmap — a 7×24 day×hour grid (SVG, no chart lib).

  Each cell is the value for (day, hour). Normalization is PER-ROW into [0,1]
  (so each day reads against its own daily range — a route's worst hour vs its
  own best), then mapped onto the dataviz heatmap ramp. A `null` cell is "no
  data" and MUST paint var(--dataviz-heatmap-nodata) — NEVER bucket 0, NEVER a
  sentinel, NEVER interpolated to a real value (honesty rule).

  DOCTRINE: every cell colour is a data mark on the dataviz heatmap scale; the
  no-data fill is the dedicated nodata token. NEVER --primary. a11y: role=img +
  an aria-label summary; each cell carries a <title> for hover/SR readout.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import { heatmapColor, HEATMAP_NODATA } from './tokens';
	import ChartTooltip from './ChartTooltip.svelte';
	import { createChartTooltip } from './useChartTooltip.svelte';

	export interface HeatmapProps extends WithElementRef<HTMLAttributes<HTMLDivElement>> {
		/**
		 * 7 rows (days) × 24 columns (hours). Cell = raw value or `null` (no data).
		 * Rows shorter/longer than 24 are tolerated (missing cells = no data).
		 */
		grid: Array<Array<number | null>>;
		/** Row (day) labels, length 7. Default = Mon..Sun. */
		dayLabels?: string[];
		/** Cell edge length (viewBox units). */
		cell?: number;
		/** Gap between cells (viewBox units). */
		gap?: number;
		/** Accessible summary (e.g. "Delay heatmap by day and hour"). */
		label?: string;
		/**
		 * Optional formatter for a cell's <title>/SR text given (day, hour, value).
		 * Default prints the raw value or "no data".
		 */
		cellTitle?: (day: number, hour: number, value: number | null) => string;
		/**
		 * Opt-in hover/focus interactivity: each cell becomes a focus target and
		 * reveals a <ChartTooltip> instead of relying on the native <title>. Default
		 * off so existing call sites stay byte-identical.
		 */
		interactive?: boolean;
		class?: string;
	}

	let {
		grid,
		dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
		cell = 12,
		gap = 2,
		label,
		cellTitle,
		interactive = false,
		class: className,
		ref = $bindable(null),
		...restProps
	}: HeatmapProps = $props();

	const ROWS = 7;
	const COLS = 24;
	const LABEL_W = 30;
	const HOUR_AXIS_H = 12;

	const step = $derived(cell + gap);
	const gridW = $derived(COLS * step - gap);
	const gridH = $derived(ROWS * step - gap);
	const width = $derived(LABEL_W + gridW);
	const height = $derived(HOUR_AXIS_H + gridH);

	type Cell = {
		x: number;
		y: number;
		fill: string;
		title: string;
		heading: string;
		valueText: string;
	};

	const cells = $derived.by<Cell[]>(() => {
		const out: Cell[] = [];
		for (let r = 0; r < ROWS; r++) {
			const row = grid[r] ?? [];
			// Per-row [0,1] normalization over the row's REAL values only.
			const reals = row.filter((v): v is number => v != null && !Number.isNaN(v));
			const min = reals.length ? Math.min(...reals) : 0;
			const max = reals.length ? Math.max(...reals) : 0;
			const span = max - min;
			for (let c = 0; c < COLS; c++) {
				const raw = row[c];
				const isNull = raw == null || Number.isNaN(raw as number);
				let fill: string;
				if (isNull) {
					fill = HEATMAP_NODATA;
				} else if (span === 0) {
					// A row with a single distinct value: paint mid-ramp, not 0.
					fill = heatmapColor(0.5);
				} else {
					fill = heatmapColor(((raw as number) - min) / span);
				}
				const title = cellTitle
					? cellTitle(r, c, isNull ? null : (raw as number))
					: `${dayLabels[r] ?? `Day ${r + 1}`} ${String(c).padStart(2, '0')}:00 — ${isNull ? 'no data' : String(raw)}`;
				out.push({
					x: LABEL_W + c * step,
					y: HOUR_AXIS_H + r * step,
					fill,
					title,
					heading: `${dayLabels[r] ?? `Day ${r + 1}`} ${String(c).padStart(2, '0')}:00`,
					valueText: isNull ? 'no data' : String(raw),
				});
			}
		}
		return out;
	});

	// Interactive tooltip controller (only wired when `interactive`).
	const tip = createChartTooltip();

	function showCell(cl: Cell) {
		if (!interactive) return;
		tip.show({
			xPct: ((cl.x + cell / 2) / width) * 100,
			yPct: ((cl.y + cell / 2) / height) * 100,
			heading: cl.heading,
			rows: [{ colorVar: cl.fill, label: label ?? 'value', value: cl.valueText }],
			side: 'top',
		});
	}
	function hideTip() {
		tip.hide();
	}
</script>

{#snippet svg()}
	<svg
		viewBox="0 0 {width} {height}"
		width="100%"
		height="auto"
		focusable="false"
		aria-hidden="true"
	>
		<!-- Hour axis ticks (0, 6, 12, 18) — neutral. -->
		{#each [0, 6, 12, 18] as h (h)}
			<text
				x={LABEL_W + h * step}
				y={HOUR_AXIS_H - 4}
				font-size="6"
				fill="var(--muted-foreground)"
				font-family="var(--font-mono)">{String(h).padStart(2, '0')}</text
			>
		{/each}

		<!-- Day (row) labels — neutral. -->
		{#each dayLabels.slice(0, ROWS) as d, r (r)}
			<text
				x={0}
				y={HOUR_AXIS_H + r * step + cell / 2 + 2}
				font-size="6"
				fill="var(--muted-foreground)"
				font-family="var(--font-mono)">{d}</text
			>
		{/each}

		<!-- Cells. -->
		{#each cells as cl, i (i)}
			{#if interactive}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<rect
					x={cl.x}
					y={cl.y}
					width={cell}
					height={cell}
					rx="1.5"
					fill={cl.fill}
					tabindex={0}
					role="img"
					aria-label={cl.title}
					onpointerenter={() => showCell(cl)}
					onpointerleave={hideTip}
					onfocus={() => showCell(cl)}
					onblur={hideTip}
				>
					<title>{cl.title}</title>
				</rect>
			{:else}
				<rect x={cl.x} y={cl.y} width={cell} height={cell} rx="1.5" fill={cl.fill}>
					<title>{cl.title}</title>
				</rect>
			{/if}
		{/each}
	</svg>
{/snippet}

<div
	bind:this={ref}
	class={cn('dv-heatmap inline-block', className)}
	role="img"
	aria-label={label ?? 'Heatmap by day and hour'}
	data-slot="heatmap"
	{...restProps}
>
	{#if interactive}
		<ChartTooltip
			open={tip.open}
			xPct={tip.xPct}
			yPct={tip.yPct}
			heading={tip.heading}
			rows={tip.rows}
			side={tip.side}
			id={tip.id}
		>
			{@render svg()}
		</ChartTooltip>
	{:else}
		{@render svg()}
	{/if}
</div>
