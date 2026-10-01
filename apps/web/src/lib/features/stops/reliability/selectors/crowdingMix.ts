import { OCCUPANCY_CODES } from '$lib/v1/schemas/types';
import type { OccupancyCode, OccupancyMix } from '$lib/v1/schemas';
import type { StackedShareSpec } from '$lib/components/dataviz/chart';
import { stackedShareSpec } from '$lib/components/dataviz/chart/share';
import type { Locale } from '$lib/i18n/config';

export interface CrowdingSegment {
	readonly code: OccupancyCode;
	readonly value: number | null;
	readonly label: string;
}

export interface CrowdingVM {
	readonly mix: OccupancyMix | null;
	readonly hasCrowding: boolean;
	readonly segments: CrowdingSegment[];
	readonly total: number;
	readonly dominant: { code: OccupancyCode; label: string; share: number } | null;
	readonly dominantPct: string | null;
	readonly spec: StackedShareSpec | null;
}

export interface CrowdingMixOptions {
	readonly title: string;
	readonly locale: Locale;
}

export function selectCrowdingMix(
	occupancyMix: OccupancyMix | null | undefined,
	bandLabel: (code: OccupancyCode) => string,
	opts: CrowdingMixOptions,
): CrowdingVM {
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
