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
