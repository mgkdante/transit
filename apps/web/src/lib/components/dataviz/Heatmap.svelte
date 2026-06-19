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
		/** X-axis caption rendered under the hour ticks (e.g. "Hour of day"). Omit = none. */
		hourAxisLabel?: string;
		/** Y-axis caption rendered rotated beside the day labels (e.g. "Day of week"). Omit = none. */
		dayAxisLabel?: string;
		/**
		 * Hour tick stops to render. Default [0, 6, 12, 18] (current behaviour); pass
		 * a denser set (e.g. [0, 3, 6, 9, 12, 15, 18, 21]) for finer reading.
		 */
		hourTicks?: number[];
		/**
		 * Append ":00" to hour tick labels when true (reads as a clock time, "06:00"
		 * not "06"). Default false → current bare-number behaviour preserved.
		 */
		clockTicks?: boolean;
		/**
		 * Full row (day) names (length 7, ISO row order Mon..Sun) for the tooltip
		 * HEADING + cell aria-label, when the axis shows short labels. Falls back to
		 * `dayLabels`.
		 */
		fullDayLabels?: string[];
		/**
		 * Tooltip/SR row label — what a cell value represents (e.g. "Intensity").
		 * Distinct from `label` (the whole-grid aria summary). Default = `label`.
		 */
		valueLabel?: string;
		/**
		 * Formats a cell value for the tooltip ROW value + the <title>/aria-label.
		 * Receives the RAW cell value (number|null) and its [0,1] row-normalized
		 * position. Default = String(value) / `noDataText` (current behaviour).
		 */
		valueFormat?: (value: number | null, norm: number | null) => string;
		/** Text for a null (no-data) cell in the <title>/tooltip. Default 'no data'. */
		noDataText?: string;
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
		hourAxisLabel,
		dayAxisLabel,
		hourTicks,
		clockTicks = false,
		fullDayLabels,
		valueLabel,
		valueFormat,
		noDataText = 'no data',
		interactive = false,
		class: className,
		ref = $bindable(null),
		...restProps
	}: HeatmapProps = $props();

	const ROWS = 7;
	const COLS = 24;
	const LABEL_W = 30;
	const HOUR_AXIS_H = 12;

	// Captions grow the gutters ONLY when requested, so the default geometry
	// (no axis labels) stays byte-identical to the legacy layout.
	const Y_AXIS_W = $derived(dayAxisLabel ? 10 : 0);
	const X_AXIS_LABEL_H = $derived(hourAxisLabel ? 10 : 0);
	const TICKS = $derived(hourTicks ?? [0, 6, 12, 18]);
	// Row labels used in the tooltip heading + cell aria-label (full names when given).
	const headingDays = $derived(fullDayLabels ?? dayLabels);

	const step = $derived(cell + gap);
	const gridW = $derived(COLS * step - gap);
	const gridH = $derived(ROWS * step - gap);
	const originX = $derived(Y_AXIS_W + LABEL_W);
	const width = $derived(originX + gridW);
	const height = $derived(HOUR_AXIS_H + gridH + X_AXIS_LABEL_H);

	/** Tick label: bare zero-padded hour, or a clock time when `clockTicks`. */
	function tickLabel(h: number): string {
		const hh = String(h).padStart(2, '0');
		return clockTicks ? `${hh}:00` : hh;
	}

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
				// Row-normalized [0,1] position (null when no data). Computed once and
				// reused for both the fill and the value formatter.
				const norm = isNull ? null : span === 0 ? 0.5 : ((raw as number) - min) / span;
				const fill = norm == null ? HEATMAP_NODATA : heatmapColor(norm);
				const valueText = isNull
					? noDataText
					: valueFormat
						? valueFormat(raw as number, norm)
						: String(raw);
				const dayName = headingDays[r] ?? `Day ${r + 1}`;
				const heading = `${dayName} ${String(c).padStart(2, '0')}:00`;
				const title = cellTitle
					? cellTitle(r, c, isNull ? null : (raw as number))
					: `${heading} — ${valueText}`;
				out.push({
					x: originX + c * step,
					y: HOUR_AXIS_H + r * step,
					fill,
					title,
					heading,
					valueText,
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
			rows: [{ colorVar: cl.fill, label: valueLabel ?? label ?? 'value', value: cl.valueText }],
			side: 'top',
		});
	}
	function hideTip() {
		tip.hide();
	}

	// ROVING TABINDEX. 168 cells must not be 168 sequential tab stops — that is a
	// keyboard trap. The grid is ONE tab stop (the active cell); arrow keys move
	// the active cell 2-dimensionally (←/→ = ±1 hour, ↑/↓ = ±1 day), Home/End jump
	// to the row edges. Only the active cell carries tabindex=0; the rest are -1.
	let activeIndex = $state(0);
	let cellEls = $state<(SVGRectElement | null)[]>([]);

	/** Move focus to cell `next` (if in range), syncing the roving index. */
	function focusCell(next: number): void {
		if (next < 0 || next >= cells.length) return;
		activeIndex = next;
		cellEls[next]?.focus();
	}

	function onCellKey(e: KeyboardEvent, i: number): void {
		const row = Math.floor(i / COLS);
		switch (e.key) {
			case 'ArrowRight':
				e.preventDefault();
				focusCell(i + 1 < cells.length && Math.floor((i + 1) / COLS) === row ? i + 1 : i);
				break;
			case 'ArrowLeft':
				e.preventDefault();
				focusCell(i - 1 >= 0 && Math.floor((i - 1) / COLS) === row ? i - 1 : i);
				break;
			case 'ArrowDown':
				e.preventDefault();
				focusCell(i + COLS);
				break;
			case 'ArrowUp':
				e.preventDefault();
				focusCell(i - COLS);
				break;
			case 'Home':
				e.preventDefault();
				focusCell(row * COLS);
				break;
			case 'End':
				e.preventDefault();
				focusCell(row * COLS + COLS - 1);
				break;
			case 'Escape':
				hideTip();
				break;
		}
	}
</script>

{#snippet svg()}
	<!-- aria-hidden only when static: when interactive the cells below are the
	     accessible content (each a labelled, focusable role=img), so an
	     aria-hidden ancestor would silence every focus stop. -->
	<svg
		viewBox="0 0 {width} {height}"
		width="100%"
		height="auto"
		focusable="false"
		aria-hidden={!interactive}
	>
		<!-- Hour axis ticks — neutral. Configurable stops; optional clock labels. -->
		{#each TICKS as h (h)}
			<text
				x={originX + h * step}
				y={HOUR_AXIS_H - 4}
				font-size="6"
				fill="var(--muted-foreground)"
				font-family="var(--font-mono)">{tickLabel(h)}</text
			>
		{/each}

		<!-- Day (row) labels — neutral. -->
		{#each dayLabels.slice(0, ROWS) as d, r (r)}
			<text
				x={Y_AXIS_W}
				y={HOUR_AXIS_H + r * step + cell / 2 + 2}
				font-size="6"
				fill="var(--muted-foreground)"
				font-family="var(--font-mono)">{d}</text
			>
		{/each}

		<!-- X-axis caption (hours), centred under the grid — only when requested. -->
		{#if hourAxisLabel}
			<text
				x={originX + gridW / 2}
				y={height - 1}
				text-anchor="middle"
				font-size="6"
				fill="var(--muted-foreground)"
				font-family="var(--font-mono)">{hourAxisLabel}</text
			>
		{/if}

		<!-- Y-axis caption (days), rotated beside the day labels — only when requested. -->
		{#if dayAxisLabel}
			<text
				transform="rotate(-90 6 {HOUR_AXIS_H + gridH / 2})"
				x={6}
				y={HOUR_AXIS_H + gridH / 2}
				text-anchor="middle"
				font-size="6"
				fill="var(--muted-foreground)"
				font-family="var(--font-mono)">{dayAxisLabel}</text
			>
		{/if}

		<!-- Cells. -->
		{#each cells as cl, i (i)}
			{#if interactive}
				<!-- Deliberate AT focus targets with roving tabindex + arrow-key nav;
				     each cell is a labelled role=img, so the interactions are intended. -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<rect
					bind:this={cellEls[i]}
					x={cl.x}
					y={cl.y}
					width={cell}
					height={cell}
					rx="1.5"
					fill={cl.fill}
					tabindex={i === activeIndex ? 0 : -1}
					role="img"
					aria-label={cl.title}
					onpointerenter={() => showCell(cl)}
					onpointerleave={hideTip}
					onfocus={() => {
						activeIndex = i;
						showCell(cl);
					}}
					onblur={hideTip}
					onkeydown={(e) => onCellKey(e, i)}
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

<!-- role: a labelled `group` when interactive (AT descends into the roving cells),
     a flat `img` when static (one summary announcement). -->
<div
	bind:this={ref}
	class={cn('dv-heatmap inline-block', className)}
	role={interactive ? 'group' : 'img'}
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
