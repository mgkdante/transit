import type { Locale } from '$lib/i18n';
import type { AbsenceSpec, MagnitudeBarsSpec, MagnitudeDatum } from '$lib/components/dataviz/chart';
import { DELAY_POS_DOMAIN } from '$lib/features/reliability/domains';
import { delayMinToSeverity } from '$lib/features/reliability/shiftGrains';
import { OCCUPANCY_CODES, type OccupancyCode } from '$lib/v1/schemas/types';
import type { CrowdingDelayCell } from '$lib/v1';

export interface CrowdingDelayLabels {
	title: string;
	rowLabel: string;
	xLabel: string;
	unit: string;
	bandLabel: (code: OccupancyCode) => string;
	noDataMarker: string;
	noteFor?: (cell: CrowdingDelayCell) => string | undefined;
}

export interface CrowdingDelayResult {
	spec: MagnitudeBarsSpec | AbsenceSpec;
	hasData: boolean;
}

export function selectCrowdingDelay(
	cells: readonly CrowdingDelayCell[],
	locale: Locale,
	labels: CrowdingDelayLabels,
): CrowdingDelayResult {
	const index: Partial<Record<string, CrowdingDelayCell>> = {};
	for (const c of cells) index[c.band] = c;

	const rows: MagnitudeDatum[] = OCCUPANCY_CODES.map((code: OccupancyCode) => {
		const cell = index[code];
		const value = cell?.avg_delay_min ?? null;
		const base = labels.bandLabel(code);
		return {
			key: code,
			label: value != null ? base : `${base} · ${labels.noDataMarker}`,
			value,
			severity: delayMinToSeverity(value),
			note: value != null && cell ? labels.noteFor?.(cell) : undefined,
			absentReason: value == null ? ('no-observations' as const) : undefined,
		};
	});

	const hasData = rows.some((r) => r.value != null);
	if (!hasData) {
		return {
			spec: {
				kind: 'absence',
				title: labels.title,
				locale,
				reason: 'no-observations',
				variant: 'block',
			},
			hasData,
		};
	}

	return {
		spec: {
			kind: 'magnitude-bars',
			mark: 'bar',
			title: labels.title,
			locale,
			domain: DELAY_POS_DOMAIN,
			unit: labels.unit,
			rowLabel: labels.rowLabel,
			xLabel: labels.xLabel,
			rows,
			sort: 'given',
			scale: 'severity',
		},
		hasData,
	};
}
