import type { TrendPoint } from '$lib/v1/schemas/network_trend';
import { OCCUPANCY_CODES, type OccupancyCode } from '$lib/v1/schemas/types';
import type { StackedShareSpec } from '$lib/components/dataviz/chart';
import { stackedShareSpec } from '$lib/components/dataviz/chart/share';
import type { Locale } from '$lib/i18n/config';

export interface OccupancyDay {
	readonly date: string;
	readonly dateLabel: string;
	readonly spec: StackedShareSpec;
}

export interface OccupancyTrendOptions {
	readonly locale: Locale;
	readonly titleFor: (dateLabel: string) => string;
}

export function selectOccupancyTrend(
	points: readonly TrendPoint[],
	dateLabel: (date: string) => string,
	occupancyLabel: (code: OccupancyCode) => string,
	opts: OccupancyTrendOptions,
): OccupancyDay[] {
	const out: OccupancyDay[] = [];
	for (const p of points) {
		const mix = p.occupancy_mix;
		if (mix == null) continue;
		const label = dateLabel(p.date);
		const spec = stackedShareSpec({
			title: opts.titleFor(label),
			locale: opts.locale,
			scale: 'occupancy',
			size: 'sm',
			inputs: OCCUPANCY_CODES.map((code: OccupancyCode) => ({
				code,
				value: mix[code] ?? null,
				label: occupancyLabel(code),
			})),
		});
		if (spec) out.push({ date: p.date, dateLabel: label, spec });
	}
	return out;
}
