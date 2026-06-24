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
	import { stopNameFallback } from '$lib/site/absence';
	import { fmtDelayMin, fmtPct } from '$lib/utils';
	import type { ReliabilityPeriod } from '$lib/v1';
	import type { SeverityCode } from '$lib/v1/schemas';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { AbsentValue, MaybeValue } from '$lib/components/edge';
	import {
		TrendLine,
		SeverityBar,
		RankedRow,
		StripPlot,
		ChartLegend,
		Distribution,
		statusVar,
		severityVar,
		heatmapColor,
		HEATMAP_RAMP,
		HEATMAP_NODATA,
	} from '$lib/components/dataviz';
	import type { DistributionStats, StripPlotRow } from '$lib/components/dataviz';
	import { GrainPicker, type GrainSegment } from '$lib/components/surface';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import type { PunctualityVM, PeriodComparisonRow } from './clusters';
	import type { ReliabilityCopy } from './reliability.copy';
	import {
		shiftLabel as shiftGrainLabel,
		dayTypeLabel as dayTypeGrainLabel,
		severeShareToSeverity,
		delayMinToSeverity,
		SHIFT_GRAIN_ORDER,
		DAY_TYPE_GRAIN_ORDER,
		DELAY_POS_DOMAIN,
		DELAY_DIST_DOMAIN,
		SEVERE_DOMAIN,
		OTP_DOMAIN,
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

	let { vm, locale, copy }: Cluster01PunctualityProps = $props();

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
	const headline = $derived<ReliabilityPeriod | null>(
		vm.trend.length > 0 ? vm.trend[vm.trend.length - 1] : null,
	);

	// Honest absence → null (MetricDisplay renders the muted no-data label); a real
	// value speaks the amber metric voice. Never a bare "·", never a fabricated 0.
	const pct = (v: number | null | undefined): string | null => fmtPct(v);
	const min = (v: number | null | undefined): string | null =>
		fmtDelayMin(v, { rounding: 'fixed1' });

	// OTP trend SHAPE across the dated day series (chronological ascending): green
	// OTP %, amber avg-delay retard. The x-axis carries real ISO dates, never the
	// repeated grain word. Each series scales to its OWN y-domain (% vs minutes).
	const otpSeries = $derived(vm.trend.map((p) => p.otp_pct ?? null));
	const retardSeries = $derived(vm.trend.map((p) => p.avg_delay_min ?? null));
	const xLabels = $derived(vm.trend.map((p) => p.date ?? ''));
	const hasTrend = $derived(vm.trend.length > 1);

	// S7 P1: the 95% Wilson confidence band (PERCENT) shipped on every period but drawn
	// nowhere until now. A fat band IS the honest low-sample signal; we rank on wilson_lo
	// elsewhere. Only render the band when at least one period carries both bounds.
	const wilsonLoSeries = $derived(vm.trend.map((p) => p.wilson_lo ?? null));
	const wilsonHiSeries = $derived(vm.trend.map((p) => p.wilson_hi ?? null));
	const hasWilsonBand = $derived(
		wilsonLoSeries.some((v) => v != null) && wilsonHiSeries.some((v) => v != null),
	);
	// S7: FIXED retard y-domain (min), identical across routes/grains/refreshes — the
	// amber delay axis no longer auto-scales to the in-view max (the stability fix).
	const retardDomain: [number, number] = [...DELAY_POS_DOMAIN];

	// Typical→worst-case delay as ONE quantile shape (S7 P9). The two formerly-
	// disconnected p50 / p90 number tiles become a single Distribution mark on the
	// FIXED, zero-based DELAY_DIST_DOMAIN ([0,15] min — wide enough that the p90 tail
	// is never clamped). The median (p50) is the --primary affordance marker (the kit's
	// lone carve-out); the whisker runs median→tail so both magnitudes read as one
	// shape. Honest absence: when BOTH p50 and p90 are null the mark is dropped and the
	// AbsentValue chip (says WHY) renders instead — never a fabricated 0.
	const p50 = $derived<number | null>(headline?.p50_min ?? null);
	const p90 = $derived<number | null>(headline?.p90_min ?? null);
	const hasDist = $derived(p50 != null || p90 != null);
	// min == median is truthful here (the median is the lower bound of the shown
	// p50→p90 range); p25/p75 stay null → an empty box track, never a fake quartile.
	const distStats = $derived<DistributionStats>({
		min: p50,
		p25: null,
		p50,
		p75: null,
		max: p90,
	});
	// Distribution.domain is a mutable [number, number]; spread the readonly const.
	const delayDistDomain: [number, number] = [...DELAY_DIST_DOMAIN];

	// Severe-share magnitude of the headline period — the ABSOLUTE %, scaled by the
	// fixed SEVERE_DOMAIN at the bar (not /100, not /max). null = no data.
	const severePct = $derived(headline?.severe_pct ?? null);
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

	// The FULL ranked set (worst mean-delay first) BEFORE the worst-N truncation. The
	// bar baseline `worst` is taken from this full set so the bar scale stays stable as
	// N changes (a smaller N never rescales the remaining bars).
	const rankedAll = $derived(
		vm.weakStops
			.filter((w) => w.avg_delay_min != null)
			.slice()
			.sort((a, b) => (b.avg_delay_min ?? 0) - (a.avg_delay_min ?? 0)),
	);
	const weakStopsTotal = $derived(rankedAll.length);

	// The accountability list, truncated to the selected worst-N, worst-on-top. S7:
	// the bar is the ABSOLUTE avg delay (min) scaled by the fixed DELAY_POS_DOMAIN at
	// the row — the same delay renders the same length on every route/grain/refresh
	// (no more delay/worst). Severity via the shared absolute delayMinToSeverity.
	const rankedStops = $derived.by(() =>
		rankedAll.slice(0, worstNCount).map((w, i) => ({
			key: w.id,
			rank: i + 1,
			title: w.name ?? stopNameFallback(w.id, locale),
			severity: delayMinToSeverity(w.avg_delay_min ?? null),
			value: w.avg_delay_min ?? null,
			display: min(w.avg_delay_min) ?? copy.strip.noData,
		})),
	);

	// Weak-stops heading carries the honest count. When the worst-N truncates the set,
	// it reads "shown/total" so the reader knows more exist; otherwise just the count.
	const weakStopsHeading = $derived(
		weakStopsTotal > rankedStops.length
			? `${copy.strip.weakStopsHeading} · ${rankedStops.length}/${weakStopsTotal}`
			: `${copy.strip.weakStopsHeading} · ${rankedStops.length}`,
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
	const SEVERITY_GLYPH: Record<SeverityCode, string> = {
		watch: '●',
		high: '▲',
		critical: '◆',
	};
	const shiftStripRows = $derived<StripPlotRow[]>(
		orderByGrain(vm.peakOffPeak.byShift, SHIFT_GRAIN_ORDER).map((r) => {
			const severity = severeShareToSeverity(r.severePct);
			return {
				key: r.grain,
				label: shiftLabel(r.grain),
				value: r.severePct,
				colorVar: severityVar(severity),
				glyph: SEVERITY_GLYPH[severity],
				display: pct(r.severePct) ?? copy.strip.noData,
				emptyLabel: copy.strip.noData,
			};
		}),
	);
	// At least one shift must carry a real severe share for the strip to draw.
	const hasShiftStrip = $derived(shiftStripRows.some((r) => r.value != null));

	// The all-day mean reference rule: the simple mean of the shifts' real severe
	// shares (a flat sum/length reduce, NOT Math.max over a spread — doctrine-clean).
	// It is a REFERENCE line in value units on the same fixed axis, never a domain.
	const shiftSevereMean = $derived.by<number | null>(() => {
		const vals = shiftStripRows.map((r) => r.value).filter((v): v is number => v != null);
		if (vals.length === 0) return null;
		let sum = 0;
		for (const v of vals) sum += v;
		return sum / vals.length;
	});
	const shiftMeanLabel = $derived(
		shiftSevereMean != null ? copy.peak.strip.mean(pct(shiftSevereMean) ?? copy.strip.noData) : '',
	);

	const dayTypePeakRows = $derived(
		toPeakRows(orderByGrain(vm.peakOffPeak.byDayType, DAY_TYPE_GRAIN_ORDER), dayTypeLabel),
	);
	const hasPeak = $derived(
		!vm.peakOffPeak.isEmpty && (hasShiftStrip || dayTypePeakRows.length > 0),
	);

	/* ── By shift and day type (G1) — STEPPED HEATMAP ─────────────────────────
	   The Tier-3 OTP crosstab as a fixed 5-shift × 2-day-type stepped heatmap. The
	   contract is SPARSE (only cells WITH observations are present), so every grid
	   cell is resolved against an index. Each cell's fill is the cell's REAL OTP %
	   mapped through the FIXED, zero-based OTP_DOMAIN ([0,100]) onto the shared
	   --dataviz-heatmap-* ramp — NEVER normalized to the in-view best cell, so the
	   same OTP paints the same colour on every route/grain/refresh.

	   Honesty rules (the repeat_problem_score lesson):
	     - A cell with no observations, a null OTP, OR fewer than MIN_TRUSTED_OBS
	       observations is GREYED to the dedicated no-data swatch — never coloured
	       like a real low value, never a fabricated 0 / "·" / em-dash.
	     - Colour is never the sole channel: every trusted cell prints its OTP value
	       + a bucket glyph; no-data cells carry the no-data glyph; the SVG cell is a
	       labelled role=img and the table caption stays the a11y source of truth. */
	// A cell needs at least this many observations before its OTP is trusted enough to
	// paint as a real value. Below it → the honest no-data swatch (n<30 lesson).
	const MIN_TRUSTED_OBS = 30;

	// Index the sparse cells by "shift|day_type" for O(1) grid lookup. A plain record
	// (not a Map) keeps this a pure derived value with no reactivity.
	const crosstabIndex = $derived.by(() => {
		const index: Record<string, (typeof vm.byShiftDaytype)[number]> = {};
		for (const cell of vm.byShiftDaytype) index[`${cell.shift}|${cell.day_type}`] = cell;
		return index;
	});

	type HeatCell = {
		readonly shift: string;
		readonly dayType: string;
		/** Real OTP % when trusted (cell present, OTP non-null, obs >= MIN_TRUSTED_OBS). */
		readonly otp: number | null;
		/** Whether this cell paints a real value (vs the no-data swatch). */
		readonly trusted: boolean;
		/** Observation count when the contract carried it (for the tooltip). */
		readonly obs: number | null;
		/** Avg delay for the tooltip secondary reading (when present). */
		readonly avgDelay: string | null;
		/** The cell fill — a fixed-domain ramp token, or the no-data swatch. */
		readonly fill: string;
		/** The bucket glyph (paired with colour) — or the no-data glyph. */
		readonly glyph: string;
		/** The visible cell label: the OTP %, or the no-data text. */
		readonly display: string;
	};

	// 5 sequential OTP bucket glyphs (low→high fill) paired with the heatmap ramp so
	// colour is never the sole channel; the no-data glyph is distinct (the honesty mark).
	const OTP_BUCKET_GLYPH = ['░', '▒', '▓', '▔', '█'] as const;
	const NODATA_GLYPH = '◌';

	// Map an OTP % through the FIXED zero-based OTP_DOMAIN → a [0,1] ramp position. This
	// is an ABSOLUTE domain literal, NOT the in-view best cell, so colour is stable.
	const [OTP_LO, OTP_HI] = OTP_DOMAIN;
	function otpRampPos(otp: number): number {
		return (otp - OTP_LO) / (OTP_HI - OTP_LO);
	}
	function otpBucketGlyph(otp: number): string {
		const pos = Math.min(1, Math.max(0, otpRampPos(otp)));
		const idx = Math.min(OTP_BUCKET_GLYPH.length - 1, Math.floor(pos * OTP_BUCKET_GLYPH.length));
		return OTP_BUCKET_GLYPH[idx];
	}

	// The resolved grid: one ROW per shift (canonical clock order), one COLUMN per
	// day-type (weekday→weekend). Cells with no observations / null OTP / too few obs
	// are greyed honestly, not coloured.
	const heatRows = $derived(
		SHIFT_GRAIN_ORDER.map((shift) => ({
			shift,
			label: shiftLabel(shift),
			cells: DAY_TYPE_GRAIN_ORDER.map((dayType): HeatCell => {
				const cell = crosstabIndex[`${shift}|${dayType}`];
				const rawOtp = cell?.otp_pct ?? null;
				const obs = cell?.observation_count ?? null;
				// Trust requires a real OTP AND enough observations to back it.
				const trusted = rawOtp != null && obs != null && obs >= MIN_TRUSTED_OBS;
				const otp = trusted ? rawOtp : null;
				return {
					shift,
					dayType,
					otp,
					trusted,
					obs,
					avgDelay: min(cell?.avg_delay_min),
					fill: trusted ? heatmapColor(otpRampPos(rawOtp)) : HEATMAP_NODATA,
					glyph: trusted ? otpBucketGlyph(rawOtp) : NODATA_GLYPH,
					display: trusted ? (pct(rawOtp) ?? copy.strip.noData) : copy.strip.noData,
				};
			}),
		})),
	);

	// The single strongest (highest-OTP) trusted cell, annotated as the standout. A flat
	// reduce over the fixed grid — no Math.max over a spread set (doctrine-clean).
	const hottestKey = $derived.by<string | null>(() => {
		let bestKey: string | null = null;
		let bestOtp = -Infinity;
		for (const row of heatRows) {
			for (const cell of row.cells) {
				if (cell.otp != null && cell.otp > bestOtp) {
					bestOtp = cell.otp;
					bestKey = `${cell.shift}|${cell.dayType}`;
				}
			}
		}
		return bestKey;
	});

	// The heatmap renders only when SOME cell is trusted — else the whole grid would be
	// a wall of no-data (its honest-empty path: the section is omitted entirely).
	const hasCrosstab = $derived(
		vm.byShiftDaytype.length > 0 && heatRows.some((r) => r.cells.some((c) => c.trusted)),
	);
	const dayTypeColLabels = $derived(
		DAY_TYPE_GRAIN_ORDER.map((d) => ({ key: d, label: dayTypeGrainLabel(d, locale) })),
	);

	// Heatmap scale legend — three sequential OTP buckets (low→high) + the dedicated
	// no-data swatch, so the legend reads as an ordered fixed-domain scale. Swatches are
	// data marks (--dataviz-heatmap-*); the caption is the a11y source of truth.
	const crosstabLegend = $derived([
		{ colorVar: HEATMAP_RAMP[0], label: copy.crosstab.legend.low, swatch: 'square' as const },
		{ colorVar: HEATMAP_RAMP[2], label: copy.crosstab.legend.mid, swatch: 'square' as const },
		{
			colorVar: HEATMAP_RAMP[HEATMAP_RAMP.length - 1],
			label: copy.crosstab.legend.high,
			swatch: 'square' as const,
		},
		{ colorVar: HEATMAP_NODATA, label: copy.crosstab.legend.noData, swatch: 'square' as const },
	]);

	// A cell's full tooltip / SR text: the (shift, day-type) heading + the OTP reading
	// or the honest no-data reason, plus the observation count + avg delay when present.
	function heatCellTitle(row: { label: string }, cell: HeatCell): string {
		const where = `${row.label} · ${dayTypeGrainLabel(cell.dayType, locale)}`;
		if (!cell.trusted) {
			// Distinguish "no observations at all" from "too few to trust" (n<30).
			const reason =
				cell.obs != null && cell.obs > 0 ? copy.crosstab.lowSample : copy.crosstab.legend.noData;
			const obsPart = cell.obs != null ? ` (${copy.crosstab.obs(cell.obs)})` : '';
			return `${where}: ${reason}${obsPart}`;
		}
		const parts = [`${copy.strip.otpPct} ${cell.display}`];
		if (cell.obs != null) parts.push(copy.crosstab.obs(cell.obs));
		if (cell.avgDelay != null) parts.push(`${copy.strip.avgDelayMin}: ${cell.avgDelay}`);
		return `${where}: ${parts.join(', ')}`;
	}
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
					value={pct(headline?.otp_pct)}
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
					value={min(headline?.avg_delay_min)}
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
			{#if hasDist}
				<Distribution
					stats={distStats}
					domain={delayDistDomain}
					unit=" min"
					fillVar={statusVar('late')}
					label={copy.strip.delayDistLabel}
					axisLabel={copy.strip.delayDistLabel}
					showAxis
					interactive
				/>
				<p class="cluster-caption" data-slot="delay-dist-caption">{copy.strip.delayDistCaption}</p>
			{/if}
		</div>

		<!-- OTP trend across the dated day series (green) vs avg-delay retard (amber). -->
		{#if hasTrend}
			<div class="cluster-block">
				<div class="cluster-block-head">
					<SectionLabel text={copy.strip.otpPct} variant="metric" />
					<span class="cluster-block-window" data-slot="trend-window">{copy.windows.trend}</span>
				</div>
				<TrendLine
					onTime={otpSeries}
					retard={retardSeries}
					domain={[0, 100]}
					{retardDomain}
					band={hasWilsonBand ? { lo: wilsonLoSeries, hi: wilsonHiSeries } : undefined}
					target={80}
					{xLabels}
					onTimeLabel={copy.strip.otpPct}
					retardLabel={copy.strip.avgDelayMin}
					yAxis={{ label: copy.strip.otpPct, unit: copy.units.pct, domain: [0, 100] }}
					retardAxis={{ label: copy.strip.avgDelayMin, unit: copy.units.min, domain: retardDomain }}
					showYTicks
					showXTicks
					interactive
					readout
					readoutHint={copy.strip.trendReadoutHint}
				/>
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
		{#if rankedStops.length > 0}
			<div class="cluster-block">
				<div class="weak-stops-head">
					<span class="label-with-info">
						<SectionLabel text={weakStopsHeading} variant="metric" />
						{@render metricInfo('weakStops', copy.strip.weakStopsHeading)}
					</span>
					{#if weakStopsTotal > 5}
						<GrainPicker
							segments={WORST_N_SEGMENTS}
							bind:value={worstN}
							label={copy.strip.worstNLabel}
						/>
					{/if}
				</div>
				<p class="cluster-caption" data-slot="weak-stops-window">{copy.windows.weakStops}</p>
				<div class="cluster-ranked" data-slot="weak-stops-list" role="list">
					{#each rankedStops as row (row.key)}
						<RankedRow
							rank={row.rank}
							title={row.title}
							severity={row.severity}
							value={row.value}
							domain={DELAY_POS_DOMAIN}
							unit=" min"
							display={row.display}
						/>
					{/each}
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
						<StripPlot
							rows={shiftStripRows}
							order="given"
							domain={SEVERE_DOMAIN}
							mean={shiftSevereMean}
							meanLabel={shiftMeanLabel}
							label={copy.peak.strip.ariaLabel}
						/>
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
		{#if hasCrosstab}
			<div class="cluster-block" data-slot="shift-daytype-crosstab">
				<span class="label-with-info">
					<SectionLabel text={copy.crosstab.heading} variant="metric" />
					{@render metricInfo('otp', copy.crosstab.heading)}
				</span>
				<table class="cluster-heatmap" aria-label={copy.crosstab.heatmapLabel}>
					<thead>
						<tr>
							<th scope="col" class="cluster-heatmap__corner">
								<span class="sr-only">{copy.crosstab.shiftHeader}</span>
							</th>
							{#each dayTypeColLabels as col (col.key)}
								<th scope="col" class="cluster-heatmap__colhead">{col.label}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each heatRows as row (row.shift)}
							<tr>
								<th scope="row" class="cluster-heatmap__rowhead">{row.label}</th>
								{#each row.cells as cell (cell.dayType)}
									{@const isHottest = `${cell.shift}|${cell.dayType}` === hottestKey}
									<td
										class="cluster-heatmap__cell"
										class:cluster-heatmap__cell--empty={!cell.trusted}
										class:cluster-heatmap__cell--hottest={isHottest}
										data-empty={!cell.trusted}
										data-hottest={isHottest || undefined}
									>
										<span
											class="cluster-heatmap__swatch"
											style="--cell-fill: {cell.fill};"
											role="img"
											aria-label={heatCellTitle(row, cell)}
											title={heatCellTitle(row, cell)}
										>
											<span class="cluster-heatmap__glyph" aria-hidden="true">{cell.glyph}</span>
											<span class="cluster-heatmap__value">{cell.display}</span>
											{#if isHottest}
												<span class="cluster-heatmap__star" aria-hidden="true">★</span>
												<span class="sr-only">{copy.crosstab.hottest}</span>
											{/if}
										</span>
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
				<ChartLegend items={crosstabLegend} />
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
	.cluster-heatmap {
		width: 100%;
		border-collapse: separate;
		/* 1px channel gaps between cells (the heatmap reads as a tiled grid). */
		border-spacing: 1px;
		font-size: var(--text-small);
	}
	.cluster-heatmap__corner {
		width: 1%;
	}
	.cluster-heatmap__colhead {
		padding: 0 0 0.4rem;
		text-align: center;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-weight: 500;
		color: var(--muted-foreground);
	}
	.cluster-heatmap__rowhead {
		padding: 0 0.6rem 0 0;
		text-align: right;
		white-space: nowrap;
		font-weight: 500;
		color: var(--foreground);
	}
	.cluster-heatmap__cell {
		padding: 0;
	}
	/* The swatch: a fixed-domain ramp fill (data mark), the value + glyph stacked. The
	   glyph + value sit on a translucent scrim so they stay AA-legible on any ramp stop. */
	.cluster-heatmap__swatch {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.1rem;
		min-height: 3rem;
		padding: 0.35rem 0.5rem;
		border-radius: 3px;
		background: var(--cell-fill);
		color: var(--foreground);
		text-align: center;
	}
	.cluster-heatmap__glyph {
		font-size: var(--text-small);
		line-height: 1;
		opacity: 0.85;
	}
	.cluster-heatmap__value {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		/* A subtle scrim chip keeps the value AA-legible across the ramp. */
		padding: 0.05rem 0.3rem;
		border-radius: 2px;
		background: color-mix(in srgb, var(--background) 70%, transparent);
	}
	/* Honest no-data swatch: quiet muted reading, the explicit message, never a "·"/0. */
	.cluster-heatmap__cell--empty .cluster-heatmap__value {
		font-family: var(--font-mono);
		font-weight: 500;
		color: var(--muted-foreground);
		background: transparent;
		padding: 0;
	}
	/* The standout: the highest-OTP trusted cell gets a calm ring + a star marker. The
	   ring is a neutral focus affordance, NOT a data colour (the fill carries the data). */
	.cluster-heatmap__cell--hottest .cluster-heatmap__swatch {
		outline: 2px solid var(--foreground);
		outline-offset: -2px;
	}
	.cluster-heatmap__star {
		font-size: var(--text-micro);
		line-height: 1;
		color: var(--foreground);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
