<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import { Chart } from '$lib/components/dataviz/chart';
	import { MaybeValue } from '$lib/components/edge';
	import type { BulletSpec } from '$lib/components/dataviz/chart/ChartSpec';
	import type { Locale } from '$lib/i18n';

	let {
		label,
		valueText,
		spec,
		locale,
		size = 'md',
		info,
		caption,
		class: className,
		...restProps
	}: {
		label: string;
		valueText: string | null;
		spec: BulletSpec;
		locale: Locale;
		size?: 'md' | 'lg';
		info?: Snippet;
		caption?: string;
		class?: string;
		[key: `data-${string}`]: string | undefined;
	} = $props();
</script>

<div
	class={cn('metric-bullet', className)}
	data-slot="metric-bullet"
	data-size={size}
	{...restProps}
>
	<div class="metric-bullet__head">
		<span class="metric-bullet__label">{label}</span>
		{#if info}{@render info()}{/if}
	</div>
	<div class="metric-bullet__value" class:metric-bullet__value--empty={valueText == null}>
		{#if valueText != null}
			{valueText}
		{:else}
			<MaybeValue value={null} reason="no-observations" {locale} />
		{/if}
	</div>
	{#if spec.value != null}
		<div class="metric-bullet__chart"><Chart {spec} /></div>
	{/if}
	{#if caption}
		<p class="metric-bullet__caption">{caption}</p>
	{/if}
</div>

<style>
	.metric-bullet {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 1rem 1.25rem;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	.metric-bullet__head {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 0;
	}
	.metric-bullet__label {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
		letter-spacing: var(--tracking-wide);
	}
	.metric-bullet__value {
		font-family: var(--font-heading);
		font-weight: 700;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
		font-size: var(--text-heading);
		white-space: nowrap;
	}
	.metric-bullet[data-size='lg'] .metric-bullet__value {
		font-size: var(--text-title);
	}
	.metric-bullet__value--empty {
		font-size: var(--text-subheading);
		font-weight: 500;
		color: var(--muted-foreground);
	}
	.metric-bullet__chart {
		margin-top: 0.125rem;
	}
	.metric-bullet__caption {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
</style>
