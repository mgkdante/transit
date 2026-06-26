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
	import type { SeverityCode } from '$lib/v1/schemas';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { AbsentValue, MaybeValue } from '$lib/components/edge';
	import {
		SeverityBar,
		RankedRow,
		StripPlot,
		ChartLegend,
		severityVar,
		HEATMAP_NODATA,
	} from '$lib/components/dataviz';
	import type { StripPlotRow } from '$lib/components/dataviz';
	import { Chart } from '$lib/components/dataviz/chart';
	import { selectPunctualityTrend } from './selectors/punctualityTrend';
	import { selectPunctualityDistribution } from './selectors/punctualityDistribution';
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
		selectPunctualityDistribution(vm, locale, { title: copy.strip.delayDistHeading, unit: ' s' }),
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
		/**
		 * Data-bar length (0–100%): the OTP's POSITION on a fixed, threshold-tuned scale
		 * ([60,100]%, so the 80% target sits at the midpoint). The research's #1 finding —
		 * position/length out-reads colour — so the bar is the primary value channel, the
		 * number the exact read, and the diverging colour a redundant fast-scan layer.
		 */
		readonly barPct: number;
		/** The bucket glyph (paired with colour) — or the no-data glyph. */
		readonly glyph: string;
		/** The visible cell label: the OTP %, or the no-data text. */
		readonly display: string;
	};

	// 5 sequential OTP bucket glyphs (low→high fill) paired with the heatmap ramp so
	// colour is never the sole channel; the no-data glyph is distinct (the honesty mark).
	const OTP_BUCKET_GLYPH = ['░', '▒', '▓', '▔', '█'] as const;
	const NODATA_GLYPH = '◌';

	// OTP hugs a threshold (real values cluster ~80-95%), so a sequential ramp over the
	// fixed [0,100] domain crushes every cell into ONE step (all the same colour) AND
	// paints a great 94% alarm-red. Use a DIVERGING scale around the 80% target instead
	// (the spec's call for OTP-near-threshold): at/above target leans to the on-time
	// GREEN (intensity by how far above), below leans to the late RED — a FIXED centre +
	// endpoints (target + OTP_DOMAIN), so colour is stable across routes, never the in-
	// view best cell. Solid pre-mixed token (color-mix to the signage bg, never alpha).
	const [OTP_LO, OTP_HI] = OTP_DOMAIN;
	const OTP_TARGET = 80;
	function otpCellColor(otp: number): string {
		if (otp >= OTP_TARGET) {
			const t = Math.min(1, (otp - OTP_TARGET) / (OTP_HI - OTP_TARGET));
			return `color-mix(in oklab, var(--dataviz-status-on-time) ${Math.round(28 + t * 60)}%, var(--signage-bg))`;
		}
		const t = Math.min(1, (OTP_TARGET - otp) / (OTP_TARGET - OTP_LO));
		return `color-mix(in oklab, var(--dataviz-status-late) ${Math.round(28 + t * 60)}%, var(--signage-bg))`;
	}
	// The glyph spreads over a MEANINGFUL OTP span (60-100%) so it differentiates the
	// clustered-high range too (colour is never the sole channel). A fuller glyph = a
	// higher OTP, agreeing with the green direction.
	function otpBucketGlyph(otp: number): string {
		const pos = Math.min(1, Math.max(0, (otp - 60) / (OTP_HI - 60)));
		const idx = Math.min(OTP_BUCKET_GLYPH.length - 1, Math.floor(pos * OTP_BUCKET_GLYPH.length));
		return OTP_BUCKET_GLYPH[idx];
	}
	// The data-bar length: the OTP's POSITION on the threshold-tuned [60,100] scale (60 =
	// empty, the 80% target = midpoint, 100 = full). Non-zero-anchored ON PURPOSE so the
	// clustered 80-95% range still differentiates by length; the exact % is always printed
	// beside it (the research's "label every cell" rule), so the bar never misleads.
	function otpBarPct(otp: number): number {
		return Math.min(100, Math.max(0, ((otp - 60) / (OTP_HI - 60)) * 100));
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
					fill: trusted ? otpCellColor(rawOtp) : HEATMAP_NODATA,
					barPct: trusted ? otpBarPct(rawOtp) : 0,
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
		{
			colorVar: 'color-mix(in oklab, var(--dataviz-status-late) 80%, var(--signage-bg))',
			label: copy.crosstab.legend.low,
			swatch: 'square' as const,
		},
		{
			colorVar: 'color-mix(in oklab, var(--dataviz-status-on-time) 28%, var(--signage-bg))',
			label: copy.crosstab.legend.mid,
			swatch: 'square' as const,
		},
		{
			colorVar: 'color-mix(in oklab, var(--dataviz-status-on-time) 85%, var(--signage-bg))',
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
							barInteractive
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
							interactive
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
											class="cluster-heatmap__databar"
											style="--bar-len: {cell.barPct}%; --cell-fill: {cell.fill};"
											role="img"
											aria-label={heatCellTitle(row, cell)}
											title={heatCellTitle(row, cell)}
										>
											<!-- The bar LENGTH is the primary value channel (research #1);
											     the diverging colour is a redundant fast-scan layer. -->
											<span class="cluster-heatmap__fill" aria-hidden="true"></span>
											<span class="cluster-heatmap__label">
												<span class="cluster-heatmap__glyph" aria-hidden="true">{cell.glyph}</span>
												<span class="cluster-heatmap__value">{cell.display}</span>
												{#if isHottest}
													<span class="cluster-heatmap__star" aria-hidden="true">★</span>
													<span class="sr-only">{copy.crosstab.hottest}</span>
												{/if}
											</span>
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
	/* The data bar: a neutral track with a LEFT-ANCHORED fill whose width is the OTP's
	   position on the [60,100] scale — the primary value channel (position/length out-
	   reads colour). The label (glyph + % + star) rides on top, left-aligned, on a subtle
	   scrim so it stays AA-legible over any fill stop. The diverging colour is now a
	   redundant fast-scan layer, not the value. */
	.cluster-heatmap__databar {
		position: relative;
		display: flex;
		align-items: center;
		min-height: 2.5rem;
		padding: 0.3rem 0.5rem;
		border-radius: 3px;
		background: var(--muted);
		color: var(--foreground);
		overflow: hidden;
	}
	.cluster-heatmap__fill {
		position: absolute;
		inset-block: 0;
		inset-inline-start: 0;
		width: var(--bar-len, 0%);
		background: var(--cell-fill);
	}
	.cluster-heatmap__label {
		position: relative;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
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
		/* A subtle scrim chip keeps the value AA-legible over the fill OR the track. */
		padding: 0.05rem 0.3rem;
		border-radius: 2px;
		background: color-mix(in srgb, var(--background) 70%, transparent);
	}
	/* Honest no-data cell: a flat muted track, no fill, the explicit message (never 0). */
	.cluster-heatmap__cell--empty .cluster-heatmap__databar {
		background: color-mix(in oklab, var(--muted) 55%, var(--signage-bg));
	}
	.cluster-heatmap__cell--empty .cluster-heatmap__value {
		font-weight: 500;
		color: var(--muted-foreground);
		background: transparent;
		padding: 0;
	}
	/* The standout: the highest-OTP trusted cell gets a calm ring + a star marker. The
	   ring is a neutral focus affordance, NOT a data colour (the fill carries the data). */
	.cluster-heatmap__cell--hottest .cluster-heatmap__databar {
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
