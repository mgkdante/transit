<!--
  SectionStatusMix — the two live distribution bars (status mix + crowding mix).

  Pure presenter of selector-emitted ChartSpecs (P5.2): the 100%-stacked status +
  occupancy strips render through the ONE <Chart> renderer (a stacked-share mark is
  EXEMPT from the absolute-magnitude domain law — each band's length IS its share of
  the whole). Each band carries the map cross-filter URL as a focusable link (selecting
  a band opens /map pre-filtered to it). The crowding tile stands DOWN when no telemetry
  was received this cycle (never a fabricated even split).

  --primary stays interactive-only; the marks own their scales.
-->
<script lang="ts">
	import { DashboardGrid } from '$lib/components/layout';
	import { Chart, type ChartSpec } from '$lib/components/dataviz/chart';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import NetworkTile from './NetworkTile.svelte';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';

	interface SectionStatusMixProps {
		/** The status-mix spec (5 StatusCodes by count, or an honest absence). */
		statusSpec: ChartSpec;
		/** The occupancy-mix spec; null when the tile stands down. */
		occupancySpec: ChartSpec | null;
		/** True when the cycle received real occupancy telemetry (gates the crowding bar). */
		hasOccupancy: boolean;
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
	}
	let { statusSpec, occupancySpec, hasOccupancy, info, copy }: SectionStatusMixProps = $props();

	const occInfo = $derived(info('occupancy', copy.occupancySection));
</script>

<DashboardGrid minTile="320px" gutter={false}>
	<!-- Status mix -->
	<NetworkTile
		title={copy.statusSection}
		subtitle={copy.statusBarLabel}
		sectionKey="network-status-mix"
	>
		<Chart spec={statusSpec} />
	</NetworkTile>

	<!-- Crowding (occupancy) — only when telemetry was received this cycle -->
	{#if hasOccupancy && occupancySpec}
		{#snippet occupancyInfo()}
			<MetricInfo
				tip={occInfo.tip}
				href={occInfo.href}
				label={occInfo.label}
				linkLabel={occInfo.linkLabel}
				side="bottom"
			/>
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
