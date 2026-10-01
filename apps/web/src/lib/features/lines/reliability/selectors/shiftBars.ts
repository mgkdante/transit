import type { Locale } from '$lib/i18n';
import type { AbsenceSpec, MagnitudeBarsSpec, MagnitudeDatum } from '$lib/components/dataviz/chart';
import type { SeverityCode } from '$lib/v1/schemas';

export interface ShiftBarDatum {
	readonly key: string;
	readonly label: string;
	readonly value: number | null;
	readonly severity: SeverityCode;
	readonly note?: string;
}

export interface ShiftBarsOpts {
	readonly title: string;
	readonly rowLabel: string;
	readonly xLabel: string;
	readonly unit: string;
	readonly domain: readonly [number, number];
	readonly noDataMarker: string;
}

export function selectShiftBars(
	rows: readonly ShiftBarDatum[],
	locale: Locale,
	opts: ShiftBarsOpts,
): MagnitudeBarsSpec | AbsenceSpec {
	const out: MagnitudeDatum[] = rows.map((r) => ({
		key: r.key,
		label: r.value != null ? r.label : `${r.label} · ${opts.noDataMarker}`,
		value: r.value,
		severity: r.severity,
		note: r.value != null ? r.note : undefined,
		absentReason: r.value == null ? ('no-observations' as const) : undefined,
	}));

	if (!out.some((r) => r.value != null)) {
		return {
			kind: 'absence',
			title: opts.title,
			locale,
			reason: 'no-observations',
			variant: 'block',
		};
	}

	return {
		kind: 'magnitude-bars',
		mark: 'bar',
		title: opts.title,
		locale,
		domain: [opts.domain[0], opts.domain[1]],
		unit: opts.unit,
		rowLabel: opts.rowLabel,
		xLabel: opts.xLabel,
		rows: out,
		sort: 'given',
		scale: 'severity',
	};
}
