<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { ExplainedMetricCard } from '$lib/components/dataviz';
	import { Chart } from '$lib/components/dataviz/chart';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import NetworkTile from './NetworkTile.svelte';
	import type { CancelTrendVM } from '../selectors/cancelTrend';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';

	interface SectionCancellationsProps {
		vm: CancelTrendVM;
		latestDisplay: string | null;
		copy: NetworkReliabilityCopy;
		locale: Locale;
	}
	let { vm, latestDisplay, copy, locale }: SectionCancellationsProps = $props();
</script>

<NetworkTile
	title={copy.cancelSection}
	subtitle={copy.cancel.summary}
	sectionKey="network-cancellations"
>
	<div class="network-trend">
		<ExplainedMetricCard
			label={copy.cancel.metric}
			value={latestDisplay}
			absentReason="no-observations"
			{locale}
			size="md"
		>
			{#snippet info()}
				<MetricInfo metricKey="cancellation" {locale} name={copy.cancelSection} side="bottom" />
			{/snippet}
		</ExplainedMetricCard>
		<Chart spec={vm.spec} />
	</div>
</NetworkTile>

<style>
	.network-trend {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 100%;
	}
</style>
