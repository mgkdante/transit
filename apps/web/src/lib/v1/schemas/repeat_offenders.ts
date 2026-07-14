// repeat_offenders.ts (a.k.a. "récidivistes") — Zod mirror of
// historic_repeat_offenders.schema.json (title: "RepeatOffenders").
// The list of entities (routes or stops) that are repeatedly late: each carries
// a type discriminator, id, the offending route (+ name), an average delay, and
// a human recurrence string ("most weekday afternoons").
//
// S14 additive: the scalar offenders[] grows STRUCTURED recurrence_days /
// window_days / severity fields (so the web stops parsing "N/14d" strings and
// stops re-deriving severity), and a NEW by_grain[] carries the per-entity
// (trip|vehicle) windowed recurrence ladders (RepeatOffenderGrain →
// RepeatOffenderEntry). Every new field is optional-with-default null, so an OLD
// payload (no by_grain, no structured offender fields) still validates.

import { z } from 'zod';
import { HistoryDateSchema } from './history';
import { isoUtc, payloadEnvelopeFields } from './types';

export const OffenderSchema = z.object({
	// 'route' | 'stop' discriminator — free string the pipeline owns, not a
	// closed enum in the contract.
	type: z.string(),
	id: z.string(),
	route: z.string().nullable().optional(),
	route_name: z.string().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
	// Human recurrence description (e.g. "weekday PM peaks"); null when absent.
	recurrence: z.string().nullable().optional(),
	// S14 additive-structured: the machine-readable recurrence count + its window
	// (days) + the published severity band — so the web reads these directly instead
	// of parsing the "N/Md" recurrence string or re-deriving severity client-side.
	recurrence_days: z.number().int().nullable().optional(),
	window_days: z.number().int().nullable().optional(),
	// Free-string severity from the pipeline (the repeat_offender vocabulary:
	// critical|high|watch), NOT the SeverityCode alert enum. null when absent.
	severity: z.string().nullable().optional(),
});
export type Offender = z.infer<typeof OffenderSchema>;

// S14 additive: one entity's windowed recurrence reading in a by_grain ladder. The
// entity is a TRIP or a VEHICLE (type discriminates) on ONE route; entries are
// ranked worst-first by the Wilson LOWER bound of the severe-observation rate
// (severe_pct is the bar's RANK variable). recurrence_days ("N of M observed days")
// is EVIDENCE, not the rank key. rank is the 1-based PER-KIND ladder position (rank
// restarts per kind, so the web filters entries[] by type into per-kind tabs).
export const RepeatOffenderEntrySchema = z.object({
	// 'trip' | 'vehicle' discriminator — free string the pipeline owns.
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
	// "N of M observed days" — the natural-frequency recurrence evidence.
	recurrence_days: z.number().int().nullable().optional(),
	observed_days: z.number().int().nullable().optional(),
	window_days: z.number().int().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
	// Published severity band (critical|high|watch); null when absent.
	severity: z.string().nullable().optional(),
});
export type RepeatOffenderEntry = z.infer<typeof RepeatOffenderEntrySchema>;

// S14 additive: one re-granulated recurrence ladder for ONE grain. grain =
// 'week'|'month' (day is absent — "repeat" is undefined on a single day).
// window_days = the trailing window span. entries = a MIXED trip+vehicle array
// (type discriminates) ranked PER KIND — the web splits it into per-kind tabs.
// total_ranked_trips / total_ranked_vehicles = the PRE-truncation ranked counts per
// kind (the honest shown/total denominators). tray = the un-ranked sub-MIN_N tail;
// tray_total = the pre-cap tray count.
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
	// S14 additive-optional: the re-granulated per-entity ladders (scalar
	// offenders[] stays as-is). Absent on an OLD payload → the web falls back to the
	// legacy ledger.
	by_grain: z.array(RepeatOffenderGrainSchema).optional(),
	...payloadEnvelopeFields(),
});
export type RepeatOffenders = z.infer<typeof RepeatOffendersSchema>;

export const HistoricRepeatOffendersDaySchema = RepeatOffendersSchema.extend({
	date: HistoryDateSchema,
	by_grain: z.array(HistoricRepeatOffenderGrainSchema).optional(),
}).superRefine((value, ctx) => {
	for (const [index, grain] of (value.by_grain ?? []).entries()) {
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
