// selectShiftBars — a per-shift magnitude-bars chart (A12, S7 P5). One bar per time-of-day
// shift on a FIXED absolute domain, in the natural am→night shift order (never re-sorted by
// value). Used for the §2 regularity reads (excess wait / CoV / bunched share by shift): one
// clean cross-shift comparison per metric, replacing the cramped per-shift row stack. Honest
// per-shift absence: a null reading keeps its labelled row but reads "no data", never a fake-0
// bar. The severity bands the bar colour; a `note` rides the hover tooltip.

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
	/** Localized shift/day-type heading for the AT table mirror. */
	readonly rowLabel: string;
	/** Localized value-axis (x) title. */
	readonly xLabel: string;
	/** Value unit suffix (e.g. " min", "%", ""). */
	readonly unit: string;
	/** The fixed absolute [0, hi] domain the bar scales against. */
	readonly domain: readonly [number, number];
	/** Short marker appended to an absent shift's label (e.g. "no data"). */
	readonly noDataMarker: string;
}

/**
 * Build the per-shift magnitude-bars spec, or an absence spec when no shift carries a real
 * reading. Order is GIVEN (the caller passes shifts in am→night order); the bar never
 * re-sorts a fixed time axis.
 */
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
