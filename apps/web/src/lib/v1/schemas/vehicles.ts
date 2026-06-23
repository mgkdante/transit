// vehicles.ts — Zod mirror of live_vehicles.schema.json (title: "VehiclesFile").
// One entry per in-service vehicle: position, bearing, delay band, occupancy,
// and the route/trip/next-stop it's working. Feeds the live map vehicle layer.
// status uses the closed StatusCode enum; occupancy uses the closed OccupancyCode
// enum. Everything else the GTFS-rt feed may omit is .nullable().

import { z } from 'zod';
import { isoUtc, StatusCodeSchema, OccupancyCodeSchema } from './types';

export const VehicleSchema = z.object({
	id: z.string(),
	lat: z.number(),
	lon: z.number(),
	status: StatusCodeSchema,
	updated_utc: isoUtc(),
	// Each vehicle's OWN report time (gold position_timestamp_utc) — distinct from
	// updated_utc (uniform snapshot capture time). Optional; fall back to updated_utc.
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
});
export type VehiclesFile = z.infer<typeof VehiclesFileSchema>;
