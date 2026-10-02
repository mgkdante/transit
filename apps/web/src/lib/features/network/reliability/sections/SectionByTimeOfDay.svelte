<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { RankedRow } from '$lib/components/dataviz';
	import { SEVERE_DOMAIN } from '$lib/features/reliability/shiftGrains';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import NetworkTile from './NetworkTile.svelte';
	import type { ShiftRow } from '../selectors/shiftRank';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';

	interface SectionByTimeOfDayProps {
		rows: readonly ShiftRow[];
		dataSlot?: string;
		showCaveat: boolean;
		copy: NetworkReliabilityCopy;
		locale: Locale;
	}
	let { rows, dataSlot, showCaveat, copy, locale }: SectionByTimeOfDayProps = $props();
</script>

{#snippet shiftInfo()}
	<MetricInfo metricKey="severe" {locale} name={copy.shiftSection} side="bottom" />
{/snippet}

<NetworkTile
	title={copy.shiftSection}
	subtitle={copy.shift.rowCaption}
	sectionKey="network-by-time-of-day"
	{dataSlot}
	headerActions={shiftInfo}
>
	<div class="network-ranked" role="list" aria-label={copy.shift.shiftSummary}>
		{#each rows as row (row.key)}
			<RankedRow
				rank={row.rank}
				title={row.title}
				subtitle={row.subtitle}
				severity={row.severity}
				value={row.value}
				domain={SEVERE_DOMAIN}
				unit={copy.units.pct}
				display={row.display}
				absentReason="no-observations"
				{locale}
			/>
		{/each}
	</div>
	{#if showCaveat}
		<p class="network-shift-caveat" data-slot="shift-caveat">{copy.shift.caveat}</p>
	{/if}
</NetworkTile>

<style>
	.network-ranked {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 100%;
	}
	.network-shift-caveat {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
		max-width: 100%;
	}
</style>
