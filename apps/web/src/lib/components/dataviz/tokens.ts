import type { OccupancyCode, SeverityCode, StatusCode } from '$lib/v1/schemas';

export function tokenSuffix(code: string): string {
	return code.replace(/_/g, '-');
}

export function statusVar(code: StatusCode): string {
	return `var(--dataviz-status-${tokenSuffix(code)})`;
}

export function occupancyVar(code: OccupancyCode): string {
	return `var(--dataviz-occupancy-${tokenSuffix(code)})`;
}

export function severityVar(code: SeverityCode): string {
	return `var(--dataviz-severity-${tokenSuffix(code)})`;
}

export const STATUS_GLYPH: Record<StatusCode, string> = {
	early: '▼',
	on_time: '●',
	late: '▲',
	severe: '◆',
	unknown: '○',
};

export const OCCUPANCY_GLYPH: Record<OccupancyCode, string> = {
	empty: '▁',
	many_seats: '▃',
	few_seats: '▅',
	standing: '▇',
	full: '⊠',
};

export const OCCUPANCY_NODATA_GLYPH = '◌';

export function occupancyGlyph(code: OccupancyCode | null | undefined): string {
	return code == null ? OCCUPANCY_NODATA_GLYPH : OCCUPANCY_GLYPH[code];
}

export const STOP_GLYPH = '■';

export const HEATMAP_RAMP = [
	'var(--dataviz-heatmap-0)',
	'var(--dataviz-heatmap-1)',
	'var(--dataviz-heatmap-2)',
	'var(--dataviz-heatmap-3)',
	'var(--dataviz-heatmap-4)',
] as const;

export const HEATMAP_NODATA = 'var(--dataviz-heatmap-nodata)';

export function heatmapColor(norm: number | null | undefined): string {
	if (norm == null || Number.isNaN(norm)) return HEATMAP_NODATA;
	const clamped = Math.min(1, Math.max(0, norm));
	const idx = Math.min(HEATMAP_RAMP.length - 1, Math.floor(clamped * HEATMAP_RAMP.length));
	return HEATMAP_RAMP[idx];
}
