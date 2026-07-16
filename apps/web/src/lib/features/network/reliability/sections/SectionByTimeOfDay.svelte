<!--
  SectionByTimeOfDay — the network-wide by-shift ranked list (worst punctuality first).

  Pure presenter of `selectShiftRank`. Each row leads with the real OTP % (avg delay + severe
  share read as the subtitle); the magnitude bar encodes the severe-delay share on the fixed
  SEVERE_DOMAIN [0,100] (the severity scale, never --primary, never the in-view worst). A grain
  with no OTP shows the styled honest-absence chip; a grain with neither OTP nor severe was
  DROPPED upstream (never a fabricated 0). The shift labels are the SHARED reliability vocabulary.

  The `network-shift` data-slot + the trailing-window caveat are COORDINATED by the orchestrator
  across this + the weekday tile (the caveat renders once): the surface passes `dataSlot` +
  `showCaveat` so the two tiles never duplicate the anchor or the note.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { RankedRow } from '$lib/components/dataviz';
	import { SEVERE_DOMAIN } from '$lib/features/reliability/shiftGrains';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import NetworkTile from './NetworkTile.svelte';
	import type { ShiftRow } from '../selectors/shiftRank';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';

	interface SectionByTimeOfDayProps {
		rows: readonly ShiftRow[];
		/** The `network-shift` data-slot when this tile hosts it (else undefined). */
		dataSlot?: string;
		/** Render the trailing-window caveat under this tile (coordinated by the orchestrator). */
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
	let { rows, dataSlot, showCaveat, info, copy, locale }: SectionByTimeOfDayProps = $props();

	const i = $derived(info('severe', copy.shiftSection));
</script>

{#snippet shiftInfo()}
	<MetricInfo tip={i.tip} href={i.href} label={i.label} linkLabel={i.linkLabel} side="bottom" />
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
