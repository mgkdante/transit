<script lang="ts">
	import { getLocalizeHref, type Locale } from '$lib/i18n';
	import { fmtDelayMin, fmtPct } from '$lib/utils';
	import { SectionLabel } from '@yesid/ui/brand';
	import CollapsibleSection from './CollapsibleSection.svelte';
	import { Chart } from '$lib/components/dataviz/chart';
	import { AbsentValue, MaybeValue } from '$lib/components/edge';
	import Detail from '$lib/components/shared/Detail.svelte';
	import TerminalPanel from '$lib/components/brand/TerminalPanel.svelte';
	import { VerdictBanner } from '$lib/components/brand';
	import MetricBullet from './MetricBullet.svelte';
	import { metricInfoCopy } from '$lib/metrics';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import {
		shiftLabel as shiftGrainLabel,
		shiftLabelShort as shiftGrainLabelShort,
		SEVERE_DOMAIN,
		OTP_DOMAIN,
		DELAY_STOP_DOMAIN,
		DELAY_DIST_DOMAIN,
	} from '$lib/features/reliability/shiftGrains';
	import { selectPunctualityTrend } from '../selectors/punctualityTrend';
	import { selectPunctualityDistribution } from '../selectors/punctualityDistribution';
	import { selectVerdict } from '$lib/v1/verdict';
	import { selectBullet, otpTone } from '../selectors/bullet';
	import { dailyPercentileCaption, type selectDailyPercentiles } from '$lib/site/dailyPercentiles';
	import type { PunctualityVM } from '../clusters';
	import type { ReliabilityCopy } from '../reliability.copy';

	const localizeHref = getLocalizeHref();

	interface Section0VerdictProps {
		vm: PunctualityVM;
		locale: Locale;
		copy: ReliabilityCopy;
		mode?: 'day' | 'week' | 'month' | 'range';
		dailyPercentiles?: ReturnType<typeof selectDailyPercentiles>;
	}
	let { vm, locale, copy, mode = 'day', dailyPercentiles = null }: Section0VerdictProps = $props();

	const grain = $derived(mode);
	const estimatedPercentiles = $derived(mode === 'week' || mode === 'month');
	const headline = $derived(vm.headline);
	const verdict = $derived(selectVerdict(headline, mode, locale, copy.verdict));
	const pct = (v: number | null | undefined): string | null => fmtPct(v);
	const min = (v: number | null | undefined): string | null =>
		fmtDelayMin(v, { rounding: 'fixed1' });

	const shiftLabel = (g: string): string => shiftGrainLabel(g, locale);
	const shiftShort = (g: string): string => shiftGrainLabelShort(g, locale);

	const otpBullet = $derived(
		selectBullet(headline.otpPct, locale, {
			title: copy.strip.otpPct,
			xLabel: copy.strip.otpPct,
			unit: copy.units.pct,
			domain: OTP_DOMAIN,
			target: 80,
			targetLabel: copy.strip.target,
			tone: otpTone(headline.otpPct),
			n: headline.observationCount,
		}),
	);
	const avgBullet = $derived(
		selectBullet(headline.avgDelayMin, locale, {
			title: copy.strip.avgDelayMin,
			xLabel: copy.strip.avgDelayMin,
			unit: copy.units.min,
			domain: DELAY_STOP_DOMAIN,
		}),
	);
	const p50Bullet = $derived(
		selectBullet(headline.p50Min, locale, {
			title: copy.strip.p50Min,
			xLabel: copy.strip.p50Min,
			unit: copy.units.min,
			domain: DELAY_STOP_DOMAIN,
		}),
	);
	const p90Bullet = $derived(
		selectBullet(headline.p90Min, locale, {
			title: copy.strip.p90Min,
			xLabel: copy.strip.p90Min,
			unit: copy.units.min,
			domain: DELAY_DIST_DOMAIN,
		}),
	);

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
			shiftShort,
		}),
	);
	const hasTrend = $derived(trendSpec.kind === 'trend');
	const hasWilsonBand = $derived(trendSpec.kind === 'trend' && trendSpec.hasBand);

	const distSpec = $derived(
		selectPunctualityDistribution(vm, locale, {
			title: copy.strip.delayDistHeading,
			unit: ' s',
			xLabel: copy.strip.delayDistLabel,
			yLabel: copy.strip.delayDistCount,
		}),
	);
	const p50 = $derived<number | null>(headline.p50Min);
	const p90 = $derived<number | null>(headline.p90Min);
	const hasDist = $derived(p50 != null || p90 != null);

	const severePct = $derived<number | null>(headline.severePct);
	const severeTone = (v: number | null): 'bad' | 'warn' | 'neutral' =>
		v == null ? 'neutral' : v >= 10 ? 'bad' : v >= 5 ? 'warn' : 'neutral';
	const severeBullet = $derived(
		selectBullet(severePct, locale, {
			title: copy.strip.severePct,
			xLabel: copy.strip.severePct,
			unit: copy.units.pct,
			domain: SEVERE_DOMAIN,
			tone: severeTone(severePct),
		}),
	);

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

{#snippet otpInfo()}<MetricInfo
		class="cluster-info"
		metricKey="otp"
		{locale}
		name={copy.strip.otpPct}
		side="bottom"
	/>{/snippet}
{#snippet avgInfo()}<MetricInfo
		class="cluster-info"
		metricKey="avgDelay"
		{locale}
		name={copy.strip.avgDelayMin}
		side="bottom"
	/>{/snippet}
{#snippet p50Info()}<MetricInfo
		class="cluster-info"
		metricKey="p50p90"
		{locale}
		name={copy.strip.p50Min}
		side="bottom"
	/>{/snippet}
{#snippet p90Info()}<MetricInfo
		class="cluster-info"
		metricKey="p50p90"
		{locale}
		name={copy.strip.p90Min}
		side="bottom"
	/>{/snippet}

<CollapsibleSection
	dataSection="verdict"
	number={1}
	eyebrow={copy.sections.verdict.label}
	question={copy.sections.verdict.question}
>
	<TerminalPanel
		title={copy.sections.verdict.terminal.title}
		tag={copy.sections.verdict.terminal.tag}
		class="verdict-terminal"
	>
		<VerdictBanner result={verdict} />

		{#if !sectionEmpty}
			<div class="verdict-kpis" data-slot="verdict-kpis">
				<MetricBullet
					label={copy.strip.otpPct}
					valueText={pct(headline.otpPct)}
					spec={otpBullet}
					{locale}
					size="lg"
					info={otpInfo}
				/>
				<MetricBullet
					label={copy.strip.avgDelayMin}
					valueText={min(headline.avgDelayMin)}
					spec={avgBullet}
					{locale}
					info={avgInfo}
				/>
				<MetricBullet
					label={copy.strip.p50Min}
					valueText={min(headline.p50Min)}
					spec={p50Bullet}
					{locale}
					info={p50Info}
					caption={estimatedPercentiles ? copy.strip.p50EstimatedCaption : copy.strip.p50Caption}
				/>
				<MetricBullet
					label={copy.strip.p90Min}
					valueText={min(headline.p90Min)}
					spec={p90Bullet}
					{locale}
					info={p90Info}
					caption={estimatedPercentiles ? copy.strip.p90EstimatedCaption : copy.strip.p90Caption}
				/>
			</div>
		{/if}
	</TerminalPanel>

	{#if !sectionEmpty}
		{#if hasTrend}
			<div class="section-primary" data-slot="otp-trend" data-card="primary">
				<div class="block-head">
					<SectionLabel text={copy.strip.otpPct} variant="metric" />
					<span class="block-window" data-slot="trend-window"
						>{isDayGrain ? copy.windows.trendByTimeOfDay : copy.windows.trendByDay}</span
					>
				</div>
				<Chart spec={trendSpec} />
				{#if hasWilsonBand}
					<p class="band-caption" data-slot="wilson-band-caption">
						{copy.strip.wilsonBandCaption}
						<a
							href={localizeHref('/metrics#confidence-intervals', locale)}
							data-card-interactive
							class="underline underline-offset-2"
							>{metricInfoCopy.confidenceIntervalLink[locale]}</a
						>
					</p>
				{/if}
			</div>
		{/if}

		<Detail label={copy.sections.detailShow} labelOpen={copy.sections.detailHide}>
			<div class="block" data-slot="delay-distribution" data-card>
				<div class="block-head">
					<span class="label-with-info">
						<SectionLabel text={copy.strip.delayDistHeading} variant="metric" />
						<MetricInfo
							class="cluster-info"
							metricKey="p50p90"
							{locale}
							name={copy.strip.delayDistHeading}
							side="bottom"
						/>
					</span>
					<span class="block-value" class:block-value--empty={!hasDist}>
						{#if hasDist}
							<span data-slot="delay-dist-readout" data-card-interactive>
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
				{#if distSpec.kind === 'histogram'}
					<Chart spec={distSpec} />
				{:else}
					<p class="caption">
						<AbsentValue reason={distSpec.reason} variant="row" {locale} />
					</p>
				{/if}
				{#if dailyPercentiles != null}
					<p class="caption" data-slot="daily-percentile-spread">
						{dailyPercentileCaption(dailyPercentiles, locale)}
					</p>
				{/if}
				{#if isDayGrain && !hasDist}
					<p class="caption" data-slot="percentile-nudge">{copy.strip.percentileNudge}</p>
				{/if}
				{#if distSpec.kind === 'histogram'}
					<p class="caption" data-slot="delay-dist-caption">{copy.strip.delayDistCaption}</p>
				{/if}
			</div>

			<div class="block" data-slot="severe-share" data-card>
				<div class="block-head">
					<span class="label-with-info">
						<SectionLabel text={copy.strip.severePct} variant="metric" />
						<MetricInfo
							class="cluster-info"
							metricKey="severe"
							{locale}
							name={copy.strip.severePct}
							side="bottom"
						/>
					</span>
					<span class="block-value" class:block-value--empty={severePct == null}>
						<MaybeValue value={pct(severePct)} reason="no-observations" {locale} />
					</span>
				</div>
				<Chart spec={severeBullet} />
				<p class="caption" data-slot="severe-caption">{copy.strip.severeCaption}</p>
			</div>
		</Detail>
	{/if}
</CollapsibleSection>

<style>
	.verdict-kpis {
		display: grid;
		gap: var(--space-card-gap);
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
