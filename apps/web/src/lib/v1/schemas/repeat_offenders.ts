import { z } from 'zod';
import { HistoryDateSchema } from './history';
import { isoUtc, payloadEnvelopeFields } from './types';

export const OffenderSchema = z.object({
	type: z.string(),
	id: z.string(),
	route: z.string().nullable().optional(),
	route_name: z.string().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
	recurrence: z.string().nullable().optional(),
	recurrence_days: z.number().int().nullable().optional(),
	window_days: z.number().int().nullable().optional(),
	severity: z.string().nullable().optional(),
});
export type Offender = z.infer<typeof OffenderSchema>;

export const RepeatOffenderEntrySchema = z.object({
	type: z.string(),
	id: z.string(),
	rank: z.number().int().nullable().optional(),
	route: z.string().nullable().optional(),
	route_name: z.string().nullable().optional(),
	observation_count: z.number().int().nullable().optional(),
	severe_count: z.number().int().nullable().optional(),
	severe_pct: z.number().nullable().optional(),
	wilson_lo: z.number().nullable().optional(),
	wilson_hi: z.number().nullable().optional(),
	recurrence_days: z.number().int().nullable().optional(),
	observed_days: z.number().int().nullable().optional(),
	window_days: z.number().int().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
	severity: z.string().nullable().optional(),
});
export type RepeatOffenderEntry = z.infer<typeof RepeatOffenderEntrySchema>;

export const RepeatOffenderGrainSchema = z.object({
	grain: z.string(),
	window_days: z.number().int().nullable().optional(),
	entries: z.array(RepeatOffenderEntrySchema).optional(),
	tray: z.array(RepeatOffenderEntrySchema).optional(),
	total_ranked_trips: z.number().int().nullable().optional(),
	total_ranked_vehicles: z.number().int().nullable().optional(),
	tray_total: z.number().int().nullable().optional(),
});
export type RepeatOffenderGrain = z.infer<typeof RepeatOffenderGrainSchema>;

export const HistoricRepeatOffenderGrainSchema = RepeatOffenderGrainSchema.extend({
	grain: z.enum(['week', 'month']),
	date: HistoryDateSchema,
	window_end: HistoryDateSchema,
}).superRefine((value, ctx) => {
	if (value.date > value.window_end) {
		ctx.addIssue({
			code: 'custom',
			path: ['date'],
			message: 'historical repeat-offender window start cannot follow its end',
		});
		return;
	}
	const expectedDays = value.grain === 'week' ? 7 : 30;
	const start = Date.parse(`${value.date}T00:00:00Z`);
	const end = Date.parse(`${value.window_end}T00:00:00Z`);
	const inclusiveDays = Math.round((end - start) / 86_400_000) + 1;
	if (inclusiveDays !== expectedDays) {
		ctx.addIssue({
			code: 'custom',
			path: ['window_end'],
			message: `historical ${value.grain} endpoints must span ${expectedDays} days`,
		});
	}
	if (value.window_days != null && value.window_days !== expectedDays) {
		ctx.addIssue({
			code: 'custom',
			path: ['window_days'],
			message: `historical ${value.grain} window_days must equal ${expectedDays}`,
		});
	}
});
export type HistoricRepeatOffenderGrain = z.infer<typeof HistoricRepeatOffenderGrainSchema>;

export const RepeatOffendersSchema = z.object({
	generated_utc: isoUtc(),
	offenders: z.array(OffenderSchema).optional(),
	by_grain: z.array(RepeatOffenderGrainSchema).optional(),
	...payloadEnvelopeFields(),
});
export type RepeatOffenders = z.infer<typeof RepeatOffendersSchema>;

export const HistoricRepeatOffendersDaySchema = RepeatOffendersSchema.extend({
	date: HistoryDateSchema,
	by_grain: z.array(HistoricRepeatOffenderGrainSchema).optional(),
}).superRefine((value, ctx) => {
	const order = ['week', 'month'] as const;
	let previousPosition = -1;
	for (const [index, grain] of (value.by_grain ?? []).entries()) {
		const position = order.indexOf(grain.grain);
		if (position <= previousPosition) {
			ctx.addIssue({
				code: 'custom',
				path: ['by_grain', index, 'grain'],
				message: 'historical repeat-offender grains must be unique and in canonical order',
			});
		}
		previousPosition = position;
		if (grain.window_end !== value.date) {
			ctx.addIssue({
				code: 'custom',
				path: ['by_grain', index, 'window_end'],
				message: 'historical repeat-offender grain window_end must equal payload date',
			});
		}
	}
});
export type HistoricRepeatOffendersDay = z.infer<typeof HistoricRepeatOffendersDaySchema>;
