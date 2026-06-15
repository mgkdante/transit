// network.ts — Zod mirror of live_network.schema.json (title: "NetworkFile").
// The live network-health rollup: vehicles in service, OTP %, delay percentiles,
// status distribution, occupancy mix and feed freshness. Powers the
// network-health surface. Many headline numbers are .nullable() — the contract
// makes "no data yet" explicit, and we honour that rather than coercing to 0.

import { z } from 'zod';
import { isoUtc } from './types';

/** Count of vehicles in each delay band. Defaults to 0 per key in the schema. */
export const StatusDistSchema = z.object({
	early: z.number().int().default(0),
	on_time: z.number().int().default(0),
	late: z.number().int().default(0),
	severe: z.number().int().default(0),
	unknown: z.number().int().default(0),
});
export type StatusDist = z.infer<typeof StatusDistSchema>;

/** Share of telemetry-reporting vehicles in each occupancy band (0..1). */
export const OccupancyMixSchema = z.object({
	empty: z.number().default(0),
	many_seats: z.number().default(0),
	few_seats: z.number().default(0),
	standing: z.number().default(0),
	full: z.number().default(0),
});
export type OccupancyMix = z.infer<typeof OccupancyMixSchema>;

export const NetworkFileSchema = z.object({
	generated_utc: isoUtc(),
	vehicles_in_service: z.number().int(),
	// null = no on-time signal this cycle (e.g. feed gap) — render unknown, not 0.
	on_time_pct: z.number().int().nullable(),
	status_dist: StatusDistSchema,
	delay_p50_min: z.number().int().nullable(),
	delay_p90_min: z.number().int().nullable(),
	non_responding: z.number().int(),
	feed_freshness_s: z.number().int().nullable(),
	coverage_pct: z.number().int().nullable(),
	// null when no occupancy telemetry was received this cycle.
	occupancy_mix: OccupancyMixSchema.nullable().optional(),
});
export type NetworkFile = z.infer<typeof NetworkFileSchema>;
