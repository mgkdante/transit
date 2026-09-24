<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { ExplainedMetricCard } from '$lib/components/dataviz';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import NetworkTile from './NetworkTile.svelte';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';

	interface SectionCompletenessProps {
		/** The formatted latest-bucket completeness reading ("94.2%"), or null → the styled chip. */
		latestDisplay: string | null;
		info: (
			key: MetricKey | SupplementalMetricKey,
			name: string,
		) => {
			tip: string;
			href: string;
			label: string;
			linkLabel: string;
		};
		copy: NetworkReliabilityCopy;
		locale: Locale;
	}
	let { latestDisplay, info, copy, locale }: SectionCompletenessProps = $props();

	const i = $derived(info('serviceComparison', copy.completeness.section));
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
			<MetricInfo tip={i.tip} href={i.href} label={i.label} linkLabel={i.linkLabel} side="bottom" />
		{/snippet}
	</ExplainedMetricCard>
</NetworkTile>
