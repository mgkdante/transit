// rangeSeed.ts — pure resolution of a URL-seeded custom date range (PR-WEB-4).
//
// The reliability rail deep-links its custom date range via ?from/?to (the read companion to the
// ?grain mirror). The URL is a HINT, never a data source, so a seeded bound only survives if it is
// a REAL dated day the contract carries; an out-of-window / non-existent / malformed bound is
// dropped (never fabricated into a fake window). A COMPLETE, valid from+to also implies range
// intent — so ?from=…&to=… deep-links a range even without an explicit ?grain=range.
//
// PURE (no DOM, no runes) → unit-tested in rangeSeed.test.ts; the component calls it once at the
// availability-clamp boundary (where `data`, hence the available dated window, is known).

/** True for a well-formed ISO calendar date (YYYY-MM-DD) — the SHAPE gate used at init, before
 *  `data` (the available window) is known. Availability is validated later by resolveRangeSeed. */
export function isIsoDate(s: string | null | undefined): s is string {
	return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export interface RangeSeed {
	/** The validated range start (a real available date), or '' when dropped. */
	readonly from: string;
	/** The validated range end (a real available date), or '' when dropped. */
	readonly to: string;
	/** True when a complete, valid from+to was seeded while the grain was NOT already 'range' —
	 *  the caller should switch the rail to range mode (a full range implies range intent). */
	readonly activateRange: boolean;
}

/**
 * Validate the URL-seeded `from`/`to` bounds against the available dated day window.
 *
 * @param from           the raw ?from value (already shape-checked, or '').
 * @param to             the raw ?to value (already shape-checked, or '').
 * @param grain          the grain the rail seeded to (from ?grain) — 'range' when the URL asked.
 * @param availableDates the set of real dated days the contract carries (the picker's options).
 */
export function resolveRangeSeed(
	from: string,
	to: string,
	grain: string,
	availableDates: ReadonlySet<string>,
): RangeSeed {
	const keep = (d: string): string => (availableDates.has(d) ? d : '');
	const f = keep(from);
	const t = keep(to);
	// A complete, valid range with at least one real day to range over implies range intent.
	const activateRange = grain !== 'range' && f !== '' && t !== '' && availableDates.size > 0;
	return { from: f, to: t, activateRange };
}
