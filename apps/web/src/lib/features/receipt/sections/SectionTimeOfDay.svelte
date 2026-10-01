<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import { RankedRow } from '$lib/components/dataviz';
	import TypedInformationCard from '$lib/components/shared/TypedInformationCard.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { ReceiptShiftRow } from '../selectors/timeOfDay';

	interface SectionTimeOfDayProps {
		rows: readonly ReceiptShiftRow[];
		heading: string;
		subtitle: string;
		caveat: string;
		caveatLabel: string;
		locale: Locale;
		headingLevel?: 2 | 3;
	}
	let {
		rows,
		heading,
		subtitle,
		caveat,
		caveatLabel,
		locale,
		headingLevel = 2,
	}: SectionTimeOfDayProps = $props();
</script>

<section class="receipt-tod" data-slot="receipt-time-of-day" aria-label={heading}>
	<SectionHeading level={headingLevel} overline={heading}>
		{#snippet explainer()}
			<MetricInfo metricKey="severe" {locale} name={heading} side="bottom" />
		{/snippet}
	</SectionHeading>
	<div class="receipt-tod-list" role="list" aria-label={heading}>
		{#each rows as row (row.key)}
			<RankedRow
				rank={row.rank}
				title={row.title}
				{subtitle}
				severity={row.severity}
				value={row.value}
				domain={row.domain}
				unit={row.unit}
				display={row.display}
				{locale}
			/>
		{/each}
	</div>
	<TypedInformationCard kind="caveat" label={caveatLabel}>
		<p class="receipt-tod-caveat-copy">{caveat}</p>
	</TypedInformationCard>
</section>

<style>
	.receipt-tod {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.receipt-tod-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.receipt-tod-caveat-copy {
		margin: 0;
		max-width: 100%;
		color: var(--foreground);
	}
</style>
