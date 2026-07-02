// presentGrains — the repeat-offenders by_grain AVAILABILITY (week / month).
//
// The S14 re-granulated repeat-offenders payload publishes one worst-N recurrence
// ladder PER GRAIN (RepeatOffenders.by_grain — see $lib/v1/schemas/repeat_offenders).
// Each grain is ONE ladder: a ranked `entries` list (trip+vehicle, type
// discriminates) + an un-ranked sub-MIN_N `tray`. A grain is OFFERED only when the
// payload actually carries a ladder for it that has at least one row (ranked OR tray)
// — a served-but-empty grain is an honest "nothing here", not a dead control.
//
// GRAINS = week|month ONLY (DECISIONS D3). "Repeat" is undefined on a single day, so
// there is deliberately NO day grain here — the honest reason, not an omission bug.

import type { RepeatOffenderGrain } from '$lib/v1/schemas';

/** The grains the repeat-offenders surface can offer (week → month; no day). */
export type OffenderGrainKey = 'week' | 'month';
export const OFFENDER_GRAINS: readonly OffenderGrainKey[] = ['week', 'month'];

const GRAIN_SET: ReadonlySet<string> = new Set(OFFENDER_GRAINS);

/** True when a served grain string is one this surface knows how to render. */
export function isOffenderGrain(v: string): v is OffenderGrainKey {
	return GRAIN_SET.has(v);
}

/** A grain ladder carries data when it has at least one ranked entry OR tray row. */
function ladderHasRows(g: RepeatOffenderGrain): boolean {
	return (g.entries?.length ?? 0) > 0 || (g.tray?.length ?? 0) > 0;
}

/**
 * Index the served ladders by their (known) grain key. The pipeline owns the grain
 * string; an unrecognized grain is dropped (never rendered as a mystery segment). If
 * the payload duplicates a grain the LAST one wins (a defensive, deterministic pick).
 */
export function ladderByGrain(
	byGrain: readonly RepeatOffenderGrain[] | undefined,
): Map<OffenderGrainKey, RepeatOffenderGrain> {
	const map = new Map<OffenderGrainKey, RepeatOffenderGrain>();
	for (const g of byGrain ?? []) {
		if (isOffenderGrain(g.grain)) map.set(g.grain, g);
	}
	return map;
}

/** The set of grains the payload POPULATES (a served ladder with ≥1 ranked/tray row). */
export function presentGrains(
	byGrain: readonly RepeatOffenderGrain[] | undefined,
): Set<OffenderGrainKey> {
	const set = new Set<OffenderGrainKey>();
	for (const [key, ladder] of ladderByGrain(byGrain)) {
		if (ladderHasRows(ladder)) set.add(key);
	}
	return set;
}

/**
 * The default (richest present) grain: the finest populated grain in OFFENDER_GRAINS
 * order (week→month), falling to 'week' when nothing is populated. This is the clamp
 * target — a chosen grain whose ladder the payload does not populate falls back here
 * rather than rendering a dead/empty rail segment.
 */
export function defaultOffenderGrain(present: ReadonlySet<OffenderGrainKey>): OffenderGrainKey {
	return OFFENDER_GRAINS.find((g) => present.has(g)) ?? 'week';
}
