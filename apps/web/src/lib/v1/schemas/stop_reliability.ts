// stop_reliability.ts — Zod mirror of historic_stop_reliability.schema.json
// (title: "StopReliability"). The per-stop history surface: OTP/delay per grain
// period (day grain carries real p50/p90; week/month carry an observation-
// weighted mean) and a per-route avg-delay breakdown at this stop.
// Fetched per stop id under stop_reliability_prefix (404 = empty state).

import { z } from 'zod';
import { RouteHabitsSchema } from './route_reliability';
import { isoUtc } from './types';

export const StopReliabilityPeriodSchema = z.object({
	// Free-string grain the pipeline owns; NOT the web filter Grain enum.
	grain: z.string(),
	otp_pct: z.number().int().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
	p50_min: z.number().nullable().optional(),
	p90_min: z.number().nullable().optional(),
	severe_pct: z.number().nullable().optional(),
});
export type StopReliabilityPeriod = z.infer<typeof StopReliabilityPeriodSchema>;

export const StopByRouteSchema = z.object({
	route: z.string(),
	avg_delay_min: z.number().nullable().optional(),
});
export type StopByRoute = z.infer<typeof StopByRouteSchema>;

export const StopReliabilitySchema = z.object({
	generated_utc: isoUtc(),
	id: z.string(),
	name: z.string().nullable().optional(),
	periods: z.array(StopReliabilityPeriodSchema).optional(),
	// per-stop 7x24 severe-delay heatmap (RouteHabits shape, 'severe_relative' scale).
	habits: RouteHabitsSchema.nullable().optional(),
	by_route: z.array(StopByRouteSchema).optional(),
});
export type StopReliability = z.infer<typeof StopReliabilitySchema>;
