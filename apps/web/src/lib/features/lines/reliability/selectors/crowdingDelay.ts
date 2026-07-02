// selectCrowdingDelay — the §04 "delay by crowding" magnitude bars (A12).
//
// Avg delay per occupancy band on the FIXED DELAY_POS_DOMAIN, in the natural crowding
// order (empty→full) so "more crowded → more delay" reads as a downward slope — and the
// same delay renders the same length as the worst-stops list. Honest per-band absence: a
// contract-omitted band OR a present-but-null one keeps its row + label (the mark renders
// every y-label) but gets an explicit "no data" marker instead of a fake-0 bar. The
// secondary p50-typical + sample n ride the hover tooltip via `note`.

import type { Locale } from '$lib/i18n';
import type { AbsenceSpec, MagnitudeBarsSpec, MagnitudeDatum } from '$lib/components/dataviz/chart';
import { DELAY_POS_DOMAIN } from '$lib/features/reliability/domains';
import { delayMinToSeverity } from '$lib/features/reliability/shiftGrains';
import { OCCUPANCY_CODES, type OccupancyCode } from '$lib/v1/schemas';
import type { CrowdingDelayCell } from '$lib/v1';

export interface CrowdingDelayLabels {
	/** Accessible name + tooltip fallback (the sub-block heading). */
	title: string;
	/** Localized value-axis title (e.g. "Avg delay"). */
	xLabel: string;
	/** Value unit suffix (e.g. " min"). */
	unit: string;
	/** Localized band label for an occupancy code. */
	bandLabel: (code: OccupancyCode) => string;
	/** Short marker appended to an absent band's label (e.g. "no data"). */
	noDataMarker: string;
	/** Optional secondary tooltip line for a present cell (e.g. "typical 0.4 min · n=120"). */
	noteFor?: (cell: CrowdingDelayCell) => string | undefined;
}

export interface CrowdingDelayResult {
	spec: MagnitudeBarsSpec | AbsenceSpec;
	/** True when at least one band carries a real avg delay. */
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
			xLabel: labels.xLabel,
			rows,
			sort: 'given', // fixed occupancy axis, never re-sorted by value
			scale: 'severity',
		},
		hasData,
	};
}
