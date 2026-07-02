<!--
  SectionCancellations — the network-wide cancellation-rate trend + its latest reading.

  Pure presenter of `selectCancelTrend`. The latest-day value is an ExplainedMetricCard (glance
  mode): a historic rollup → a null latest-day reads through the styled honest-absence chip with
  the 'no-observations' reason (too few readings), never a plain "no data". The single-series
  TrendLine plots ONLY the cancellation rate on the FIXED CANCEL_RATE_DOMAIN [0,100] (a
  percentage's honest domain IS the whole — a near-zero rate truthfully reads "rare"); the
  retard channel is empty (all-null gaps). The whole block stands DOWN when the series carries
  no cancellation data (never a flat zero line) — the orchestrator gates on `hasCancel`.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { TrendLine, ExplainedMetricCard } from '$lib/components/dataviz';
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
		<!-- Single-series: only the cancellation rate is plotted. `singleSeries` suppresses the
		     empty retard legend swatch + its y-tick gutter (one line, not a phantom swatch). -->
		<TrendLine
			onTime={vm.series}
			retard={vm.empty}
			domain={vm.domain}
			xLabels={vm.xLabels}
			onTimeLabel={copy.cancel.seriesLabel}
			yAxis={{ label: copy.cancel.seriesLabel, unit: copy.units.pct, domain: vm.domain }}
			showYTicks
			singleSeries
			label={copy.cancel.summary}
			interactive
		/>
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
	}
	.network-trend {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 100%;
	}
</style>
