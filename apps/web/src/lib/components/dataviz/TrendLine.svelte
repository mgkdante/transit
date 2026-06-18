<!--
  TrendLine — dual-series trend chart (SVG, no chart lib).

  Renders two series over a shared x-domain: on-time % (green) and a delay /
  "retard" series (amber). Both colours come from the dataviz scale —
  --dataviz-status-on-time (green) and --dataviz-status-late (amber). `null`
  points break the line (gaps, never interpolated).

  DUAL Y-DOMAINS: the two series may carry DIFFERENT units (e.g. on-time % vs a
  p90 delay in MINUTES). Each scales to its OWN y-domain — `domain` for on-time,
  `retardDomain` for the retard series (defaults to `domain` when both are the
  same unit). This is why neither axis is numbered: the chart reads as two
  independent TREND SHAPES, not a shared-scale comparison — the tooltip carries
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
	import ChartLegend from './ChartLegend.svelte';
	import { createChartTooltip } from './useChartTooltip.svelte';

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
		 * off — the chart stays a static figure.
		 */
		interactive?: boolean;
		/** Optional x-axis category labels (one per index) for the tooltip heading. */
		xLabels?: string[];
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

	const EM_DASH = '—';

	function fmt(series: Series, i: number): string {
		const v = series[i];
		return v == null || Number.isNaN(v) ? EM_DASH : String(v);
	}

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
				{ colorVar: ON_TIME_VAR, label: onTimeLabel, value: fmt(onTime, i) },
				{ colorVar: RETARD_VAR, label: retardLabel, value: fmt(retard, i) },
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
	</svg>
{/snippet}

<figure
	bind:this={ref}
	class={cn('dv-trendline m-0', className)}
	aria-label={summary}
	data-slot="trend-line"
	{...restProps}
>
	{#if interactive}
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
						aria-label={`${xLabels?.[i] ?? `#${i + 1}`}: ${onTimeLabel} ${fmt(
							onTime,
							i,
						)}, ${retardLabel} ${fmt(retard, i)}`}
						aria-describedby={tip.id}
						onfocus={() => showAt(i)}
						onblur={hide}
						onkeydown={onKeyDown}
					></button>
				{/each}
			</div>
		</div>
	{:else}
		{@render chart()}
	{/if}

	<ChartLegend class="mt-1.5" items={legendItems} />
</figure>

<style>
	.dv-trendline-plot {
		position: relative;
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
