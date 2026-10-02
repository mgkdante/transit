import { z } from 'zod';
import { HistoryDateSchema } from './history';
import { isoUtc, payloadEnvelopeFields } from './types';

export const HotspotSchema = z.object({
	rank: z.number().int(),
	type: z.string(),
	id: z.string(),
	name: z.string().nullable().optional(),
	otp_delta_pts: z.number().nullable().optional(),
	severity: z.string().nullable().optional(),
});
export type Hotspot = z.infer<typeof HotspotSchema>;

export const HotspotEntrySchema = z.object({
	rank: z.number().int().nullable().optional(),
	type: z.string(),
	id: z.string(),
	name: z.string().nullable().optional(),
	severity: z.string().nullable().optional(),
	otp_delta_pts: z.number().nullable().optional(),
	observation_count: z.number().int().nullable().optional(),
	severe_count: z.number().int().nullable().optional(),
	severe_pct: z.number().nullable().optional(),
	wilson_lo: z.number().nullable().optional(),
	wilson_hi: z.number().nullable().optional(),
	issue_count: z.number().int().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
});
export type HotspotEntry = z.infer<typeof HotspotEntrySchema>;

export const HotspotGrainSchema = z.object({
	grain: z.string(),
	date: z.string().nullable().optional(),
	window_end: z.string().nullable().optional(),
	entries: z.array(HotspotEntrySchema).optional(),
	tray: z.array(HotspotEntrySchema).optional(),
	total_ranked_routes: z.number().int().nullable().optional(),
	total_ranked_stops: z.number().int().nullable().optional(),
	tray_total: z.number().int().nullable().optional(),
});
export type HotspotGrain = z.infer<typeof HotspotGrainSchema>;

const HISTORIC_HOTSPOT_GRAINS = ['day', 'week', 'month', 'shift'] as const;
export const HistoricHotspotGrainSchema = HotspotGrainSchema.extend({
	grain: z.enum(HISTORIC_HOTSPOT_GRAINS),
});
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

export const HotspotsSchema = z.object({
	generated_utc: isoUtc(),
	hotspots: z.array(HotspotSchema).optional(),
	by_grain: z.array(HotspotGrainSchema).optional(),
	...payloadEnvelopeFields(),
});
export type Hotspots = z.infer<typeof HotspotsSchema>;

export const HistoricHotspotsDaySchema = HotspotsSchema.extend({
	date: HistoryDateSchema,
	by_grain: z.array(HistoricHotspotGrainSchema).optional(),
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
