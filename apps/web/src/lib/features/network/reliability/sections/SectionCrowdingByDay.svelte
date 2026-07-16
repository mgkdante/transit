<!--
  SectionCrowdingByDay — the per-day crowding small-multiple (one 100% bar per day).

  Pure presenter of `selectOccupancyTrend` (P5.2: selector-emitted stacked-share
  ChartSpecs through the ONE <Chart> renderer). One strip per day WITH occupancy
  telemetry — a day with no telemetry is SKIPPED upstream (never an even split). The
  100% stacked strips are self-normalising (EXEMPT from the absolute-magnitude domain
  law). The whole tile stands down (renders nothing) when no day carries crowding data —
  the orchestrator gates on the day-grain + a non-empty list.
-->
<script lang="ts">
	import { Chart } from '$lib/components/dataviz/chart';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import NetworkTile from './NetworkTile.svelte';
	import type { OccupancyDay } from '../selectors/occupancyTrend';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';

	interface SectionCrowdingByDayProps {
		days: readonly OccupancyDay[];
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
	let { days, info, copy }: SectionCrowdingByDayProps = $props();

	const i = $derived(info('occupancy', copy.occupancyTrendSection));
</script>

{#snippet crowdingInfo()}
	<MetricInfo tip={i.tip} href={i.href} label={i.label} linkLabel={i.linkLabel} side="bottom" />
{/snippet}

<NetworkTile
	title={copy.occupancyTrendSection}
	subtitle={copy.occupancyTrend.summary}
	sectionKey="network-crowding-by-day"
	headerActions={crowdingInfo}
>
	<ul
		class="network-occupancy-days"
		aria-label={copy.occupancyTrend.summary}
		data-slot="occupancy-trend"
	>
		{#each days as day (day.date)}
			<li class="network-occupancy-day">
				<span class="network-occupancy-date">{day.dateLabel}</span>
				<Chart spec={day.spec} />
			</li>
		{/each}
	</ul>
</NetworkTile>

<style>
	.network-occupancy-days {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		max-width: 100%;
	}
	.network-occupancy-day {
		display: grid;
		grid-template-columns: 5.5rem minmax(0, 1fr);
		align-items: center;
		gap: 0.75rem;
	}
	.network-occupancy-date {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}
</style>
