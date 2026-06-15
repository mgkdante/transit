// Internal data-viz token + glyph helpers (dataviz kit only).
//
// DOCTRINE: data marks are encoded with the dataviz scale exclusively
// (`var(--dataviz-status-*|occupancy-*|severity-*|heatmap-*|vehicle-*)`).
// Orange `--primary` is INTERACTIVE-ONLY and never encodes data. The lone
// permitted `--primary` touch in this kit is Distribution's median affordance
// MARKER line — that is a UI affordance, not a data mark.
//
// Token mapping rule (SHARED CONTRACT): map an enum value to a CSS token suffix
// by replacing '_' with '-' (e.g. status 'on_time' -> --dataviz-status-on-time).
// Glyphs: early ▼ on_time ● late ▲ severe ◆ unknown ○ (stops ■).

import type { OccupancyCode, SeverityCode, StatusCode } from '$lib/v1/schemas';

/** Enum value -> token suffix (underscores become hyphens). */
export function tokenSuffix(code: string): string {
	return code.replace(/_/g, '-');
}

/** A `var(--dataviz-status-*)` reference for a StatusCode. */
export function statusVar(code: StatusCode): string {
	return `var(--dataviz-status-${tokenSuffix(code)})`;
}

/** A `var(--dataviz-occupancy-*)` reference for an OccupancyCode. */
export function occupancyVar(code: OccupancyCode): string {
	return `var(--dataviz-occupancy-${tokenSuffix(code)})`;
}

/** A `var(--dataviz-severity-*)` reference for a SeverityCode. */
export function severityVar(code: SeverityCode): string {
	return `var(--dataviz-severity-${tokenSuffix(code)})`;
}

/** Glyph for each StatusCode — colour is never the sole channel. */
export const STATUS_GLYPH: Record<StatusCode, string> = {
	early: '▼',
	on_time: '●',
	late: '▲',
	severe: '◆',
	unknown: '○',
};

/** The stop marker glyph (per SHARED CONTRACT: stops ■). */
export const STOP_GLYPH = '■';

/**
 * The discrete heatmap ramp tokens (5 buckets, dark -> hot). A normalized
 * value in [0,1] maps to one of these; `null` MUST resolve to the no-data
 * token — NEVER bucket 0 / a sentinel.
 */
export const HEATMAP_RAMP = [
	'var(--dataviz-heatmap-0)',
	'var(--dataviz-heatmap-1)',
	'var(--dataviz-heatmap-2)',
	'var(--dataviz-heatmap-3)',
	'var(--dataviz-heatmap-4)',
] as const;

export const HEATMAP_NODATA = 'var(--dataviz-heatmap-nodata)';

/**
 * Map a normalized value in [0,1] to a heatmap ramp token. `null`/`undefined`
 * (and NaN) resolve to the no-data token — the honesty rule: surface "no data"
 * rather than colouring it like a real 0.
 */
export function heatmapColor(norm: number | null | undefined): string {
	if (norm == null || Number.isNaN(norm)) return HEATMAP_NODATA;
	const clamped = Math.min(1, Math.max(0, norm));
	const idx = Math.min(HEATMAP_RAMP.length - 1, Math.floor(clamped * HEATMAP_RAMP.length));
	return HEATMAP_RAMP[idx];
}
