// selectPunctualityTimeOfDay — the §01 "by time of day" severe-share Cleveland dot-strip.
//
// One dot per shift (AM peak → night) on ONE shared, fixed severe-share axis
// (SEVERE_DOMAIN [0,100]) — the dots are NEVER connected (A8); the all-day mean is a
// vertical reference. The dot's POSITION encodes the value (the primary read); its colour
// is the severity band (secondary). A null-severe shift is an honest gap (no dot), never a
// fabricated 0. Reads the whole-window shift pattern the contract aggregates, so it shows
// its own (time-of-day) dimension regardless of the page grain — the matrix, just not the
// time axis.

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
	const points: DotStripDatum[] = vm.peakOffPeak.byShift
		.slice()
		.sort((a, b) => order.indexOf(a.grain) - order.indexOf(b.grain))
		.map((r) => ({
			key: r.grain,
			group: labels.shiftLabel(r.grain),
			value: r.severePct,
			severity: severeShareToSeverity(r.severePct),
		}));

	const reals = points.map((p) => p.value).filter((v): v is number => v != null);
	if (reals.length === 0) {
		return {
			kind: 'absence',
			title: labels.title,
			locale,
			reason: 'no-observations',
			variant: 'block',
		};
	}

	// The all-day mean reference — a plain sum/length (NEVER Math.max over a spread).
	const mean = reals.reduce((s, v) => s + v, 0) / reals.length;

	return {
		kind: 'dot-strip',
		title: labels.title,
		locale,
		domain: SEVERE_DOMAIN,
		unit: labels.unit,
		points,
		medianRef: mean,
		scale: 'severity',
	};
}
