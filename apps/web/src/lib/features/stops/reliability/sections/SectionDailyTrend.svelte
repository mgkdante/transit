<!--
  SectionDailyTrend — the S8A dated severe-share trend + the range verdict.

  Consumes StopReliability.daily[] (the DB lane's SERVE-THE-COUNTS series): an A3
  line/area on ABSOLUTE domains (severe-share [0,100] primary, avg-delay [0,8]
  secondary) rendered through the ONE <Chart>, plus a verdict block that pools the
  counts over the {from,to} window EXACTLY (Σcounts → severe_pct + a Wilson
  interval via $lib/v1/stats). Below MIN_N the pooled share is withheld (an honest
  note), and an empty window renders honest absence — never a fabricated span.

  `window` clips BOTH the trend and verdict. The parent surface's one shared
  HistoryNavigator owns the retained selection; this section owns no controls.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { fmtDelayMin } from '$lib/utils';
	import type { DateWindow } from '$lib/filters';
	import type { StopDailyPoint } from '$lib/v1';
	import { Chart } from '$lib/components/dataviz/chart';
	import { MetricDisplay } from '$lib/components/brand';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { AbsentValue } from '$lib/components/edge';
	import { selectDailyTrend } from '../selectors/dailyTrend';
	import { poolDailyRange, type ExactDailyRangeIngredients } from '../selectors/dailyRange';
	import type { StopReliabilityCopy } from '../stops-reliability.copy';
	import StopReliabilityPresenter from './StopReliabilityPresenter.svelte';

	interface SectionDailyTrendProps {
		/** The stop's dated daily series (trailing ~90 days, SERVE-THE-COUNTS). */
		daily: readonly StopDailyPoint[] | null | undefined;
		/** Active locale (FR canonical). */
		locale: Locale;
		/** The reliability copy bundle for this locale. */
		copy: StopReliabilityCopy;
		/** The {from,to} window clipping the trend + verdict; null = full current series. */
		window?: DateWindow | null;
		/** Exact retained additive ingredients; bypasses rounded daily averages. */
		exact?: ExactDailyRangeIngredients | null;
		/** The article disclosure owns the card and heading in article-body mode. */
		presentation?: 'standalone' | 'article-body';
	}
	let {
		daily,
		locale,
		copy,
		window = null,
		exact = null,
		presentation = 'standalone',
	}: SectionDailyTrendProps = $props();

	// The dated severe-share trend (A3), clipped to the window. Honest absence when
	// fewer than 2 real points survive.
	const trendSpec = $derived(
		selectDailyTrend(
			daily,
			locale,
			{
				title: copy.trend.chartTitle,
				severeLabel: copy.trend.severeLabel,
				avgLabel: copy.trend.avgLabel,
				pctUnit: copy.trend.pctUnit,
				minUnit: copy.trend.minUnit,
			},
			window,
		),
	);
	const hasTrend = $derived(trendSpec.kind === 'trend');
	const hasWilsonBand = $derived(trendSpec.kind === 'trend' && trendSpec.hasBand);

	// The pooled verdict over the window — EXACT counts → severe_pct + Wilson.
	const verdict = $derived(poolDailyRange(daily, window, exact));

	// Percent / minute display helpers (honest-null → the styled AbsentValue).
	const pct = (v: number | null): string | null => (v == null ? null : `${v.toFixed(1)}%`);
	const min = (v: number | null): string | null => fmtDelayMin(v, { rounding: 'fixed1' });

	// Names the pooled window: a single day reads exact, a span names its true
	// (gap-honest) day count. Empty → the section shows honest absence instead.
	const windowCaption = $derived.by<string>(() => {
		if (verdict.daysWithData === 0 || verdict.from == null || verdict.to == null) return '';
		if (verdict.from === verdict.to) return copy.trend.singleDay(verdict.from);
		return copy.trend.rangeWindow(verdict.daysWithData, verdict.from, verdict.to);
	});

	// The whole section stands down only when the series carries no poolable day AND
	// no trend — an honest "no daily history yet" rather than a fabricated empty axis.
	const sectionEmpty = $derived(!hasTrend && verdict.daysWithData === 0);
</script>

<StopReliabilityPresenter
	as="section"
	heading={copy.trend.heading}
	metricKey="severe"
	{locale}
	{presentation}
	spacing="comfortable"
	dataSlot="stop-daily-trend"
	dataMount="daily-range"
>
	{#if sectionEmpty}
		<AbsentValue variant="block" reason="no-observations" {locale} />
	{:else}
		<!-- The dated trend (A3, absolute domains). Degrades to its own absence mark. -->
		<div class="daily-trend-chart" data-slot="daily-trend-chart" data-card="primary">
			<Chart spec={trendSpec} />
			{#if hasWilsonBand}
				<p class="daily-trend-caption" data-slot="wilson-band-caption">{copy.trend.caveat}</p>
			{/if}
		</div>

		<!-- The range verdict: pooled read over the window (EXACT counts). -->
		<div class="daily-verdict" data-slot="daily-range-verdict">
			<div class="daily-verdict-head">
				<SectionLabel text={copy.trend.verdictHeading} variant="metric" />
				{#if windowCaption}
					<span class="daily-verdict-window" aria-live="polite">{windowCaption}</span>
				{/if}
			</div>
			<div class="daily-verdict-tiles">
				<MetricDisplay
					value={pct(verdict.severePct)}
					absentReason="no-observations"
					{locale}
					label={copy.trend.pooledSevere}
					sublabel={verdict.wilsonLo != null && verdict.wilsonHi != null
						? copy.trend.wilsonCaption(verdict.wilsonLo.toFixed(1), verdict.wilsonHi.toFixed(1))
						: undefined}
					size="md"
				/>
				<MetricDisplay
					value={min(verdict.avgDelayMin)}
					absentReason="no-observations"
					{locale}
					label={copy.trend.pooledAvg}
					size="md"
				/>
				<MetricDisplay
					value={verdict.observations > 0 ? verdict.observations.toLocaleString(locale) : null}
					absentReason="no-observations"
					{locale}
					label={copy.trend.observations}
					size="md"
				/>
			</div>
			<!-- Honest thin-sample note: enough observations to count, too few to print a
			     firm percentage (< MIN_N). The tiles above already show the raw count. -->
			{#if verdict.observations > 0 && !verdict.reliable}
				<p class="daily-verdict-note" data-slot="below-min-n">
					{copy.trend.belowMinN(verdict.observations)}
				</p>
			{/if}
			<p class="daily-verdict-note">{copy.trend.caveat}</p>
		</div>
	{/if}
</StopReliabilityPresenter>

<style>
	.daily-verdict {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.daily-verdict-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.daily-verdict-window {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.daily-verdict-tiles {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem 2rem;
	}
	/* Honest caveat / thin-sample note: quiet mono, AA both themes. */
	.daily-trend-caption,
	.daily-verdict-note {
		margin: 0;
		max-width: 100%;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
</style>
