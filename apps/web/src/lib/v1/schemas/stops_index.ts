import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

export const StopIndexEntrySchema = z.object({
	id: z.string(),
	name: z.string(),
	lat: z.number(),
	lon: z.number(),
	code: z.string().nullable().optional(),
	mode: z.string().nullable().optional(),
	routes: z.array(z.string()).optional(),
});
export type StopIndexEntry = z.infer<typeof StopIndexEntrySchema>;

export const StopsIndexSchema = z.object({
	generated_utc: isoUtc(),
	stops: z.array(StopIndexEntrySchema),
	...payloadEnvelopeFields(),
});
export type StopsIndex = z.infer<typeof StopsIndexSchema>;
