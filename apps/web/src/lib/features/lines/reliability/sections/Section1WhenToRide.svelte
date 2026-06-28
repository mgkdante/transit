<!--
  §1 When to ride — "When is it reliable, and when does it go bad?"

  The second rider-question section. Leads with the ONE always-visible primary
  chart — the 7×24 repeat-problems heatmap (the rider's at-a-glance "which hours
  of which days does this line let me down?") — and tucks the analyst detail
  (the time-of-day severe-share dot-strip, the weekday/weekend split, the
  shift×day-type crosstab lines, and the weekday-seasonality line) behind the
  progressive-disclosure `<Detail>` expander.

  Reads the HabitsVM (the heatmap matrix, cells number|null) + the PunctualityVM
  (its day-of-week seasonality, its peak/off-peak shift + day-type buckets, and
  its shift×day-type OTP crosstab). The page grain does NOT re-shape this section
  — these reads each carry their OWN dimension (hour-of-day, day-of-week, shift)
  independent of the picked window, so the section stays grain-invariant.

  Honest absence throughout: a null heatmap cell paints the dedicated no-data
  token (never a fabricated low value); each chart degrades to its own absence
  mark; and when BOTH the habits matrix is empty AND there is no punctuality
  peak / crosstab / day-of-week signal at all, the whole section renders the
  styled AbsentValue chip (says WHY), never a dropped section.

  NOTE (Phase 2): the plain-language verdict SENTENCE ("Worst around weekday PM
  peak; calmest mid-morning …") lands here above the heatmap once the verdict
  rules engine is built. Phase 1 frames the section with the rider question.

  NOTE (Phase 4): the heatmap PRIMARY will be rebuilt as a LayerChart classed-tier
  mark for the "same face" convergence; Phase 1 keeps the Heatmap primitive.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { fmtPct } from '$lib/utils';
	import type { SeverityCode } from '$lib/v1/schemas';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import CollapsibleSection from './CollapsibleSection.svelte';
	import { ChartLegend, DeltaStat } from '$lib/components/dataviz';
	import { Chart } from '$lib/components/dataviz/chart';
	import { AbsentValue } from '$lib/components/edge';
	import Detail from '$lib/components/shared/Detail.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import {
		shiftLabel as shiftGrainLabel,
		shiftLabelShort as shiftGrainLabelShort,
		severeShareToSeverity,
		DAY_TYPE_GRAIN_ORDER,
		SHIFT_GRAIN_ORDER,
		SEVERE_DOMAIN,
	} from '$lib/features/reliability/shiftGrains';
	import { selectPunctualityTimeOfDay } from '../selectors/punctualityTimeOfDay';
	import { proportionPriorDelta, type PriorDelta } from '../selectors/priorDelta';
	import { selectPunctualityCrosstab } from '../selectors/punctualityCrosstab';
	import { selectWeekdayCycle } from '../selectors/weekdayCycle';
	import { selectHabitsHeatmap } from '../selectors/habitsHeatmap';
	import { selectBestTimeInsight } from '../selectors/bestTimeInsight';
	import { selectShiftBars } from '../selectors/shiftBars';
	import type { PunctualityVM, HabitsVM, PeriodComparisonRow } from '../clusters';
	import type { ReliabilityCopy } from '../reliability.copy';
	import { habitsBandCopy } from '../Cluster05Habits.copy';

	interface Section1WhenToRideProps {
		/** The punctuality view-model from `toReliabilityClusters` (day-of-week + peak + crosstab). */
		punctuality: PunctualityVM;
		/** The 05 habits view-model — the 7×24 matrix kept verbatim (cells number|null). */
		habits: HabitsVM;
		/** Active locale (FR canonical). */
		locale: Locale;
		/** The co-located reliability copy bundle for this locale. */
		copy: ReliabilityCopy;
		/**
		 * Active window (day|week|month|range) — names the "vs prior {window}" comparison phrase.
		 * The §1 breakdowns themselves re-shape on this window via the mapper (periods_by_grain);
		 * `range` reads the day-anchored windowed breakdown, so it borrows the 'day' phrasing.
		 */
		mode?: 'day' | 'week' | 'month' | 'range';
	}
	let { punctuality, habits, locale, copy, mode = 'day' }: Section1WhenToRideProps = $props();

	const band = $derived(habitsBandCopy[locale]);
	// Resolved window grain for the comparison phrasing (a custom range reads the day window).
	const win = $derived<'day' | 'week' | 'month'>(
		mode === 'week' || mode === 'month' ? mode : 'day',
	);

	// Honest absence → null; never a fabricated 0. Shared formatter for severe %.
	const pct = (v: number | null | undefined): string | null => fmtPct(v);

	// Metric-explainer (i) affordance — the same wiring every section uses.
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});
	const shiftLabel = (g: string): string => shiftGrainLabel(g, locale);
	const dayTypeLabel = (g: string): string => {
		if (g === 'weekday') return copy.peak.weekday;
		if (g === 'weekend') return copy.peak.weekend;
		return g;
	};

	/* ── PRIMARY — the 7×24 repeat-problems heatmap (grain-invariant) ─────────
	   habits.matrix (7 days × 24 hours, cells number|null in [0,1], normalised to
	   THIS route's worst hour). Now a CLASSED-tier LayerChart mark (S7 P4): a fixed
	   [0,1] domain binned onto 4 plain-language tiers on a CVD-safe ramp, so the same
	   value reads the same tier on every route — and weekends that genuinely see fewer
	   severe delays read calmer (the legacy per-row re-normalisation hid that). A null
	   cell is the honest no-data swatch; the worst tier carries an outline + the ◆ glyph. */
	const hasHeatmap = $derived(!habits.isEmpty);

	// Full day names in heatmap ROW order (Mon..Sun) for the tooltip heading + table.
	const fullDayLabels = $derived(band.weekdays.slice(1));

	// §1 takeaway SENTENCE (the verdict the section earmarks): the line's worst repeat-problem
	// window + its calmest weekday, read straight off the matrix so a rider gets "when to avoid /
	// when it's fine" without decoding the grid. Worded RELATIVE to the line (its own peak hour).
	const bestTime = $derived(
		selectBestTimeInsight(habits, {
			fullRowLabels: fullDayLabels,
			hourLabel: (h) => `${String(h).padStart(2, '0')}:00`,
		}),
	);
	const bestTimeText = $derived(
		bestTime
			? band.bestTime.lead(bestTime.worstDayLabel, bestTime.worstHourLabel) +
					(bestTime.calmDayIdx >= 0 ? band.bestTime.calm(bestTime.calmDayLabel) : '')
			: null,
	);

	const heatmapSpec = $derived(
		selectHabitsHeatmap(habits, locale, {
			title: band.heatmapLabel,
			valueLabel: band.cellValueLabel,
			rowAxisLabel: band.dayAxisLabel,
			colAxisLabel: band.hourAxisLabel,
			rowLabels: band.weekdaysShort,
			fullRowLabels: fullDayLabels,
			tierLabels: band.tiers.labels,
			noDataLabel: band.tiers.noData,
			worstGlyph: band.tiers.worstGlyph,
			hourLabel: (h) => `${String(h).padStart(2, '0')}:00`,
			hourTicks: [0, 3, 6, 9, 12, 15, 18, 21],
		}),
	);

	// Classed-tier legend — four plain-language swatches calmest→worst (the worst label
	// carries the ◆ glyph) + the dedicated no-data swatch, in tier order. The colours are
	// data marks (--dataviz-heatmap-tier-*); the mark's tooltip + sr-table carry a11y.
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
			label: band.tiers.noData,
			swatch: 'square' as const,
		},
	]);

	// Plain-language caption: the resolved scale phrase (never the raw snake_case
	// `scale`) + the how-to-read sentence. Null/unmapped scale → heading fallback.
	const scaleCaptionText = $derived(
		habits.scale
			? `${band.scaleLegend[habits.scale] ?? band.heatmapHeading} · ${band.scaleCaption}`
			: band.scaleCaption,
	);

	/* ── DETAIL — by time of day (A1/A2) ─────────────────────────────────────
	   The granular shift + day-type buckets the contract already carries. The
	   per-shift severe share is a Cleveland DOT-STRIP — one dot per shift on the
	   fixed SEVERE_DOMAIN, dots NOT connected, the all-day mean a reference rule.
	   selectPunctualityTimeOfDay owns the shift order + severity banding + the
	   mean; honest absence when no shift carries a real severe share. */
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
			? copy.peak.strip.mean(pct(timeOfDaySpec.medianRef) ?? copy.strip.noData)
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

	// S7: fixed-category rows in their natural weekday→weekend order — NOT sorted
	// by severe share (re-sorting a fixed axis is itself a doctrine violation).
	// value = the ABSOLUTE severe %, scaled by the fixed SEVERE_DOMAIN at the bar
	// (never the in-view max); the rank ordinal is dropped at the render.
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
				display: pct(r.severePct) ?? copy.strip.noData,
			}));
	}

	// Order the fixed day-type buckets by their canonical weekday→weekend sequence
	// so the strip reads in a stable order every visit.
	const orderByGrain = (
		rows: readonly PeriodComparisonRow[],
		order: readonly string[],
	): PeriodComparisonRow[] =>
		rows.slice().sort((a, b) => order.indexOf(a.grain) - order.indexOf(b.grain));

	const dayTypePeakRows = $derived(
		toPeakRows(orderByGrain(punctuality.peakOffPeak.byDayType, DAY_TYPE_GRAIN_ORDER), dayTypeLabel),
	);
	// S7 P5: the weekday/weekend severe-share as a LayerChart magnitude-bars chart on the
	// fixed SEVERE_DOMAIN (weekday→weekend order, never re-sorted), replacing the RankedRow
	// pair so the day-type read wears the same face as every other mark.
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
				xLabel: copy.strip.severePct,
				unit: '%',
				domain: SEVERE_DOMAIN,
				noDataMarker: copy.strip.noData,
			},
		),
	);
	const hasPeak = $derived(
		!punctuality.peakOffPeak.isEmpty && (hasShiftStrip || dayTypePeakRows.length > 0),
	);

	/* ── DETAIL — on-time by time of day · vs prior {window} (PR-WEB-3) ──────────
	   The per-shift + weekday/weekend ON-TIME rate the windowed breakdowns carry, each with
	   a Δ-vs-prior badge gated on a two-proportion z-test (proportionPriorDelta). Shown ONLY
	   when the §1 breakdowns are windowed (periods_by_grain present) — the scalar whole-history
	   rows carry no prior, so there is nothing to compare. Honest absence: a row with no prior
	   window shows the neutral "no prior {window}" marker (never a fake 0); a real-but-
	   insignificant swing reads "within noise" (neutral), never a coloured arrow. */
	interface OnTimeRow {
		readonly key: string;
		readonly label: string;
		readonly otpPct: number | null;
		readonly delta: PriorDelta;
	}
	const toOnTimeRow = (r: PeriodComparisonRow, label: (g: string) => string): OnTimeRow => ({
		key: r.grain,
		label: label(r.grain),
		otpPct: r.otpPct,
		delta: proportionPriorDelta(
			r.otpPct,
			r.observationCount,
			r.priorOtpPct,
			r.priorObservationCount,
			{ onTime: r.onTime },
		),
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
	// Gate on `windowed`: only the windowed breakdowns carry a prior to compare against.
	const hasOnTimeCompare = $derived(
		punctuality.windowed && (onTimeShiftRows.length > 0 || onTimeDayTypeRows.length > 0),
	);
	// "+5 pts" / "-3 pts" / "+1 pt" — ASCII sign (the no-em-dash gate forbids U+2014, not the
	// hyphen-minus); singular unit on a ±1 move.
	const fmtPts = (d: number): string =>
		`${d > 0 ? '+' : ''}${d} ${Math.abs(d) === 1 ? copy.priorDelta.ptOne : copy.priorDelta.pts}`;

	/* ── DETAIL — by shift and day type (G1) — TWO LINES (S7 convergence) ─────
	   The Tier-3 OTP crosstab is the cohesive line language: weekday vs weekend
	   on-time % across the day's shifts on the fixed OTP_DOMAIN. A cell below
	   MIN_TRUSTED_OBS (or null OTP) is an honest GAP in its line, never a fake
	   point. selectPunctualityCrosstab owns the trust filter + the spec. */
	const crosstabLines = $derived(
		selectPunctualityCrosstab(punctuality.byShiftDaytype, locale, {
			title: copy.crosstab.heading,
			xLabel: copy.crosstab.shiftHeader,
			yLabel: copy.strip.otpPct,
			// SHORT shift labels on the crosstab x-axis (5 shifts across a narrow plot overlap on a
			// phone with the full "AM peak"/… labels); the lines' series carry the day-type identity.
			shiftLabel: (s) => shiftGrainLabelShort(s, locale),
			weekdayLabel: copy.peak.weekday,
			weekendLabel: copy.peak.weekend,
		}),
	);

	/* ── DETAIL — weekday seasonality — ONE LINE (S7 convergence) ─────────────
	   Mean delay per weekday in the FIXED Mon→Sun cycle on DELAY_DOW_DOMAIN (the
	   cycle order IS the meaning, never sorted by value). selectWeekdayCycle owns
	   the spec; a weekday the contract omits is an honest GAP in the line, never
	   a fabricated 0. */
	const weekdayCycle = $derived(
		selectWeekdayCycle(punctuality.dayOfWeek, locale, {
			title: band.weekdayHeading,
			yLabel: copy.strip.avgDelayMin,
			unit: ' min',
			weekdayShort: (iso) => band.weekdaysShort[iso - 1],
		}),
	);
	const hasWeekday = $derived(weekdayCycle.hasData);

	// Whole-section honest empty: nothing time-shaped to show at all — no habit
	// matrix AND no punctuality peak / crosstab / day-of-week signal.
	const sectionEmpty = $derived(!hasHeatmap && !hasPeak && !crosstabLines.hasData && !hasWeekday);
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

{#snippet onTimeCompareRow(row: OnTimeRow)}
	<li
		class="compare-row"
		data-slot="on-time-compare-row"
		data-prior={row.delta.hasPrior ? (row.delta.significant ? 'change' : 'noise') : 'absent'}
	>
		<span class="compare-label">{row.label}</span>
		<span class="compare-value">{pct(row.otpPct) ?? copy.strip.noData}</span>
		<DeltaStat
			class="compare-delta"
			delta={row.delta.significant ? row.delta.delta : null}
			display={row.delta.significant && row.delta.delta != null
				? fmtPts(row.delta.delta)
				: undefined}
			higherIsBetter
			context={row.delta.significant
				? copy.priorDelta.vsPrior[win]
				: row.delta.hasPrior
					? copy.priorDelta.withinNoise
					: copy.priorDelta.noPrior[win]}
			ariaNoun={`${row.label} ${copy.priorDelta.onTimeNoun}`}
		/>
	</li>
{/snippet}

<CollapsibleSection
	dataSection="when-to-ride"
	eyebrow={copy.sections.whenToRide.label}
	question={copy.sections.whenToRide.question}
>
	{#if sectionEmpty}
		<div data-slot="when-to-ride-empty">
			<AbsentValue variant="block" reason="no-observations" {locale} />
		</div>
	{:else}
		<!-- PRIMARY — the 7×24 repeat-problems heatmap (always visible). -->
		{#if hasHeatmap}
			<div class="section-primary" data-slot="habits-heatmap" data-card="primary">
				<span class="label-with-info">
					<SectionLabel text={band.heatmapHeading} variant="metric" />
					{@render metricInfo('habits', band.heatmapHeading)}
				</span>
				<!-- Tier-1 takeaway (the verdict SENTENCE the section earmarks): names the line's worst
				     repeat-problem window + calmest weekday, so the rider gets the answer before reading
				     the grid. Worded relative to the line itself. -->
				{#if bestTimeText}
					<p class="heatmap-insight" data-slot="best-time-insight">{bestTimeText}</p>
				{/if}
				<!-- Operator: "today and this week look the same — explain why." The heatmap reads the
					     FULL history (grain-invariant), so it is identical whichever window the rail is on.
					     State it plainly right under the title (∞ ties back to the section's scope glyph). -->
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

		<!-- DETAIL — the time-of-day + weekday analyst reads, one disclosure level deep. -->
		<Detail label={copy.sections.detailShow} labelOpen={copy.sections.detailHide}>
			<!-- On-time by time of day · vs the prior window (PR-WEB-3): each shift + day-type's
			     on-time rate with a significance-gated Δ-vs-prior badge. Shown only when the
			     breakdowns are windowed (else there is no prior to compare against). -->
			{#if hasOnTimeCompare}
				<div class="block" data-slot="on-time-vs-prior" data-card>
					<span class="label-with-info">
						<SectionLabel text={copy.priorDelta.onTimeHeading} variant="metric" />
						{@render metricInfo('otp', copy.priorDelta.onTimeHeading)}
					</span>
					<ul class="compare-list" data-slot="on-time-compare">
						{#each onTimeShiftRows as row (row.key)}{@render onTimeCompareRow(row)}{/each}
						{#each onTimeDayTypeRows as row (row.key)}{@render onTimeCompareRow(row)}{/each}
					</ul>
					<p class="caption" data-slot="on-time-vs-prior-caption">{copy.priorDelta.caption}</p>
				</div>
			{/if}

			<!-- By time of day (A1): the per-shift severe-share dot-strip + weekday/weekend split. -->
			{#if hasPeak}
				<div class="block" data-slot="peak-off-peak" data-card>
					<span class="label-with-info">
						<SectionLabel text={copy.peak.heading} variant="metric" />
						{@render metricInfo('severe', copy.peak.heading)}
					</span>
					{#if hasShiftStrip}
						<!-- P10: a Cleveland DOT/STRIP plot — one dot per shift on ONE shared
						     severe-share axis (fixed SEVERE_DOMAIN), am→night order, dots NOT
						     connected. The all-day mean is a reference rule; dots ride the
						     dataviz severity scale + a glyph; a null-severe shift is an honest
						     gap (no fake 0). -->
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

					<!-- Honest caveat: trailing-window observation-weighted proxy, small samples vary. -->
					<p class="caption" data-slot="peak-caveat">{copy.peak.caveat}</p>
				</div>
			{/if}

			<!-- By shift and day type (G1): weekday vs weekend OTP across shifts as TWO lines. -->
			{#if crosstabLines.hasData}
				<div class="block" data-slot="shift-daytype-crosstab" data-card>
					<span class="label-with-info">
						<SectionLabel text={copy.crosstab.heading} variant="metric" />
						{@render metricInfo('otp', copy.crosstab.heading)}
					</span>
					<Chart spec={crosstabLines.spec} />
					<p class="caption" data-slot="crosstab-caption">{copy.crosstab.caption}</p>
				</div>
			{/if}

			<!-- Weekday seasonality: mean delay per weekday (Mon→Sun) as ONE line. -->
			{#if hasWeekday}
				<div class="block" data-slot="habits-weekday" data-card>
					<span class="label-with-info">
						<SectionLabel text={band.weekdayHeading} variant="metric" />
						{@render metricInfo('seasonality', band.weekdayHeading)}
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
	/* Mobile/360px hardening: keep the 7×24 heatmap inside its subsection at narrow widths.
	   The HORIZONTAL scroll + the FROZEN day-label gutter now live INSIDE the mark (ScrollFrame),
	   so the wrapper only bounds the width — it must NOT add its own overflow-x (that would double-
	   scroll) nor force `svg { min-width }` (that would stretch the frozen gutter SVG too). */
	.section-primary :global(.habits-heatmap) {
		max-width: 100%;
	}
	/* A heading + its explainer (i), kept centred on the label. The label keeps a
	   measure (min-width:0) so a long heading wraps cleanly; the (i) wrapper never
	   shrinks (flex:none) so the glyph stays whole beside it. */
	.label-with-info {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.label-with-info :global([data-slot='section-label']) {
		min-width: 0;
	}
	.label-with-info :global(.cluster-info) {
		flex: none;
	}
	/* Quiet mono caption (scale legend / honest caveat / cycle note), AA both themes. */
	.caption {
		margin: 0;
		max-width: 52ch;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	/* "Why does Today look like This week?" note (operator). Reads at FOREGROUND weight (not
	   a quiet caption) so it is actually noticed — it answers a real confusion. The ∞ glyph
	   ties it to the section TOC's full-history scope mark. */
	.heatmap-window-note {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		margin: 0;
		max-width: 60ch;
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
	/* §1 takeaway sentence — the lead "when to avoid / when it's fine" verdict. Reads stronger
	   than the quiet captions (foreground, medium weight, body size) so the eye catches the
	   answer first; a thin accent rule marks it as the section's insight. */
	.heatmap-insight {
		margin: 0;
		max-width: 60ch;
		padding-inline-start: 0.7rem;
		border-inline-start: 3px solid var(--accent-text);
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
	/* The per-shift severe-share Cleveland strip + its axis caption. */
	.strip {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	/* On-time-by-time-of-day · vs-prior comparison (PR-WEB-3): a label | value | Δ-badge row
	   list. The label keeps a fixed measure so the on-time values align in a column; the Δ
	   badge (DeltaStat) trails and wraps to its own line on a narrow phone. */
	.compare-list {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.compare-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.6rem;
		padding: 0.3rem 0;
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
