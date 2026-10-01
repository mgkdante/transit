import type { OccupancyMix } from '$lib/v1/schemas/network';
import { OCCUPANCY_CODES, type OccupancyCode } from '$lib/v1/schemas/types';
import type { ChartSpec } from '$lib/components/dataviz/chart';
import { stackedShareSpec } from '$lib/components/dataviz/chart/share';
import type { Locale } from '$lib/i18n/config';

export interface OccupancyMixOptions {
	readonly title: string;
	readonly locale: Locale;
	readonly hrefFor?: (code: OccupancyCode) => string;
}

export interface OccupancyMixVM {
	readonly hasOccupancy: boolean;
	readonly spec: ChartSpec | null;
}

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
