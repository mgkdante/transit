<!--
  StripPlot — a 1-D dot plot, one circle per value (slice-S3, Chart Doctrine §A).

  The honest small-sample distribution: when n is below the histogram floor
  (STRIP_FLOOR..MIN_N) you show every observation as a dot on a shared value axis
  instead of a misleading histogram/box. Position (x) is the value — the accurate
  channel — so colour is a single calm hue, not a category; the count + range are
  carried in aria (colour is never the sole channel because position is).

  DETERMINISM: vertical jitter to separate overlapping dots comes from
  hashJitter(id) (FNV-1a), NEVER Math.random — the plot renders byte-identical
  across loads/SSR. Pass stable `ids` (e.g. trip ids); without them the index is
  the seed. Pin `domain` for a comparable axis across small multiples.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import { hashJitter } from '$lib/utils/hash';

	export interface StripPlotProps extends WithElementRef<HTMLAttributes<HTMLElement>> {
		/** The raw values, one dot each (e.g. per-trip signed delay minutes). */
		values: number[];
		/** Stable id per value for deterministic jitter; falls back to the index. */
		ids?: string[];
		/** Pinned x value-domain [min, max]; defaults to the data's own range. */
		domain?: [number, number];
		/** Dot fill — a `var(--dataviz-*)` token (never --primary). Default neutral. */
		colorVar?: string;
		/** Optional median tick (value units) drawn as a vertical reference rule. */
		median?: number | null;
		/** Optional tinted reference band [from, to] (value units) e.g. the on-time band. */
		band?: [number, number] | null;
		/** Accessible summary (already localized). Falls back to "{n} values". */
		label?: string;
		width?: number;
		height?: number;
		/** Dot radius (viewBox units). */
		dotR?: number;
		class?: string;
	}

	let {
		values,
		ids,
		domain,
		colorVar = 'var(--dataviz-status-unknown)',
		median = null,
		band = null,
		label,
		width = 240,
		height = 48,
		dotR = 3,
		class: className,
		ref = $bindable(null),
		...restProps
	}: StripPlotProps = $props();

	const PAD = $derived(dotR + 2);
	const reals = $derived(values.filter((v) => v != null && !Number.isNaN(v)));
	const dMin = $derived(domain ? domain[0] : Math.min(...(reals.length ? reals : [0])));
	const dMax = $derived(domain ? domain[1] : Math.max(...(reals.length ? reals : [1])));
	const span = $derived(dMax - dMin || 1);
	const innerW = $derived(width - PAD * 2);
	const midY = $derived(height / 2);
	// Total vertical jitter band, capped so dots stay inside the plot.
	const jitterBand = $derived(Math.min(8, (height - dotR * 2 - 4) / 2));

	const scaleX = (v: number): number =>
		PAD + ((Math.min(dMax, Math.max(dMin, v)) - dMin) / span) * innerW;

	type Dot = { x: number; y: number };
	const dots = $derived<Dot[]>(
		values
			.map((v, i) => ({ v, seed: ids?.[i] ?? String(i) }))
			.filter((d) => d.v != null && !Number.isNaN(d.v))
			.map((d) => ({ x: scaleX(d.v), y: midY + hashJitter(d.seed, jitterBand) })),
	);

	const summary = $derived(label ?? `${reals.length} values`);
	const bandX = $derived(band ? ([scaleX(band[0]), scaleX(band[1])] as const) : null);
</script>

<figure
	bind:this={ref}
	class={cn('dv-strip-plot m-0', className)}
	data-slot="strip-plot"
	aria-label={summary}
	{...restProps}
>
	<svg
		viewBox="0 0 {width} {height}"
		width="100%"
		{height}
		preserveAspectRatio="none"
		role="img"
		aria-hidden="true"
	>
		<!-- Reference band (e.g. the on-time window) — structural tint, not a data mark. -->
		{#if bandX}
			<rect
				x={Math.min(bandX[0], bandX[1])}
				y="0"
				width={Math.abs(bandX[1] - bandX[0])}
				{height}
				fill="var(--muted)"
				opacity="0.5"
			/>
		{/if}
		<!-- Baseline axis rule (neutral). -->
		<line
			x1={PAD}
			y1={midY}
			x2={width - PAD}
			y2={midY}
			stroke="var(--border)"
			stroke-width="0.75"
		/>
		<!-- Median reference tick (value units). -->
		{#if median != null && !Number.isNaN(median)}
			<line
				x1={scaleX(median)}
				y1={PAD}
				x2={scaleX(median)}
				y2={height - PAD}
				stroke="var(--border-strong, var(--border))"
				stroke-width="1"
				stroke-dasharray="3 3"
			/>
		{/if}
		<!-- One dot per observation; x = the true value, deterministic y jitter. -->
		{#each dots as d, i (i)}
			<circle cx={d.x} cy={d.y} r={dotR} fill={colorVar} opacity="0.8" />
		{/each}
	</svg>
</figure>
