import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

export const RouteIndexEntrySchema = z.object({
	id: z.string(),
	short: z.string(),
	type: z.number().int(),
	long: z.string().nullable().optional(),
	color: z.string().nullable().optional(),
	reliability: z.boolean().optional(),
});
export type RouteIndexEntry = z.infer<typeof RouteIndexEntrySchema>;

export const RoutesIndexSchema = z.object({
	generated_utc: isoUtc(),
	routes: z.array(RouteIndexEntrySchema),
	...payloadEnvelopeFields(),
});
export type RoutesIndex = z.infer<typeof RoutesIndexSchema>;
