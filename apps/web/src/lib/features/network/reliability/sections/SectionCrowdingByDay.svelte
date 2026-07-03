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
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
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

<div class="network-tile">
	<SectionHeading level={3} overline={copy.occupancyTrendSection}>
		{#snippet explainer()}
			<MetricInfo tip={i.tip} href={i.href} label={i.label} linkLabel={i.linkLabel} side="bottom" />
		{/snippet}
	</SectionHeading>
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
</div>

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
