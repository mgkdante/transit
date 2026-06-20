// reliabilityVerdict.ts — pure OTP% → status verdict mapping (no runes, no DOM).
//
// The single place that turns a headline on-time-percentage into a dataviz
// StatusCode band so a list-row badge can paint the verdict in colour + glyph
// (StatusBadge / StatusDot speak StatusCode). Kept pure + framework-free so it
// lives in the fast `data` test project and is reused by the lazy snapshot
// loader AND any future consumer.
//
// DOCTRINE: the band is a DATA mark on the dataviz status scale (never
// --primary). Honesty: a null/absent OTP yields NO verdict (the caller renders
// no badge) — we never fabricate a 0% "severe" for a route with no history.
//
// Bands (OTP% = trips on time): the same shape /health uses board-side —
//   >= 90  on_time   (strong)
//   >= 75  late       (slipping)
//   <  75  severe     (poor)
// `early` is never a verdict here (OTP has no "ahead of schedule" reading).

import type { StatusCode } from './schemas';

/** OTP% at/above which a line/stop reads as healthy. */
export const OTP_ON_TIME_FLOOR = 90;
/** OTP% at/above which a line/stop reads as merely slipping (below = poor). */
export const OTP_LATE_FLOOR = 75;

/**
 * Map a headline OTP% to a dataviz StatusCode band, or `null` when there is no
 * percentage to read (absent / NaN). `null` is the honest "no data" signal —
 * the caller renders no badge rather than a fabricated verdict.
 */
export function otpVerdict(otpPct: number | null | undefined): StatusCode | null {
	if (otpPct == null || Number.isNaN(otpPct)) return null;
	if (otpPct >= OTP_ON_TIME_FLOOR) return 'on_time';
	if (otpPct >= OTP_LATE_FLOOR) return 'late';
	return 'severe';
}

/**
 * The status bands a "late/severe only" filter narrows to — the worst-first
 * reading. Shared by the lines status filter so the chip set and the predicate
 * never drift.
 */
export const PROBLEM_VERDICTS: readonly StatusCode[] = ['late', 'severe'];

/** True when a verdict is one a rider would treat as a problem (late or worse). */
export function isProblemVerdict(verdict: StatusCode | null): boolean {
	return verdict != null && PROBLEM_VERDICTS.includes(verdict);
}
