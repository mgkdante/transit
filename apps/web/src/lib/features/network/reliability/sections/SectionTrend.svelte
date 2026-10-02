<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { Chart, type ChartSpec, type SparklineSpec } from '$lib/components/dataviz/chart';
	import { SectionLabel } from '@yesid/ui/brand';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey } from '$lib/metrics';
	import NetworkTile from './NetworkTile.svelte';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';

	interface SectionTrendProps {
		locale: Locale;
		trendSpec: ChartSpec;
		vehiclesSpark: SparklineSpec | null;
		isDailyGrain: boolean;
		metricKey: MetricKey;
		copy: NetworkReliabilityCopy;
	}
	let { locale, trendSpec, vehiclesSpark, isDailyGrain, metricKey, copy }: SectionTrendProps =
		$props();
</script>

{#snippet trendInfo()}
	<MetricInfo {metricKey} {locale} name={copy.trendSection} side="bottom" />
{/snippet}

<NetworkTile
	wide
	title={copy.trendSection}
	subtitle={copy.trend.summary}
	sectionKey="network-daily-trend"
	headerActions={trendInfo}
>
	<div class="network-trend">
		<Chart spec={trendSpec} />

		{#if isDailyGrain && vehiclesSpark}
			<div class="network-vehicles-row" data-slot="vehicles-reporting-row">
				<SectionLabel text={copy.trend.vehiclesContext} variant="metric" />
				<Chart spec={vehiclesSpark} />
			</div>
		{/if}
	</div>
</NetworkTile>

<style>
	.network-trend {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 100%;
	}
	.network-vehicles-row {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
</style>
