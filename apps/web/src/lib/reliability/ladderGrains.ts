export const HOTSPOT_GRAINS = ['day', 'week', 'month', 'shift'] as const;
export const OFFENDER_GRAINS = ['week', 'month'] as const;
export type HotspotGrainKey = (typeof HOTSPOT_GRAINS)[number];
export type OffenderGrainKey = (typeof OFFENDER_GRAINS)[number];

interface GrainLadder {
	readonly grain: string;
	readonly entries?: readonly unknown[];
	readonly tray?: readonly unknown[];
}

export function ladderGrains<K extends string, T extends GrainLadder>(
	rows: readonly T[] | undefined,
	known: readonly [K, ...K[]],
): { ladders: Map<K, T>; present: Set<K>; defaultGrain: K } {
	const ladders = new Map<K, T>();
	for (const row of rows ?? []) {
		const key = known.find((grain) => grain === row.grain);
		if (key !== undefined) ladders.set(key, row);
	}
	const present = new Set<K>();
	for (const [key, row] of ladders) {
		if ((row.entries?.length ?? 0) > 0 || (row.tray?.length ?? 0) > 0) present.add(key);
	}
	return { ladders, present, defaultGrain: known.find((key) => present.has(key)) ?? known[0] };
}
