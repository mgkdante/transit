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
		/** The metric value (e.g. "82%", "5 min", "1.2k"). */
		value: string;
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
</script>

<div class={cn('flex flex-col', className)} data-slot="metric-display" {...restProps}>
	{#if !labelBelow}
		<span class="label-metric">{label}</span>
	{/if}
	<span
		class={cn(
			'metric-value font-heading font-extrabold leading-none text-accent-text',
			valueClass[size],
		)}>{value}</span
	>
	{#if labelBelow}
		<span class="mt-2 label-metric">{label}</span>
	{/if}
	{#if sublabel}
		<span class="mt-1 font-mono text-caption text-[var(--muted-foreground)]">{sublabel}</span>
	{/if}
</div>
