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
	note?: string;
}

export interface HeadwayDumbbellLabels {
	title: string;
	xLabel: string;
	unit: string;
	scheduledLabel: string;
	observedLabel: string;
	noDataMarker: string;
}

export interface HeadwayDumbbellResult {
	spec: DumbbellSpec | AbsenceSpec;
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
