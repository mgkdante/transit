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
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import { RankedRow } from '$lib/components/dataviz';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import type { WeekdayRow } from '../selectors/weekdaySeasonality';
	import type { StopReliabilityCopy } from '../stops-reliability.copy';

	interface SectionWeekdayProps {
		rows: readonly WeekdayRow[];
		locale: Locale;
		copy: StopReliabilityCopy;
	}
	let { rows, locale, copy }: SectionWeekdayProps = $props();

	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});
</script>

{#snippet metricInfo(key: MetricKey, name: string)}
	{@const i = info(key, name)}
	<MetricInfo
		class="stop-metric-info"
		tip={i.tip}
		href={i.href}
		label={i.label}
		linkLabel={i.linkLabel}
		side="bottom"
	/>
{/snippet}

<div class="stop-tile stop-reliability-weekday" data-slot="stop-weekday">
	<SectionHeading level={2} overline={copy.weekday.heading} class="stop-tile-heading">
		{#snippet explainer()}
			{@render metricInfo('seasonality', copy.weekday.heading)}
		{/snippet}
	</SectionHeading>
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
</div>

<style>
	.stop-reliability-weekday {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
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
