<!--
  Distribution — a horizontal box-plot / quantile summary (SVG, no chart lib).

  Renders a five-number summary (min, p25, p50/median, p75, max) on a shared
  domain. The box (p25–p75) and whiskers are DATA marks filled from the dataviz
  scale (default = the unknown/neutral status token, overridable via `fillVar`).

  SPECIAL DOCTRINE CARVE-OUT: the p50 MEDIAN line is the one place this kit
  touches --primary — and ONLY as the interactive *affordance marker* (it marks
  "where the median sits", a UI pointer), NOT as a data-encoding colour. Every
  other mark stays on the dataviz scale.

  a11y: figure + aria-label spelling out the five-number summary so the shape is
  announced. `null` quantiles render an empty domain track (no data), never a
  collapsed-to-zero box.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import ChartTooltip from './ChartTooltip.svelte';
	import { createChartTooltip, type ChartTooltipRow } from './useChartTooltip.svelte';

	export interface DistributionStats {
		min: number | null;
		p25: number | null;
		p50: number | null;
		p75: number | null;
		max: number | null;
	}

	export interface DistributionProps extends WithElementRef<HTMLAttributes<HTMLElement>> {
		/** Five-number summary. Any `null` field is treated as missing. */
		stats: DistributionStats;
		/** Value domain [min,max] the summary lives in (axis extent). */
		domain: [number, number];
		/** Drawn width (viewBox units). */
		width?: number;
		/** Drawn height (viewBox units). */
		height?: number;
		/**
		 * Dataviz token for the box fill (DATA). Default = neutral unknown token.
		 * Pass e.g. var(--dataviz-status-late). NEVER --primary.
		 */
		fillVar?: string;
		/** Accessible label prefix (e.g. route/metric name). */
		label?: string;
		/** Optional unit suffix for the a11y summary + tooltip values (e.g. "min", "%"). */
		unit?: string;
		/**
		 * Render the domain min/max endpoint ticks (with `unit`) under the baseline.
		 * Default false so existing call sites stay byte-identical. HTML spans, not
		 * SVG <text> — the SVG is stretched (`preserveAspectRatio none`).
		 */
		showAxis?: boolean;
		/** Optional axis caption rendered under the track (already localized). */
		axisLabel?: string;
		/**
		 * Opt-in hover/focus interactivity: reveals p25/p50/p75 marker ticks and a
		 * five-number tooltip. Default off so existing call sites stay byte-identical.
		 */
		interactive?: boolean;
		class?: string;
	}

	let {
		stats,
		domain,
		width = 280,
		height = 40,
		fillVar = 'var(--dataviz-status-unknown)',
		label,
		unit = '',
		showAxis = false,
		axisLabel,
		interactive = false,
		class: className,
		ref = $bindable(null),
		...restProps
	}: DistributionProps = $props();

	const PAD_X = 8;
	const innerW = $derived(width - PAD_X * 2);
	const midY = $derived(height / 2);
	const boxH = $derived(Math.min(20, height - 12));

	function x(v: number | null): number | null {
		if (v == null || Number.isNaN(v)) return null;
		const [lo, hi] = domain;
		const span = hi - lo || 1;
		const clamped = Math.min(hi, Math.max(lo, v));
		return PAD_X + ((clamped - lo) / span) * innerW;
	}

	const xMin = $derived(x(stats.min));
	const xP25 = $derived(x(stats.p25));
	const xP50 = $derived(x(stats.p50));
	const xP75 = $derived(x(stats.p75));
	const xMax = $derived(x(stats.max));

	const hasBox = $derived(xP25 != null && xP75 != null);
	const hasWhiskers = $derived(xMin != null && xMax != null);
	const anyData = $derived(hasBox || hasWhiskers || xP50 != null);

	const fmt = (v: number | null) => (v == null ? '—' : `${v}${unit}`);
	const summary = $derived(
		`${label ? label + ' — ' : ''}distribution: min ${fmt(stats.min)}, p25 ${fmt(stats.p25)}, median ${fmt(stats.p50)}, p75 ${fmt(stats.p75)}, max ${fmt(stats.max)}`,
	);

	// Interactive tooltip controller (only wired when `interactive`).
	const tip = createChartTooltip();

	// Five-number rows: median carries the --primary affordance swatch, the
	// quartiles the strong border, whiskers stay neutral (no swatch).
	const tipRows = $derived<ChartTooltipRow[]>([
		{ label: 'min', value: fmt(stats.min) },
		{ colorVar: 'var(--border-strong, var(--border))', label: 'p25', value: fmt(stats.p25) },
		{ colorVar: 'var(--primary)', label: 'median', value: fmt(stats.p50) },
		{ colorVar: 'var(--border-strong, var(--border))', label: 'p75', value: fmt(stats.p75) },
		{ label: 'max', value: fmt(stats.max) },
	]);

	// Anchor the tooltip over the median tick (falls back to the box centre, then
	// the track centre) as a percentage of the stretched viewBox width.
	const anchorX = $derived(xP50 ?? (hasBox ? (xP25! + xP75!) / 2 : width / 2));
	const xPct = $derived((anchorX / width) * 100);

	// Drives the p25/p50/p75 marker-tick reveal on hover/focus.
	let active = $state(false);

	function showTip() {
		if (!interactive) return;
		active = true;
		tip.show({ xPct, yPct: 0, heading: label, rows: tipRows, side: 'top' });
	}
	function hideTip() {
		active = false;
		tip.hide();
	}
</script>

{#snippet svgBody()}
	<!-- Domain baseline (neutral, NOT data). -->
	<line
		x1={PAD_X}
		y1={midY}
		x2={width - PAD_X}
		y2={midY}
		stroke="var(--border)"
		stroke-width="0.75"
	/>

	{#if anyData}
		<!-- Whisker line min..max. -->
		{#if hasWhiskers}
			<line
				x1={xMin}
				y1={midY}
				x2={xMax}
				y2={midY}
				stroke="var(--border-strong, var(--border))"
				stroke-width="1"
			/>
			<line
				x1={xMin}
				y1={midY - boxH / 2}
				x2={xMin}
				y2={midY + boxH / 2}
				stroke="var(--border-strong, var(--border))"
				stroke-width="1"
			/>
			<line
				x1={xMax}
				y1={midY - boxH / 2}
				x2={xMax}
				y2={midY + boxH / 2}
				stroke="var(--border-strong, var(--border))"
				stroke-width="1"
			/>
		{/if}

		<!-- p25/p75 marker ticks — interactive-only, revealed on hover/focus. -->
		{#if interactive && active && xP25 != null}
			<line
				x1={xP25}
				y1={midY - boxH / 2 - 2}
				x2={xP25}
				y2={midY + boxH / 2 + 2}
				stroke="var(--border-strong, var(--border))"
				stroke-width="1.5"
				stroke-linecap="round"
			/>
		{/if}
		{#if interactive && active && xP75 != null}
			<line
				x1={xP75}
				y1={midY - boxH / 2 - 2}
				x2={xP75}
				y2={midY + boxH / 2 + 2}
				stroke="var(--border-strong, var(--border))"
				stroke-width="1.5"
				stroke-linecap="round"
			/>
		{/if}

		<!-- Interquartile box (DATA fill from the dataviz scale). -->
		{#if hasBox}
			<rect
				x={Math.min(xP25!, xP75!)}
				y={midY - boxH / 2}
				width={Math.max(1, Math.abs(xP75! - xP25!))}
				height={boxH}
				rx="2"
				fill={fillVar}
				fill-opacity="0.55"
				stroke={fillVar}
				stroke-width="1"
			/>
		{/if}

		<!-- p50 MEDIAN: the lone --primary touch, an AFFORDANCE MARKER line. -->
		{#if xP50 != null}
			<line
				x1={xP50}
				y1={midY - boxH / 2 - 2}
				x2={xP50}
				y2={midY + boxH / 2 + 2}
				stroke="var(--primary)"
				stroke-width="2"
				stroke-linecap="round"
			/>
		{/if}
	{:else}
		<text
			x={width / 2}
			y={midY + 3}
			text-anchor="middle"
			font-size="10"
			fill="var(--muted-foreground)">no data</text
		>
	{/if}
{/snippet}

{#snippet chart()}
	<svg
		viewBox="0 0 {width} {height}"
		width="100%"
		{height}
		preserveAspectRatio="none"
		role="img"
		aria-hidden={!interactive}
		focusable="false"
	>
		{@render svgBody()}
		{#if interactive}
			<!-- Transparent focus/pointer target on TOP of the marks: a full-track
			     hit-area so hovering any mark drives the tooltip. The box rect and
			     median line stay visual marks; this carries the a11y label + focus. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<rect
				x="0"
				y="0"
				{width}
				{height}
				fill="transparent"
				tabindex={0}
				role="img"
				aria-label={summary}
				aria-describedby={tip.open ? tip.id : undefined}
				onpointerenter={showTip}
				onpointerleave={hideTip}
				onfocus={showTip}
				onblur={hideTip}
			/>
		{/if}
	</svg>
{/snippet}

<figure
	bind:this={ref}
	class={cn('dv-distribution m-0', className)}
	aria-label={summary}
	data-slot="distribution"
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
			{@render chart()}
		</ChartTooltip>
	{:else}
		{@render chart()}
	{/if}

	{#if showAxis}
		<!-- Domain endpoint ticks (with unit) under the track. HTML, not SVG <text>
		     — the SVG is stretched. Neutral axis colour, never an affordance token. -->
		<div class="dv-distribution-axis" aria-hidden="true">
			<span class="dv-distribution-tick">{fmt(domain[0])}</span>
			{#if axisLabel}
				<span class="dv-distribution-axislabel">{axisLabel}</span>
			{/if}
			<span class="dv-distribution-tick">{fmt(domain[1])}</span>
		</div>
	{/if}
</figure>

<style>
	.dv-distribution-axis {
		margin-top: 0.25rem;
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.dv-distribution-tick {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-variant-numeric: tabular-nums;
		line-height: 1;
		color: var(--muted-foreground);
	}
	.dv-distribution-axislabel {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--muted-foreground);
	}
</style>
