<!--
  SectionHeadline — the receipt's headline reliability band (S13).

  Pure presenter of the headlineKpis VMs: the day's on-time %, average delay, severe
  share, rider-impact score, each a MetricDisplay + its (i) metric-explainer. A null
  value reads the styled honest-absence chip ('no-observations'), never a fabricated 0.
  A receipt line-group inside the TerminalPanel (WEB4 metaphor preserved).
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import type { HeadlineKpiVM } from '../selectors/headlineKpis';

	interface SectionHeadlineProps {
		kpis: readonly HeadlineKpiVM[];
		heading: string;
		noData: string;
		info: (
			key: MetricKey | SupplementalMetricKey,
			name: string,
		) => { tip: string; href: string; label: string; linkLabel: string };
		locale: Locale;
	}
	let { kpis, heading, noData, info, locale }: SectionHeadlineProps = $props();

	const headingInfo = $derived(info('otp', heading));
</script>

<section class="receipt-panel receipt-primary" data-slot="receipt-headline">
	<SectionHeading level={2} overline={heading}>
		{#snippet explainer()}
			<MetricInfo
				tip={headingInfo.tip}
				href={headingInfo.href}
				label={headingInfo.label}
				linkLabel={headingInfo.linkLabel}
				side="bottom"
			/>
		{/snippet}
	</SectionHeading>
	<div class="receipt-metrics">
		{#each kpis as kpi (kpi.key)}
			{@const i = info(kpi.key, kpi.label)}
			<div class="receipt-kpi">
				<MetricDisplay
					value={kpi.value}
					label={kpi.label}
					size={kpi.size}
					absentReason="no-observations"
					{locale}
					emptyLabel={noData}
				/>
				<MetricInfo
					tip={i.tip}
					href={i.href}
					label={i.label}
					linkLabel={i.linkLabel}
					side="bottom"
				/>
			</div>
		{/each}
	</div>
</section>

<style>
	.receipt-panel {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding: 1.1rem 1.2rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
	}
	.receipt-primary {
		gap: 1rem;
	}
	.receipt-metrics {
		margin: 0;
		display: grid;
		gap: 1.1rem 1.75rem;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	@container receipt (min-width: 46rem) {
		.receipt-metrics {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
	.receipt-kpi {
		display: flex;
		align-items: flex-start;
		gap: 0.375rem;
		min-width: 0;
	}
	.receipt-kpi :global([data-slot='metric-display']) {
		min-width: 0;
	}
</style>
