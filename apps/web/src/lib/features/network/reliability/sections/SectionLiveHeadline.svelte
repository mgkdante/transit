<!--
  SectionLiveHeadline — the four glance ExplainedMetricCards (S9C / DECISIONS C1 · C4).

  The top live board: on_time_pct · coverage_pct · delay_p50_min · delay_p90_min, each an
  ExplainedMetricCard in GLANCE mode (C4: the `explanation` column is OMITTED so context lives
  in the (i) hover only — the hero-strip pattern). A NULL value + the 'not-reported' reason
  renders the styled AbsentValue chip via the card's inner MetricDisplay, never a plain "no
  data" and never a fabricated 0. vehicles_in_service + non_responding are NOT here — they
  moved wholly into the dedicated Reporting row (SectionReporting).

  Pure presenter of `selectHeadlineKpis(...).headline`; the orchestrator does the mapping pass.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { DashboardGrid } from '$lib/components/layout';
	import { ExplainedMetricCard } from '$lib/components/dataviz';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import type { KpiCardVM } from '../selectors/headlineKpis';

	interface SectionLiveHeadlineProps {
		/** The four glance cards (already formatted + honesty-marked upstream). */
		cards: readonly KpiCardVM[];
		/** The orchestrator's metric-explainer resolver (key + name → the (i) wiring). */
		info: (
			key: MetricKey | SupplementalMetricKey,
			name: string,
		) => {
			tip: string;
			href: string;
			label: string;
			linkLabel: string;
		};
		/** Plain no-data label fallback (the styled chip carries the real WHY). */
		noData: string;
		locale: Locale;
	}
	let { cards, info, noData, locale }: SectionLiveHeadlineProps = $props();
</script>

<!-- Glance board — the four scalars on an auto-fit grid so they fill the desktop width and
     reflow to one column on a phone. No `label`: the enclosing LIVE region already names it. -->
<DashboardGrid minTile="220px" gutter={false}>
	{#each cards as card (card.label)}
		{@const i = info(card.key, card.label)}
		<ExplainedMetricCard
			label={card.label}
			value={card.value}
			absentReason={card.absentReason}
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
	{/each}
</DashboardGrid>
