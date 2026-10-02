<script lang="ts" module>
	import type { AbsenceReasonKey } from '$lib/site/absence';
	import type { Locale } from '$lib/i18n';
	import type { Snippet } from 'svelte';

	export interface ExplainedMetricCardProps {
		label: string;
		value: string | null | undefined;
		explanation?: string;
		info?: Snippet;
		sublabel?: string;
		note?: string;
		absentReason?: AbsenceReasonKey;
		absentParams?: Readonly<Record<string, string | number>>;
		locale?: Locale;
		size?: 'sm' | 'md' | 'lg';
		class?: string;
	}
</script>

<script lang="ts">
	import { cn } from '$lib/utils';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';

	let {
		label,
		value,
		explanation,
		info,
		sublabel,
		note,
		absentReason,
		absentParams,
		locale,
		size = 'md',
		class: className,
	}: ExplainedMetricCardProps = $props();
</script>

<article
	class={cn('explained-metric-card', className)}
	data-slot="explained-metric-card"
	data-explained={explanation ? 'true' : 'false'}
>
	<div class="emc-grid">
		<div class="emc-figure" data-slot="explained-metric-figure">
			<MetricDisplay {label} {value} {sublabel} {absentReason} {absentParams} {locale} {size} />
			{#if info}
				<span class="emc-info" data-slot="explained-metric-info">{@render info()}</span>
			{/if}
			{#if note}
				<p class="emc-note" data-slot="explained-metric-note">{note}</p>
			{/if}
		</div>

		{#if explanation}
			<p class="emc-explanation" data-slot="explained-metric-text">{explanation}</p>
		{/if}
	</div>
</article>

<style>
	.explained-metric-card {
		position: relative;
		container-type: inline-size;
		height: 100%;
		display: flex;
		flex-direction: column;
		padding: 1.1rem 1.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
		min-width: 0;
	}

	.emc-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
		min-width: 0;
		flex: 1;
	}
	@container (min-width: 23rem) {
		.explained-metric-card[data-explained='true'] .emc-grid {
			grid-template-columns: minmax(7rem, 12rem) minmax(0, 1fr);
			gap: 1.25rem 1.75rem;
			align-items: start;
		}
	}

	.emc-figure {
		position: relative;
		min-width: 0;
		padding-inline-end: 1.5rem;
	}
	.emc-info {
		position: absolute;
		inset-block-start: 0.05rem;
		inset-inline-end: 0;
		display: inline-flex;
	}
	.emc-figure :global([data-slot='metric-display'] .label-metric) {
		min-width: 0;
		padding-inline-end: 1.4rem;
	}

	.emc-explanation {
		margin: 0;
		font-size: var(--text-small);
		line-height: 1.55;
		color: var(--muted-foreground);
		text-wrap: pretty;
	}

	.emc-note {
		margin: 0.375rem 0 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
</style>
