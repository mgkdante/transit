<!--
  Sparkline — a tiny single-series trend line (SVG, no chart lib).

  Lightweight inline trend for a sequence of numbers (e.g. a route's OTP over
  the last N days). `null` points are GAPS — the path breaks rather than
  interpolating a fake value (honesty rule: never invent data).

  DOCTRINE: the line is a data mark. Its colour comes from the dataviz scale —
  default is the on-time green token; callers may pass any dataviz token via
  `colorVar`. NEVER --primary. An optional last-point dot reuses the same token.
  a11y: img role + aria-label summarising the series; decorative svg internals
  are aria-hidden.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import ChartTooltip from './ChartTooltip.svelte';
	import { createChartTooltip, type ChartAxis } from './useChartTooltip.svelte';

	export interface SparklineProps extends WithElementRef<HTMLAttributes<HTMLDivElement>> {
		/** The series. `null` entries render as gaps (no interpolation). */
		values: Array<number | null>;
		/** Drawn width in px (viewBox units). */
		width?: number;
		/** Drawn height in px (viewBox units). */
		height?: number;
		/** Stroke width in viewBox units. */
		stroke?: number;
		/**
		 * A dataviz token reference for the line colour (DATA). Default = on-time
		 * green. Pass e.g. `var(--dataviz-status-late)`. NEVER --primary.
		 */
		colorVar?: string;
		/** Draw a dot at the last real point. */
		showLast?: boolean;
		/** Accessible summary of the series (e.g. "On-time % last 14 days"). */
		label?: string;
		/**
		 * Y-axis metadata: a unit suffix for the tooltip value (e.g. "%") plus an
		 * optional axis label/domain. Optional → omitting it leaves the readout
		 * byte-identical to the old raw-number tooltip.
		 */
		yAxis?: ChartAxis;
		/**
		 * X-axis category labels (one per index), already localized — drives the
		 * tooltip heading (the period / date). Omit → no heading.
		 */
		xLabels?: string[];
		/**
		 * Render min/max y endpoint tick labels in a left gutter beside the line.
		 * Default false so the tiny 96×24 inline use stays unchanged. The ticks are
		 * HTML spans (not SVG text) because the viewBox is `preserveAspectRatio
		 * "none"` → SVG text would stretch.
		 */
		showYTicks?: boolean;
		/**
		 * Opt into hover/focus tooltips: the nearest real point reveals its value
		 * (a hover dot marks it). Each real point is also keyboard-focusable.
		 * Default off — the sparkline stays a static inline mark.
		 */
		interactive?: boolean;
		class?: string;
	}

	let {
		values,
		width = 96,
		height = 24,
		stroke = 1.5,
		colorVar = 'var(--dataviz-status-on-time)',
		showLast = true,
		label,
		yAxis,
		xLabels,
		showYTicks = false,
		interactive = false,
		class: className,
		ref = $bindable(null),
		...restProps
	}: SparklineProps = $props();

	const PAD = $derived(stroke + 0.5);

	/** Suffix a value with the y-axis unit (when one was passed). */
	const withUnit = (v: number | string): string => `${v}${yAxis?.unit ?? ''}`;
	/** The label used for the tooltip row + keyboard readout. */
	const seriesLabel = $derived(yAxis?.label ?? label ?? 'value');

	const tip = createChartTooltip();
	let svgEl = $state<SVGSVGElement | null>(null);
	// Index of the point under the pointer / focus; -1 = none (hover dot hidden).
	let activeIndex = $state(-1);

	type Pt = { x: number; y: number };

	// Compute scaled points (null -> gap). Domain spans only the real values.
	const points = $derived.by<Array<Pt | null>>(() => {
		const reals = values.filter((v): v is number => v != null && !Number.isNaN(v));
		if (reals.length === 0) return values.map(() => null);
		const min = Math.min(...reals);
		const max = Math.max(...reals);
		const span = max - min || 1;
		const n = values.length;
		const innerW = width - PAD * 2;
		const innerH = height - PAD * 2;
		return values.map((v, i) => {
			if (v == null || Number.isNaN(v)) return null;
			const x = n === 1 ? width / 2 : PAD + (i / (n - 1)) * innerW;
			const y = PAD + (1 - (v - min) / span) * innerH;
			return { x, y };
		});
	});

	// Build one or more <path> segments, breaking across null gaps.
	const segments = $derived.by<string[]>(() => {
		const segs: string[] = [];
		let cur: Pt[] = [];
		for (const p of points) {
			if (p == null) {
				if (cur.length)
					segs.push(
						cur
							.map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(2)},${q.y.toFixed(2)}`)
							.join(' '),
					);
				cur = [];
			} else {
				cur.push(p);
			}
		}
		if (cur.length)
			segs.push(
				cur.map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(' '),
			);
		return segs;
	});

	const lastPoint = $derived.by<Pt | null>(() => {
		for (let i = points.length - 1; i >= 0; i--) {
			const p = points[i];
			if (p) return p;
		}
		return null;
	});

	const hasData = $derived(segments.length > 0);

	// The real-value y-domain [min,max] that drives the optional endpoint ticks.
	// Falls back to the explicit yAxis.domain when given; null when no real data
	// (the ticks then render an em-dash, never a fabricated 0).
	const yDomain = $derived.by<[number, number] | null>(() => {
		if (yAxis?.domain) return yAxis.domain;
		const reals = values.filter((v): v is number => v != null && !Number.isNaN(v));
		if (reals.length === 0) return null;
		return [Math.min(...reals), Math.max(...reals)];
	});

	// The hover/focus dot for the active point (interactive only).
	const activePoint = $derived(activeIndex >= 0 ? points[activeIndex] : null);

	// Show the tooltip for index `i` (only if it is a real, plotted point). The
	// value carries the y-axis unit; the heading carries the x-axis category. The
	// tooltip sits ABOVE the point (side 'top') and ChartTooltip flips it below +
	// clamps horizontally when the point is near an edge, so it never overlaps.
	function showAt(i: number): void {
		const p = points[i];
		if (!p) return;
		activeIndex = i;
		tip.show({
			xPct: (p.x / width) * 100,
			yPct: (p.y / height) * 100,
			side: 'top',
			heading: xLabels?.[i],
			rows: [{ colorVar, label: seriesLabel, value: withUnit(values[i] as number) }],
		});
	}

	function hide(): void {
		activeIndex = -1;
		tip.hide();
	}

	// Nearest plotted (non-null) point index to a client x; -1 if none.
	function nearestIndex(clientX: number): number {
		const el = svgEl;
		if (!el) return -1;
		const r = el.getBoundingClientRect();
		if (r.width === 0) return -1;
		const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
		const vbX = frac * width;
		let best = -1;
		let bestDist = Infinity;
		for (let i = 0; i < points.length; i++) {
			const p = points[i];
			if (!p) continue;
			const d = Math.abs(p.x - vbX);
			if (d < bestDist) {
				bestDist = d;
				best = i;
			}
		}
		return best;
	}

	function onPointerMove(e: PointerEvent): void {
		const i = nearestIndex(e.clientX);
		if (i >= 0) showAt(i);
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.key === 'Escape') hide();
	}

	// Indices that have a real plotted point — the keyboard-focusable set.
	const realIndices = $derived(
		points.map((p, i) => (p ? i : -1)).filter((i): i is number => i >= 0),
	);
</script>

{#snippet spark()}
	<svg
		bind:this={svgEl}
		viewBox="0 0 {width} {height}"
		{width}
		{height}
		preserveAspectRatio="none"
		aria-hidden="true"
		focusable="false"
	>
		{#if hasData}
			{#each segments as d, i (i)}
				<path
					{d}
					fill="none"
					stroke={colorVar}
					stroke-width={stroke}
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			{/each}
			{#if showLast && lastPoint}
				<circle cx={lastPoint.x} cy={lastPoint.y} r={stroke + 0.5} fill={colorVar} />
			{/if}
			<!-- Hover/focus dot tracking the active point (interactive only). -->
			{#if activePoint}
				<circle cx={activePoint.x} cy={activePoint.y} r={stroke + 1.5} fill={colorVar} />
			{/if}
		{:else}
			<!-- No real points: a faint baseline, NOT a fabricated zero line. -->
			<line
				x1={PAD}
				y1={height / 2}
				x2={width - PAD}
				y2={height / 2}
				stroke="var(--border)"
				stroke-width={stroke}
				stroke-dasharray="2 3"
			/>
		{/if}
	</svg>
{/snippet}

{#snippet yTicks()}
	<!-- Min/max endpoint ticks (HTML, not SVG <text> — the viewBox stretches).
	     An em-dash when the domain is unknown: an honest no-data tick, never 0. -->
	<div class="dv-sparkline-ticks" aria-hidden="true" style="height: {height}px;">
		<span class="dv-sparkline-tick">{yDomain ? withUnit(yDomain[1]) : '—'}</span>
		<span class="dv-sparkline-tick">{yDomain ? withUnit(yDomain[0]) : '—'}</span>
	</div>
{/snippet}

<div
	bind:this={ref}
	class={cn('dv-sparkline inline-flex items-stretch', className)}
	role="img"
	aria-label={label ?? 'Sparkline'}
	data-slot="sparkline"
	{...restProps}
>
	{#if showYTicks}
		{@render yTicks()}
	{/if}
	{#if interactive}
		<div class="dv-sparkline-plot">
			<ChartTooltip
				{...tip}
				id={tip.id}
				onpointermove={onPointerMove}
				onpointerleave={hide}
				onkeydown={onKeyDown}
			>
				{@render spark()}
			</ChartTooltip>

			<!-- Keyboard / AT focus targets: one per real plotted point. -->
			<div class="dv-sparkline-targets" aria-hidden="false">
				{#each realIndices as i (i)}
					<!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
					<!-- Deliberate AT focus target: a focusable <button> that reads its
					     point's value via role=img + aria-label (keyboard parity). -->
					<button
						type="button"
						class="dv-sparkline-target"
						role="img"
						aria-label={`${xLabels?.[i] ? xLabels[i] + ' ' : ''}${seriesLabel}: ${withUnit(
							values[i] as number,
						)}`}
						aria-describedby={tip.id}
						onfocus={() => showAt(i)}
						onblur={hide}
						onkeydown={onKeyDown}
					></button>
				{/each}
			</div>
		</div>
	{:else}
		{@render spark()}
	{/if}
</div>

<style>
	.dv-sparkline-plot {
		position: relative;
		flex: 1 1 auto;
		min-width: 0;
	}

	/* Endpoint-tick gutter (max on top, min on bottom). Mono micro text on the
	   neutral axis colour — never an affordance token; AA-tested. */
	.dv-sparkline-ticks {
		display: flex;
		flex: none;
		flex-direction: column;
		justify-content: space-between;
		align-items: flex-end;
		padding-inline-end: 0.375rem;
		text-align: end;
	}

	.dv-sparkline-tick {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-variant-numeric: tabular-nums;
		line-height: 1;
		color: var(--muted-foreground);
	}

	/* Invisible per-point focus strips overlaying the line for keyboard + AT;
	   pointer events fall through to the ChartTooltip wrapper. */
	.dv-sparkline-targets {
		position: absolute;
		inset: 0;
		display: flex;
		pointer-events: none;
	}

	.dv-sparkline-target {
		flex: 1 1 0;
		min-width: 0;
		height: 100%;
		padding: 0;
		border: 0;
		background: none;
		pointer-events: none;
	}

	.dv-sparkline-target:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -1px;
		border-radius: var(--radius-sm);
	}
</style>
