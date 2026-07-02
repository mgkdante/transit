// selectShiftRank — the network-wide by-shift / by-daytype reliability, ranked by punctuality.
//
// Ported VERBATIM from the NetworkHealth god-file `rankByPunctuality`. The HEADLINE per grain
// is the REAL on-time % (otp_pct over the trailing window), ranked worst-PUNCTUALITY first
// (lowest OTP first); a grain with no OTP falls back to its severe-delay share for ordering
// and sorts AFTER every OTP-known grain (worst severe-share first among those). The magnitude
// bar encodes the SEVERE-delay share as the ABSOLUTE percent on the fixed SEVERE_DOMAIN
// [0,100] (never the in-view worst). Honesty: a grain with NEITHER otp NOR severe is DROPPED
// (never a fabricated 0); a null-OTP grain shows the styled honest-absence chip in its
// headline, never a fake 0%.

import { severeShareToSeverity } from '$lib/features/reliability/shiftGrains';
import type { NetworkShift } from '$lib/v1';
import type { SeverityCode } from '$lib/v1/schemas';

/** One ranked shift/day-type row (a RankedRow-ready shape). */
export interface ShiftRow {
	readonly key: string;
	readonly rank: number;
	readonly title: string;
	readonly severity: SeverityCode;
	/** The ABSOLUTE severe-delay share (%), scaled by SEVERE_DOMAIN at the bar. null = no read. */
	readonly value: number | null;
	/** null when no OTP reading → RankedRow renders the styled honest-absence chip, never a 0%. */
	readonly display: string | null;
	/** avg delay + severe share reading. */
	readonly subtitle: string;
}

/** Already-localized helpers (i18n + formatting stay out of the selector). */
export interface ShiftRankLabels {
	/** grain token → localized grain name. */
	grainLabel: (grain: string) => string;
	/** otp % → the formatted headline, or NULL on no-data (renders the styled chip). */
	pctOrNull: (v: number | null) => string | null;
	/** avg delay (min) + severe share (%) → the localized subtitle. */
	subtitle: (avg: number | null, severe: number | null) => string;
}

/**
 * Rank worst-punctuality first: lowest OTP first; grains with no OTP fall back to severe-share
 * for ordering and sort AFTER every OTP-known grain. A grain carrying NEITHER otp NOR severe
 * is dropped (no fabricated 0).
 */
export function selectShiftRank(
	rows: readonly NetworkShift[] | null | undefined,
	labels: ShiftRankLabels,
): ShiftRow[] {
	const real = (rows ?? []).filter((r) => r.otp_pct != null || r.severe_pct != null);
	return real
		.slice()
		.sort((a, b) => {
			const aHas = a.otp_pct != null;
			const bHas = b.otp_pct != null;
			// OTP-known grains always sort before OTP-unknown grains.
			if (aHas !== bHas) return aHas ? -1 : 1;
			// Both OTP-known: lowest OTP (worst punctuality) first.
			if (aHas && bHas) return (a.otp_pct ?? 0) - (b.otp_pct ?? 0);
			// Both OTP-unknown: worst severe-share first.
			return (b.severe_pct ?? 0) - (a.severe_pct ?? 0);
		})
		.map((r, i) => {
			const sev = r.severe_pct ?? null;
			return {
				key: r.grain,
				rank: i + 1,
				title: labels.grainLabel(r.grain),
				// The bar encodes the severe share; null severe → quiet no-data bar.
				severity: severeShareToSeverity(sev),
				value: sev,
				// HEADLINE: the real OTP %, or NULL → the styled honest-absence chip, never a fake 0%.
				display: labels.pctOrNull(r.otp_pct ?? null),
				subtitle: labels.subtitle(r.avg_delay_min ?? null, sev),
			};
		});
}
