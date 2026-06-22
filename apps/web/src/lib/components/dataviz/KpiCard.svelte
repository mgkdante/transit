<!--
  KpiCard — the canonical headline-metric card (slice-S3, Chart Doctrine §3.1).

  Top-to-bottom anatomy:
    eyebrow label  — names the metric AND its baseline/window IN WORDS
                     ("On-time, within 5 min, last 24h") — the structural fix for
                     "1.8 min over what?". (Caller passes the full phrase.)
    value          — largest, the yellow wayfinding voice (text-accent-text), via
                     the shared brand/MetricDisplay; honest muted no-data, never a
                     fabricated 0 or a bare "·".
    delta row      — ONE comparison line; signage (the dataviz direction colour)
                     rides HERE only (DeltaStat), never the value.
    sparkline      — optional, shown ONLY with >= MIN_POINTS_FOR_LINE trustworthy
                     points (the doctrine sparkline floor); below that it's omitted
                     rather than drawing a fake trend through too few points.

  Composes existing primitives (MetricDisplay + DeltaStat + Sparkline) — no new
  colour tokens, so no tw-merge registration. data-slot="kpi-card".
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import { MIN_POINTS_FOR_LINE } from '$lib/v1/stats';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import DeltaStat from './DeltaStat.svelte';
	import Sparkline from './Sparkline.svelte';

	export interface KpiCardProps extends WithElementRef<HTMLAttributes<HTMLDivElement>> {
		/** Eyebrow — names the metric + its baseline/window in words (already localized). */
		label: string;
		/** Formatted value (e.g. "82%", "1.8 min"); null/"" → the honest no-data label. */
		value: string | null | undefined;
		/** Localized no-data label shown (muted) when `value` is absent. */
		emptyLabel?: string;
		/** Value size. */
		size?: 'sm' | 'md' | 'lg';
		/** Period-over-period change; omit/null → no delta row. */
		delta?: number | null;
		/** Formatted delta text (e.g. "+2.1 pts"). */
		deltaDisplay?: string;
		/** Whether a rise is the good direction (on-time %: true; delay: false). */
		higherIsBetter?: boolean;
		/** Trailing delta context, already localized (e.g. "vs last week"). */
		deltaContext?: string;
		/** a11y noun for the delta (e.g. the metric name). */
		deltaAriaNoun?: string;
		/** Optional trailing sparkline series; drawn only with >= MIN_POINTS_FOR_LINE points. */
		sparkline?: Array<number | null>;
		/** Accessible label for the sparkline. */
		sparklineLabel?: string;
		/** Pinned sparkline y-domain (stable shape); omit to auto-scale. */
		sparklineDomain?: [number, number];
		class?: string;
	}

	let {
		label,
		value,
		emptyLabel,
		size = 'lg',
		delta = null,
		deltaDisplay,
		higherIsBetter = false,
		deltaContext,
		deltaAriaNoun,
		sparkline,
		sparklineLabel,
		sparklineDomain,
		class: className,
		ref = $bindable(null),
		...restProps
	}: KpiCardProps = $props();

	const hasDelta = $derived(delta != null && !Number.isNaN(delta));
	// Sparkline only past the doctrine floor — never a trend through too few points.
	const showSpark = $derived(
		!!sparkline && sparkline.filter((v) => v != null).length >= MIN_POINTS_FOR_LINE,
	);
</script>

<div
	bind:this={ref}
	class={cn(
		'dv-kpi-card flex flex-col gap-2 rounded-lg border border-border bg-card p-4',
		className,
	)}
	data-slot="kpi-card"
	{...restProps}
>
	<MetricDisplay {label} {value} {emptyLabel} {size} />
	{#if hasDelta}
		<DeltaStat
			{delta}
			display={deltaDisplay}
			{higherIsBetter}
			context={deltaContext}
			ariaNoun={deltaAriaNoun}
		/>
	{/if}
	{#if showSpark}
		<Sparkline
			values={sparkline ?? []}
			label={sparklineLabel}
			domain={sparklineDomain}
			class="mt-1"
		/>
	{/if}
</div>
