import type { Locale } from '#lib/i18n/index.ts';
import type { StackedShareSpec, ShareSegment } from '#lib/components/dataviz/chart/ChartSpec.ts';
import { OCCUPANCY_CODES, type OccupancyCode } from '#lib/v1/schemas/types.ts';

export interface OccupancyShareOpts {
	readonly title: string;
	readonly label: (code: OccupancyCode) => string;
}

export type OccupancyMix = Partial<Record<OccupancyCode, number | null>> | null;

export function selectOccupancyShare(
	mix: OccupancyMix,
	locale: Locale,
	opts: OccupancyShareOpts,
): StackedShareSpec | null {
	if (!mix) return null;
	const total = OCCUPANCY_CODES.reduce((sum, code) => {
		const v = mix[code];
		return sum + (v != null && v > 0 ? v : 0);
	}, 0);
	if (total <= 0) return null;

	const segments: ShareSegment[] = [];
	for (const code of OCCUPANCY_CODES) {
		const v = mix[code];
		if (v == null || v <= 0) continue;
		segments.push({
			key: code,
			label: opts.label(code),
			share: (v / total) * 100,
			occupancy: code,
		});
	}
	return { kind: 'stacked-share', title: opts.title, locale, scale: 'occupancy', segments };
}
