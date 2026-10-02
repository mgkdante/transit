import { z } from 'zod';
import { RouteHabitsSchema, RouteDayOfWeekSchema } from './route_reliability';
import { OccupancyMixSchema } from './network';
import { isoUtc, payloadEnvelopeFields } from './types';

export const StopReliabilityPeriodSchema = z.object({
	grain: z.string(),
	otp_pct: z.number().int().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
	p50_min: z.number().nullable().optional(),
	p90_min: z.number().nullable().optional(),
	severe_pct: z.number().nullable().optional(),
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

export const StopDailyPointSchema = z.object({
	date: z.string(),
	observation_count: z.number().int(),
	severe_count: z.number().int(),
	severe_pct: z.number().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
});
export type StopDailyPoint = z.infer<typeof StopDailyPointSchema>;

export const StopReliabilitySchema = z.object({
	generated_utc: isoUtc(),
	id: z.string(),
	name: z.string().nullable().optional(),
	periods: z.array(StopReliabilityPeriodSchema).optional(),
	habits: RouteHabitsSchema.nullable().optional(),
	day_of_week: z.array(RouteDayOfWeekSchema).optional(),
	by_route: z.array(StopByRouteSchema).optional(),
	occupancy_mix: OccupancyMixSchema.nullable().optional(),
	daily: z.array(StopDailyPointSchema).optional(),
	...payloadEnvelopeFields(),
});
export type StopReliability = z.infer<typeof StopReliabilitySchema>;
