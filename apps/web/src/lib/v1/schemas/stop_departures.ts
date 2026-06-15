// stop_departures.ts — Zod mirror of live_stop_departures.schema.json
// (title: "StopDeparturesFile"). A map of stop_id -> ordered list of upcoming
// departures (the live "next buses" board for a stop). `stops` is an object
// keyed by stop id whose values are arrays (additionalProperties: array).

import { z } from 'zod';
import { isoUtc } from './types';

export const StopDepartureSchema = z.object({
	eta_utc: isoUtc(),
	route: z.string().nullable().optional(),
	trip: z.string().nullable().optional(),
	delay_min: z.number().int().nullable().optional(),
});
export type StopDeparture = z.infer<typeof StopDepartureSchema>;

export const StopDeparturesFileSchema = z.object({
	generated_utc: isoUtc(),
	// Only generated_utc is required; the map may be absent when no stop has
	// upcoming departures this cycle.
	stops: z.record(z.string(), z.array(StopDepartureSchema)).optional(),
});
export type StopDeparturesFile = z.infer<typeof StopDeparturesFileSchema>;
