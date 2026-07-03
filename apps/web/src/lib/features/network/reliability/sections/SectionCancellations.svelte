<!--
  SectionCancellations — the network-wide cancellation-rate trend + its latest reading.

  Pure presenter of `selectCancelTrend` (P5.2: the selector emits a single-series
  `trend` ChartSpec rendered by the ONE <Chart> renderer). The latest-day value is an
  ExplainedMetricCard (glance mode): a historic rollup → a null latest-day reads through
  the styled honest-absence chip with the 'no-observations' reason (too few readings),
  never a plain "no data". The trend plots ONLY the cancellation rate on the FIXED
  CANCEL_RATE_DOMAIN [0,100] (a percentage's honest domain IS the whole — a near-zero
  rate truthfully reads "rare"). The whole block stands DOWN when the series carries no
  cancellation data (never a flat zero line) — the orchestrator gates on `hasCancel`.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { ExplainedMetricCard } from '$lib/components/dataviz';
	import { Chart } from '$lib/components/dataviz/chart';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import type { CancelTrendVM } from '../selectors/cancelTrend';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';

	interface SectionCancellationsProps {
		/** The cancellation-trend view-model (series + latest + the fixed domain). */
		vm: CancelTrendVM;
		/** The formatted latest reading ("2.6%"), or null → the styled chip. */
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
	let { vm, latestDisplay, info, copy, noData, locale }: SectionCancellationsProps = $props();

	const i = $derived(info('cancellation', copy.cancelSection));
</script>

<div class="network-tile">
	<div class="network-trend">
		<ExplainedMetricCard
			label={copy.cancel.metric}
			value={latestDisplay}
			absentReason="no-observations"
			emptyLabel={noData}
			{locale}
			size="md"
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
		<!-- Single-series trend spec: only the cancellation rate is plotted. -->
		<Chart spec={vm.spec} />
	</div>
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
	.network-trend {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 100%;
	}
</style>
