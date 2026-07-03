<!--
  SectionWeekday — the weekday-vs-weekend companion to the by-time-of-day list.

  Pure presenter of `selectShiftRank` (the by_daytype rows), same punctuality ranking + honesty
  rules as SectionByTimeOfDay. The `network-shift` data-slot + the trailing-window caveat are
  COORDINATED by the orchestrator (the caveat renders once across the two tiles): the surface
  passes `dataSlot` + `showCaveat`.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { RankedRow } from '$lib/components/dataviz';
	import { SEVERE_DOMAIN } from '$lib/features/reliability/shiftGrains';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import type { ShiftRow } from '../selectors/shiftRank';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';

	interface SectionWeekdayProps {
		rows: readonly ShiftRow[];
		dataSlot?: string;
		showCaveat: boolean;
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
		locale: Locale;
	}
	let { rows, dataSlot, showCaveat, info, copy, locale }: SectionWeekdayProps = $props();

	const i = $derived(info('seasonality', copy.dayTypeSection));
</script>

<div class="network-tile" data-slot={dataSlot}>
	<SectionHeading level={3} overline={copy.dayTypeSection}>
		{#snippet explainer()}
			<MetricInfo tip={i.tip} href={i.href} label={i.label} linkLabel={i.linkLabel} side="bottom" />
		{/snippet}
	</SectionHeading>
	<p class="network-shift-caption">{copy.shift.rowCaption}</p>
	<div class="network-ranked" role="list" aria-label={copy.shift.dayTypeSummary}>
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
	.network-ranked {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 100%;
	}
	.network-shift-caption,
	.network-shift-caveat {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
		max-width: 100%;
	}
</style>
