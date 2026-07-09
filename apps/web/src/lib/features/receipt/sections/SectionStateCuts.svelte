<!--
  SectionStateCuts — the receipt's scheduled→delivered→cancelled→silent split (S13, NEW).

  Pure presenter of selectStateCuts. The ONE completeness number (heroed from
  service_states.service_completeness_pct — DB1) rides an ExplainedMetricCard with the
  S9 "silent = scheduled but never appears in the live feed" explainer; the delivered /
  cancelled / silent shares are RankedRow SeverityBars on the FIXED absolute
  CANCEL_RATE_DOMAIN [0,100] (doctrine-coded — never the in-view max). Mounted by the
  orchestrator only when hasData (RAMP-IN: service_states is additive-optional, null
  across the retained window until GC2 accrues). A receipt line-group below the frame —
  a documented hoist because a share-bar ladder breaks the compact tile metaphor (WEB4).
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { ExplainedMetricCard, RankedRow } from '$lib/components/dataviz';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import type { StateCutsVM } from '../selectors/stateCuts';

	interface SectionStateCutsProps {
		state: StateCutsVM;
		heading: string;
		completenessLabel: string;
		explainer: string;
		standDown: string;
		splitLabel: string;
		noData: string;
		info: (
			key: MetricKey | SupplementalMetricKey,
			name: string,
		) => { tip: string; href: string; label: string; linkLabel: string };
		locale: Locale;
	}
	let {
		state,
		heading,
		completenessLabel,
		explainer,
		standDown,
		splitLabel,
		noData,
		info,
		locale,
	}: SectionStateCutsProps = $props();

	const i = $derived(info('cancellation', completenessLabel));
</script>

<section class="receipt-states" data-slot="receipt-state-cuts" aria-label={heading}>
	<SectionHeading level={2} overline={heading} />

	<!-- The ONE completeness reading (heroed from service_completeness_pct). A null
	     reading reads the styled honest-absence chip + the ramp-in note, never a 0. -->
	<div class="receipt-states-hero" data-slot="receipt-completeness">
		<ExplainedMetricCard
			label={completenessLabel}
			value={state.completenessDisplay}
			explanation={explainer}
			note={state.completenessDisplay == null ? standDown : undefined}
			absentReason="no-observations"
			emptyLabel={noData}
			{locale}
			size="lg"
		>
			{#snippet info()}
				<MetricInfo
					tip={i.tip}
					href={i.href}
					label={i.label}
					linkLabel={i.linkLabel}
					side="bottom"
				/>
			{/snippet}
		</ExplainedMetricCard>
	</div>

	<!-- The delivered / cancelled / silent share bars on the absolute [0,100] whole. -->
	<div class="receipt-states-split" data-slot="receipt-state-split">
		<SectionLabel text={splitLabel} variant="metric" />
		<div class="receipt-states-list" role="list" aria-label={splitLabel}>
			{#each state.rows as row (row.key)}
				<!-- A FIXED-category split (delivered/cancelled/silent) — the row order is the
				     meaning, so the 1..N ordinal is suppressed (showRank=false, doctrine). -->
				<RankedRow
					rank={0}
					showRank={false}
					title={row.label}
					severity={row.severity}
					value={row.value}
					domain={row.domain}
					unit="%"
					display={row.display}
					absentReason="no-observations"
					{locale}
				/>
			{/each}
		</div>
	</div>
</section>

<style>
	.receipt-states {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}
	.receipt-states-hero {
		max-width: 24rem;
	}
	.receipt-states-split {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.receipt-states-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
</style>
