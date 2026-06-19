<!--
  TrendLine, dual-series trend chart (SVG, no chart lib).

  Renders two series over a shared x-domain: on-time % (green) and a delay /
  "retard" series (amber). Both colours come from the dataviz scale —
  --dataviz-status-on-time (green) and --dataviz-status-late (amber). `null`
  points break the line (gaps, never interpolated).

  DUAL Y-DOMAINS: the two series may carry DIFFERENT units (e.g. on-time % vs a
  p90 delay in MINUTES). Each scales to its OWN y-domain, `domain` for on-time,
  `retardDomain` for the retard series (defaults to `domain` when both are the
  same unit). This is why neither axis is numbered: the chart reads as two
  independent TREND SHAPES, not a shared-scale comparison, the tooltip carries
  the real per-series values. Plotting minutes on the 0–100 % axis would squash
  the delay line flat against the floor (and clamp it), so a caller mixing units
  MUST pass `retardDomain`.

  a11y: figure with an aria-label summary and a visually-hidden legend;
  decorative geometry is aria-hidden.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import ChartTooltip from './ChartTooltip.svelte';
	import ChartReadout from './ChartReadout.svelte';
	import ChartLegend from './ChartLegend.svelte';
	import { createChartTooltip, type ChartAxis } from './useChartTooltip.svelte';

	type Series = Array<number | null>;

	export interface TrendLineProps extends WithElementRef<HTMLAttributes<HTMLElement>> {
		/** On-time % series (rendered green). */
		onTime: Series;
		/** Delay / retard series (rendered amber). */
		retard: Series;
		/**
		 * y-domain [min,max] for the ON-TIME series. Typically a percentage, so the
		 * default is [0,100].
		 */
		domain?: [number, number];
		/**
		 * y-domain [min,max] for the RETARD series. Defaults to `domain` (same unit
		 * as on-time). Pass this when the retard series uses a DIFFERENT unit (e.g.
		 * a delay in minutes) so it scales to its own range instead of being
		 * squashed/clamped against the on-time percentage axis.
		 */
		retardDomain?: [number, number];
		/** Drawn width (viewBox units). */
		width?: number;
		/** Drawn height (viewBox units). */
		height?: number;
		/** Stroke width (viewBox units). */
		stroke?: number;
		/** Accessible legend labels (already localized upstream). */
		onTimeLabel?: string;
		retardLabel?: string;
		/** Overall accessible summary. */
		label?: string;
		/**
		 * Opt into hover/focus tooltips: a vertical guide tracks the nearest
		 * x-index and a tooltip reads both series at that index. Per-index focus
		 * targets expose the same readout to keyboard + assistive tech. Default
		 * off, the chart stays a static figure.
		 */
		interactive?: boolean;
		/** Optional x-axis category labels (one per index) for the tooltip heading. */
		xLabels?: string[];
		/**
		 * Left y-axis metadata for the ON-TIME series, a unit suffix for the
		 * tooltip value (e.g. "%") + an optional label/domain for the endpoint
		 * ticks. Optional + backward-compatible.
		 */
		yAxis?: ChartAxis;
		/**
		 * Right y-axis metadata for the RETARD series, its OWN unit (e.g. " min")
		 * + optional label/domain. Dual-axis honesty: each line is labelled in its
		 * own unit.
		 */
		retardAxis?: ChartAxis;
		/**
		 * Show min/max endpoint tick labels on each y-axis (on-time left, retard
		 * right). Default false → existing renders stay byte-identical. Ticks are
		 * HTML overlay spans because the SVG stretches (`preserveAspectRatio none`).
		 */
		showYTicks?: boolean;
		/**
		 * Show the first/last x-labels under the plot. `xLabels` already feeds the
		 * tooltip heading; this surfaces the endpoints visibly. Default false.
		 */
		showXTicks?: boolean;
		/**
		 * Track a focus DOT on each series at the hovered x-index (in addition to
		 * the vertical guide). Defaults to true when `interactive`.
		 */
		focusDots?: boolean;
		/**
		 * Place the hover/focus readout in a FIXED row ABOVE the plot instead of a
		 * floating overlay over the lines (the overlay covers the data on a line
		 * chart). Only takes effect with `interactive`. Default false → existing
		 * renders keep the floating ChartTooltip path byte-identical. The vertical
		 * guide + focus dots stay on-plot; only the value readout moves out.
		 */
		readout?: boolean;
		/** Hint shown in the fixed readout before anything is hovered. `readout` only. */
		readoutHint?: string;
		class?: string;
	}

	let {
		onTime,
		retard,
		domain = [0, 100],
		retardDomain,
		width = 320,
		height = 120,
		stroke = 2,
		onTimeLabel = 'On-time %',
		retardLabel = 'Delayed %',
		label,
		interactive = false,
		xLabels,
		yAxis,
		retardAxis,
		showYTicks = false,
		showXTicks = false,
		focusDots = true,
		readout = false,
		readoutHint,
		class: className,
		ref = $bindable(null),
		...restProps
	}: TrendLineProps = $props();

	const PAD = 6;
	const ON_TIME_VAR = 'var(--dataviz-status-on-time)';
	const RETARD_VAR = 'var(--dataviz-status-late)';

	const tip = createChartTooltip();
	let svgEl = $state<SVGSVGElement | null>(null);
	// Nearest x-index under the pointer / focus; -1 = none (guide hidden).
	let activeIndex = $state(-1);

	// The shared x-domain length (drives index targets + nearest-index math).
	const n = $derived(Math.max(onTime.length, retard.length, 1));

	const NO_DATA = '·';

	function fmt(series: Series, i: number): string {
		const v = series[i];
		return v == null || Number.isNaN(v) ? NO_DATA : String(v);
	}

	// Like fmt(), but suffixes the axis unit on a real value (never on an em-dash,
	// so a no-data readout stays an honest dash rather than e.g. "— %").
	function fmtUnit(series: Series, i: number, axis: ChartAxis | undefined): string {
		const s = fmt(series, i);
		return s === NO_DATA ? s : `${s}${axis?.unit ?? ''}`;
	}

	// Labels used for the tooltip rows + keyboard readout (axis label wins).
	const onTimeRowLabel = $derived(yAxis?.label ?? onTimeLabel);
	const retardRowLabel = $derived(retardAxis?.label ?? retardLabel);

	// viewBox x for an index (mirrors scale()): single point centres.
	function indexX(i: number): number {
		const innerW = width - PAD * 2;
		return n === 1 ? width / 2 : PAD + (i / (n - 1)) * innerW;
	}

	// Place + fill the tooltip for index `i`. The guide x is in viewBox units;
	// xPct/yPct are percentages of the wrapper (svg fills it, aspect 'none').
	function showAt(i: number): void {
		if (i < 0 || i >= n) return;
		activeIndex = i;
		const heading = xLabels?.[i] ?? `#${i + 1}`;
		tip.show({
			xPct: (indexX(i) / width) * 100,
			yPct: 0,
			side: 'bottom',
			heading,
			rows: [
				{ colorVar: ON_TIME_VAR, label: onTimeRowLabel, value: fmtUnit(onTime, i, yAxis) },
				{ colorVar: RETARD_VAR, label: retardRowLabel, value: fmtUnit(retard, i, retardAxis) },
			],
		});
	}

	function hide(): void {
		activeIndex = -1;
		tip.hide();
	}

	// Map a pointer to the nearest x-index using the svg's rendered box.
	function nearestIndex(clientX: number): number {
		const el = svgEl;
		if (!el) return -1;
		const r = el.getBoundingClientRect();
		if (r.width === 0) return -1;
		const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
		// Pointer fraction → viewBox x → nearest index.
		const vbX = frac * width;
		if (n === 1) return 0;
		const innerW = width - PAD * 2;
		const raw = ((vbX - PAD) / innerW) * (n - 1);
		return Math.min(n - 1, Math.max(0, Math.round(raw)));
	}

	function onPointerMove(e: PointerEvent): void {
		const i = nearestIndex(e.clientX);
		if (i >= 0) showAt(i);
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.key === 'Escape') hide();
	}

	type Pt = { x: number; y: number };

	function scale(series: Series, dom: [number, number]): Array<Pt | null> {
		const [min, max] = dom;
		const span = max - min || 1;
		const n = Math.max(series.length, 1);
		const innerW = width - PAD * 2;
		const innerH = height - PAD * 2;
		return series.map((v, i) => {
			if (v == null || Number.isNaN(v)) return null;
			const x = n === 1 ? width / 2 : PAD + (i / (n - 1)) * innerW;
			const clamped = Math.min(max, Math.max(min, v));
			const y = PAD + (1 - (clamped - min) / span) * innerH;
			return { x, y };
		});
	}

	function toSegments(pts: Array<Pt | null>): string[] {
		const segs: string[] = [];
		let cur: Pt[] = [];
		for (const p of pts) {
			if (p == null) {
				if (cur.length)
					segs.push(
						cur
							.map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(2)},${q.y.toFixed(2)}`)
							.join(' '),
					);
				cur = [];
			} else cur.push(p);
		}
		if (cur.length)
			segs.push(
				cur.map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(' '),
			);
		return segs;
	}

	function lastOf(pts: Array<Pt | null>): Pt | null {
		for (let i = pts.length - 1; i >= 0; i--) if (pts[i]) return pts[i];
		return null;
	}

	const onTimePts = $derived(scale(onTime, domain));
	// Retard scales to its OWN domain when given (different unit, e.g. minutes);
	// otherwise it shares the on-time domain (same unit).
	const retardPts = $derived(scale(retard, retardDomain ?? domain));
	const onTimeSegs = $derived(toSegments(onTimePts));
	const retardSegs = $derived(toSegments(retardPts));
	const onTimeLast = $derived(lastOf(onTimePts));
	const retardLast = $derived(lastOf(retardPts));

	// Midline gridline for orientation (neutral, not a data mark).
	const midY = $derived(PAD + (height - PAD * 2) / 2);
	const summary = $derived(label ?? `${onTimeLabel} vs ${retardLabel}`);

	// Vertical guide x (viewBox units) for the active index, when interactive.
	const guideX = $derived(activeIndex >= 0 ? indexX(activeIndex) : null);

	// Focus dots: the plotted point on each series at the active x-index (drawn in
	// addition to the guide line so the hover gives per-series feedback). They
	// reuse the series colour → still a data mark on the dataviz scale.
	const showFocusDots = $derived(interactive && focusDots && activeIndex >= 0);
	const onTimeFocus = $derived(showFocusDots ? onTimePts[activeIndex] : null);
	const retardFocus = $derived(showFocusDots ? retardPts[activeIndex] : null);

	// Endpoint-tick domains. On-time falls back to its [0,100] default; retard to
	// the on-time domain when it shares the unit. axis.domain overrides either.
	const onTimeTickDomain = $derived<[number, number]>(yAxis?.domain ?? domain);
	const retardTickDomain = $derived<[number, number]>(retardAxis?.domain ?? retardDomain ?? domain);
	const fmtTick = (v: number, axis: ChartAxis | undefined): string => `${v}${axis?.unit ?? ''}`;
	const firstXLabel = $derived(xLabels?.[0] ?? '');
	const lastXLabel = $derived(xLabels?.[n - 1] ?? '');

	// Decorative legend rows (dot swatches): on-time + retard series.
	const legendItems = $derived([
		{ colorVar: ON_TIME_VAR, label: onTimeLabel, swatch: 'dot' as const },
		{ colorVar: RETARD_VAR, label: retardLabel, swatch: 'dot' as const },
	]);
</script>

{#snippet chart()}
	<svg
		bind:this={svgEl}
		viewBox="0 0 {width} {height}"
		width="100%"
		{height}
		preserveAspectRatio="none"
		role="img"
		aria-hidden="true"
		focusable="false"
	>
		<!-- Neutral orientation grid (NOT data). -->
		<line
			x1={PAD}
			y1={midY}
			x2={width - PAD}
			y2={midY}
			stroke="var(--border)"
			stroke-width="0.75"
			stroke-dasharray="3 4"
		/>

		<!-- Vertical guide tracking the active x-index (interactive only). -->
		{#if guideX != null}
			<line
				x1={guideX}
				y1={PAD}
				x2={guideX}
				y2={height - PAD}
				stroke="var(--border-strong, var(--border))"
				stroke-width="0.75"
			/>
		{/if}

		<!-- Retard (amber) under on-time so green reads as the headline. -->
		{#each retardSegs as d, i (i)}
			<path
				{d}
				fill="none"
				stroke={RETARD_VAR}
				stroke-width={stroke}
				stroke-linecap="round"
				stroke-linejoin="round"
				opacity="0.95"
			/>
		{/each}
		{#if retardLast}
			<circle cx={retardLast.x} cy={retardLast.y} r={stroke + 0.5} fill={RETARD_VAR} />
		{/if}

		{#each onTimeSegs as d, i (i)}
			<path
				{d}
				fill="none"
				stroke={ON_TIME_VAR}
				stroke-width={stroke}
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		{/each}
		{#if onTimeLast}
			<circle cx={onTimeLast.x} cy={onTimeLast.y} r={stroke + 0.5} fill={ON_TIME_VAR} />
		{/if}

		<!-- Focus dots tracking each series at the hovered x-index (data marks). -->
		{#if retardFocus}
			<circle cx={retardFocus.x} cy={retardFocus.y} r={stroke + 1.5} fill={RETARD_VAR} />
		{/if}
		{#if onTimeFocus}
			<circle cx={onTimeFocus.x} cy={onTimeFocus.y} r={stroke + 1.5} fill={ON_TIME_VAR} />
		{/if}
	</svg>
{/snippet}

{#snippet targets()}
	<!-- Keyboard / AT focus targets: one transparent strip per x-index,
	     overlaying the plot, each carrying the both-series readout. -->
	<div class="dv-trendline-targets" aria-hidden="false">
		{#each Array.from({ length: n }, (_, i) => i) as i (i)}
			<!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
			<!-- Deliberate AT focus target: a focusable <button> that reads both
			     series at this x-index via role=img + aria-label (keyboard parity). -->
			<button
				type="button"
				class="dv-trendline-target"
				role="img"
				aria-label={`${xLabels?.[i] ?? `#${i + 1}`}: ${onTimeRowLabel} ${fmtUnit(
					onTime,
					i,
					yAxis,
				)}, ${retardRowLabel} ${fmtUnit(retard, i, retardAxis)}`}
				aria-describedby={tip.id}
				onfocus={() => showAt(i)}
				onblur={hide}
				onkeydown={onKeyDown}
			></button>
		{/each}
	</div>
{/snippet}

{#snippet plot()}
	{#if interactive && readout}
		<!-- Fixed-readout path: NO floating overlay over the lines. The pointer
		     handlers ride a plain plot <div>; the values read in the row above. -->
		<div
			class="dv-trendline-plot"
			onpointermove={onPointerMove}
			onpointerleave={hide}
			onkeydown={onKeyDown}
			role="presentation"
		>
			{@render chart()}
			{@render targets()}
		</div>
	{:else if interactive}
		<div class="dv-trendline-plot">
			<ChartTooltip
				{...tip}
				id={tip.id}
				onpointermove={onPointerMove}
				onpointerleave={hide}
				onkeydown={onKeyDown}
			>
				{@render chart()}
			</ChartTooltip>

			{@render targets()}
		</div>
	{:else}
		{@render chart()}
	{/if}
{/snippet}

{#snippet yTickGutter(dom: [number, number], axis: ChartAxis | undefined, side: 'left' | 'right')}
	<!-- Min/max endpoint ticks for one y-axis. HTML (not SVG <text>), the SVG is
	     stretched (`preserveAspectRatio none`). Neutral axis colour, never an
	     affordance token. -->
	<div
		class="dv-trendline-yticks"
		class:dv-trendline-yticks--right={side === 'right'}
		aria-hidden="true"
	>
		<span class="dv-trendline-tick">{fmtTick(dom[1], axis)}</span>
		<span class="dv-trendline-tick">{fmtTick(dom[0], axis)}</span>
	</div>
{/snippet}

<figure
	bind:this={ref}
	class={cn('dv-trendline m-0', className)}
	aria-label={summary}
	data-slot="trend-line"
	{...restProps}
>
	{#if interactive && readout}
		<!-- Fixed readout ABOVE the plot, updates on hover/focus, never over the line. -->
		<ChartReadout
			class="dv-trendline-readout"
			open={tip.open}
			heading={tip.heading}
			rows={tip.rows}
			id={tip.id}
			placeholder={readoutHint}
		/>
	{/if}

	{#if showYTicks}
		<div class="dv-trendline-frame">
			{@render yTickGutter(onTimeTickDomain, yAxis, 'left')}
			<div class="dv-trendline-frame-plot">{@render plot()}</div>
			{@render yTickGutter(retardTickDomain, retardAxis, 'right')}
		</div>
	{:else}
		{@render plot()}
	{/if}

	{#if showXTicks && xLabels && xLabels.length > 0}
		<div class="dv-trendline-xticks" aria-hidden="true">
			<span class="dv-trendline-tick">{firstXLabel}</span>
			<span class="dv-trendline-tick">{lastXLabel}</span>
		</div>
	{/if}

	<ChartLegend class="mt-1.5" items={legendItems} />
</figure>

<style>
	.dv-trendline-plot {
		position: relative;
	}

	/* Fixed readout sits above the plot with a small gap; it reserves its own
	   height so the chart doesn't shift as the reader hovers in/out. */
	:global(.dv-trendline-readout) {
		margin-bottom: 0.5rem;
	}

	/* Axis frame: y-tick gutters flank the stretched plot; plot grows to fill. */
	.dv-trendline-frame {
		display: flex;
		align-items: stretch;
		gap: 0.375rem;
	}
	.dv-trendline-frame-plot {
		flex: 1 1 auto;
		min-width: 0;
	}

	/* Per-axis endpoint ticks (max on top, min on bottom). Mono micro text on the
	   neutral axis colour, never an affordance token; AA-tested. */
	.dv-trendline-yticks {
		display: flex;
		flex: none;
		flex-direction: column;
		justify-content: space-between;
		align-items: flex-end;
		text-align: end;
	}
	.dv-trendline-yticks--right {
		align-items: flex-start;
		text-align: start;
	}

	/* First/last x-labels, edge-aligned under the plot. */
	.dv-trendline-xticks {
		margin-top: 0.25rem;
		display: flex;
		justify-content: space-between;
	}

	.dv-trendline-tick {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-variant-numeric: tabular-nums;
		line-height: 1;
		color: var(--muted-foreground);
	}

	/* Invisible per-index focus strips overlaying the plot for keyboard + AT;
	   purely an affordance, so they carry no paint of their own. The pointer
	   tooltip is driven by the ChartTooltip wrapper below, so the strips let
	   pointer events fall through. */
	.dv-trendline-targets {
		position: absolute;
		inset: 0;
		display: flex;
		pointer-events: none;
	}

	.dv-trendline-target {
		flex: 1 1 0;
		min-width: 0;
		height: 100%;
		padding: 0;
		border: 0;
		background: none;
		pointer-events: none;
	}

	.dv-trendline-target:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -1px;
		border-radius: var(--radius-sm);
	}
</style>
