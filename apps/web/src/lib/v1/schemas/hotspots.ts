import { z } from 'zod';
import { HistoryDateSchema } from './history';
import * as base from './generated/historic_hotspots';
import * as historic from './generated/historic_hotspots_day';

export const HotspotSchema = base.HotspotSchema;
export type Hotspot = z.infer<typeof HotspotSchema>;

export const HotspotEntrySchema = base.HotspotEntrySchema;
export type HotspotEntry = z.infer<typeof HotspotEntrySchema>;

export const HotspotGrainSchema = base.HotspotGrainSchema;
export type HotspotGrain = z.infer<typeof HotspotGrainSchema>;

const HISTORIC_HOTSPOT_GRAINS = ['day', 'week', 'month', 'shift'] as const;
export const HistoricHotspotGrainSchema = historic.HistoricHotspotGrainSchema;
export type HistoricHotspotGrain = z.infer<typeof HistoricHotspotGrainSchema>;

function shiftIsoDate(value: string, days: number): string {
	const [year, month, day] = value.split('-').map(Number);
	const shifted = new Date(0);
	shifted.setUTCHours(0, 0, 0, 0);
	shifted.setUTCFullYear(year, month - 1, day + days);
	return `${String(shifted.getUTCFullYear()).padStart(4, '0')}-${String(
		shifted.getUTCMonth() + 1,
	).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

export const HotspotsSchema = base.HotspotsSchema;
export type Hotspots = z.infer<typeof HotspotsSchema>;

export const HistoricHotspotsDaySchema = historic.HistoricHotspotsDaySchema.extend({
	date: HistoryDateSchema,
}).superRefine((value, ctx) => {
	let previousPosition = -1;
	const windowDays = { day: 1, week: 7, month: 30 } as const;
	for (const [index, grain] of (value.by_grain ?? []).entries()) {
		const position = HISTORIC_HOTSPOT_GRAINS.indexOf(grain.grain);
		if (position <= previousPosition) {
			ctx.addIssue({
				code: 'custom',
				path: ['by_grain', index, 'grain'],
				message: 'historical hotspot grains must be unique and in canonical order',
			});
		}
		previousPosition = position;
		if (grain.grain === 'shift') {
			if (grain.date != null || grain.window_end != null) {
				ctx.addIssue({
					code: 'custom',
					path: ['by_grain', index],
					message: 'historical hotspot shift endpoints must be null',
				});
			}
			continue;
		}
		const expectedStart = shiftIsoDate(value.date, -(windowDays[grain.grain] - 1));
		if (grain.date !== expectedStart || grain.window_end !== value.date) {
			ctx.addIssue({
				code: 'custom',
				path: ['by_grain', index],
				message: `historical hotspot ${grain.grain} endpoints must anchor to payload date`,
			});
		}
	}
});
export type HistoricHotspotsDay = z.infer<typeof HistoricHotspotsDaySchema>;
