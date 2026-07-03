<!--
  SectionCompleteness — the network SERVICE-COMPLETENESS tile (S9B · DECISIONS B4).

  "Service delivered": the share of scheduled trips the network actually ran, from GC2's
  schedule-aware service_completeness_rate (Σdelivered / Σscheduled — a DIFFERENT denominator than
  the cancellation rate). Rendered as an ExplainedMetricCard (DECISIONS B4): the latest served
  bucket % + the always-visible "silent = scheduled but never appeared" explainer + the (i) deep
  link. It is a completeness SHARE on the [0,100] whole, NOT a second flat trend line to zoom.

  HONEST RAMP-IN: service_completeness_rate is null across the whole retained window on prod today
  (pre-0073 GC2 data has not accrued), so the orchestrator gates this section on `hasData`. When it
  DOES render, a null latest reads through the styled honest-absence chip ('no-observations') with
  the ramp-in note, never a plain "no data" and never a fabricated 0.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { ExplainedMetricCard } from '$lib/components/dataviz';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';

	interface SectionCompletenessProps {
		/** The formatted latest-bucket completeness reading ("94.2%"), or null → the styled chip. */
		latestDisplay: string | null;
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
		noData: string;
		locale: Locale;
	}
	let { latestDisplay, info, copy, noData, locale }: SectionCompletenessProps = $props();

	const i = $derived(info('cancellation', copy.completeness.section));
</script>

<div class="network-tile" data-slot="completeness-section">
	<ExplainedMetricCard
		label={copy.completeness.metric}
		value={latestDisplay}
		explanation={copy.completeness.explainer}
		note={latestDisplay == null ? copy.completeness.standDown : undefined}
		absentReason="no-observations"
		emptyLabel={noData}
		{locale}
		size="lg"
	>
		{#snippet info()}
			<MetricInfo tip={i.tip} href={i.href} label={i.label} linkLabel={i.linkLabel} side="bottom" />
		{/snippet}
	</ExplainedMetricCard>
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
</style>
