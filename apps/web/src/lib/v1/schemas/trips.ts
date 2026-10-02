import { z } from 'zod';
import { isoUtc, StatusCodeSchema, payloadEnvelopeFields } from './types';

export const StopEtaSchema = z.object({
	stop: z.string(),
	eta_utc: isoUtc(),
	delay_min: z.number().int().nullable().optional(),
});
export type StopEta = z.infer<typeof StopEtaSchema>;

export const TripSchema = z.object({
	status: StatusCodeSchema,
	route: z.string().nullable().optional(),
	delay_min: z.number().int().nullable().optional(),
	stops: z.array(StopEtaSchema).optional(),
});
export type Trip = z.infer<typeof TripSchema>;

export const TripsFileSchema = z.object({
	generated_utc: isoUtc(),
	trips: z.record(z.string(), TripSchema),
	...payloadEnvelopeFields(),
});
export type TripsFile = z.infer<typeof TripsFileSchema>;
