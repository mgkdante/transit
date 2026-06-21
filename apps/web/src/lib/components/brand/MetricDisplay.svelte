<!--
  MetricDisplay — big number + label stat combo (Set A).
  Brand primitive: replaces scattered metric implementations.
  Adapted from yesid.dev MetricDisplay; re-themed to transit tokens.

  Doctrine: the metric VALUE speaks the yellow wayfinding voice
  (text-accent-text = AA amber ink both modes); the label stays quiet
  (.label-metric = muted mono caption).
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface MetricDisplayProps extends HTMLAttributes<HTMLDivElement> {
		/**
		 * The metric value (e.g. "82%", "5 min", "1.2k"). When `null` / `undefined`
		 * / "" the tile shows the muted `emptyLabel` instead of the amber value voice
		 * — the honest no-data state, never a bare "·" and never a fabricated 0.
		 */
		value: string | null | undefined;
		/**
		 * Localized no-data label rendered (muted, quiet) when `value` is absent.
		 * When this is also empty, nothing is rendered rather than an empty amber span.
		 */
		emptyLabel?: string;
		/** Primary label. */
		label: string;
		/** Optional secondary description. */
		sublabel?: string;
		/** Display size. */
		size?: 'sm' | 'md' | 'lg';
		/** Place the label below the value instead of above. */
		labelBelow?: boolean;
		class?: string;
	}

	let {
		value,
		emptyLabel,
		label,
		sublabel,
		size = 'md',
		labelBelow = false,
		class: className,
		...restProps
	}: MetricDisplayProps = $props();

	const valueClass = {
		sm: 'text-subheading',
		md: 'text-heading',
		lg: 'text-title',
	} as const;

	// A value is "empty" when null/undefined/"" — the honest no-data state. The
	// amber metric-value voice speaks ONLY for a real value; absence speaks in the
	// quiet muted-mono caption voice (never --accent-text, never --primary).
	const isEmpty = $derived(value == null || value === '');
</script>

<div class={cn('flex flex-col', className)} data-slot="metric-display" {...restProps}>
	{#if !labelBelow}
		<span class="label-metric">{label}</span>
	{/if}
	{#if isEmpty}
		{#if emptyLabel}
			<span class="metric-empty" data-slot="metric-empty">{emptyLabel}</span>
		{/if}
	{:else}
		<span
			class={cn(
				'metric-value font-heading font-extrabold leading-none text-accent-text',
				valueClass[size],
			)}>{value}</span
		>
	{/if}
	{#if labelBelow}
		<span class="mt-2 label-metric">{label}</span>
	{/if}
	{#if sublabel}
		<span class="mt-1 font-mono text-caption text-[var(--muted-foreground)]">{sublabel}</span>
	{/if}
</div>

<style>
	/* Honest no-data: a quiet muted-mono caption, never the amber metric-value
	   voice and never --primary. Smaller than the value so it reads as an absence. */
	.metric-empty {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.2;
		color: var(--muted-foreground);
	}
</style>
