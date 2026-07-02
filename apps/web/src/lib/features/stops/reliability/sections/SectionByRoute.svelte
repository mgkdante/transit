<!--
  SectionByRoute — the per-route ranked severity bars (worst line first).

  Pure presenter of `selectRankedRoutes`. Each bar is banded off its avg delay on
  the FIXED DELAY_POS_DOMAIN so the reader sees WHICH line drags this stop down.
  When the stop HAS by-route associations but every one carries a null delay, the
  ranked list is empty — say so with the styled honest no-data chip, never vanish.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { RankedRow } from '$lib/components/dataviz';
	import { AbsentValue } from '$lib/components/edge';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import type { RankedRouteRow } from '../selectors/rankedRoutes';
	import type { StopReliabilityCopy } from '../stops-reliability.copy';

	interface SectionByRouteProps {
		/** The ranked route rows (empty when no real-delay route survived). */
		rows: readonly RankedRouteRow[];
		/** True when the stop HAS by-route associations (drives the empty-vs-absent branch). */
		hasAssociations: boolean;
		locale: Locale;
		copy: StopReliabilityCopy;
	}
	let { rows, hasAssociations, locale, copy }: SectionByRouteProps = $props();

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

{#if rows.length > 0 || hasAssociations}
	<div class="stop-tile stop-reliability-routes" data-slot="stop-by-route">
		<span class="stop-tile-heading">
			<SectionLabel text={copy.byRoute} variant="station" />
			{@render metricInfo('avgDelay', copy.byRoute)}
		</span>
		{#if rows.length > 0}
			<div class="stop-reliability-route-list" role="list">
				{#each rows as row (row.key)}
					<RankedRow
						rank={row.rank}
						title={row.title}
						severity={row.severity}
						value={row.value}
						domain={row.domain}
						unit={row.unit}
						display={row.display}
					/>
				{/each}
			</div>
		{:else}
			<!-- Every by-route association carries a null avg delay (too few readings). -->
			<AbsentValue variant="block" reason="no-observations" {locale} />
		{/if}
	</div>
{/if}

<style>
	.stop-reliability-routes {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.stop-reliability-route-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
</style>
