<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { absenceShort } from '$lib/site/absence';
	import { fmtPct } from '$lib/utils';
	import type { SeverityCode } from '$lib/v1/schemas';
	import { SectionLabel } from '@yesid/ui/brand';
	import CollapsibleSection from './CollapsibleSection.svelte';
	import { ChartLegend, DeltaStat } from '$lib/components/dataviz';
	import { Chart } from '$lib/components/dataviz/chart';
	import { AbsentValue } from '$lib/components/edge';
	import Detail from '$lib/components/shared/Detail.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import {
		shiftLabel as shiftGrainLabel,
		shiftLabelShort as shiftGrainLabelShort,
		severeShareToSeverity,
		DAY_TYPE_GRAIN_ORDER,
		SHIFT_GRAIN_ORDER,
		SEVERE_DOMAIN,
	} from '$lib/features/reliability/shiftGrains';
	import { selectPunctualityTimeOfDay } from '../selectors/punctualityTimeOfDay';
	import { priorDelta } from '../selectors/priorDelta';
	import { selectPunctualityCrosstab } from '../selectors/punctualityCrosstab';
	import { selectWeekdayCycle } from '../selectors/weekdayCycle';
	import { buildHabitsHeatmap } from '$lib/reliability/habitsHeatmap';
	import { selectRelativeScorePeak } from '../selectors/relativeScorePeak';
	import { selectShiftBars } from '../selectors/shiftBars';
	import type { PunctualityVM, HabitsVM, PeriodComparisonRow } from '../clusters';
	import type { ReliabilityCopy } from '../reliability.copy';
	import { habitsBandCopy } from '../Cluster05Habits.copy';

	interface Section1WhenToRideProps {
		punctuality: PunctualityVM;
		habits: HabitsVM;
		locale: Locale;
		copy: ReliabilityCopy;
		mode?: 'day' | 'week' | 'month' | 'range';
	}
	let { punctuality, habits, locale, copy, mode = 'day' }: Section1WhenToRideProps = $props();

	const band = $derived(habitsBandCopy[locale]);
	const noDataLabel = $derived(absenceShort('no-observations', locale));
	const win = $derived<'day' | 'week' | 'month'>(
		mode === 'week' || mode === 'month' ? mode : 'day',
	);

	const pct = (v: number | null | undefined): string | null => fmtPct(v);

	const shiftLabel = (g: string): string => shiftGrainLabel(g, locale);
	const dayTypeLabel = (g: string): string => {
		if (g === 'weekday') return copy.peak.weekday;
		if (g === 'weekend') return copy.peak.weekend;
		return g;
	};

	const hasHeatmap = $derived(!habits.isEmpty);

	const fullDayLabels = $derived(band.weekdays.slice(1));

	const relativePeak = $derived(
		selectRelativeScorePeak(habits, {
			fullRowLabels: fullDayLabels,
			hourLabel: (h) => `${String(h).padStart(2, '0')}:00`,
		}),
	);
	const relativePeakText = $derived(
		relativePeak ? band.relativePeak(relativePeak.dayLabel, relativePeak.hourLabel) : null,
	);

	const heatmapSpec = $derived(
		buildHabitsHeatmap(habits.matrix, locale, {
			title: band.heatmapLabel,
			valueLabel: band.cellValueLabel,
			rowAxisLabel: band.dayAxisLabel,
			colAxisLabel: band.hourAxisLabel,
			rowLabels: band.weekdaysShort,
			fullRowLabels: fullDayLabels,
			tierLabels: band.tiers.labels,
			noDataLabel,
			worstGlyph: band.tiers.worstGlyph,
			hourLabel: (h) => `${String(h).padStart(2, '0')}:00`,
			hourTicks: [0, 3, 6, 9, 12, 15, 18, 21],
		}),
	);

	const legendItems = $derived([
		{
			colorVar: 'var(--dataviz-heatmap-tier-0)',
			label: band.tiers.labels[0],
			swatch: 'square' as const,
		},
		{
			colorVar: 'var(--dataviz-heatmap-tier-1)',
			label: band.tiers.labels[1],
			swatch: 'square' as const,
		},
		{
			colorVar: 'var(--dataviz-heatmap-tier-2)',
			label: band.tiers.labels[2],
			swatch: 'square' as const,
		},
		{
			colorVar: 'var(--dataviz-heatmap-tier-3)',
			label: `${band.tiers.labels[3]} ${band.tiers.worstGlyph}`,
			swatch: 'square' as const,
		},
		{
			colorVar: 'var(--dataviz-heatmap-nodata)',
			label: noDataLabel,
			swatch: 'square' as const,
		},
	]);

	const scaleCaptionText = $derived(
		habits.scale
			? `${band.scaleLegend[habits.scale] ?? band.heatmapHeading} · ${band.scaleCaption}`
			: band.scaleCaption,
	);

	const timeOfDaySpec = $derived(
		selectPunctualityTimeOfDay(punctuality, locale, {
			title: copy.peak.strip.ariaLabel,
			unit: copy.units.pct,
			shiftLabel,
		}),
	);
	const hasShiftStrip = $derived(timeOfDaySpec.kind === 'dot-strip');
	const shiftMeanLabel = $derived(
		timeOfDaySpec.kind === 'dot-strip' && timeOfDaySpec.medianRef != null
			? copy.peak.strip.mean(pct(timeOfDaySpec.medianRef) ?? noDataLabel)
			: '',
	);

	type PeakRow = {
		readonly key: string;
		readonly rank: number;
		readonly title: string;
		readonly severity: SeverityCode;
		readonly value: number | null;
		readonly display: string;
	};

	function toPeakRows(
		rows: readonly PeriodComparisonRow[],
		label: (g: string) => string,
	): PeakRow[] {
		return rows
			.filter((r) => r.severePct != null)
			.map((r, i) => ({
				key: r.grain,
				rank: i + 1,
				title: label(r.grain),
				severity: severeShareToSeverity(r.severePct),
				value: r.severePct,
				display: pct(r.severePct) ?? noDataLabel,
			}));
	}

	const orderByGrain = (
		rows: readonly PeriodComparisonRow[],
		order: readonly string[],
	): PeriodComparisonRow[] =>
		rows.slice().sort((a, b) => order.indexOf(a.grain) - order.indexOf(b.grain));

	const dayTypePeakRows = $derived(
		toPeakRows(orderByGrain(punctuality.peakOffPeak.byDayType, DAY_TYPE_GRAIN_ORDER), dayTypeLabel),
	);
	const dayTypeBars = $derived(
		selectShiftBars(
			dayTypePeakRows.map((r) => ({
				key: r.key,
				label: r.title,
				value: r.value,
				severity: r.severity,
			})),
			locale,
			{
				title: copy.peak.dayType,
				rowLabel: copy.crosstab.dayTypeHeader,
				xLabel: copy.strip.severePct,
				unit: '%',
				domain: SEVERE_DOMAIN,
				noDataMarker: noDataLabel,
			},
		),
	);
	const hasPeak = $derived(
		!punctuality.peakOffPeak.isEmpty && (hasShiftStrip || dayTypePeakRows.length > 0),
	);

	interface OnTimeRow {
		readonly key: string;
		readonly label: string;
		readonly otpPct: number | null;
		readonly delta: number | null;
	}
	const toOnTimeRow = (r: PeriodComparisonRow, label: (g: string) => string): OnTimeRow => ({
		key: r.grain,
		label: label(r.grain),
		otpPct: r.otpPct,
		delta: priorDelta(r.otpPct, r.priorOtpPct),
	});
	const onTimeShiftRows = $derived(
		orderByGrain(
			punctuality.peakOffPeak.byShift.filter((r) => r.otpPct != null),
			SHIFT_GRAIN_ORDER as readonly string[],
		).map((r) => toOnTimeRow(r, shiftLabel)),
	);
	const onTimeDayTypeRows = $derived(
		orderByGrain(punctuality.peakOffPeak.byDayType, DAY_TYPE_GRAIN_ORDER)
			.filter((r) => r.otpPct != null)
			.map((r) => toOnTimeRow(r, dayTypeLabel)),
	);
	const hasOnTimeCompare = $derived(
		punctuality.windowed && (onTimeShiftRows.length > 0 || onTimeDayTypeRows.length > 0),
	);
	const fmtPts = (d: number): string =>
		`${d > 0 ? '+' : ''}${d} ${Math.abs(d) === 1 ? copy.priorDelta.ptOne : copy.priorDelta.pts}`;

	const crosstabLines = $derived(
		selectPunctualityCrosstab(punctuality.byShiftDaytype, locale, {
			title: copy.crosstab.heading,
			xLabel: copy.crosstab.shiftHeader,
			yLabel: copy.strip.otpPct,
			shiftLabel: (s) => shiftGrainLabelShort(s, locale),
			weekdayLabel: copy.peak.weekday,
			weekendLabel: copy.peak.weekend,
		}),
	);

	const weekdayCycle = $derived(
		selectWeekdayCycle(punctuality.dayOfWeek, locale, {
			title: band.weekdayHeading,
			xLabel: band.dayAxisLabel,
			yLabel: copy.strip.avgDelayMin,
			unit: ' min',
			weekdayShort: (iso) => band.weekdaysShort[iso - 1],
		}),
	);
	const hasWeekday = $derived(weekdayCycle.hasData);

	const sectionEmpty = $derived(!hasHeatmap && !hasPeak && !crosstabLines.hasData && !hasWeekday);
</script>

{#snippet onTimeCompareRow(row: OnTimeRow)}
	<li
		class="compare-row"
		data-slot="on-time-compare-row"
		data-prior={row.delta == null ? 'absent' : row.delta === 0 ? 'flat' : 'change'}
	>
		<span class="compare-label">{row.label}</span>
		<span class="compare-value">{pct(row.otpPct) ?? noDataLabel}</span>
		<DeltaStat
			class="compare-delta"
			delta={row.delta}
			display={row.delta == null ? undefined : fmtPts(row.delta)}
			higherIsBetter
			context={row.delta == null ? copy.priorDelta.noPrior[win] : copy.priorDelta.vsPrior[win]}
			ariaNoun={`${row.label} ${copy.priorDelta.onTimeNoun}`}
		/>
	</li>
{/snippet}

<CollapsibleSection
	dataSection="when-to-ride"
	number={2}
	eyebrow={copy.sections.whenToRide.label}
	question={copy.sections.whenToRide.question}
>
	{#if sectionEmpty}
		<div data-slot="when-to-ride-empty">
			<AbsentValue variant="block" reason="no-observations" {locale} />
		</div>
	{:else}
		{#if hasHeatmap}
			<div class="section-primary" data-slot="habits-heatmap" data-card="primary">
				<span class="label-with-info">
					<SectionLabel text={band.heatmapHeading} variant="metric" />
					<MetricInfo
						class="cluster-info"
						metricKey="habits"
						{locale}
						name={band.heatmapHeading}
						side="bottom"
					/>
				</span>
				{#if relativePeakText}
					<p class="heatmap-insight" data-slot="best-time-insight">{relativePeakText}</p>
				{/if}
				<p class="heatmap-window-note" data-slot="heatmap-window-note">
					<span class="heatmap-window-note__glyph" aria-hidden="true">∞</span>
					{band.heatmapWindowNote}
				</p>
				<div class="habits-heatmap">
					<Chart spec={heatmapSpec} />
				</div>
				<ChartLegend items={legendItems} />
				<p class="caption" data-slot="habits-scale-caption">{scaleCaptionText}</p>
			</div>
		{/if}

		<Detail label={copy.sections.detailShow} labelOpen={copy.sections.detailHide}>
			{#if hasOnTimeCompare}
				<div class="block" data-slot="on-time-vs-prior" data-card>
					<span class="label-with-info">
						<SectionLabel text={copy.priorDelta.onTimeHeading} variant="metric" />
						<MetricInfo
							class="cluster-info"
							metricKey="otp"
							{locale}
							name={copy.priorDelta.onTimeHeading}
							side="bottom"
						/>
					</span>
					<ul class="compare-list" data-slot="on-time-compare">
						{#each onTimeShiftRows as row (row.key)}{@render onTimeCompareRow(row)}{/each}
						{#each onTimeDayTypeRows as row (row.key)}{@render onTimeCompareRow(row)}{/each}
					</ul>
					<p class="caption" data-slot="on-time-vs-prior-caption">{copy.priorDelta.caption}</p>
				</div>
			{/if}

			{#if hasPeak}
				<div class="block" data-slot="peak-off-peak" data-card>
					<span class="label-with-info">
						<SectionLabel text={copy.peak.heading} variant="metric" />
						<MetricInfo
							class="cluster-info"
							metricKey="severe"
							{locale}
							name={copy.peak.heading}
							side="bottom"
						/>
					</span>
					{#if hasShiftStrip}
						<div class="strip" data-slot="shift-severe-strip">
							<Chart spec={timeOfDaySpec} />
							<p class="caption" data-slot="shift-strip-axis">
								{copy.peak.dayOfWeekSevere}{#if shiftMeanLabel}
									· {shiftMeanLabel}{/if}
							</p>
						</div>
					{/if}

					{#if dayTypePeakRows.length > 0}
						<div class="peak-daytype" data-slot="peak-day-type">
							<SectionLabel text={copy.peak.dayType} variant="metric" />
							<Chart spec={dayTypeBars} />
						</div>
					{/if}

					<p class="caption" data-slot="peak-caveat">{copy.peak.caveat}</p>
				</div>
			{/if}

			{#if crosstabLines.hasData}
				<div class="block" data-slot="shift-daytype-crosstab" data-card>
					<span class="label-with-info">
						<SectionLabel text={copy.crosstab.heading} variant="metric" />
						<MetricInfo
							class="cluster-info"
							metricKey="otp"
							{locale}
							name={copy.crosstab.heading}
							side="bottom"
						/>
					</span>
					<Chart spec={crosstabLines.spec} />
					<p class="caption" data-slot="crosstab-caption">{copy.crosstab.caption}</p>
				</div>
			{/if}

			{#if hasWeekday}
				<div class="block" data-slot="habits-weekday" data-card>
					<span class="label-with-info">
						<SectionLabel text={band.weekdayHeading} variant="metric" />
						<MetricInfo
							class="cluster-info"
							metricKey="seasonality"
							{locale}
							name={band.weekdayHeading}
							side="bottom"
						/>
					</span>
					<Chart spec={weekdayCycle.spec} />
					<p class="caption" data-slot="habits-cycle-caption">{band.cycle.captionSingle}</p>
				</div>
			{/if}
		</Detail>
	{/if}
</CollapsibleSection>

<style>
	.section-primary,
	.block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.section-primary :global(.habits-heatmap) {
		max-width: 100%;
	}
	.caption {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.heatmap-window-note {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--foreground);
	}
	.heatmap-window-note__glyph {
		flex: none;
		font-size: var(--text-body);
		line-height: 1;
		color: var(--accent-text);
	}
	.heatmap-insight {
		margin: 0;
		font-size: var(--text-body);
		line-height: 1.45;
		font-weight: 500;
		color: var(--foreground);
		text-wrap: pretty;
	}
	.peak-daytype {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.strip {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.compare-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.compare-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.5rem;
		padding: 0.375rem 0;
	}
	.compare-row + .compare-row {
		border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
	}
	.compare-label {
		flex: 0 0 7rem;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-weight: 500;
		color: var(--foreground);
	}
	.compare-value {
		flex: 0 0 auto;
		min-width: 2.75rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
	}
</style>
