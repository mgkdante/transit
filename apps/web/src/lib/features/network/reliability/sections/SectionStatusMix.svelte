<!--
  SectionStatusMix — the two live distribution bars (status mix + crowding mix).

  Pure presenter: the 100%-stacked status + occupancy bars ride the shared StackedBar primitive
  (a stacked-share mark is EXEMPT from the absolute-magnitude domain law — each segment's length
  IS its share of the whole), so NEITHER touches the chart-doctrine count-domain rule. Each bar
  cross-filters the live map (selecting a band opens /map pre-filtered to it). The crowding bar
  stands DOWN when no telemetry was received this cycle (never a fabricated even split).

  --primary stays interactive-only; the marks own their scales.
-->
<script lang="ts">
	import type { StatusCode, OccupancyCode } from '$lib/v1/schemas';
	import { DashboardGrid } from '$lib/components/layout';
	import { StackedBar, type StackedSegment } from '$lib/components/dataviz';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';

	interface SectionStatusMixProps {
		/** The status-mix segments (5 StatusCodes by count). */
		statusSegments: readonly StackedSegment[];
		/** The occupancy-mix segments (5 OccupancyCodes by fraction). */
		occupancySegments: readonly StackedSegment[];
		/** True when the cycle received real occupancy telemetry (gates the crowding bar). */
		hasOccupancy: boolean;
		/** Open the live map pre-filtered to a status band. */
		onStatusSelect: (code: StatusCode | OccupancyCode) => void;
		/** Open the live map pre-filtered to an occupancy band. */
		onOccupancySelect: (code: StatusCode | OccupancyCode) => void;
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
	let {
		statusSegments,
		occupancySegments,
		hasOccupancy,
		onStatusSelect,
		onOccupancySelect,
		info,
		copy,
	}: SectionStatusMixProps = $props();

	const occInfo = $derived(info('occupancy', copy.occupancySection));
</script>

<DashboardGrid minTile="320px" align="start" gutter={false}>
	<!-- Status mix -->
	<div class="network-tile">
		<SectionLabel text={copy.statusSection} variant="station" />
		<StackedBar
			scale="status"
			segments={statusSegments as StackedSegment[]}
			label={copy.statusBarLabel}
			interactive
			legend
			onSelect={onStatusSelect}
		/>
	</div>

	<!-- Crowding (occupancy) — only when telemetry was received this cycle -->
	{#if hasOccupancy}
		<div class="network-tile">
			<span class="network-section">
				<SectionLabel text={copy.occupancySection} variant="station" />
				<MetricInfo
					tip={occInfo.tip}
					href={occInfo.href}
					label={occInfo.label}
					linkLabel={occInfo.linkLabel}
					side="bottom"
				/>
			</span>
			<StackedBar
				scale="occupancy"
				segments={occupancySegments as StackedSegment[]}
				label={copy.occupancyBarLabel}
				interactive
				legend
				onSelect={onOccupancySelect}
			/>
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
	}
	.network-section {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
</style>
