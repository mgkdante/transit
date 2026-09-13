// Shift severe shares on one fixed axis; missing rates remain gaps. The reference
// approximates the observation-weighted mean among displayed reporting shifts and
// requires a valid known-delay count for every contributing shift.

import type { Locale } from '$lib/i18n';
import type { AbsenceSpec, DotStripDatum, DotStripSpec } from '$lib/components/dataviz/chart';
import { SEVERE_DOMAIN } from '$lib/features/reliability/domains';
import { SHIFT_GRAIN_ORDER, severeShareToSeverity } from '$lib/features/reliability/shiftGrains';
import type { PunctualityVM } from '../clusters';

export interface TimeOfDayLabels {
	/** Accessible name (e.g. "Severe-delay share by time of day"). */
	title: string;
	/** Value unit suffix (e.g. "%"). */
	unit: string;
	/** Localized shift label for a shift-grain key. */
	shiftLabel: (grain: string) => string;
}

export function selectPunctualityTimeOfDay(
	vm: PunctualityVM,
	locale: Locale,
	labels: TimeOfDayLabels,
): DotStripSpec | AbsenceSpec {
	const order = SHIFT_GRAIN_ORDER as readonly string[];
	const rows = vm.peakOffPeak.byShift
		.slice()
		.sort((a, b) => order.indexOf(a.grain) - order.indexOf(b.grain));
	const points: DotStripDatum[] = rows.map((r) => ({
		key: r.grain,
		group: labels.shiftLabel(r.grain),
		value: r.severePct,
		severity: severeShareToSeverity(r.severePct),
	}));

	if (!points.some((p) => p.value != null)) {
		return {
			kind: 'absence',
			title: labels.title,
			locale,
			reason: 'no-observations',
			variant: 'block',
		};
	}

	// Published shift rates are rounded to 0.1 percentage point before weighting.
	let weightedTotal = 0;
	let observations = 0;
	for (const r of rows) {
		if (r.severePct == null) continue;
		const obs = r.observationCount;
		if (obs == null || !Number.isSafeInteger(obs) || obs <= 0) {
			observations = 0;
			break;
		}
		weightedTotal += r.severePct * obs;
		observations += obs;
	}

	return {
		kind: 'dot-strip',
		title: labels.title,
		locale,
		domain: SEVERE_DOMAIN,
		unit: labels.unit,
		points,
		medianRef: observations > 0 ? weightedTotal / observations : null,
		scale: 'severity',
	};
}
