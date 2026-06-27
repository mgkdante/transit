// selectHeadwayDumbbell — the §02 scheduled-vs-observed headway dumbbell (A8).
//
// One row per shift: the scheduled headway ● —— ● the observed headway, on the fixed
// HEADWAY_DOMAIN, so the GAP (excess wait) reads at a glance ("scheduled every 8 min,
// actually every 13"). The observed dot is severity-coloured (bunching), the scheduled dot
// is the muted reference. Honest absence: a shift missing either endpoint keeps its
// labelled row but reads "no data" (never a fabricated bar); when no shift has BOTH
// endpoints the one <Chart> shows the absence chip itself.

import type { Locale } from '$lib/i18n';
import type { AbsenceSpec, DumbbellSpec, DumbbellDatum } from '$lib/components/dataviz/chart';
import { HEADWAY_DOMAIN } from '$lib/features/reliability/domains';
import type { SeverityCode } from '$lib/v1/schemas';

export interface DumbbellInputRow {
	key: string;
	label: string;
	scheduled: number | null;
	observed: number | null;
	excess: number | null;
	severity?: SeverityCode;
	/** Pre-built secondary tooltip line (e.g. "CoV 0.42 · 28% bunched"). */
	note?: string;
}

export interface HeadwayDumbbellLabels {
	title: string;
	/** Localized value-axis title (e.g. "Headway"). */
	xLabel: string;
	/** Value unit suffix (e.g. " min"). */
	unit: string;
	/** Legend/tooltip label for the scheduled endpoint. */
	scheduledLabel: string;
	/** Legend/tooltip label for the observed endpoint. */
	observedLabel: string;
	/** Short marker appended to a row missing an endpoint (e.g. "no data"). */
	noDataMarker: string;
}

export interface HeadwayDumbbellResult {
	spec: DumbbellSpec | AbsenceSpec;
	/** True when at least one shift carries BOTH a scheduled + observed headway. */
	hasData: boolean;
}

export function selectHeadwayDumbbell(
	rows: readonly DumbbellInputRow[],
	locale: Locale,
	labels: HeadwayDumbbellLabels,
): HeadwayDumbbellResult {
	const complete = (r: DumbbellInputRow): boolean => r.scheduled != null && r.observed != null;
	const hasData = rows.some(complete);

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

	const datums: DumbbellDatum[] = rows.map((r) => ({
		key: r.key,
		label: complete(r) ? r.label : `${r.label} · ${labels.noDataMarker}`,
		scheduled: r.scheduled,
		observed: r.observed,
		excess: r.excess,
		severity: r.severity,
		note: complete(r) ? r.note : undefined,
		absentReason: complete(r) ? undefined : ('no-observations' as const),
	}));

	return {
		spec: {
			kind: 'dumbbell',
			title: labels.title,
			locale,
			domain: HEADWAY_DOMAIN,
			unit: labels.unit,
			xLabel: labels.xLabel,
			rows: datums,
			scale: 'severity',
			scheduledLabel: labels.scheduledLabel,
			observedLabel: labels.observedLabel,
		},
		hasData,
	};
}
