import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

export const StopDepartureSchema = z.object({
	eta_utc: isoUtc(),
	route: z.string().nullable().optional(),
	trip: z.string().nullable().optional(),
	delay_min: z.number().int().nullable().optional(),
});
export type StopDeparture = z.infer<typeof StopDepartureSchema>;

export const StopDeparturesFileSchema = z.object({
	generated_utc: isoUtc(),
	stops: z.record(z.string(), z.array(StopDepartureSchema)).optional(),
	...payloadEnvelopeFields(),
});
export type StopDeparturesFile = z.infer<typeof StopDeparturesFileSchema>;
