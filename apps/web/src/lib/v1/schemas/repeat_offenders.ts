import { z } from 'zod';
import { HistoryDateSchema } from './history';
import * as base from './generated/historic_repeat_offenders';
import * as historic from './generated/historic_repeat_offenders_day';

export const OffenderSchema = base.OffenderSchema;
export type Offender = z.infer<typeof OffenderSchema>;

export const RepeatOffenderEntrySchema = base.RepeatOffenderEntrySchema;
export type RepeatOffenderEntry = z.infer<typeof RepeatOffenderEntrySchema>;

export const RepeatOffenderGrainSchema = base.RepeatOffenderGrainSchema;
export type RepeatOffenderGrain = z.infer<typeof RepeatOffenderGrainSchema>;

export const HistoricRepeatOffenderGrainSchema = historic.HistoricRepeatOffenderGrainSchema.extend({
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

export const RepeatOffendersSchema = base.RepeatOffendersSchema;
export type RepeatOffenders = z.infer<typeof RepeatOffendersSchema>;

export const HistoricRepeatOffendersDaySchema = historic.HistoricRepeatOffendersDaySchema.extend({
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
