// useChartTooltip — a Svelte 5 rune factory that owns one chart's tooltip
// state, so each chart wires an interactive tooltip in ~5 lines:
//
//   const tip = createChartTooltip();
//   <ChartTooltip {...tip} id={tip.id}> {svg} </ChartTooltip>
//   on:pointermove → tip.show({ xPct, yPct, heading, rows })
//   on:pointerleave → tip.hide()
//
// The factory holds the open/position/content as internal $state and exposes
// REACTIVE GETTERS only (reassignments stay reactive for `.svelte` consumers
// that spread the object). Positions are percentages of the chart wrapper box
// so the presentational <ChartTooltip> can place the overlay without knowing
// the chart's viewBox or pixel dimensions.
//
// The `id` is generated from a module-level monotonically-incrementing integer
// (NEVER Math.random / Date.now — non-deterministic ids are forbidden in this
// codebase: they break SSR hydration matching and snapshot stability). Each
// factory call claims the next integer, so ids are stable + unique per chart.

/** One line in the tooltip body: an optional colour swatch + label + value. */
export interface ChartTooltipRow {
	/** CSS color for the swatch, e.g. 'var(--dataviz-status-on-time)'. Omit for no swatch. */
	colorVar?: string;
	/** Series / category label (already localized upstream). */
	label: string;
	/** Formatted value string (already localized + unit-suffixed upstream). */
	value: string;
}

/**
 * Optional axis metadata a chart consumer passes so the primitive can label its
 * ticks and suffix the tooltip values with a unit. The single source of truth
 * for axis shape across the line/area kit (Sparkline / TrendLine / Distribution).
 * Every field is optional → existing call-sites that omit it stay byte-identical.
 */
export interface ChartAxis {
	/** Short axis title, already localized (e.g. "On-time %", "p90 delay"). */
	label?: string;
	/** Unit suffix appended to tick + tooltip values (e.g. "%", " min"). '' = none. */
	unit?: string;
	/** Explicit [min,max] for tick endpoints; falls back to the chart's domain. */
	domain?: [number, number];
}

/** Which edge of the anchor point the tooltip is placed against. */
export type ChartTooltipSide = 'top' | 'bottom' | 'left' | 'right';

/** Arguments to `show` — the anchor (in % of the wrapper) plus the content. */
export interface ChartTooltipShowArgs {
	/** Horizontal anchor as a percentage [0,100] of the chart wrapper width. */
	xPct: number;
	/** Vertical anchor as a percentage [0,100] of the chart wrapper height. */
	yPct: number;
	/** Optional heading line (e.g. the x-axis category / timestamp). */
	heading?: string;
	/** The body rows. */
	rows: ChartTooltipRow[];
	/** Preferred side; the overlay may flip it to stay in bounds. Default 'top'. */
	side?: ChartTooltipSide;
}

/**
 * The reactive controller returned by {@link createChartTooltip}. Spread it
 * straight onto `<ChartTooltip>` (plus `id={tip.id}`); drive it from pointer
 * handlers with `show()` / `hide()`.
 */
export interface ChartTooltipController {
	/** Whether the tooltip is currently shown. */
	readonly open: boolean;
	/** Current horizontal anchor (% of wrapper width). */
	readonly xPct: number;
	/** Current vertical anchor (% of wrapper height). */
	readonly yPct: number;
	/** Current heading line, if any. */
	readonly heading: string | undefined;
	/** Current body rows. */
	readonly rows: ChartTooltipRow[];
	/** Current preferred side. */
	readonly side: ChartTooltipSide;
	/** Stable, deterministic DOM id for the tooltip element (aria wiring). */
	readonly id: string;
	/** Show the tooltip at an anchor with content. */
	show(args: ChartTooltipShowArgs): void;
	/** Hide the tooltip (content is retained for a clean fade-out). */
	hide(): void;
}

// Module-level monotonic counter — deterministic, never random/time-based.
let tooltipSeq = 0;

/**
 * Create one chart's tooltip controller. Call once per chart (e.g. at the top
 * of the chart component's `<script>`); the returned object is reactive.
 */
export function createChartTooltip(): ChartTooltipController {
	const id = `chart-tooltip-${++tooltipSeq}`;

	let open = $state(false);
	let xPct = $state(0);
	let yPct = $state(0);
	let heading = $state<string | undefined>(undefined);
	let rows = $state<ChartTooltipRow[]>([]);
	let side = $state<ChartTooltipSide>('top');

	return {
		get open() {
			return open;
		},
		get xPct() {
			return xPct;
		},
		get yPct() {
			return yPct;
		},
		get heading() {
			return heading;
		},
		get rows() {
			return rows;
		},
		get side() {
			return side;
		},
		get id() {
			return id;
		},
		show(args: ChartTooltipShowArgs): void {
			xPct = args.xPct;
			yPct = args.yPct;
			heading = args.heading;
			rows = args.rows;
			side = args.side ?? 'top';
			open = true;
		},
		hide(): void {
			open = false;
		},
	};
}
