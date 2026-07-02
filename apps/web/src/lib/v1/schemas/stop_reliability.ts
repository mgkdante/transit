// stop_reliability.ts — Zod mirror of historic_stop_reliability.schema.json
// (title: "StopReliability"). The per-stop history surface: OTP/delay per grain
// period (day grain carries real p50/p90; week/month carry an observation-
// weighted mean) and a per-route avg-delay breakdown at this stop.
// Fetched per stop id under stop_reliability_prefix (404 = empty state).

import { z } from 'zod';
import { RouteHabitsSchema, RouteDayOfWeekSchema } from './route_reliability';
// Reuse the canonical OccupancyMixSchema from the network surface — the SAME
// source route_reliability.ts imports it from. The crowding band-shares are one
// shape across the network / lines / stops surfaces; never re-declare it.
import { OccupancyMixSchema } from './network';
import { isoUtc, payloadEnvelopeFields } from './types';

export const StopReliabilityPeriodSchema = z.object({
	// Free-string grain the pipeline owns; NOT the web filter Grain enum.
	grain: z.string(),
	otp_pct: z.number().int().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
	p50_min: z.number().nullable().optional(),
	p90_min: z.number().nullable().optional(),
	severe_pct: z.number().nullable().optional(),
	// Chart Doctrine honesty fields (slice-S3, additive-optional). CAVEAT: stop otp_pct
	// is the SEVERE-delay proxy, so wilson_lo/wilson_hi bound the NOT-SEVERE proportion
	// (PERCENT), NOT a real OTP — do not rank stops and routes on one Wilson scale.
	observation_count: z.number().int().nullable().optional(),
	wilson_lo: z.number().nullable().optional(),
	wilson_hi: z.number().nullable().optional(),
});
export type StopReliabilityPeriod = z.infer<typeof StopReliabilityPeriodSchema>;

export const StopByRouteSchema = z.object({
	route: z.string(),
	avg_delay_min: z.number().nullable().optional(),
});
export type StopByRoute = z.infer<typeof StopByRouteSchema>;

// per-stop weekday seasonality (ISO 1=Mon..7=Sun). The DB contract reuses the
// canonical RouteDayOfWeek $def for the stop surface, so the stop day_of_week
// item type is exactly RouteDayOfWeek — reuse the schema rather than duplicate it.

export const StopReliabilitySchema = z.object({
	generated_utc: isoUtc(),
	id: z.string(),
	name: z.string().nullable().optional(),
	periods: z.array(StopReliabilityPeriodSchema).optional(),
	// per-stop 7x24 severe-delay heatmap (RouteHabits shape, 'severe_relative' scale).
	habits: RouteHabitsSchema.nullable().optional(),
	// per-stop weekday seasonality (ISO 1=Mon..7=Sun) — reuses RouteDayOfWeek.
	day_of_week: z.array(RouteDayOfWeekSchema).optional(),
	by_route: z.array(StopByRouteSchema).optional(),
	// trailing-window crowding band-shares — the occupancy of buses OBSERVED AT
	// this stop (GTFS-RT VehiclePosition stop_id), NOT a stop attribute. null when
	// no occupancy telemetry was attributed to this stop. Reuses OccupancyMixSchema.
	occupancy_mix: OccupancyMixSchema.nullable().optional(),
	...payloadEnvelopeFields(),
});
export type StopReliability = z.infer<typeof StopReliabilitySchema>;
