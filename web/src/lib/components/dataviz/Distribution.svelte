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

	export interface DistributionStats {
		min: number | null;
		p25: number | null;
		p50: number | null;
		p75: number | null;
		max: number | null;
	}

	export interface DistributionProps
		extends WithElementRef<HTMLAttributes<HTMLElement>> {
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
		/** Optional unit suffix for the a11y summary (e.g. "min", "%"). */
		unit?: string;
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
</script>

<figure
	bind:this={ref}
	class={cn('dv-distribution m-0', className)}
	aria-label={summary}
	data-slot="distribution"
	{...restProps}
>
	<svg
		viewBox="0 0 {width} {height}"
		width="100%"
		height={height}
		preserveAspectRatio="none"
		role="img"
		aria-hidden="true"
		focusable="false"
	>
		<!-- Domain baseline (neutral, NOT data). -->
		<line x1={PAD_X} y1={midY} x2={width - PAD_X} y2={midY} stroke="var(--border)" stroke-width="0.75" />

		{#if anyData}
			<!-- Whisker line min..max. -->
			{#if hasWhiskers}
				<line x1={xMin} y1={midY} x2={xMax} y2={midY} stroke="var(--border-strong, var(--border))" stroke-width="1" />
				<line x1={xMin} y1={midY - boxH / 2} x2={xMin} y2={midY + boxH / 2} stroke="var(--border-strong, var(--border))" stroke-width="1" />
				<line x1={xMax} y1={midY - boxH / 2} x2={xMax} y2={midY + boxH / 2} stroke="var(--border-strong, var(--border))" stroke-width="1" />
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
			<text x={width / 2} y={midY + 3} text-anchor="middle" font-size="10" fill="var(--muted-foreground)">no data</text>
		{/if}
	</svg>
</figure>
