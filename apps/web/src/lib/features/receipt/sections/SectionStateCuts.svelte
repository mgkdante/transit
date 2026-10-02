<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { ExplainedMetricCard, RankedRow } from '$lib/components/dataviz';
	import { SectionLabel } from '@yesid/ui/brand';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { StateCutsVM } from '../selectors/stateCuts';

	interface SectionStateCutsProps {
		state: StateCutsVM;
		heading: string;
		completenessLabel: string;
		explainer: string;
		standDown: string;
		splitLabel: string;
		locale: Locale;
		headingLevel?: 2 | 3;
	}
	let {
		state,
		heading,
		completenessLabel,
		explainer,
		standDown,
		splitLabel,
		locale,
		headingLevel = 2,
	}: SectionStateCutsProps = $props();
</script>

<section class="receipt-states" data-slot="receipt-state-cuts" aria-label={heading}>
	<SectionHeading level={headingLevel} overline={heading} />

	<div class="receipt-states-hero" data-slot="receipt-completeness">
		<ExplainedMetricCard
			label={completenessLabel}
			value={state.completenessDisplay}
			explanation={explainer}
			note={state.completenessDisplay == null ? standDown : undefined}
			absentReason="no-observations"
			{locale}
			size="lg"
		>
			{#snippet info()}
				<MetricInfo metricKey="serviceComparison" {locale} name={completenessLabel} side="bottom" />
			{/snippet}
		</ExplainedMetricCard>
	</div>

	<div class="receipt-states-split" data-slot="receipt-state-split">
		<SectionLabel text={splitLabel} variant="metric" />
		<div class="receipt-states-list" role="list" aria-label={splitLabel}>
			{#each state.rows as row (row.key)}
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
