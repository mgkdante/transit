// share.ts — StackedShareSpec construction helpers (P5.2).
//
// The legacy StackedBar primitive took raw counts/fractions and normalised them
// itself; in spec-land the SELECTOR owns that math (Web Surface Doctrine). These
// helpers are the one shared implementation of the legacy semantics: null/NaN
// treated as 0, zero segments DROPPED (no zero-width slivers), order preserved,
// shares normalised to 100. A whole-strip with no real share returns null so the
// caller can emit an honest `absence` spec (never a fabricated split).

import type { Locale } from '$lib/i18n/config';
import type { OccupancyCode, StatusCode } from '$lib/v1/schemas';
import type { ShareSegment, StackedShareSpec } from './ChartSpec';

/** One raw band: a status/occupancy code with its count (or fraction) + label. */
export interface ShareInput {
	readonly code: StatusCode | OccupancyCode;
	/** Raw count / weight / fraction. null/NaN are treated as 0 (legacy semantics). */
	readonly value: number | null;
	readonly label: string;
	/** Optional drill link for the band (e.g. the map cross-filter URL). */
	readonly href?: string;
}

const clean = (v: number | null): number => (v != null && Number.isFinite(v) ? Math.max(0, v) : 0);

/** Normalise raw bands to [0,100] shares, dropping zero bands. [] when total ≤ 0. */
export function shareSegments(
	scale: 'status' | 'occupancy',
	inputs: readonly ShareInput[],
): ShareSegment[] {
	const total = inputs.reduce((sum, i) => sum + clean(i.value), 0);
	if (total <= 0) return [];
	const out: ShareSegment[] = [];
	for (const i of inputs) {
		const v = clean(i.value);
		if (v <= 0) continue;
		out.push({
			key: i.code,
			label: i.label,
			share: (v / total) * 100,
			href: i.href,
			...(scale === 'status'
				? { status: i.code as StatusCode }
				: { occupancy: i.code as OccupancyCode }),
		});
	}
	return out;
}

export interface StackedShareSpecOptions {
	readonly title: string;
	readonly caption?: string;
	readonly locale: Locale;
	readonly scale: 'status' | 'occupancy';
	readonly inputs: readonly ShareInput[];
	readonly legend?: boolean;
	readonly size?: 'sm' | 'md';
}

/** Build the spec, or null when no band carries a real share (caller emits absence). */
export function stackedShareSpec(opts: StackedShareSpecOptions): StackedShareSpec | null {
	const segments = shareSegments(opts.scale, opts.inputs);
	if (segments.length === 0) return null;
	return {
		kind: 'stacked-share',
		title: opts.title,
		caption: opts.caption,
		locale: opts.locale,
		scale: opts.scale,
		segments,
		legend: opts.legend,
		size: opts.size,
	};
}
