<!--
  SectionTimeOfDay — the by-shift + weekday-vs-weekend ranked lists.

  Pure presenter of `selectTimeOfDay`. SHIFT buckets (ranked by severe share on the
  FIXED SEVERE_DOMAIN) + a weekday-vs-weekend day-type comparison, surfaced from the
  granular grains the pipeline emits alongside the calendar ones (these never enter
  the grain rail). A trailing-window proxy. Rendered only when the caller has at
  least one shift OR day-type row.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { RankedRow } from '$lib/components/dataviz';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import type { TimeOfDayRow } from '../selectors/timeOfDay';
	import type { StopReliabilityCopy } from '../stops-reliability.copy';

	interface SectionTimeOfDayProps {
		shiftRows: readonly TimeOfDayRow[];
		dayTypeRows: readonly TimeOfDayRow[];
		locale: Locale;
		copy: StopReliabilityCopy;
	}
	let { shiftRows, dayTypeRows, locale, copy }: SectionTimeOfDayProps = $props();

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

<div class="stop-tile stop-reliability-tod" data-slot="stop-time-of-day">
	<span class="stop-tile-heading">
		<SectionLabel text={copy.timeOfDay.heading} variant="station" />
		{@render metricInfo('severe', copy.timeOfDay.heading)}
	</span>
	{#if shiftRows.length > 0}
		<div class="stop-reliability-route-list" role="list" aria-label={copy.timeOfDay.heading}>
			{#each shiftRows as row (row.key)}
				<RankedRow
					rank={row.rank}
					title={row.title}
					subtitle={copy.timeOfDay.severeShare}
					severity={row.severity}
					value={row.value}
					domain={row.domain}
					unit={row.unit}
					display={row.display}
				/>
			{/each}
		</div>
	{/if}

	{#if dayTypeRows.length > 0}
		<div class="stop-reliability-tod-daytype" data-slot="stop-day-type">
			<SectionLabel text={copy.timeOfDay.dayType} variant="metric" />
			<div class="stop-reliability-route-list" role="list" aria-label={copy.timeOfDay.dayType}>
				{#each dayTypeRows as row (row.key)}
					<RankedRow
						rank={row.rank}
						title={row.title}
						subtitle={copy.timeOfDay.severeShare}
						severity={row.severity}
						value={row.value}
						domain={row.domain}
						unit={row.unit}
						display={row.display}
					/>
				{/each}
			</div>
		</div>
	{/if}

	<p class="stop-reliability-caveat">{copy.timeOfDay.caveat}</p>
</div>

<style>
	.stop-reliability-tod {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.stop-reliability-route-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.stop-reliability-tod-daytype {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.5rem;
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
