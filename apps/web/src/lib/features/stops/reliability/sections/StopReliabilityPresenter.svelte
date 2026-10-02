<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Locale } from '$lib/i18n';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey } from '$lib/metrics';
	import { cn } from '$lib/utils';

	type Presentation = 'standalone' | 'article-body';
	type Spacing = 'compact' | 'comfortable';

	interface StopReliabilityPresenterProps {
		heading: string;
		metricKey: MetricKey;
		locale: Locale;
		presentation?: Presentation;
		spacing?: Spacing;
		as?: 'div' | 'section';
		dataSlot: string;
		dataMount?: string;
		class?: string;
		children?: Snippet;
	}

	let {
		heading,
		metricKey,
		locale,
		presentation = 'standalone',
		spacing = 'compact',
		as = 'div',
		dataSlot,
		dataMount,
		class: className,
		children,
	}: StopReliabilityPresenterProps = $props();
</script>

<svelte:element
	this={as}
	class={cn(
		'stop-reliability-presenter',
		spacing === 'comfortable' && 'stop-reliability-presenter--comfortable',
		presentation === 'standalone' && 'stop-reliability-presenter--standalone',
		className,
	)}
	data-presentation={presentation}
	data-slot={dataSlot}
	data-mount={dataMount}
>
	{#if presentation === 'standalone'}
		{#snippet headingExplainer()}
			<MetricInfo class="stop-metric-info" {metricKey} {locale} name={heading} side="bottom" />
		{/snippet}
		<SectionHeading level={2} overline={heading} explainer={headingExplainer} />
	{/if}
	{@render children?.()}
</svelte:element>

<style>
	.stop-reliability-presenter {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.5rem;
	}

	.stop-reliability-presenter--comfortable {
		gap: 0.75rem;
	}

	.stop-reliability-presenter--standalone {
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
	}
</style>
