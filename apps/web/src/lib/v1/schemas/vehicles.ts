import { z } from 'zod';
import { isoUtc, StatusCodeSchema, OccupancyCodeSchema, payloadEnvelopeFields } from './types';

export const VehicleSchema = z.object({
	id: z.string(),
	lat: z.number(),
	lon: z.number(),
	status: StatusCodeSchema,
	updated_utc: isoUtc(),
	reported_utc: isoUtc().nullable().optional(),
	route: z.string().nullable().optional(),
	trip: z.string().nullable().optional(),
	next_stop: z.string().nullable().optional(),
	bearing: z.number().int().nullable().optional(),
	speed_kmh: z.number().int().nullable().optional(),
	delay_min: z.number().int().nullable().optional(),
	occupancy: OccupancyCodeSchema.nullable().optional(),
});
export type Vehicle = z.infer<typeof VehicleSchema>;

export const VehiclesFileSchema = z.object({
	generated_utc: isoUtc(),
	vehicles: z.array(VehicleSchema),
	...payloadEnvelopeFields(),
});
export type VehiclesFile = z.infer<typeof VehiclesFileSchema>;
