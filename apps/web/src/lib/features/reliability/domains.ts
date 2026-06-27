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
/** Day-of-week + delay-by-crowding avg delay (min). */
export const DELAY_DOW_DOMAIN = [0, 6] as const;
/** Scheduled / observed / excess headway gap (min). */
export const HEADWAY_DOMAIN = [0, 35] as const;

// ── Ratio ───────────────────────────────────────────────────────────────────────────────────
/** Headway coefficient-of-variation (gap stddev / mean); 1.0 = random-arrivals reference. */
export const COV_DOMAIN = [0, 1.2] as const;

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
