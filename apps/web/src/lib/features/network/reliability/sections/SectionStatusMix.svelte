<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { DashboardGrid } from '$lib/components/layout';
	import { Chart, type ChartSpec } from '$lib/components/dataviz/chart';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import NetworkTile from './NetworkTile.svelte';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';

	interface SectionStatusMixProps {
		locale: Locale;
		statusSpec: ChartSpec;
		occupancySpec: ChartSpec | null;
		hasOccupancy: boolean;
		copy: NetworkReliabilityCopy;
	}
	let { locale, statusSpec, occupancySpec, hasOccupancy, copy }: SectionStatusMixProps = $props();
</script>

<DashboardGrid minTile="320px" gutter={false}>
	<NetworkTile
		title={copy.statusSection}
		subtitle={copy.statusBarLabel}
		sectionKey="network-status-mix"
	>
		<Chart spec={statusSpec} />
	</NetworkTile>

	{#if hasOccupancy && occupancySpec}
		{#snippet occupancyInfo()}
			<MetricInfo metricKey="occupancy" {locale} name={copy.occupancySection} side="bottom" />
		{/snippet}
		<NetworkTile
			title={copy.occupancySection}
			subtitle={copy.occupancyBarLabel}
			sectionKey="network-occupancy-mix"
			headerActions={occupancyInfo}
		>
			<Chart spec={occupancySpec} />
		</NetworkTile>
	{/if}
</DashboardGrid>
