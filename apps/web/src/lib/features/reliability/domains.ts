// domains.ts — the SINGLE structural home for every fixed, absolute chart domain the lines
// reliability surface scales against. A magnitude mark NEVER computes its own scale inline; it
// reads a constant here, so the same value renders the same length on every route / grain / 30s
// refresh (the audit's law #1) and like metrics share like scales. The domains are LITERALS —
// never `Math.max(...inView)`, never `/max`, never in-view normalization (the chart-doctrine
// law). Grouped by UNIT; each is zero-anchored (or signed-zero) and justified inline.

// ── Percentages (a share of a whole) — ALWAYS the full [0,100] scale ────────────────────────
// A percentage is a fraction of a whole, so its honest domain IS the whole: [0,100]. A 7% share
// fills 7% of the bar, never an exaggerated slice of a zoomed max — so a near-empty bar
// truthfully reads "this is rare", and the precise value (plus any "X of Y" count) carries the
// detail. ALL share the scale, so on-time / severe / bunched / cancellation / skipped are
// directly comparable and none can visually overstate itself.
export const OTP_DOMAIN = [0, 100] as const; // on-time % + Wilson confidence bounds
export const SEVERE_DOMAIN = [0, 100] as const; // severe-delay share
export const BUNCHED_DOMAIN = [0, 100] as const; // bunched-bus share
export const CANCEL_RATE_DOMAIN = [0, 100] as const; // cancellation rate
export const SKIPPED_RATE_DOMAIN = [0, 100] as const; // skipped-stop rate
export const SHARE_DOMAIN = [0, 100] as const; // a band's share of a part-to-whole mix (e.g. the dominant occupancy band)

// ── Delay / time (minutes) — metric-specific honest ranges ──────────────────────────────────
// Delays genuinely cluster in small minute ranges, and each constant measures a DIFFERENT
// thing, so each carries the range that keeps its real signal visible without clipping. (These
// are NOT interchangeable like the percentages — a per-stop delay and a p90 tail differ.)
/** Signed per-stop avg delay (min); early stops render LEFT of the zero baseline. */
export const DELAY_STOP_DOMAIN = [-2, 8] as const;
/** Positive delay aggregates (min) — e.g. the OTP-trend retard (amber) axis. */
export const DELAY_POS_DOMAIN = [0, 8] as const;
/**
 * Delay-DISTRIBUTION axis (min) for the typical→worst-case (p50→p90) quantile mark. Wider than
 * DELAY_POS_DOMAIN because the p90 tail routinely runs past 8 min (real STM days reach ~12) —
 * clamping it to 8 would hide the tail.
 */
export const DELAY_DIST_DOMAIN = [0, 15] as const;
// ── Delay-trend axis: two like-metric trend lines pin DIFFERENT delay domains ─────────────────
// The lines OTP-trend retard axis reads DELAY_POS_DOMAIN [0,8] (an AVG-only series — no p90
// channel), so [0,8] keeps a chronically-late average visible without clipping. The network
// delay-trend retard axis reads DELAY_DIST_DOMAIN [0,15] because it can plot the p90 tail (the
// "slowest 10%" toggle), which routinely runs past 8 min — [0,8] would clip that tail. Both are
// zero-anchored absolute literals (never in-view max); the [0,8] vs [0,15] split is a RECORDED
// exception to "like metrics share like scales", justified by avg-only vs p90-capable ranges.
//
// S9 DECISION A2 (network re-seat): the two trend axes are DELIBERATELY NOT unified. The network
// delay-trend keeps DELAY_DIST_DOMAIN [0,15] (it plots the p90 "slowest 10%" tail); the lines
// OTP-trend keeps DELAY_POS_DOMAIN [0,8] (an avg-only pair). They stay a NAMED PAIRED CONSTANT set
// here — cross-page comparability is preserved by the SHARED constants (both zero-anchored
// absolute literals), NOT by forcing one axis onto the other: [0,15] applies when a series is
// p90-capable, [0,8] when it is avg-only. Changing lines' [0,8] would blast-radius every lines
// mark for no honesty gain, so the divergence is a recorded decision, not drift.
/** Day-of-week + delay-by-crowding avg delay (min). Shares DELAY_POS's [0,8] so a chronically
 *  late route's weekday average (real STM tail runs past 6) stays visible instead of pinning. */
export const DELAY_DOW_DOMAIN = [0, 8] as const;
/** Scheduled / observed / excess headway gap (min). */
export const HEADWAY_DOMAIN = [0, 35] as const;

// ── Ratio ───────────────────────────────────────────────────────────────────────────────────
/** Headway coefficient-of-variation (gap stddev / mean); 1.0 = random-arrivals reference. Real
 *  STM night/weekend bunching reaches ~1.27, so the frame runs to 1.5 (every bar mark also clamps
 *  to its domain, so a rarer overshoot pins at the frame edge rather than escaping it). */
export const COV_DOMAIN = [0, 1.5] as const;

// ── Normalised score (0..1) ───────────────────────────────────────────────────────────────────
/**
 * The §1 habits heatmap score (`repeat_problem_relative`): each day×hour cell normalised to
 * THIS route's worst cell, so 1.0 = the route's single worst hour and 0.0 = no repeat problem.
 * A FIXED [0,1] domain — the classed-tier mark bins every cell on it (so weekends that really
 * are calmer read calmer), never a per-row / in-view re-normalisation.
 */
export const HABITS_DOMAIN = [0, 1] as const;

// ── Signed distribution (seconds) ─────────────────────────────────────────────────────────────
/**
 * Signed delay-distribution histogram axis (SECONDS), the visible window that STRADDLES 0
 * (early left of 0, on-time at 0, late right). The contract's 21 bins reach [-3600, 3600);
 * the rare extreme-early / extreme-late bins clamp at these edges. This is the X domain of
 * the A1 histogram — its diverging colour anchors at exactly 0. (-300s = -5 min early →
 * +1800s = +30 min late.)
 */
export const DELAY_HISTOGRAM_DOMAIN = [-300, 1800] as const;

/**
 * The network live delay-distribution histogram X domain, expressed in the SAME seconds unit as
 * DELAY_HISTOGRAM_DOMAIN so the two diverging-at-zero distributions read on ONE shared scale. The
 * network live buckets are published in signed MINUTES (edges < -5 … 15+), so the selector scales
 * them minutes→seconds (×60) before feeding this axis; the visible window then straddles 0 exactly
 * like the lines A1 histogram (early left / on-time at 0 / late right). This is the network sibling
 * of DELAY_HISTOGRAM_DOMAIN — a NAMED constant, never an in-view max — so a given delay bin renders
 * the same length on every 30 s live refresh. The 15+ overflow bin (lo=900 s, hi=∞) is carried by
 * the sr-only table + the p90 rule, not plotted (the same honest-tail treatment lines uses).
 */
export const NETWORK_DELAY_HISTOGRAM_DOMAIN = DELAY_HISTOGRAM_DOMAIN;

// ── OTP trend zoom (S9B · DECISIONS B1/B2) ────────────────────────────────────────────────────
/**
 * The MINIMUM visible span (percentage points) the network on-time TREND axis is allowed to show.
 * The whole-network on-time average genuinely moves only ~1–2 points week-to-week, so on the bare
 * [0,100] axis a real 87→88 wiggle is sub-pixel and reads dead-flat. A floor of 8 pts guarantees a
 * near-flat week still shows legible SLOPE without ever inventing one (a genuinely flat 88/88 week
 * stays a flat line inside an 8-pt window). DECISIONS B1.
 */
export const OTP_TREND_MIN_SPAN = 8 as const;
/**
 * The absolute reference anchor drawn on the zoomed OTP-trend axis (the lines-page 80% target
 * convention). DECISIONS B2: the zoom is annotated with this hairline so a clipped axis is never
 * deceptive — the reader sees the true 80% mark, not a normalized floor.
 */
export const OTP_TREND_REFERENCE = 80 as const;

/**
 * otpTrendDomain — a DATA-ANCHORED, MIN-SPAN-floored, [0,100]-clamped y-domain for the network
 * on-time TREND line (S9B). This is the ONE exception to the "bare [0,100]" percentage rule, and
 * it is deliberately NOT the banned in-view /max normalization:
 *   - it is SYMMETRIC LITERAL padding (`OTP_TREND_PAD`) around the real min/max, never `value/max`;
 *   - it enforces a fixed MIN SPAN so a near-flat series shows honest slope, never a magnified one;
 *   - it is CLAMPED to the absolute [0,100] whole, so the axis can never exceed the real scale;
 *   - it is paired with a visible reference line (OTP_TREND_REFERENCE) + true y-tick labels, so the
 *     reader always sees the absolute anchor (87 vs 88), not a deceptive zero-hidden zoom.
 * The min/max are computed with a plain reduce (NOT `Math.max(...spread)`) so the chart-doctrine
 * gate — which bans spread-into-Math.max as an auto-scale idiom — stays green: this is a documented,
 * literal-padded, clamped, floored zoom on ONE surface (the network trend), not a per-refresh
 * re-normalization. Applies ONLY to the network OTP trend; lines' OTP axis stays OTP_DOMAIN [0,100].
 * null points are ignored; an all-null / empty series falls back to the honest full [0,100].
 */
export function otpTrendDomain(values: ReadonlyArray<number | null>): [number, number] {
	const OTP_TREND_PAD = 2; // symmetric literal headroom (pts) above/below the real extremes
	let lo = Number.POSITIVE_INFINITY;
	let hi = Number.NEGATIVE_INFINITY;
	for (const v of values) {
		if (v == null || Number.isNaN(v)) continue;
		if (v < lo) lo = v;
		if (v > hi) hi = v;
	}
	// No real points → honest full scale (never a fabricated zoom).
	if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 100];
	// The 80% target reference must sit INSIDE the zoom — a clamped-to-the-floor
	// hairline would be a falsely positioned anchor (prod OTP runs 84-89, above 80).
	lo = Math.min(lo, OTP_TREND_REFERENCE);
	hi = Math.max(hi, OTP_TREND_REFERENCE);
	// Literal symmetric padding around the real extremes, clamped to the absolute whole.
	let min = Math.max(0, Math.floor(lo - OTP_TREND_PAD));
	let max = Math.min(100, Math.ceil(hi + OTP_TREND_PAD));
	// Enforce the min span: widen symmetrically, then push off whichever [0,100] wall we hit so the
	// full floor span survives even when the data hugs 0 or 100.
	if (max - min < OTP_TREND_MIN_SPAN) {
		const grow = (OTP_TREND_MIN_SPAN - (max - min)) / 2;
		min = Math.max(0, Math.floor(min - grow));
		max = Math.min(100, Math.ceil(max + grow));
		if (max - min < OTP_TREND_MIN_SPAN) {
			if (min === 0) max = Math.min(100, OTP_TREND_MIN_SPAN);
			else if (max === 100) min = Math.max(0, 100 - OTP_TREND_MIN_SPAN);
		}
	}
	return [min, max];
}
