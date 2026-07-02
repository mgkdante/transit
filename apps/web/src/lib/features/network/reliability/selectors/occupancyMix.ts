// occupancyMix — the live crowding-mix segments (the 5 OccupancyCodes by fraction).
//
// Ported VERBATIM from the NetworkHealth god-file. The 100% occupancy bar stays on the shared
// StackedBar primitive (a stacked-share mark is EXEMPT from the absolute-magnitude domain
// law). Honesty: occupancy_mix may be null/absent when no telemetry was received this cycle —
// `hasOccupancy` false stands the whole bar down rather than fabricating an even split.

import { OCCUPANCY_CODES, type OccupancyCode, type OccupancyMix } from '$lib/v1/schemas';
import type { StackedSegment } from '$lib/components/dataviz';

export interface OccupancyMixVM {
	/** True when the cycle received real occupancy telemetry (never fabricate a split). */
	readonly hasOccupancy: boolean;
	/** The five bands as StackedBar segments (fractions 0..1, null = no data). */
	readonly segments: StackedSegment[];
}

/** code → localized occupancy band label (the SHARED $lib/v1/enumLabels vocabulary). */
export function selectOccupancyMix(
	mix: OccupancyMix | null | undefined,
	occupancyLabel: (code: OccupancyCode) => string,
): OccupancyMixVM {
	const raw = mix ?? null;
	return {
		hasOccupancy: raw != null,
		segments: OCCUPANCY_CODES.map((code: OccupancyCode) => ({
			code,
			value: raw ? (raw[code] ?? null) : null,
			label: occupancyLabel(code),
		})),
	};
}
