// timeOfDay — the receipt's per-shift time-of-day cut (S13, NEW).
//
// Consumes Receipt.by_shift[] (ReceiptShiftCut: shift, observation_count, severe_count,
// severe_pct, avg_delay_min) — the day's network-wide reading split by canonical shift
// (am_peak…night). Mirrors the stops SectionTimeOfDay ranker VERBATIM in spirit: rank
// worst-first by severe share, banding each bar on the FIXED absolute SEVERE_DOMAIN
// [0,100] (NEVER the in-view max), secondary-sorting by canonical shift order. A cut
// with a null severe share is DROPPED (no fabricated-0 ranking) — an avg-only shift has
// no place in a severe-share list. RAMP-IN: by_shift is additive-optional (absent on
// pre-S13 receipts), so an absent/empty array stands the whole section down.

import {
	SHIFT_GRAIN_ORDER,
	severeShareToSeverity,
	SEVERE_DOMAIN,
} from '$lib/features/reliability/shiftGrains';
import type { SeverityCode, ReceiptShiftCut } from '$lib/v1/schemas';

/** One ranked shift row (RankedRow-ready, carrying its absolute domain). */
export interface ReceiptShiftRow {
	readonly key: string;
	readonly rank: number;
	readonly title: string;
	readonly severity: SeverityCode;
	readonly value: number;
	readonly domain: readonly [number, number];
	readonly unit: string;
	readonly display: string;
}

export interface ReceiptTimeOfDayVM {
	readonly rows: ReceiptShiftRow[];
	/** The section stands down unless at least one shift carries a real severe share. */
	readonly hasTimeOfDay: boolean;
}

export interface ReceiptTimeOfDayLabels {
	/** shift token → localized label ("AM peak"). */
	readonly shiftLabel: (shift: string) => string;
}

/** Canonical shift order rank (unknown tokens sort last). */
function shiftRank(shift: string): number {
	const i = SHIFT_GRAIN_ORDER.indexOf(shift as (typeof SHIFT_GRAIN_ORDER)[number]);
	return i === -1 ? SHIFT_GRAIN_ORDER.length : i;
}

/** Build the receipt time-of-day VM from Receipt.by_shift[]. */
export function selectReceiptTimeOfDay(
	byShift: readonly ReceiptShiftCut[] | null | undefined,
	labels: ReceiptTimeOfDayLabels,
): ReceiptTimeOfDayVM {
	// A shift earns a row only with a real severe share (these rank BY severe share; a
	// null-share cut would survive yet vanish from the list). Never fabricate a share.
	const real = (byShift ?? []).filter((c) => c.severe_pct != null);
	const rows: ReceiptShiftRow[] = real
		.slice()
		.sort(
			(a, b) =>
				(b.severe_pct ?? 0) - (a.severe_pct ?? 0) || shiftRank(a.shift) - shiftRank(b.shift),
		)
		.map((c, i) => {
			const sev = c.severe_pct ?? 0;
			return {
				key: c.shift,
				rank: i + 1,
				title: labels.shiftLabel(c.shift),
				severity: severeShareToSeverity(c.severe_pct ?? null),
				value: sev,
				domain: SEVERE_DOMAIN,
				unit: '%',
				display: `${sev.toFixed(1)}%`,
			};
		});
	return { rows, hasTimeOfDay: rows.length > 0 };
}
