// presentGrains — the hotspots by_grain AVAILABILITY (day / week / month / shift).
//
// The S12 re-granulated hotspots payload publishes one worst-N ladder PER GRAIN
// (Hotspots.by_grain — see $lib/v1/schemas/hotspots). Unlike the network trend (an
// N-bucket calendar series per grain), each hotspots grain is ONE ladder: a ranked
// `entries` list + an un-ranked sub-MIN_N `tray`. A grain is OFFERED only when the
// payload actually carries a ladder for it that has at least one row (ranked OR tray)
// — a served-but-empty grain is an honest "nothing here", not a dead control.
//
// The 'shift' grain (DECISIONS DB1/WEB4) is a TIME-OF-DAY cut (date=null), a 4th
// segment on the same rail — never a per-row sub-breakdown. It is offered on the SAME
// terms as the calendar grains: iff the payload serves a populated shift ladder.

import type { HotspotGrain } from '$lib/v1/schemas';

/** The grains the hotspots surface can offer (finest → coarsest → the shift cut). */
export type HotspotGrainKey = 'day' | 'week' | 'month' | 'shift';
export const HOTSPOT_GRAINS: readonly HotspotGrainKey[] = ['day', 'week', 'month', 'shift'];

const GRAIN_SET: ReadonlySet<string> = new Set(HOTSPOT_GRAINS);

/** True when a served grain string is one this surface knows how to render. */
export function isHotspotGrain(v: string): v is HotspotGrainKey {
	return GRAIN_SET.has(v);
}

/** A grain ladder carries data when it has at least one ranked entry OR tray row. */
function ladderHasRows(g: HotspotGrain): boolean {
	return (g.entries?.length ?? 0) > 0 || (g.tray?.length ?? 0) > 0;
}

/**
 * Index the served ladders by their (known) grain key. The pipeline owns the grain
 * string; an unrecognized grain is dropped (never rendered as a mystery segment). If
 * the payload duplicates a grain the LAST one wins (a defensive, deterministic pick).
 */
export function ladderByGrain(
	byGrain: readonly HotspotGrain[] | undefined,
): Map<HotspotGrainKey, HotspotGrain> {
	const map = new Map<HotspotGrainKey, HotspotGrain>();
	for (const g of byGrain ?? []) {
		if (isHotspotGrain(g.grain)) map.set(g.grain, g);
	}
	return map;
}

/** The set of grains the payload POPULATES (a served ladder with ≥1 ranked/tray row). */
export function presentGrains(byGrain: readonly HotspotGrain[] | undefined): Set<HotspotGrainKey> {
	const set = new Set<HotspotGrainKey>();
	for (const [key, ladder] of ladderByGrain(byGrain)) {
		if (ladderHasRows(ladder)) set.add(key);
	}
	return set;
}

/**
 * The default (richest present) grain: the finest populated grain in HOTSPOT_GRAINS
 * order (day→week→month→shift), falling to 'day' when nothing is populated. This is
 * the clamp target — a chosen grain whose ladder the payload does not populate falls
 * back here rather than rendering a dead/empty rail segment.
 */
export function defaultHotspotGrain(present: ReadonlySet<HotspotGrainKey>): HotspotGrainKey {
	return HOTSPOT_GRAINS.find((g) => present.has(g)) ?? 'day';
}
