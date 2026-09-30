<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { ExplainedMetricCard } from '$lib/components/dataviz';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import NetworkTile from './NetworkTile.svelte';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';

	interface SectionCompletenessProps {
		/** The formatted latest-bucket completeness reading ("94.2%"), or null → the styled chip. */
		latestDisplay: string | null;
		copy: NetworkReliabilityCopy;
		locale: Locale;
	}
	let { latestDisplay, copy, locale }: SectionCompletenessProps = $props();
</script>

<NetworkTile
	title={copy.completeness.section}
	subtitle={copy.completeness.explainer}
	sectionKey="network-service-completeness"
	dataSlot="completeness-section"
>
	<ExplainedMetricCard
		label={copy.completeness.metric}
		value={latestDisplay}
		note={latestDisplay == null ? copy.completeness.standDown : undefined}
		absentReason="no-observations"
		{locale}
		size="lg"
	>
		{#snippet info()}
			<MetricInfo
				metricKey="serviceComparison"
				{locale}
				name={copy.completeness.section}
				side="bottom"
			/>
		{/snippet}
	</ExplainedMetricCard>
</NetworkTile>
