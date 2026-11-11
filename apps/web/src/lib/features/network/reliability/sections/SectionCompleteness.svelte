<script lang="ts">
	import type { Locale } from '#lib/i18n/index.ts';
	import { ExplainedMetricCard } from '#lib/components/dataviz/index.ts';
	import MetricInfo from '#lib/features/metrics/MetricInfo.svelte';
	import NetworkTile from './NetworkTile.svelte';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';

	interface SectionCompletenessProps {
		latestDisplay: string | null;
		copy: NetworkReliabilityCopy;
		locale: Locale;
	}
	let { latestDisplay, copy, locale }: SectionCompletenessProps = $props();
</script>

<NetworkTile
	title={copy.completeness.section}
	subtitle={copy.questions.completeness}
	sectionKey="network-service-completeness"
	dataSlot="completeness-section"
>
	<p class="text-sm text-muted-foreground">{copy.completeness.explainer}</p>
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
