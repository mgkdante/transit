// directions.ts — the ONE place that turns a GTFS direction_id (0/1) into the bus's real
// destination HEADSIGN (what a rider actually reads on the bus + at the stop). Riders don't
// know "direction 0/1"; they know "Est / Ouest / Station Snowdon". Every lines/[slug] surface
// that labels a direction reads this map, so the naming is structural, never ad-hoc inline.

import type { RouteFile } from '$lib/v1';

/**
 * Build a `dir → headsign` lookup from the static `RouteFile.directions`. A route may list
 * several headsign variants for one direction (e.g. "Est" then "Est destination Station
 * Snowdon"); the FIRST non-empty one is the canonical short label. Returns a plain record
 * keyed by direction_id; a direction the route publishes no headsign for is simply absent,
 * so callers fall back to a neutral "Direction N" — never a fabricated name.
 */
export function directionHeadsigns(
	directions: RouteFile['directions'] | undefined | null,
): Record<number, string> {
	const byDir: Record<number, string> = {};
	for (const d of directions ?? []) {
		if (d.dir == null) continue;
		const sign = (d.headsign ?? '').trim();
		if (sign && byDir[d.dir] == null) byDir[d.dir] = sign;
	}
	return byDir;
}
