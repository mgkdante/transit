// Shared reliability verdict for route, stop and network headlines.
// Product thresholds choose the value band, require n >= 30 for a sample-based
// verdict, and use Wilson bounds to flag wide intervals or uncertain band membership.
// Copy belongs to each surface so its observation population stays explicit.

import type { Locale } from '$lib/i18n';
import { wilsonBoundsProportion } from '$lib/v1/stats';

export type VerdictStatus = 'reliable' | 'patchy' | 'unreliable' | 'tentative' | 'absent';

export interface VerdictResult {
	readonly status: VerdictStatus;
	/** The big-aggregate number, e.g. "78%". Null when there is nothing to assert. */
	readonly ban: string | null;
	/** The plain-language two-sided verdict sentence (also the screen-reader summary). */
	readonly sentence: string;
}

/** The headline fields the verdict reads (a subset of a surface's headline VM). */
export interface VerdictHeadline {
	readonly otpPct: number | null;
	readonly observationCount: number | null;
	readonly onTime: number | null;
}

/** The window, frequencies and uncertainty clause interpolated by a verdict sentence. */
export interface VerdictSentenceArgs {
	readonly window: string;
	readonly onTen: number | '<1' | '>9';
	readonly lateTen: number | '<1' | '>9';
	/** The numeric clause, e.g. " (78%, 95% CI: 71–84%)" or " (78%)". */
	readonly hedge: string;
}

/** Surface-specific copy for the shared verdict calculation. */
export interface VerdictCopy {
	readonly windowPhrase: {
		readonly day: string;
		readonly week: string;
		readonly month: string;
		readonly range: string;
	};
	readonly reliable: (a: VerdictSentenceArgs) => string;
	readonly patchy: (a: VerdictSentenceArgs) => string;
	readonly unreliable: (a: VerdictSentenceArgs) => string;
	readonly tentative: (a: {
		readonly window: string;
		readonly otp: number;
		readonly n: number;
		readonly lo: number;
		readonly hi: number;
	}) => string;
	readonly tooFew: (window: string, n: number) => string;
	readonly absent: string;
	readonly hedgeSimple: (otp: number) => string;
	readonly hedgeCI: (otp: number, lo: number, hi: number) => string;
}

/** Minimum observation count for a sample-based verdict. */
export const VERDICT_MIN_N = 30;
/** Product threshold for the "reliable" band. */
export const VERDICT_RELIABLE_FLOOR = 80;
/** OTP% at/above which the line reads "patchy" (below → "unreliable"). */
export const VERDICT_PATCHY_FLOOR = 60;
/** Wilson interval width (proportion) at/above which a verdict degrades to "tentative". */
const VERDICT_WIDE_CI = 0.3;

/** Shared Wilson bounds; a nonpositive denominator yields the full [0,1] interval. */
export function wilsonInterval(onTime: number, n: number): { lo: number; hi: number } {
	const b = wilsonBoundsProportion(onTime, n);
	return { lo: b?.[0] ?? 0, hi: b?.[1] ?? 1 };
}

type Mode = 'day' | 'week' | 'month' | 'range';
const asMode = (m: string): Mode => (m === 'week' || m === 'month' || m === 'range' ? m : 'day');

const bandOf = (otp: number): 'reliable' | 'patchy' | 'unreliable' =>
	otp >= VERDICT_RELIABLE_FLOOR
		? 'reliable'
		: otp >= VERDICT_PATCHY_FLOOR
			? 'patchy'
			: 'unreliable';

/**
 * Build the verdict for the selected-window headline.
 * @param mode the display window (day|week|month|range) — names the window in the sentence.
 */
export function selectVerdict(
	headline: VerdictHeadline,
	mode: string,
	_locale: Locale,
	verdict: VerdictCopy,
): VerdictResult {
	const v = verdict;
	const window = v.windowPhrase[asMode(mode)];
	const otp = headline.otpPct;

	// Nothing to read → honest absence (no fabricated 0%).
	if (otp == null) return { status: 'absent', ban: null, sentence: v.absent };

	const otpInt = Math.round(otp);
	const n = headline.observationCount;
	// Only real counts can establish an exact zero. A small nonzero share stays
	// below one in ten rather than being inflated to one or rounded to zero.
	const hasCounts = n != null && n > 0 && headline.onTime != null;
	const onShare = hasCounts ? headline.onTime / n : otp / 100;
	let onTen: VerdictSentenceArgs['onTen'];
	let lateTen: VerdictSentenceArgs['lateTen'];
	if (hasCounts && headline.onTime === 0) {
		onTen = 0;
		lateTen = 10;
	} else if (hasCounts && headline.onTime >= n) {
		onTen = 10;
		lateTen = 0;
	} else if (onShare < 0.1) {
		onTen = '<1';
		lateTen = '>9';
	} else if (onShare > 0.9) {
		onTen = '>9';
		lateTen = '<1';
	} else {
		onTen = hasCounts ? 10 - Math.round(((n - headline.onTime) / n) * 10) : Math.round(otp / 10);
		lateTen = 10 - onTen;
	}
	const band = bandOf(otp);

	// No denominator yet (pre-republish) → the band sentence WITHOUT a Wilson hedge or n.
	if (n == null || n <= 0) {
		return {
			status: band,
			ban: `${otpInt}%`,
			sentence: v[band]({ window, onTen, lateTen, hedge: v.hedgeSimple(otpInt) }),
		};
	}
	// Too few observations for the product's sample-based verdict.
	if (n < VERDICT_MIN_N) {
		return { status: 'absent', ban: null, sentence: v.tooFew(window, n) };
	}
	// Enough trips → Wilson interval (shared kernel, z=1.96). Derive the numerator from otp×n when
	// on_time is null.
	const numer = headline.onTime ?? Math.round((otp / 100) * n);
	const [lo, hi] = wilsonBoundsProportion(numer, n) ?? [0, 1];
	const loPct = Math.round(lo * 100);
	const hiPct = Math.round(hi * 100);

	// Hedge as tentative when the interval is too wide to commit to a band, OR when the Wilson CI
	// STRADDLES a band boundary (the true rate could honestly fall either side of the 80/60 line) —
	// asserting a confident band there would overstate what the sample supports.
	if (hi - lo >= VERDICT_WIDE_CI || bandOf(loPct) !== bandOf(hiPct)) {
		return {
			status: 'tentative',
			ban: `${otpInt}%`,
			sentence: v.tentative({ window, otp: otpInt, n, lo: loPct, hi: hiPct }),
		};
	}
	return {
		status: band,
		ban: `${otpInt}%`,
		sentence: v[band]({ window, onTen, lateTen, hedge: v.hedgeCI(otpInt, loPct, hiPct) }),
	};
}
