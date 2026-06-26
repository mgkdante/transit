<!--
  Cluster01Punctuality, the "01 Punctuality" band of the slice-9.6 historic
  Reliability surface (approach B, one band per cluster).

  Reads a `PunctualityVM` (the pure mapper's per-band view-model) + locale +
  the co-located reliability copy. It answers, for the route's punctuality:

    - the headline, OTP % + avg delay (MetricDisplay) for the latest closed day,
      then the typical→worst-case spread (p50→p90) as ONE Distribution quantile
      mark on the fixed [0,15] min DELAY_DIST_DOMAIN (median = the --primary
      affordance marker, the bar runs median→tail);
    - the OTP trend SHAPE across the dated day series (TrendLine: OTP green vs
      the avg-delay/retard amber series, dual y-domains since the units differ),
      captioned with its window (last 30 days) and real dated x-ticks;
    - the SEVERE-DELAY SHARE magnitude of the headline day (SeverityBar, a
      [0,1] data mark on the dataviz severity scale, NEVER --primary) under its
      OWN dedicated label (it is NOT the p90);
    - the accountability element: the weakest stops ranked worst-delay first
      under an explicit heading + count (RankedRow, normalized against the worst
      stop on the route);
    - "By time of day" (A1), the time-of-day shift buckets + a weekday/weekend
      pair, ranked by severe-delay share, with the honest trailing-window caveat.

  HONESTY DOCTRINE upheld here:
    - vm.isEmpty → an explicit no-data note; never a fake 0 or a dropped band.
    - every headline is `number | null`; null renders an em-dash, not 0.
    - each data mark rides the dataviz scale; --primary is interaction-only.
    - the peak block prints its trailing-window / small-sample caveat (the shift
      buckets are an observation-weighted proxy, not certified OTP).

  Self-contained: takes its data + locale + copy as props (no resource load, no
  i18n context) so it compiles + renders in isolation before it is wired up.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { fmtDelayMin, fmtPct } from '$lib/utils';
	import type { SeverityCode } from '$lib/v1/schemas';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { AbsentValue, MaybeValue } from '$lib/components/edge';
	import { SeverityBar, RankedRow } from '$lib/components/dataviz';
	import { Chart } from '$lib/components/dataviz/chart';
	import { selectPunctualityTrend } from './selectors/punctualityTrend';
	import { selectPunctualityDistribution } from './selectors/punctualityDistribution';
	import { selectPunctualityTimeOfDay } from './selectors/punctualityTimeOfDay';
	import { selectWeakStops } from './selectors/weakStops';
	import { selectPunctualityCrosstab } from './selectors/punctualityCrosstab';
	import { GrainPicker, type GrainSegment } from '$lib/components/surface';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import type { PunctualityVM, PeriodComparisonRow } from './clusters';
	import type { ReliabilityCopy } from './reliability.copy';
	import {
		shiftLabel as shiftGrainLabel,
		severeShareToSeverity,
		DAY_TYPE_GRAIN_ORDER,
		SEVERE_DOMAIN,
	} from '$lib/features/reliability/shiftGrains';

	export interface Cluster01PunctualityProps {
		/** The punctuality view-model from `toReliabilityClusters`. */
		vm: PunctualityVM;
		/** Active locale (FR canonical). */
		locale: Locale;
		/** The co-located reliability copy bundle for this locale. */
		copy: ReliabilityCopy;
		/**
		 * Which grain the headline answers for. Defaults to 'day'; the band's
		 * headline tiles answer for the latest closed day (the strip is the
		 * canonical grain-aware headline). Threaded for parity with the spine.
		 */
		grain?: string;
	}

	let { vm, locale, copy, grain = 'day' }: Cluster01PunctualityProps = $props();

	// The in-app metric-explainer (i) affordance: the one-line tip + a localized
	// deep link to /metrics#<anchor>. An INTERACTIVE control beside each label,
	// never a data mark; doctrine-clean.
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	// The headline period: the most-recent dated day in the trend (the foundation
	// trend is day-only, ascending). The strip remains the canonical grain-aware
	// headline; this band's tiles answer for the latest closed day.
	// §01's headline tiles + the typical→worst-case Distribution + the severe-share bar
	// read the GRAIN-AWARE aggregate (today / this week / this month / range — the same
	// values the strip shows), so they answer for the picked window. The trend below
	// carries the daily detail. One aggregate, never the trend tail (systematic).
	const headline = $derived(vm.headline);

	// Honest absence → null (MetricDisplay renders the muted no-data label); a real
	// value speaks the amber metric voice. Never a bare "·", never a fabricated 0.
	const pct = (v: number | null | undefined): string | null => fmtPct(v);
	const min = (v: number | null | undefined): string | null =>
		fmtDelayMin(v, { rounding: 'fixed1' });

	// S7 (granularity MATRIX): the trend shows the SUB-GRAIN of the picked window — at DAY
	// grain the intra-day pattern (OTP across the time-of-day shifts), at week / month /
	// range the dated daily series. selectPunctualityTrend owns that shaping + the Wilson
	// band + the absolute domains (OTP [0,100], retard [0,8]); this band just renders the
	// returned spec through the one <Chart> (the first LayerChart-backed mark, S7 P1.4).
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

	// Typical→worst-case: the p50/p90 quantile NUMBERS (available per-grain) sit above the
	// true A1 signed-delay distribution SHAPE — now the real histogram from the contract's
	// delay_histogram (the D4 payoff), rendered via the one <Chart>. The histogram is null
	// on the day grain + any date range (per contract), where selectPunctualityDistribution
	// returns honest absence; the quantile numbers stay. NO mean (skew lies); median + p90
	// are the histogram's own reference rules.
	const p50 = $derived<number | null>(headline.p50Min);
	const p90 = $derived<number | null>(headline.p90Min);
	const hasDist = $derived(p50 != null || p90 != null);
	const distSpec = $derived(
		selectPunctualityDistribution(vm, locale, {
			title: copy.strip.delayDistHeading,
			unit: ' s',
			xLabel: copy.strip.delayDistLabel,
		}),
	);

	// Severe-share magnitude of the headline period — the ABSOLUTE %, scaled by the
	// fixed SEVERE_DOMAIN at the bar (not /100, not /max). null = no data.
	const severePct = $derived(headline.severePct);
	const severeValue = $derived<number | null>(severePct);
	// Severe share is itself a severity reading: band it so the bar colour is honest
	// (shared thresholds — see severeShareToSeverity; null bands to 'watch').
	const severeSeverity = $derived<SeverityCode>(severeShareToSeverity(severePct));

	// Worst-N selector (S7): a selectable how-many-stops control (5/10/20/30/50/100,
	// default 10) reusing GrainPicker over a numeric-string union — the active chip is
	// --primary (an interactive control), never a data mark. Local state; the slice is
	// applied below so the data is always present, just truncated to the chosen N.
	const WORST_N_SEGMENTS: GrainSegment<string>[] = [
		{ key: '5', label: '5' },
		{ key: '10', label: '10' },
		{ key: '20', label: '20' },
		{ key: '30', label: '30' },
		{ key: '50', label: '50' },
		{ key: '100', label: '100' },
	];
	let worstN = $state('10');
	const worstNCount = $derived(Number(worstN));

	// Worst-N accountability LOLLIPOP (A13) — selectWeakStops owns the rank + the worst-N
	// slice + the spec; rendered via the one <Chart> on the fixed DELAY_POS_DOMAIN (the same
	// delay renders the same length on every route/grain/refresh). Click a row → the stop
	// page. The heading carries the honest shown/total count. (Ranking is by avg delay today
	// — the contract WeakStop carries no Wilson/n; the Wilson-lower rank + whisker is a small
	// pipeline-rollup follow-up.)
	const weakStops = $derived(
		selectWeakStops(vm.weakStops, worstNCount, locale, {
			title: copy.strip.weakStopsHeading,
			xLabel: copy.strip.avgDelayMin,
			unit: copy.units.min,
			stopHref: (id) => `/stop/${id}`,
		}),
	);
	const weakStopsHeading = $derived(
		weakStops.total > weakStops.shown
			? `${copy.strip.weakStopsHeading} · ${weakStops.shown}/${weakStops.total}`
			: `${copy.strip.weakStopsHeading} · ${weakStops.shown}`,
	);

	/* ── By time of day (A1/A2) ──────────────────────────────────────────────
	   The granular shift + day-type buckets the contract already carries, ranked
	   by SEVERE-delay share (worst first). Each row's SeverityBar encodes the
	   severe share as a [0,1] magnitude; null severe → empty track (no fake 0).
	   These are a trailing-window observation-weighted proxy (date:null), NOT
	   certified OTP, the band prints that caveat below the block. */
	// Shift-grain labels come from the shared reliability vocabulary so the lines +
	// stops surfaces speak identical tokens (no re-invented labels here).
	function shiftLabel(g: string): string {
		return shiftGrainLabel(g, locale);
	}
	function dayTypeLabel(g: string): string {
		if (g === 'weekday') return copy.peak.weekday;
		if (g === 'weekend') return copy.peak.weekend;
		return g;
	}

	type PeakRow = {
		readonly key: string;
		readonly rank: number;
		readonly title: string;
		readonly severity: SeverityCode;
		readonly value: number | null;
		readonly display: string;
	};

	// S7: fixed-category rows in their natural CLOCK / weekday→weekend order — NOT
	// sorted by severe share (re-sorting a fixed axis is itself a doctrine violation).
	// value = the ABSOLUTE severe %, scaled by the fixed SEVERE_DOMAIN at the bar (never
	// the in-view max); the rank ordinal is dropped at the render (showRank=false).
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

	// Order the fixed buckets by their canonical sequence (clock order for shifts,
	// weekday→weekend for day-type) so the strip reads in a stable order every visit.
	const orderByGrain = (
		rows: readonly PeriodComparisonRow[],
		order: readonly string[],
	): PeriodComparisonRow[] =>
		rows.slice().sort((a, b) => order.indexOf(a.grain) - order.indexOf(b.grain));

	// P10: the per-shift severe share renders as a Cleveland DOT/STRIP plot over the
	// 5 shifts on ONE shared severe-share axis (the fixed SEVERE_DOMAIN [0,35]) — no
	// more 5 disconnected bars. order='given' keeps the am→night chronological order
	// (re-sorting a fixed axis is a doctrine violation); the dots are NOT connected.
	// Each row's dot is coloured on the dataviz SEVERITY scale (banded by the SAME
	// severe-share thresholds as the bars), paired with an escalating glyph so colour
	// is never the sole channel. A null-severe shift routes through honest absence (no
	// dot, the WHY) — never a fabricated 0. The byShift rows ALWAYS carry every shift
	// the contract returned; the strip shows the fixed axis with honest gaps.
	// P10/S7 P1.5: the per-shift severe share is a Cleveland DOT-STRIP — one dot per shift
	// on the fixed SEVERE_DOMAIN, dots NOT connected, the all-day mean a reference rule —
	// now rendered via the one <Chart>. selectPunctualityTimeOfDay owns the shift order +
	// severity banding + the mean; honest absence when no shift carries a real severe share.
	const timeOfDaySpec = $derived(
		selectPunctualityTimeOfDay(vm, locale, {
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

	const dayTypePeakRows = $derived(
		toPeakRows(orderByGrain(vm.peakOffPeak.byDayType, DAY_TYPE_GRAIN_ORDER), dayTypeLabel),
	);
	const hasPeak = $derived(
		!vm.peakOffPeak.isEmpty && (hasShiftStrip || dayTypePeakRows.length > 0),
	);

	/* ── By shift and day type (G1) — TWO LINES (S7 line-chart convergence) ───────
	   The Tier-3 OTP crosstab is now the cohesive line language: weekday vs weekend
	   on-time % across the day's shifts on the fixed OTP_DOMAIN. A cell below
	   MIN_TRUSTED_OBS (or null OTP) is an honest GAP in its line, never a fake point.
	   selectPunctualityCrosstab owns the trust filter + the spec; rendered via <Chart>. */
	const crosstabLines = $derived(
		selectPunctualityCrosstab(vm.byShiftDaytype, locale, {
			title: copy.crosstab.heading,
			xLabel: copy.crosstab.shiftHeader,
			yLabel: copy.crosstab.heading,
			shiftLabel: (s) => shiftGrainLabel(s, locale),
			weekdayLabel: copy.peak.weekday,
			weekendLabel: copy.peak.weekend,
		}),
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

<section class="cluster" aria-label={copy.clusters.punctuality}>
	<SectionLabel text={copy.clusters.punctuality} variant="station" />

	{#if vm.isEmpty}
		<!-- Honest empty: the styled honest-absence chip (says WHY), never a fake 0 / dropped band. -->
		<div data-testid="punctuality-empty">
			<AbsentValue variant="block" reason="no-observations" {locale} />
		</div>
	{:else}
		<!-- Latest-day headline: OTP %, avg delay (the typical→worst-case spread moves
		     into its own Distribution mark below). -->
		<div class="cluster-headline">
			<div class="metric-with-info">
				<MetricDisplay
					value={pct(headline.otpPct)}
					emptyLabel={copy.strip.noData}
					absentReason="no-observations"
					{locale}
					label={copy.strip.otpPct}
					size="lg"
				/>
				{@render metricInfo('otp', copy.strip.otpPct)}
			</div>
			<div class="metric-with-info">
				<MetricDisplay
					value={min(headline.avgDelayMin)}
					emptyLabel={copy.strip.noData}
					absentReason="no-observations"
					{locale}
					label={copy.strip.avgDelayMin}
					size="md"
				/>
				{@render metricInfo('avgDelay', copy.strip.avgDelayMin)}
			</div>
		</div>

		<!-- Typical → worst-case delay as ONE quantile shape: the median (p50) is the
		     --primary affordance marker, the bar runs median→tail (p90) on the FIXED
		     [0,15] min DELAY_DIST_DOMAIN. Honest absence: when both are null the
		     AbsentValue chip (says WHY) renders, never a fabricated 0 / collapsed box. -->
		<div class="cluster-block" data-slot="delay-distribution">
			<div class="cluster-block-head">
				<span class="label-with-info">
					<SectionLabel text={copy.strip.delayDistHeading} variant="metric" />
					{@render metricInfo('p50p90', copy.strip.delayDistHeading)}
				</span>
				<span class="cluster-block-value" class:cluster-block-value--empty={!hasDist}>
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
				<p class="cluster-caption" data-slot="delay-dist-caption">{copy.strip.delayDistCaption}</p>
			{/if}
		</div>

		<!-- OTP trend across the dated day series (green) vs avg-delay retard (amber). -->
		{#if hasTrend}
			<div class="cluster-block">
				<div class="cluster-block-head">
					<SectionLabel text={copy.strip.otpPct} variant="metric" />
					<span class="cluster-block-window" data-slot="trend-window"
						>{isDayGrain ? copy.windows.trendByTimeOfDay : copy.windows.trendByDay}</span
					>
				</div>
				<Chart spec={trendSpec} />
				{#if hasWilsonBand}
					<p class="cluster-band-caption" data-slot="wilson-band-caption">
						{copy.strip.wilsonBandCaption}
					</p>
				{/if}
			</div>
		{/if}

		<!-- Severe-delay share of the headline day, its OWN label (NOT p90). -->
		<div class="cluster-block">
			<div class="cluster-block-head">
				<span class="label-with-info">
					<SectionLabel text={copy.strip.severePct} variant="metric" />
					{@render metricInfo('severe', copy.strip.severePct)}
				</span>
				<span class="cluster-block-value" class:cluster-block-value--empty={severePct == null}>
					<MaybeValue value={pct(severePct)} reason="no-observations" {locale} />
				</span>
			</div>
			<SeverityBar
				severity={severeSeverity}
				value={severeValue}
				domain={SEVERE_DOMAIN}
				unit="%"
				label={copy.strip.severePct}
				interactive
			/>
			<p class="cluster-caption" data-slot="severe-caption">{copy.strip.severeCaption}</p>
		</div>

		<!-- Weakest stops, the accountability list, worst delay first + count. -->
		{#if weakStops.shown > 0}
			<div class="cluster-block">
				<div class="weak-stops-head">
					<span class="label-with-info">
						<SectionLabel text={weakStopsHeading} variant="metric" />
						{@render metricInfo('weakStops', copy.strip.weakStopsHeading)}
					</span>
					{#if weakStops.total > 5}
						<GrainPicker
							segments={WORST_N_SEGMENTS}
							bind:value={worstN}
							label={copy.strip.worstNLabel}
						/>
					{/if}
				</div>
				<p class="cluster-caption" data-slot="weak-stops-window">{copy.windows.weakStops}</p>
				<div data-slot="weak-stops-list">
					<Chart spec={weakStops.spec} />
				</div>
			</div>
		{/if}

		<!-- By time of day (A1): shift buckets + weekday/weekend, ranked by severe share. -->
		{#if hasPeak}
			<div class="cluster-block" data-slot="peak-off-peak">
				<span class="label-with-info">
					<SectionLabel text={copy.peak.heading} variant="metric" />
					{@render metricInfo('severe', copy.peak.heading)}
				</span>
				{#if hasShiftStrip}
					<!-- P10: a Cleveland DOT/STRIP plot — one dot per shift on ONE shared
					     severe-share axis (fixed SEVERE_DOMAIN [0,35]), am→night order, dots
					     NOT connected. The all-day mean is a vertical reference rule; only the
					     extremes are direct-labelled. Dots ride the dataviz severity scale +
					     a glyph; a null-severe shift is an honest gap (no fake 0). -->
					<div class="cluster-strip" data-slot="shift-severe-strip">
						<Chart spec={timeOfDaySpec} />
						<p class="cluster-caption" data-slot="shift-strip-axis">
							{copy.peak.dayOfWeekSevere}{#if shiftMeanLabel}
								· {shiftMeanLabel}{/if}
						</p>
					</div>
				{/if}

				{#if dayTypePeakRows.length > 0}
					<div class="cluster-peak-daytype" data-slot="peak-day-type">
						<SectionLabel text={copy.peak.dayType} variant="metric" />
						<div class="cluster-ranked" role="list" aria-label={copy.peak.dayType}>
							{#each dayTypePeakRows as row (row.key)}
								<RankedRow
									rank={row.rank}
									title={row.title}
									subtitle={copy.peak.dayOfWeekSevere}
									severity={row.severity}
									value={row.value}
									domain={SEVERE_DOMAIN}
									unit="%"
									showRank={false}
									display={row.display}
									barInteractive
								/>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Honest caveat: trailing-window observation-weighted proxy, small samples vary. -->
				<p class="cluster-caption" data-slot="peak-caveat">{copy.peak.caveat}</p>
			</div>
		{/if}

		<!-- By shift and day type (G1): the Tier-3 OTP crosstab as a STEPPED HEATMAP, a
		     fixed 5-shift × 2-day-type grid. Each cell's fill is its REAL OTP on the
		     FIXED [0,100] OTP_DOMAIN → the --dataviz-heatmap-* ramp (never the in-view
		     best). A cell with no obs / null OTP / n<30 is greyed honestly, never a
		     coloured fake 0. Colour is never the sole channel: each cell carries its
		     value + a bucket glyph; the hottest trusted cell is annotated. -->
		{#if crosstabLines.hasData}
			<div class="cluster-block" data-slot="shift-daytype-crosstab">
				<span class="label-with-info">
					<SectionLabel text={copy.crosstab.heading} variant="metric" />
					{@render metricInfo('otp', copy.crosstab.heading)}
				</span>
				<!-- S7: weekday vs weekend OTP across shifts as TWO lines (was a stepped
				     heatmap grid) — the cohesive line language; untrusted cells gap honestly. -->
				<Chart spec={crosstabLines.spec} />
				<p class="cluster-caption" data-slot="crosstab-caption">{copy.crosstab.caption}</p>
			</div>
		{/if}
	{/if}
</section>

<style>
	.cluster {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.cluster-headline {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem 2rem;
	}
	/* A metric tile + its explainer (i): the affordance rides the tile's top edge,
	   inline so the headline row keeps wrapping naturally (no layout disruption). The
	   tile keeps a measure (min-width:0) so a long label wraps cleanly; the (i) wrapper
	   never shrinks (flex:none) so the glyph stays whole beside it, never colliding. */
	.metric-with-info {
		display: inline-flex;
		align-items: flex-start;
		gap: 0.35rem;
	}
	.metric-with-info :global([data-slot='metric-display']) {
		min-width: 0;
	}
	.metric-with-info :global(.cluster-info) {
		flex: none;
	}
	/* A block overline + its explainer (i), kept centred on the label. The label
	   keeps a measure (min-width:0) so a long overline wraps cleanly; the (i)
	   wrapper never shrinks (flex:none) so the glyph stays whole beside it. */
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
	.cluster-block {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	/* Weak-stops heading row: the label + (i) on the left, the worst-N selector on
	   the right; wraps to its own row on narrow/mobile so the selector never crowds
	   the heading. */
	.weak-stops-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
	}
	.cluster-block-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.cluster-block-value {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
	}
	/* Honest no-data reading of the inline severe value: quiet muted mono. */
	.cluster-block-value--empty {
		color: var(--muted-foreground);
	}
	/* Quiet mono caption (window label / honest caveat), AA both themes. */
	.cluster-block-window,
	.cluster-caption {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.cluster-caption {
		margin: 0;
		max-width: 52ch;
	}
	.cluster-block-window {
		font-variant-numeric: tabular-nums;
	}
	/* Plain-language legend for the Wilson band + 80% target rule, under the trend. */
	.cluster-band-caption {
		margin: 0.5rem 0 0;
		font-size: var(--text-caption);
		line-height: 1.5;
		color: var(--muted-foreground);
		text-wrap: pretty;
	}
	.cluster-ranked {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.cluster-peak-daytype {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	/* The per-shift severe-share Cleveland strip + its axis caption. */
	.cluster-strip {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* By-shift-and-day-type STEPPED HEATMAP: a fixed 5×2 grid of OTP swatches. Header +
	   row labels are descriptive (no rotated text); each cell is a coloured swatch on
	   the fixed-domain heatmap ramp + its OTP value + a bucket glyph. 1px channel gaps
	   between swatches (border-spacing). A greyed cell rides the no-data swatch. */
</style>
