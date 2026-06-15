// repeat_offenders.ts (a.k.a. "récidivistes") — Zod mirror of
// historic_repeat_offenders.schema.json (title: "RepeatOffenders").
// The list of entities (routes or stops) that are repeatedly late: each carries
// a type discriminator, id, the offending route (+ name), an average delay, and
// a human recurrence string ("most weekday afternoons").

import { z } from 'zod';
import { isoUtc } from './types';

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
});
export type Offender = z.infer<typeof OffenderSchema>;

export const RepeatOffendersSchema = z.object({
	generated_utc: isoUtc(),
	offenders: z.array(OffenderSchema).optional(),
});
export type RepeatOffenders = z.infer<typeof RepeatOffendersSchema>;
