<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { fmtDelayMin } from '$lib/utils';
	import type { DateWindow } from '$lib/filters';
	import type { StopDailyPoint } from '$lib/v1';
	import { Chart } from '$lib/components/dataviz/chart';
	import { MetricDisplay } from '$lib/components/brand';
	import { SectionLabel } from '@yesid/ui/brand';
	import { AbsentValue } from '$lib/components/edge';
	import { selectDailyTrend } from '../selectors/dailyTrend';
	import { poolDailyRange, type ExactDailyRangeIngredients } from '../selectors/dailyRange';
	import type { StopReliabilityCopy } from '../stops-reliability.copy';
	import StopReliabilityPresenter from './StopReliabilityPresenter.svelte';

	interface SectionDailyTrendProps {
		daily: readonly StopDailyPoint[] | null | undefined;
		locale: Locale;
		copy: StopReliabilityCopy;
		window?: DateWindow | null;
		exact?: ExactDailyRangeIngredients | null;
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

	const verdict = $derived(poolDailyRange(daily, window, exact));

	const pct = (v: number | null): string | null => (v == null ? null : `${v.toFixed(1)}%`);
	const min = (v: number | null): string | null => fmtDelayMin(v, { rounding: 'fixed1' });

	const windowCaption = $derived.by<string>(() => {
		if (verdict.daysWithData === 0 || verdict.from == null || verdict.to == null) return '';
		if (verdict.from === verdict.to) return copy.trend.singleDay(verdict.from);
		return copy.trend.rangeWindow(verdict.daysWithData, verdict.from, verdict.to);
	});

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
		<div class="daily-trend-chart" data-slot="daily-trend-chart" data-card="primary">
			<Chart spec={trendSpec} />
			{#if hasWilsonBand}
				<p class="daily-trend-caption" data-slot="wilson-band-caption">{copy.trend.caveat}</p>
			{/if}
		</div>

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
