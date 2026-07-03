// crowdingMix — the per-stop occupancy band-shares (occupancy_mix).
//
// Ports the StopDetail inline crowding transforms VERBATIM: the trailing-window
// occupancy band-shares of buses OBSERVED AT this stop, rendered as a 100%-stacked
// proportion strip through the ONE <Chart> renderer (P5.2 — the legacy StackedBar
// primitive is retired; the VM now carries a selector-emitted stacked-share spec).
// Honesty (Cluster04 doctrine): occupancy_mix is null when no telemetry was
// attributed to this stop, and an ALL-ZERO mix is ALSO treated as empty — in both
// cases the section stands down (never a fabricated / even split).

import { OCCUPANCY_CODES, type OccupancyCode, type OccupancyMix } from '$lib/v1/schemas';
import type { StackedShareSpec } from '$lib/components/dataviz/chart';
import { stackedShareSpec } from '$lib/components/dataviz/chart/share';
import type { Locale } from '$lib/i18n/config';

/** One occupancy band as a StackedBar segment (fraction 0..1, null = no data). */
export interface CrowdingSegment {
	readonly code: OccupancyCode;
	readonly value: number | null;
	readonly label: string;
}

export interface CrowdingVM {
	/** The mix, or null when there is no real telemetry (absent or all-zero). */
	readonly mix: OccupancyMix | null;
	/** True when at least one band carries a real share. */
	readonly hasCrowding: boolean;
	/** The five bands as StackedBar segments (fractions 0..1). */
	readonly segments: CrowdingSegment[];
	/** Total band share — guards the dominant-band headline + its share math. */
	readonly total: number;
	/** The largest band — the single-glance read (null when no telemetry). */
	readonly dominant: { code: OccupancyCode; label: string; share: number } | null;
	/** Dominant-band share as a whole-percent string (e.g. "62%"), or null. */
	readonly dominantPct: string | null;
	/** The 100%-stacked crowding spec (legend + sm strip); null when standing down. */
	readonly spec: StackedShareSpec | null;
}

export interface CrowdingMixOptions {
	/** Accessible strip title (the legacy bar label). */
	readonly title: string;
	readonly locale: Locale;
}

export function selectCrowdingMix(
	occupancyMix: OccupancyMix | null | undefined,
	/** code → localized band label (the SHARED lines occupancy vocabulary). */
	bandLabel: (code: OccupancyCode) => string,
	opts: CrowdingMixOptions,
): CrowdingVM {
	// Treat the raw mix as empty unless at least one band carries a real share.
	const raw = occupancyMix ?? null;
	const hasShare = raw != null && OCCUPANCY_CODES.some((c: OccupancyCode) => (raw[c] ?? 0) > 0);
	const mix = hasShare ? raw : null;
	const hasCrowding = mix != null;

	const segments: CrowdingSegment[] = OCCUPANCY_CODES.map((code: OccupancyCode) => ({
		code,
		value: mix ? (mix[code] ?? null) : null,
		label: bandLabel(code),
	}));

	const total = segments.reduce(
		(sum, s) => sum + (s.value != null && s.value > 0 ? s.value : 0),
		0,
	);

	let dominant: { code: OccupancyCode; label: string; share: number } | null = null;
	if (hasCrowding && total > 0) {
		for (const code of OCCUPANCY_CODES) {
			const v = mix ? (mix[code] ?? null) : null;
			if (v == null || v <= 0) continue;
			if (dominant == null || v > dominant.share)
				dominant = { code, label: bandLabel(code), share: v };
		}
	}

	const dominantPct = dominant ? `${Math.round((dominant.share / total) * 100)}%` : null;

	const spec = hasCrowding
		? stackedShareSpec({
				title: opts.title,
				locale: opts.locale,
				scale: 'occupancy',
				legend: true,
				size: 'sm',
				inputs: segments.map((s) => ({ code: s.code, value: s.value, label: s.label })),
			})
		: null;

	return { mix, hasCrowding, segments, total, dominant, dominantPct, spec };
}
