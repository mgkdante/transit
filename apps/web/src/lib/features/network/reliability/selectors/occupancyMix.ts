// occupancyMix — the live crowding-mix spec (the 5 OccupancyCodes by fraction).
//
// P5.2: emits a `stacked-share` ChartSpec for the ONE <Chart> renderer (the legacy
// StackedBar primitive is retired; the 100% bar stays EXEMPT from the absolute-
// magnitude domain law). Honesty: occupancy_mix may be null/absent when no telemetry
// was received this cycle — `hasOccupancy` false stands the whole tile down rather
// than fabricating an even split (`spec` is null in that case, never a zeroed strip).

import { OCCUPANCY_CODES, type OccupancyCode, type OccupancyMix } from '$lib/v1/schemas';
import type { ChartSpec } from '$lib/components/dataviz/chart';
import { stackedShareSpec } from '$lib/components/dataviz/chart/share';
import type { Locale } from '$lib/i18n/config';

export interface OccupancyMixOptions {
	/** Accessible title for the strip (the legacy `label`). */
	readonly title: string;
	readonly locale: Locale;
	/** Band → the localized map cross-filter URL (omit ⇒ non-navigating bands). */
	readonly hrefFor?: (code: OccupancyCode) => string;
}

export interface OccupancyMixVM {
	/** True when the cycle received real occupancy telemetry (never fabricate a split). */
	readonly hasOccupancy: boolean;
	/** The 100%-stacked crowding spec; null when the tile stands down. */
	readonly spec: ChartSpec | null;
}

/** code → localized occupancy band label (the SHARED $lib/v1/enumLabels vocabulary). */
export function selectOccupancyMix(
	mix: OccupancyMix | null | undefined,
	occupancyLabel: (code: OccupancyCode) => string,
	opts: OccupancyMixOptions,
): OccupancyMixVM {
	const raw = mix ?? null;
	if (raw == null) return { hasOccupancy: false, spec: null };
	return {
		hasOccupancy: true,
		spec: stackedShareSpec({
			title: opts.title,
			locale: opts.locale,
			scale: 'occupancy',
			legend: true,
			size: 'md',
			inputs: OCCUPANCY_CODES.map((code: OccupancyCode) => ({
				code,
				value: raw[code] ?? null,
				label: occupancyLabel(code),
				href: opts.hrefFor?.(code),
			})),
		}),
	};
}
