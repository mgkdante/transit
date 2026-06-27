// ChartSpec — the ONE typed contract between a selector and the ONE `<Chart>` renderer.
//
// WHY THIS EXISTS (S7 re-seaming): the reliability surface used to hand-roll one
// raw-SVG primitive per visual, each scaling itself. The Chart Doctrine's law #1 is
// that every cross-view MAGNITUDE mark renders on an EXPLICIT absolute zero-based
// domain (never `/max`, never `d3.extent`) so the same value reads the same length on
// every route / grain / refresh. A regex gate can ban `/max` in source, but it is
// BLIND to a LayerChart adapter that could silently auto-derive an extent. So we lift
// the invariant into the TYPE SYSTEM: a selector emits a `ChartSpec`, and every
// magnitude kind is structurally REQUIRED to carry an absolute `domain`. The one
// `<Chart>` renderer consumes the spec; it cannot invent a scale because the spec owns
// it. The spec is domain-AGNOSTIC — it types `domain: AbsoluteDomain` (a `[lo,hi]`
// tuple); the selector supplies the literal from `features/reliability/domains.ts`, so
// `components/` never imports `features/` (layering stays one-way).
//
// FAT, by design: EVERY visual emits a spec — including the kinds the renderer
// delegates to an existing primitive that already wins (heatmap stays per-row,
// stacked-share stays part-to-whole, metric stays a tile, absence stays AbsentValue).
// Covering them in the union means the absolute-domain + null-policy invariants are
// enforced UNIFORMLY by the compiler, even where LayerChart is not the mark.
//
// NULL POLICY (Chart Doctrine §2.4 / §13.3): null ≠ 0. A per-datum `value: number|null`
// renders an absent slot (typed grey, never a zero-height/full-height bar). A whole mark
// with no data is its own `absence` spec carrying an `AbsenceReasonKey`. The renderer
// NEVER paints a missing value as 0, a flat line, or a pale low colour.

import type { AbsenceReasonKey } from '$lib/site/absence';
import type { Locale } from '$lib/i18n/config';
import type { OccupancyCode, SeverityCode, StatusCode } from '$lib/v1/schemas';

/**
 * An explicit, absolute chart domain `[lo, hi]`. Comes from a `domains.ts` literal —
 * never `Math.max(...inView)`, never `d3.extent`, never a per-view max. For pure
 * magnitude marks `lo` is 0 (zero baseline); the one exception is a SIGNED histogram,
 * whose domain straddles 0 (`lo < 0 < hi`) — still anchored AT 0, just diverging.
 */
export type AbsoluteDomain = readonly [number, number];

/** Discriminant for the `ChartSpec` union. */
export type ChartKind =
	| 'magnitude-bars'
	| 'dot-strip'
	| 'dumbbell'
	| 'line'
	| 'trend'
	| 'cycle'
	| 'histogram'
	| 'bullet'
	| 'metric'
	| 'stacked-share'
	| 'heatmap'
	| 'absence';

/**
 * The MAGNITUDE kinds — cross-view marks whose LENGTH/POSITION encodes the value, so
 * they are structurally required to carry an absolute `domain` (Chart Doctrine §6.2.3
 * / §7.1.2). `stacked-share` (self-normalising to 100%) and `heatmap` (sequential
 * luminance / quantile bins) ride a different channel and are EXEMPT — see the union.
 */
export const MAGNITUDE_KINDS = [
	'magnitude-bars',
	'dot-strip',
	'dumbbell',
	'line',
	'trend',
	'cycle',
	'histogram',
	'bullet',
] as const satisfies readonly ChartKind[];

export type MagnitudeKind = (typeof MAGNITUDE_KINDS)[number];

/** Fields every spec shares — the accessible identity + the plain caption. */
interface ChartSpecBase {
	/** Accessible name describing data + takeaway (never an i18n key). */
	readonly title: string;
	/** Plain-language caption beneath the mark (what it measures, the baseline). */
	readonly caption?: string;
	readonly locale: Locale;
}

/** A datum that may be absent, with a typed reason (renders the grey no-data slot). */
export interface MagnitudeDatum {
	readonly key: string;
	readonly label: string;
	/** null ⇒ absent slot — drawn at baseline as a labelled no-data swatch, never 0. */
	readonly value: number | null;
	/** Sample size, surfaced as `n=` and used by the MIN_N degradation ladder. */
	readonly n?: number | null;
	/** Wilson 95% bounds — the lower bound is the rank key when `sort: 'wilson-lower'`. */
	readonly wilsonLo?: number | null;
	readonly wilsonHi?: number | null;
	readonly severity?: SeverityCode;
	readonly status?: StatusCode;
	/** Optional drill link — clicking the row navigates here (e.g. the stop's page). */
	readonly href?: string;
	/** Optional secondary tooltip line (e.g. "median 0.4 min · n=120"). */
	readonly note?: string;
	/** Reason for an absent datum, shown on hover / in the no-data slot. */
	readonly absentReason?: AbsenceReasonKey;
}

/**
 * A13/A12 — sorted horizontal bars OR lollipops, worst-on-top, zero-based unit-titled
 * axis. Rank by Wilson lower bound (never the point estimate). Cap + "show all".
 */
export interface MagnitudeBarsSpec extends ChartSpecBase {
	readonly kind: 'magnitude-bars';
	readonly mark: 'bar' | 'lollipop';
	readonly domain: AbsoluteDomain;
	readonly unit: string;
	/** Localized value-axis (x) title. */
	readonly xLabel?: string;
	readonly rows: readonly MagnitudeDatum[];
	readonly sort: 'wilson-lower' | 'given';
	/** Colour family for the fill — always a dataviz scale, never an affordance token. */
	readonly scale: 'status' | 'severity' | 'occupancy';
}

/** One observation in a dot-strip. */
export interface DotStripDatum {
	readonly key: string;
	readonly group: string;
	readonly value: number | null;
	readonly status?: StatusCode;
	readonly severity?: SeverityCode;
	readonly n?: number | null;
	readonly absentReason?: AbsenceReasonKey;
}

/**
 * A8 — dot / lollipop strip, NEVER connected. Each observation is one dot at its value;
 * deterministic jitter only (hashJitter, never Math.random). Optional median reference.
 */
export interface DotStripSpec extends ChartSpecBase {
	readonly kind: 'dot-strip';
	readonly domain: AbsoluteDomain;
	readonly unit: string;
	readonly points: readonly DotStripDatum[];
	readonly medianRef?: number | null;
	readonly scale: 'status' | 'severity';
}

/** One point on the trend line. `x` is epoch-ms (time scale) or a band label. */
export interface TrendDatum {
	readonly x: number | string;
	/** Display label for this point (tooltip heading / x-tick) — e.g. a date or shift name. */
	readonly xLabel: string;
	/** Primary series value (e.g. OTP %). null ⇒ the line BREAKS here (never bridged). */
	readonly y: number | null;
	/** Secondary series value (e.g. retard min) when `secondary` is set. */
	readonly y2?: number | null;
	/** Wilson band bounds for the primary series at this point (PERCENT). */
	readonly bandLo?: number | null;
	readonly bandHi?: number | null;
	readonly n?: number | null;
}

/**
 * A3 — line + point markers on a TRUE x-scale (time or band). Primary y pinned to an
 * absolute domain (e.g. OTP [0,100]); an optional secondary series rides its OWN pinned
 * domain (e.g. retard [0,8]) so the two never squash each other. Wilson 95% band follows
 * the primary. Gaps (null y) BREAK the line. Line only when realPoints ≥ minPointsForLine
 * AND every period n ≥ minN; otherwise unconnected dots.
 */
export interface TrendSpec extends ChartSpecBase {
	readonly kind: 'trend';
	readonly xScale: 'time' | 'band';
	readonly domain: AbsoluteDomain;
	readonly unit: string;
	/** Accessible label for the primary series (e.g. "On-time %"). */
	readonly label: string;
	readonly points: readonly TrendDatum[];
	readonly hasBand: boolean;
	/** Optional horizontal reference on the primary domain (e.g. 80 = the 80% OTP target). */
	readonly target?: number | null;
	readonly secondary?: {
		readonly domain: AbsoluteDomain;
		readonly unit: string;
		readonly label: string;
	};
	readonly minPointsForLine: number;
	readonly minN: number;
}

/** One weekday panel of a cycle plot (a mini across-weeks series + its mean). */
export interface CyclePanelSpec {
	readonly key: string;
	readonly label: string;
	readonly points: readonly (number | null)[];
	readonly mean: number | null;
	readonly severe?: number | null;
	readonly n?: number | null;
	readonly absentReason?: AbsenceReasonKey;
}

/**
 * B9 — cycle plot: weekday panels Mon→Sun, each a mini-line + its mean rule, all sharing
 * ONE fixed y-axis; a 7-point line over day-of-week is forbidden (implies Sun→Mon
 * continuity). A second pinned domain carries the severe-share bar.
 */
export interface CycleSpec extends ChartSpecBase {
	readonly kind: 'cycle';
	readonly domain: AbsoluteDomain;
	readonly severeDomain: AbsoluteDomain;
	readonly unit: string;
	readonly panels: readonly CyclePanelSpec[];
}

/** One histogram bin — left-closed/right-open in the value unit. */
export interface HistogramBin {
	/** null lo ⇒ the (-∞, hi) underflow bin; null hi ⇒ the [lo, +∞) overflow bin. */
	readonly lo: number | null;
	readonly hi: number | null;
	readonly count: number;
}

/**
 * A1 — signed-delay distribution histogram. Bars on a SIGNED domain anchored at 0
 * (early left / on-time at 0 / late right), diverging colour at exactly 0. Median + p90
 * reference lines; NO mean (skew makes it lie); never KDE/violin. The whole mark is
 * absent (its own `absence` spec) when there is no in-window distribution.
 */
export interface HistogramSpec extends ChartSpecBase {
	readonly kind: 'histogram';
	/** Signed domain straddling 0 (e.g. [-300, 1800] sec or [-5, 30] min). */
	readonly domain: AbsoluteDomain;
	/**
	 * The COUNT y-axis domain `[0, maxCount]`. A histogram is read by SHAPE within ONE
	 * distribution — it is NOT a cross-view magnitude comparison (you never compare this
	 * route's "30-60s bin" height to another's), so the Lie-Factor law (scoped to cross-view
	 * length) does not bind it; the selector supplies the distribution's own max so the
	 * shape is readable. Still zero-based, still explicit — the renderer never derives it.
	 */
	readonly countDomain: AbsoluteDomain;
	readonly unit: string;
	/** Localized x-axis title (e.g. "Delay (min)"). */
	readonly xLabel?: string;
	/** Localized y-axis title (e.g. "Trips"). */
	readonly yLabel?: string;
	readonly bins: readonly HistogramBin[];
	readonly medianRef?: number | null;
	readonly p90Ref?: number | null;
}

/**
 * A2 — bullet graph: a single measured value on a zero-based bar with a target tick,
 * showing where a KPI sits on its fixed domain. Rendered by BulletMark (LayerChart).
 */
export interface BulletSpec extends ChartSpecBase {
	readonly kind: 'bullet';
	readonly domain: AbsoluteDomain;
	readonly unit: string;
	readonly value: number | null;
	readonly target?: number | null;
	readonly bands?: readonly number[];
	readonly n?: number | null;
	readonly absentReason?: AbsenceReasonKey;
	/** Qualitative tone of the value bar — the dataviz STATUS scale (never --primary). */
	readonly tone?: 'good' | 'warn' | 'bad' | 'neutral';
	/** Axis / aria label for the measured value (e.g. "On-time %"). */
	readonly xLabel?: string;
	/** Plain-language label for the target tick in the tooltip (e.g. "target"). */
	readonly targetLabel?: string;
}

/**
 * B1 — a scalar metric tile (big number + context). Paints NO data mark, so it carries
 * no domain. Delegated to MetricDisplay / ExplainedMetricCard. Honest absence via the
 * reason, never `0.0`.
 */
export interface MetricSpec extends ChartSpecBase {
	readonly kind: 'metric';
	readonly value: string | null;
	readonly label: string;
	readonly explanation?: string;
	readonly absentReason?: AbsenceReasonKey;
}

/** One band of a 100%-stacked part-to-whole strip. */
export interface ShareSegment {
	readonly key: string;
	readonly label: string;
	/** Share of the whole in [0,100]. */
	readonly share: number;
	readonly occupancy?: OccupancyCode;
	readonly status?: StatusCode;
	readonly glyph?: string;
}

/**
 * A7/A9/A10 — single 100%-stacked horizontal bar (part-to-whole). EXEMPT from the
 * absolute-magnitude domain law: it is self-normalising to 100% (each segment's length
 * IS its share of the whole), and order rides sequential luminance / fixed band order,
 * not a cross-view length scale. Delegated to StackedBar.
 */
export interface StackedShareSpec extends ChartSpecBase {
	readonly kind: 'stacked-share';
	readonly scale: 'status' | 'occupancy';
	readonly segments: readonly ShareSegment[];
}

/** One cell of a heatmap grid. */
export interface HeatmapCell {
	/** null ⇒ the typed no-data swatch (distinct grey, NEVER bucket-0 / the ramp end). */
	readonly value: number | null;
	readonly absentReason?: AbsenceReasonKey;
}

/**
 * The CLASSED-TIER legend for a heatmap (B10, S7 P4). The mark bins each cell's value
 * onto N DISCRETE tiers (NOT a continuous ramp) on a perceptually-uniform, CVD-safe
 * sequential scale, and labels each tier in plain language so the read never rests on
 * hue alone (the worst tier ALSO carries a glyph). `tierLabels[0]` is the calmest tier,
 * the last index the worst.
 */
export interface HeatmapTiers {
	/** Plain-language label per tier, calmest → worst (length === the tier count). */
	readonly tierLabels: readonly string[];
	/** Label for a no-data cell (the honest absence swatch). */
	readonly noDataLabel: string;
	/** Glyph stamped on the WORST tier — colour is never the sole channel (a11y). */
	readonly worstGlyph?: string;
}

/** A sparse column-axis tick (e.g. clock hours) — its band index + the formatted label. */
export interface HeatmapColTick {
	readonly index: number;
	readonly label: string;
}

/**
 * B10 — heatmap. EXEMPT from the absolute zero-based length law: magnitude rides
 * sequential luminance, not length. Two honest scaling modes:
 *  - `absolute`: a fixed quantile/linear domain across all cells (e.g. the §01 shift ×
 *    day-type OTP crosstab pinned to [0,100], or §05 habits on the route-normalised [0,1]).
 *  - `row-relative`: each row normalised within itself, BY DESIGN, because the underlying
 *    metric is already a within-row relative score.
 * The mode is explicit so a row-relative read can never be mistaken for an absolute one.
 *
 * The classed-tier mark (P4) consumes the OPTIONAL presentation fields below; older
 * heatmap call sites omit them and fall back to a raw read. A magnitude value is binned
 * onto `tiers.tierLabels` over `domain` (so the same value reads the same tier on every
 * route/refresh — never `/max`, never a per-view quantile).
 */
export interface HeatmapSpec extends ChartSpecBase {
	readonly kind: 'heatmap';
	readonly mode: 'absolute' | 'row-relative';
	/** Required when `mode: 'absolute'`. */
	readonly domain?: AbsoluteDomain;
	readonly rowLabels: readonly string[];
	readonly colLabels: readonly string[];
	readonly cells: readonly (readonly HeatmapCell[])[];
	/** Classed-tier legend (plain-language labels + worst-tier glyph). */
	readonly tiers?: HeatmapTiers;
	/** What a single cell value encodes, for the tooltip + SR table (e.g. "Repeat problems"). */
	readonly valueLabel?: string;
	/** Row (y) axis caption (e.g. "Day of week"). */
	readonly rowAxisLabel?: string;
	/** Column (x) axis caption (e.g. "Hour of day"). */
	readonly colAxisLabel?: string;
	/** Full row names for the tooltip heading + SR table (defaults to `rowLabels`). */
	readonly fullRowLabels?: readonly string[];
	/** Sparse column ticks (a subset of columns), so a 24-hour axis stays legible. */
	readonly colTicks?: readonly HeatmapColTick[];
}

/**
 * A whole-mark stand-down: there is no data to draw, and we say WHY via the unknown-data
 * layer (renders AbsentValue). Never an empty axis, never a zeroed mark.
 */
export interface AbsenceSpec extends ChartSpecBase {
	readonly kind: 'absence';
	readonly reason: AbsenceReasonKey;
	readonly params?: Record<string, string | number>;
	readonly variant?: 'inline' | 'block';
}

/** One row of a dumbbell — two values (scheduled vs observed) sharing a label. */
export interface DumbbellDatum {
	readonly key: string;
	readonly label: string;
	/** Reference endpoint (e.g. scheduled headway, min). */
	readonly scheduled: number | null;
	/** Actual endpoint (e.g. observed headway, min) — the severity-coloured dot. */
	readonly observed: number | null;
	/** The gap (e.g. excess wait, min) — for the tooltip. */
	readonly excess?: number | null;
	/** Severity of the OBSERVED endpoint (drives its dot colour). */
	readonly severity?: SeverityCode;
	/** Optional secondary tooltip line (e.g. "CoV 0.4 · 28% bunched"). */
	readonly note?: string;
	readonly absentReason?: AbsenceReasonKey;
}

/**
 * A dumbbell / connected-dot plot (A8): one row per category, two endpoints joined by a
 * connector so the GAP reads at a glance (scheduled ●——● observed headway). A magnitude
 * kind — the value axis is the same fixed zero-based domain for both endpoints.
 */
export interface DumbbellSpec extends ChartSpecBase {
	readonly kind: 'dumbbell';
	readonly domain: AbsoluteDomain;
	readonly unit: string;
	/** Localized value-axis (x) title. */
	readonly xLabel?: string;
	readonly rows: readonly DumbbellDatum[];
	/** Colour family for the observed dot — always a dataviz scale. */
	readonly scale: 'status' | 'severity' | 'occupancy';
	/** Legend / tooltip label for the reference (scheduled) endpoint. */
	readonly scheduledLabel: string;
	/** Legend / tooltip label for the actual (observed) endpoint. */
	readonly observedLabel: string;
}

/** One series of a multi-line/area chart — y-values index-aligned to LineSpec.xLabels. */
export interface LineSeries {
	readonly key: string;
	readonly label: string;
	/** y per x; null = an honest GAP (the line breaks, never connects across no-data). */
	readonly points: readonly (number | null)[];
	/** Line colour (a dataviz var / token). Defaults to the value voice. */
	readonly colorVar?: string;
	/** Dashed stroke — distinguishes a series by PATTERN, not colour alone (a11y). */
	readonly dashed?: boolean;
	/** Fill the area under the line (area chart). */
	readonly area?: boolean;
}

/**
 * The UNIVERSAL line/area chart (S7 "one chart paradigm"): N series over a shared ordered
 * categorical x (shifts / weekdays / hours), on ONE fixed zero-based y domain. Series are
 * distinguished by solid/dashed + markers + a legend (colour is never the sole channel).
 * This is the cohesive mark most reliability data converges onto; the dated dual-axis OTP
 * trend keeps its own `trend` spec (already a line).
 */
export interface LineSpec extends ChartSpecBase {
	readonly kind: 'line';
	/** The ordered x labels (categories / formatted x), index-aligned to series.points. */
	readonly xLabels: readonly string[];
	/** Zero-based y value domain (never /max). */
	readonly domain: AbsoluteDomain;
	readonly unit: string;
	readonly xLabel?: string;
	readonly yLabel?: string;
	readonly series: readonly LineSeries[];
	/** Optional reference rule (e.g. a target / all-series mean). */
	readonly target?: number | null;
}

/** The fat discriminated union — every reliability visual is one of these. */
export type ChartSpec =
	| MagnitudeBarsSpec
	| DotStripSpec
	| DumbbellSpec
	| LineSpec
	| TrendSpec
	| CycleSpec
	| HistogramSpec
	| BulletSpec
	| MetricSpec
	| StackedShareSpec
	| HeatmapSpec
	| AbsenceSpec;

/** Type guard: is this a magnitude kind (must carry an absolute domain)? */
export function isMagnitudeKind(kind: ChartKind): kind is MagnitudeKind {
	return (MAGNITUDE_KINDS as readonly ChartKind[]).includes(kind);
}

/**
 * The structural invariant the type system already enforces, re-checked at runtime for
 * the spec gate (P1.3) and for dev assertions: every magnitude spec carries an explicit
 * absolute domain `[lo, hi]` with lo ≤ hi, anchored at 0 (lo === 0) — OR, for a signed
 * histogram, a domain that straddles 0 (lo < 0 < hi). Returns an error string, or null
 * when the spec satisfies the invariant.
 */
export function checkAbsoluteDomain(spec: ChartSpec): string | null {
	if (!isMagnitudeKind(spec.kind)) return null;
	const domain = (spec as { domain?: AbsoluteDomain }).domain;
	if (!domain || domain.length !== 2) {
		return `${spec.kind} "${spec.title}" is a magnitude mark but carries no absolute [lo,hi] domain`;
	}
	const [lo, hi] = domain;
	if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
		return `${spec.kind} "${spec.title}" domain has a non-finite bound [${lo}, ${hi}]`;
	}
	if (lo > hi) {
		return `${spec.kind} "${spec.title}" domain is inverted [${lo}, ${hi}]`;
	}
	if (spec.kind === 'histogram') {
		// A signed distribution must anchor AT 0 by straddling it.
		if (!(lo < 0 && hi > 0)) {
			return `histogram "${spec.title}" must straddle 0 (signed), got [${lo}, ${hi}]`;
		}
		return null;
	}
	// Every other magnitude mark is zero-based.
	if (lo !== 0) {
		return `${spec.kind} "${spec.title}" must be zero-based (lo === 0), got [${lo}, ${hi}]`;
	}
	return null;
}
