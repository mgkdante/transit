<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import EntityRow from '$lib/components/surface/EntityRow.svelte';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import type { WorstOfDayVM } from '../selectors/day-worst';

	interface SectionWorstProps {
		worst: WorstOfDayVM;
		heading: string;
		info: (
			key: MetricKey | SupplementalMetricKey,
			name: string,
		) => { tip: string; href: string; label: string; linkLabel: string };
		locale: Locale;
		headingLevel?: 2 | 3;
	}
	let { worst, heading, info, locale, headingLevel = 2 }: SectionWorstProps = $props();

	const headingInfo = $derived(info('otp', heading));
</script>

<section class="receipt-panel receipt-worst-panel" data-slot="receipt-worst">
	<SectionHeading level={headingLevel} overline={heading}>
		{#snippet explainer()}
			<MetricInfo
				tip={headingInfo.tip}
				href={headingInfo.href}
				label={headingInfo.label}
				linkLabel={headingInfo.linkLabel}
				side="bottom"
			/>
		{/snippet}
	</SectionHeading>
	<div class="receipt-worst">
		{#if worst.route}
			<EntityRow
				target={{ kind: 'line', id: worst.route.id }}
				{locale}
				title={worst.route.title}
				subtitle={worst.route.subtitle}
				meta={worst.route.meta}
			/>
		{/if}
		{#if worst.stop}
			<EntityRow
				target={{ kind: 'stop', id: worst.stop.id }}
				{locale}
				title={worst.stop.title}
				subtitle={worst.stop.subtitle}
				meta={worst.stop.meta}
			/>
		{/if}
	</div>
</section>

<style>
	.receipt-panel {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding: 1.1rem 1.2rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
	}
	.receipt-worst {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.receipt-worst :global(.entity-row) {
		flex-direction: column;
		align-items: stretch;
		gap: 0.375rem;
	}
	.receipt-worst :global(.entity-row-title-text),
	.receipt-worst :global(.entity-row-subtitle) {
		white-space: normal;
		overflow-wrap: anywhere;
	}
	.receipt-worst :global(.entity-row-meta) {
		overflow-wrap: anywhere;
	}
</style>
