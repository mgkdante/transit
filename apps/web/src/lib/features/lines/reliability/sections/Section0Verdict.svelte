<!--
  §0 Verdict — "Can you count on this line?"

  The first rider-question section + the page's at-a-glance answer. Leads with the
  punctuality KPI tiles (on-time, avg delay, typical/worst-case), then the ONE
  always-visible primary chart — the on-time / avg-delay trend — and tucks the
  analyst detail (the delay distribution + severe-delay share) behind the
  progressive-disclosure `<Detail>` expander.

  Reads ONLY the PunctualityVM: the old snapshot strip's cancellation/skip rates
  move to §3 and its headway CoV to §2, so this section is punctuality-pure. The
  grain rail (mounted by the orchestrator) only re-shapes the trend; the headline
  tiles already carry the grain-aware aggregate.

  Honest absence throughout: a null value renders the styled AbsentValue chip
  (says WHY), never a fabricated 0; each chart degrades to its own absence mark.

  NOTE (Phase 2): the plain-language two-sided verdict SENTENCE ("Line 51 ran on
  time 4 of 5 trips this week …") lands here above the tiles once the verdict
  rules engine is built. Phase 1 frames the section with the rider question.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { fmtDelayMin, fmtPct } from '$lib/utils';
	import type { SeverityCode } from '$lib/v1/schemas';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { ExplainedMetricCard, SeverityBar } from '$lib/components/dataviz';
	import { Chart } from '$lib/components/dataviz/chart';
	import { MaybeValue } from '$lib/components/edge';
	import Detail from '$lib/components/shared/Detail.svelte';
	import VerdictBanner from './VerdictBanner.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import {
		shiftLabel as shiftGrainLabel,
		severeShareToSeverity,
		SEVERE_DOMAIN,
	} from '$lib/features/reliability/shiftGrains';
	import { selectPunctualityTrend } from '../selectors/punctualityTrend';
	import { selectPunctualityDistribution } from '../selectors/punctualityDistribution';
	import { selectVerdict } from '../selectors/verdict';
	import type { PunctualityVM } from '../clusters';
	import type { ReliabilityCopy } from '../reliability.copy';

	interface Section0VerdictProps {
		/** The punctuality view-model from `toReliabilityClusters`. */
		vm: PunctualityVM;
		/** Active locale (FR canonical). */
		locale: Locale;
		/** The co-located reliability copy bundle for this locale. */
		copy: ReliabilityCopy;
		/** Active window (day|week|month|range) — names the verdict window + drives the trend. */
		mode?: 'day' | 'week' | 'month' | 'range';
	}
	let { vm, locale, copy, mode = 'day' }: Section0VerdictProps = $props();

	// The trend re-shapes on the calendar grain; a date range zooms the day series.
	const grain = $derived(mode === 'range' ? 'day' : mode);
	const headline = $derived(vm.headline);
	const verdict = $derived(selectVerdict(headline, mode, locale, copy));
	const pct = (v: number | null | undefined): string | null => fmtPct(v);
	const min = (v: number | null | undefined): string | null =>
		fmtDelayMin(v, { rounding: 'fixed1' });

	// Metric-explainer (i) affordance — the same wiring every band uses.
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});
	const shiftLabel = (g: string): string => shiftGrainLabel(g, locale);

	// PRIMARY — OTP/avg-delay trend (grain-aware: day → 5 shifts, else dated series).
	const isDayGrain = $derived(grain === 'day');
	const trendSpec = $derived(
		selectPunctualityTrend(vm, grain, locale, {
			title: `${copy.strip.otpPct} · ${
				isDayGrain ? copy.windows.trendByTimeOfDay : copy.windows.trendByDay
			}`,
			otpLabel: copy.strip.otpPct,
			retardLabel: copy.strip.avgDelayMin,
			pctUnit: copy.units.pct,
			minUnit: copy.units.min,
			shiftLabel,
		}),
	);
	const hasTrend = $derived(trendSpec.kind === 'trend');
	const hasWilsonBand = $derived(trendSpec.kind === 'trend' && trendSpec.hasBand);

	// DETAIL — the typical→worst-case delay distribution (signed-delay histogram).
	const distSpec = $derived(
		selectPunctualityDistribution(vm, locale, {
			title: copy.strip.delayDistHeading,
			unit: ' s',
			xLabel: copy.strip.delayDistLabel,
		}),
	);
	const p50 = $derived<number | null>(headline.p50Min);
	const p90 = $derived<number | null>(headline.p90Min);
	const hasDist = $derived(p50 != null || p90 != null);

	// DETAIL — severe-delay share (its own metric, not the p90).
	const severePct = $derived<number | null>(headline.severePct);
	const severeSeverity = $derived<SeverityCode>(severeShareToSeverity(severePct));

	// Whole-section honest empty: nothing punctuality-shaped to show at all.
	const sectionEmpty = $derived(
		headline.otpPct == null &&
			headline.avgDelayMin == null &&
			headline.p50Min == null &&
			headline.p90Min == null &&
			severePct == null &&
			!hasTrend &&
			!hasDist,
	);
</script>

{#snippet metricInfo(key: MetricKey, name: string)}
	{@const i = info(key, name)}
	<MetricInfo
		class="cluster-info"
		tip={i.tip}
		href={i.href}
		label={i.label}
		linkLabel={i.linkLabel}
		side="bottom"
	/>
{/snippet}
{#snippet otpInfo()}{@render metricInfo('otp', copy.strip.otpPct)}{/snippet}
{#snippet avgInfo()}{@render metricInfo('avgDelay', copy.strip.avgDelayMin)}{/snippet}
{#snippet p50Info()}{@render metricInfo('p50p90', copy.strip.p50Min)}{/snippet}
{#snippet p90Info()}{@render metricInfo('p50p90', copy.strip.p90Min)}{/snippet}

<section class="section" data-section="verdict" aria-label={copy.sections.verdict.label}>
	<header class="section-head">
		<SectionLabel text={copy.sections.verdict.label} variant="station" />
		<p class="section-question" data-slot="section-question">{copy.sections.verdict.question}</p>
	</header>

	<!-- The at-a-glance verdict: the BAN + the plain-language two-sided sentence. It owns
	     §0's honest absence ("still measuring") when there's no percentage to read. -->
	<VerdictBanner result={verdict} />

	{#if !sectionEmpty}
		<!-- KPI tiles — the verdict-backing metrics (each self-handles honest absence). -->
		<div class="verdict-kpis" data-slot="verdict-kpis">
			<ExplainedMetricCard
				label={copy.strip.otpPct}
				value={pct(headline.otpPct)}
				info={otpInfo}
				emptyLabel={copy.strip.noData}
				absentReason="no-observations"
				{locale}
				size="lg"
			/>
			<ExplainedMetricCard
				label={copy.strip.avgDelayMin}
				value={min(headline.avgDelayMin)}
				info={avgInfo}
				emptyLabel={copy.strip.noData}
				absentReason="no-observations"
				{locale}
			/>
			<ExplainedMetricCard
				label={copy.strip.p50Min}
				value={min(headline.p50Min)}
				info={p50Info}
				sublabel={copy.strip.p50Caption}
				emptyLabel={copy.strip.noData}
				absentReason="no-observations"
				{locale}
			/>
			<ExplainedMetricCard
				label={copy.strip.p90Min}
				value={min(headline.p90Min)}
				info={p90Info}
				sublabel={copy.strip.p90Caption}
				emptyLabel={copy.strip.noData}
				absentReason="no-observations"
				{locale}
			/>
		</div>

		<!-- PRIMARY — the on-time / avg-delay trend. -->
		{#if hasTrend}
			<div class="section-primary" data-slot="otp-trend">
				<div class="block-head">
					<SectionLabel text={copy.strip.otpPct} variant="metric" />
					<span class="block-window" data-slot="trend-window"
						>{isDayGrain ? copy.windows.trendByTimeOfDay : copy.windows.trendByDay}</span
					>
				</div>
				<Chart spec={trendSpec} />
				{#if hasWilsonBand}
					<p class="band-caption" data-slot="wilson-band-caption">{copy.strip.wilsonBandCaption}</p>
				{/if}
			</div>
		{/if}

		<!-- DETAIL — distribution + severe-delay share, one disclosure level deep. -->
		<Detail label={copy.sections.detailShow} labelOpen={copy.sections.detailHide}>
			<div class="block" data-slot="delay-distribution">
				<div class="block-head">
					<span class="label-with-info">
						<SectionLabel text={copy.strip.delayDistHeading} variant="metric" />
						{@render metricInfo('p50p90', copy.strip.delayDistHeading)}
					</span>
					<span class="block-value" class:block-value--empty={!hasDist}>
						{#if hasDist}
							<span data-slot="delay-dist-readout">
								{copy.strip.p50Min}
								<MaybeValue value={min(p50)} reason="no-observations" {locale} />
								·
								{copy.strip.p90Min}
								<MaybeValue value={min(p90)} reason="no-observations" {locale} />
							</span>
						{:else}
							<MaybeValue value={null} reason="no-observations" {locale} />
						{/if}
					</span>
				</div>
				<Chart spec={distSpec} />
				{#if distSpec.kind === 'histogram'}
					<p class="caption" data-slot="delay-dist-caption">{copy.strip.delayDistCaption}</p>
				{/if}
			</div>

			<div class="block" data-slot="severe-share">
				<div class="block-head">
					<span class="label-with-info">
						<SectionLabel text={copy.strip.severePct} variant="metric" />
						{@render metricInfo('severe', copy.strip.severePct)}
					</span>
					<span class="block-value" class:block-value--empty={severePct == null}>
						<MaybeValue value={pct(severePct)} reason="no-observations" {locale} />
					</span>
				</div>
				<SeverityBar
					severity={severeSeverity}
					value={severePct}
					domain={SEVERE_DOMAIN}
					unit="%"
					label={copy.strip.severePct}
					interactive
				/>
				<p class="caption" data-slot="severe-caption">{copy.strip.severeCaption}</p>
			</div>
		</Detail>
	{/if}
</section>

<style>
	/* Section rhythm: generous BETWEEN-block air (research: within ≤ between), all on
	   the 8px grid. The section owns its inner stack; the orchestrator owns the
	   between-section gap. */
	.section {
		display: flex;
		flex-direction: column;
		gap: clamp(1.25rem, 3vw, 2rem);
		width: 100%;
	}
	.section-head {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	/* The rider question — the section's plain-language frame, quiet under the overline. */
	.section-question {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-subheading);
		font-weight: 600;
		line-height: 1.3;
		color: var(--foreground);
		max-inline-size: 42ch;
	}

	/* KPI tiles: a responsive RAM grid, never below one column on a phone. */
	.verdict-kpis {
		display: grid;
		gap: var(--space-card-gap, 1rem);
		grid-template-columns: repeat(auto-fit, minmax(min(11rem, 100%), 1fr));
	}

	.section-primary,
	.block {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}
	.block-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.label-with-info {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
	}
	.block-window,
	.band-caption,
	.caption {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.block-value {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
		font-variant-numeric: tabular-nums;
	}
	.block-value--empty {
		color: var(--muted-foreground);
	}
</style>
