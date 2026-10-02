<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { RankedRow } from '$lib/components/dataviz';
	import type { WeekdayRow } from '../selectors/weekdaySeasonality';
	import type { StopReliabilityCopy } from '../stops-reliability.copy';
	import StopReliabilityPresenter from './StopReliabilityPresenter.svelte';

	interface SectionWeekdayProps {
		rows: readonly WeekdayRow[];
		locale: Locale;
		copy: StopReliabilityCopy;
		presentation?: 'standalone' | 'article-body';
	}
	let { rows, locale, copy, presentation = 'standalone' }: SectionWeekdayProps = $props();
</script>

<StopReliabilityPresenter
	heading={copy.weekday.heading}
	metricKey="seasonality"
	{locale}
	{presentation}
	dataSlot="stop-weekday"
>
	<div class="stop-reliability-route-list" role="list" aria-label={copy.weekday.heading}>
		{#each rows as row (row.key)}
			<RankedRow
				rank={row.rank}
				title={row.title}
				subtitle={row.subtitle}
				severity={row.severity}
				value={row.value}
				domain={row.domain}
				unit={row.unit}
				display={row.display}
				{locale}
			/>
		{/each}
	</div>
	<p class="stop-reliability-caveat">{copy.weekday.caveat}</p>
</StopReliabilityPresenter>

<style>
	.stop-reliability-route-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.stop-reliability-caveat {
		margin: 0;
		max-width: 100%;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
</style>
