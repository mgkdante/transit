<!--
  BulletKpi — one number vs a target (slice-S3, Chart Doctrine §3.1 / Few).

  A bullet graph, NOT a gauge/donut: a big value in the wayfinding voice + a thin
  horizontal measure bar against optional qualitative bands and a target tick. The
  bar + tick ride the DATAVIZ scale (never --primary). The value/target verdict is
  glyph-free but fully labelled via role=img + aria, so colour is never the sole
  channel.

  HONESTY: with no value — or a sample too small to be reliable (n < MIN_N_RATE) —
  the bar is suppressed and the card reads the muted no-data label, never a rate
  off a tiny denominator. data-slot="bullet-kpi".
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import { isReliableRate } from '$lib/v1/stats';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';

	export interface BulletKpiProps extends WithElementRef<HTMLAttributes<HTMLDivElement>> {
		/** Eyebrow label — names the metric + baseline/window in words. */
		label: string;
		/** The measured value (domain units). null → honest no-data. */
		value: number | null | undefined;
		/** Formatted big-number display (e.g. "82%"). Falls back to value+unit. */
		display?: string;
		/** Localized no-data label (shown muted when value is absent/suppressed). */
		emptyLabel?: string;
		/** Target / goal tick (domain units); omit to draw no target. */
		target?: number | null;
		/** Bar domain [min, max]. Default [0, 100]. */
		domain?: [number, number];
		/**
		 * Sample size behind the value. When provided and below MIN_N_RATE the value
		 * is SUPPRESSED to the no-data label — never a rate off a tiny denominator.
		 */
		n?: number | null;
		/** Unit suffix for the fallback display + aria (e.g. "%", " min"). */
		unit?: string;
		/**
		 * Measure-bar fill — a `var(--dataviz-*)` token (doctrine: dataviz scale
		 * ONLY, never --primary). Default the calm on-time green.
		 */
		colorVar?: string;
		/**
		 * Optional qualitative band cutoffs (ascending, domain units) drawn as
		 * light→lighter grey segments behind the bar (poor / fair / good context).
		 */
		bands?: number[];
		class?: string;
	}

	let {
		label,
		value,
		display,
		emptyLabel,
		target = null,
		domain = [0, 100],
		n = null,
		unit = '',
		colorVar = 'var(--dataviz-status-on-time)',
		bands,
		class: className,
		ref = $bindable(null),
		...restProps
	}: BulletKpiProps = $props();

	const W = 100;
	const H = 14;
	const BAR_H = 6;
	const BAR_Y = (H - BAR_H) / 2;

	// Suppress when there's no value OR the sample is too small to be reliable.
	const suppressed = $derived(value == null || (n != null && !isReliableRate(n)));
	const valueText = $derived(suppressed ? null : (display ?? `${value}${unit}`));

	const [dMin, dMax] = $derived(domain);
	const span = $derived(dMax - dMin || 1);
	const scaleX = (v: number): number => ((Math.min(dMax, Math.max(dMin, v)) - dMin) / span) * W;

	const measureW = $derived(value == null ? 0 : scaleX(value));
	const targetX = $derived(target == null ? null : scaleX(target));
	// Band segments as [x0, x1] spans (ascending cutoffs, clamped to the domain).
	const bandSpans = $derived.by<Array<[number, number]>>(() => {
		if (!bands?.length) return [];
		const edges = [dMin, ...bands.filter((b) => b > dMin && b < dMax), dMax];
		const out: Array<[number, number]> = [];
		for (let i = 0; i < edges.length - 1; i++) out.push([scaleX(edges[i]), scaleX(edges[i + 1])]);
		return out;
	});

	const ariaLabel = $derived(
		suppressed
			? `${label}: ${emptyLabel ?? 'not enough data'}`
			: `${label}: ${valueText}${targetX != null ? `, target ${target}${unit}` : ''}`,
	);
</script>

<div
	bind:this={ref}
	class={cn(
		'dv-bullet-kpi flex flex-col gap-2 rounded-lg border border-border bg-card p-4',
		className,
	)}
	data-slot="bullet-kpi"
	{...restProps}
>
	<MetricDisplay {label} value={valueText} {emptyLabel} size="lg" />
	{#if !suppressed}
		<svg
			class="dv-bullet-bar"
			viewBox="0 0 {W} {H}"
			width="100%"
			height={H}
			preserveAspectRatio="none"
			role="img"
			aria-label={ariaLabel}
		>
			<!-- Qualitative bands (light→lighter grey context); structural, not data. -->
			{#each bandSpans as [x0, x1], i (i)}
				<rect
					x={x0}
					y={BAR_Y}
					width={Math.max(0, x1 - x0)}
					height={BAR_H}
					fill="var(--muted)"
					opacity={0.35 + i * 0.18}
				/>
			{/each}
			<!-- Measure bar — dataviz fill, never --primary. -->
			<rect x="0" y={BAR_Y + BAR_H / 4} width={measureW} height={BAR_H / 2} fill={colorVar} />
			<!-- Target tick (a goal marker, structural border colour). -->
			{#if targetX != null}
				<rect
					x={Math.max(0, targetX - 0.6)}
					y="1"
					width="1.2"
					height={H - 2}
					fill="var(--border-strong, var(--border))"
				/>
			{/if}
		</svg>
	{/if}
</div>
