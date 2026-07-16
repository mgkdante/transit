<!--
  SectionWeekday — the weekday seasonality ranked list (day_of_week[]).

  Pure presenter of `selectWeekdaySeasonality`. Which weekday drags this stop down
  most, ranked worst-first by mean delay on the FIXED DELAY_DOW_DOMAIN. A weekday
  with no mean delay is already dropped by the selector (never a fake-0 bar); the
  severe share rides as a second reading only when enough observations back it.
  Rendered only when the caller has at least one real-delay weekday.
-->
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
