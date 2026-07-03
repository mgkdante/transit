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
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
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

<DashboardGrid minTile="320px" align="start" gutter={false}>
	<!-- Status mix -->
	<div class="network-tile">
		<SectionHeading level={3} overline={copy.statusSection} />
		<Chart spec={statusSpec} />
	</div>

	<!-- Crowding (occupancy) — only when telemetry was received this cycle -->
	{#if hasOccupancy && occupancySpec}
		<div class="network-tile">
			<SectionHeading level={3} overline={copy.occupancySection}>
				{#snippet explainer()}
					<MetricInfo
						tip={occInfo.tip}
						href={occInfo.href}
						label={occInfo.label}
						linkLabel={occInfo.linkLabel}
						side="bottom"
					/>
				{/snippet}
			</SectionHeading>
			<Chart spec={occupancySpec} />
		</div>
	{/if}
</DashboardGrid>

<style>
	.network-tile {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
		/* E1 glow map: content tiles rest on --shadow-card (the soft card bevel);
		   they carry no drill-in, so no interactive hover-lift. */
		box-shadow: var(--shadow-card);
	}
</style>
