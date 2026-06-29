// verdict.ts — the §0 plain-language reliability verdict (the page's at-a-glance answer).
//
// Research-driven (S7 pass-2): the verdict is TEXT-LED (the Deterministic Construal
// Error — text reads 94% correct vs ~36% for any probability graphic) and is the page's
// honesty failure point (84% of misleading dashboards mislead via the reasoning, not the
// marks). So this selector is deliberately conservative + n-aware:
//
//   • two-sided natural frequency  ("about 8 in 10 trips on time … 2 in 10 late")
//   • a numeric (not verbal) hedge ("78%, 95% sure between 71 and 84%")
//   • NCHS small-sample suppression (n<30 → "still measuring", never a confident verdict)
//   • a Wilson-width "tentative" tier when the interval is too wide to call
//
// Value bands (OTP% vs the operator-locked 80% SLA target): Reliable ≥80 / Patchy 60–80 /
// Unreliable <60. (Distinct from the coarse 90/75 list-row colour badge in
// v1/reliabilityVerdict.ts — that's a glyph swatch; this is the nuanced sentence.)
//
// Degrades honestly pre-republish: observation_count / on_time are nullable+optional on the
// contract, so when the denominator is absent the band sentence still shows WITHOUT the
// Wilson hedge or n (never fabricated). Pure (no runes/DOM) → lives in the fast data project.

import type { Locale } from '$lib/i18n';
import type { ReliabilityCopy } from '../reliability.copy';

export type VerdictStatus = 'reliable' | 'patchy' | 'unreliable' | 'tentative' | 'absent';

export interface VerdictResult {
	readonly status: VerdictStatus;
	/** The big-aggregate number, e.g. "78%". Null when there is nothing to assert. */
	readonly ban: string | null;
	/** The plain-language two-sided verdict sentence (also the screen-reader summary). */
	readonly sentence: string;
}

/** The headline fields the verdict reads (a subset of PunctualityVM['headline']). */
export interface VerdictHeadline {
	readonly otpPct: number | null;
	readonly observationCount: number | null;
	readonly onTime: number | null;
}

/** NCHS small-sample suppression floor: below this many tracked arrivals, suppress. */
export const VERDICT_MIN_N = 30;
/** OTP% at/above which the line reads "reliable" — the operator-locked 80% SLA target. */
export const VERDICT_RELIABLE_FLOOR = 80;
/** OTP% at/above which the line reads "patchy" (below → "unreliable"). */
export const VERDICT_PATCHY_FLOOR = 60;
/** Wilson interval width (proportion) at/above which a verdict degrades to "tentative". */
const VERDICT_WIDE_CI = 0.3;
/** z for a 95% interval. */
const Z = 1.959963984540054;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * 95% Wilson score interval for a proportion onTime/n — valid near 0/1 and at small n
 * where the Wald interval collapses to false certainty (Brown, Cai & DasGupta 2001).
 * Returns [0,1] bounds.
 */
export function wilsonInterval(onTime: number, n: number): { lo: number; hi: number } {
	if (n <= 0) return { lo: 0, hi: 1 };
	const p = clamp01(onTime / n);
	const z2 = Z * Z;
	const denom = 1 + z2 / n;
	const center = (p + z2 / (2 * n)) / denom;
	const margin = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
	return { lo: clamp01(center - margin), hi: clamp01(center + margin) };
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
 * Build the §0 verdict for the selected-window headline.
 * @param mode the display window (day|week|month|range) — names the window in the sentence.
 */
export function selectVerdict(
	headline: VerdictHeadline,
	mode: string,
	_locale: Locale,
	copy: ReliabilityCopy,
): VerdictResult {
	const v = copy.verdict;
	const window = v.windowPhrase[asMode(mode)];
	const otp = headline.otpPct;

	// Nothing to read → honest absence (no fabricated 0%).
	if (otp == null) return { status: 'absent', ban: null, sentence: v.absent };

	const otpInt = Math.round(otp);
	const n = headline.observationCount;
	// Two-sided natural frequency. Derived from the REAL counts when available, and NEVER letting a
	// side read 0-in-10 unless its true count is genuinely 0 — rounding 96% to "10 in 10 on time, 0
	// in 10 late" fabricated a zero for ~1000 actually-late trips. When the counts are absent
	// (pre-republish), fall back to the rounded otp (the old behaviour, only ever hit with no n).
	let onTen: number;
	let lateTen: number;
	if (n != null && n > 0 && headline.onTime != null) {
		const on = headline.onTime;
		const late = Math.max(0, n - on);
		if (on === 0) {
			onTen = 0;
			lateTen = 10;
		} else if (late === 0) {
			onTen = 10;
			lateTen = 0;
		} else {
			// Both sides have real trips → each floors at 1 (so neither narrates a fabricated 0).
			lateTen = Math.min(9, Math.max(1, Math.round((late / n) * 10)));
			onTen = 10 - lateTen;
		}
	} else {
		onTen = Math.round(otp / 10);
		lateTen = Math.max(0, 10 - onTen);
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
	// Too few tracked trips to call it (NCHS n<30 suppression).
	if (n < VERDICT_MIN_N) {
		return { status: 'absent', ban: null, sentence: v.tooFew(window, n) };
	}
	// Enough trips → Wilson interval. Derive the numerator from otp×n when on_time is null.
	const numer = headline.onTime ?? Math.round((otp / 100) * n);
	const { lo, hi } = wilsonInterval(numer, n);
	const loPct = Math.round(lo * 100);
	const hiPct = Math.round(hi * 100);

	// The interval is too wide to commit to a band — hedge as tentative.
	if (hi - lo >= VERDICT_WIDE_CI) {
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
