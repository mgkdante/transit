// trips.ts — Zod mirror of live_trips.schema.json (title: "TripsFile").
// A map of trip_id -> Trip, each Trip carrying its status band, route, current
// delay, and the ordered ETA list for its remaining stops. `trips` is an object
// keyed by trip id (additionalProperties), not an array.

import { z } from 'zod';
import { isoUtc, StatusCodeSchema } from './types';

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
	// Defaults to [] in the pipeline; absent on the wire = no remaining stops known.
	stops: z.array(StopEtaSchema).optional(),
});
export type Trip = z.infer<typeof TripSchema>;

export const TripsFileSchema = z.object({
	generated_utc: isoUtc(),
	trips: z.record(z.string(), TripSchema),
});
export type TripsFile = z.infer<typeof TripsFileSchema>;
