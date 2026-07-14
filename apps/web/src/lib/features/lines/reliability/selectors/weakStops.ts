// selectWeakStops — the §4 "Where it's worst" accountability lollipop (A13).
//
// TWO magnitude semantics, switched by `opts.preRanked`:
//   * WINDOWED (preRanked, S7-B weak_stops_by_grain): the contract delivers the stops already
//     ranked worst-first by the not-severe Wilson LOWER bound, each carrying {severe_pct,
//     observation_count, wilson_lo, wilson_hi}. The bar encodes `severe_pct` on SEVERE_DOMAIN
//     [0,100] — the RANK variable itself, always >= 0 — so a genuinely-worst stop whose pooled
//     avg delay is <= 0 still draws an honest bar (not a dishonest empty one). The DB order is
//     PRESERVED (no re-sort); avg + Wilson LB + n ride the per-row note tooltip.
//   * FALLBACK (scalar weak_stops, pre-deploy): rank by avg delay DESC, bar = avg_delay_min on
//     DELAY_POS_DOMAIN — the long-standing whole-history view, unchanged.
// Each row carries a drill href to its stop page. Honest absence when no stop is served.

import type { Locale } from '$lib/i18n';
import type { AbsenceSpec, MagnitudeBarsSpec, MagnitudeDatum } from '$lib/components/dataviz/chart';
import { DELAY_POS_DOMAIN, SEVERE_DOMAIN } from '$lib/features/reliability/domains';
import { delayMinToSeverity, severeShareToSeverity } from '$lib/features/reliability/shiftGrains';
import { stopNameFallback } from '$lib/site/absence';
import type { WeakStop } from '$lib/v1';

export interface WeakStopsLabels {
	/** Accessible name (e.g. "Weakest stops by delay"). */
	title: string;
	/** Localized stop heading for the AT table mirror. */
	rowLabel: string;
	/** Localized value-axis title for the FALLBACK (avg-delay) path (e.g. "Avg delay"). */
	xLabel: string;
	/** Value unit suffix for the fallback path (e.g. " min"). */
	unit: string;
	/** WINDOWED value-axis title — the severe-rate the bar encodes (e.g. "Severe-delay rate"). */
	severeXLabel?: string;
	/** WINDOWED unit suffix (e.g. "%"). */
	severeUnit?: string;
	/** WINDOWED per-row evidence note builder (e.g. "severe 42% · avg 3.1 min · n=987"). */
	note?: (w: WeakStop) => string;
	/** WINDOWED Wilson-interval label (e.g. "95% CI") — surfaces the per-row uncertainty in the
	 *  tooltip + sr-only table. Only meaningful on the preRanked (severe-rate) path. */
	ciLabel?: string;
	/** Build the drill link for a stop id. */
	stopHref: (id: string) => string;
}

export interface WeakStopsResult {
	spec: MagnitudeBarsSpec | AbsenceSpec;
	/** The full ranked count (before the worst-N truncation) — for the honest heading. */
	total: number;
	/** How many rows the spec actually carries (≤ N). */
	shown: number;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

// The bar encodes the SEVERE rate, but the contract's wilson_lo/hi bracket the COMPLEMENTARY
// not-severe rate (not_severe = 100 − severe). Flip the interval onto the severe scale,
// [100 − wilson_hi, 100 − wilson_lo], so the displayed CI (whisker + tooltip + sr-table) brackets
// the bar's value honestly instead of sitting on the opposite end of the axis. Null on either
// missing bound (honest absence). Width is preserved (the flip is just 100 − x).
const severeCiLo = (w: WeakStop): number | null =>
	w.wilson_lo != null && w.wilson_hi != null ? round1(100 - w.wilson_hi) : null;
const severeCiHi = (w: WeakStop): number | null =>
	w.wilson_lo != null && w.wilson_hi != null ? round1(100 - w.wilson_lo) : null;

export interface WeakStopsOpts {
	/**
	 * True when `stops` is the windowed weak_stops_by_grain slice — already DB-ranked worst-first
	 * by the not-severe Wilson lower bound. Switches the magnitude to severe_pct/SEVERE_DOMAIN and
	 * preserves the contract order (no re-sort).
	 */
	preRanked?: boolean;
}

export function selectWeakStops(
	stops: readonly WeakStop[],
	n: number,
	locale: Locale,
	labels: WeakStopsLabels,
	opts?: WeakStopsOpts,
): WeakStopsResult {
	const preRanked = opts?.preRanked === true;
	// The FULL ranked set before truncation — so the absolute domain stays stable as N changes
	// (a smaller N never rescales the remaining bars). Windowed: keep the contract's Wilson-LB
	// worst-first order verbatim. Fallback: rank by avg delay DESC (rows without a delay dropped).
	const ranked = preRanked
		? stops.slice()
		: stops
				.filter((w) => w.avg_delay_min != null)
				.slice()
				.sort((a, b) => (b.avg_delay_min ?? 0) - (a.avg_delay_min ?? 0));
	const total = ranked.length;
	const top = ranked.slice(0, Math.max(0, n));
	const shown = top.length;

	if (shown === 0) {
		return {
			spec: {
				kind: 'absence',
				title: labels.title,
				locale,
				reason: 'no-observations',
				variant: 'block',
			},
			total,
			shown,
		};
	}

	const rows: MagnitudeDatum[] = top.map((w) =>
		preRanked
			? {
					key: w.id,
					label: w.name ?? stopNameFallback(w.id, locale),
					// the RANK variable: severe-delay rate %, always >= 0 (null → honest no-data swatch).
					value: w.severe_pct ?? null,
					severity: severeShareToSeverity(w.severe_pct ?? null),
					n: w.observation_count ?? null,
					// CI flipped onto the bar's (severe-rate) scale so it brackets the value (see helpers).
					wilsonLo: severeCiLo(w),
					wilsonHi: severeCiHi(w),
					note: labels.note?.(w),
					href: labels.stopHref(w.id),
				}
			: {
					key: w.id,
					label: w.name ?? stopNameFallback(w.id, locale),
					value: w.avg_delay_min ?? null,
					severity: delayMinToSeverity(w.avg_delay_min ?? null),
					href: labels.stopHref(w.id),
				},
	);

	return {
		spec: {
			kind: 'magnitude-bars',
			mark: 'lollipop',
			title: labels.title,
			locale,
			domain: preRanked ? SEVERE_DOMAIN : DELAY_POS_DOMAIN,
			unit: preRanked ? (labels.severeUnit ?? labels.unit) : labels.unit,
			rowLabel: labels.rowLabel,
			xLabel: preRanked ? (labels.severeXLabel ?? labels.xLabel) : labels.xLabel,
			// the Wilson interval is meaningful only on the severe-rate (preRanked) path.
			ciLabel: preRanked ? labels.ciLabel : undefined,
			rows,
			sort: 'given',
			scale: 'severity',
		},
		total,
		shown,
	};
}
