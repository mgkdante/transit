import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

export const StatusDistSchema = z.object({
	early: z.number().int().default(0),
	on_time: z.number().int().default(0),
	late: z.number().int().default(0),
	severe: z.number().int().default(0),
	unknown: z.number().int().default(0),
});
export type StatusDist = z.infer<typeof StatusDistSchema>;

export const OccupancyMixSchema = z.object({
	empty: z.number().default(0),
	many_seats: z.number().default(0),
	few_seats: z.number().default(0),
	standing: z.number().default(0),
	full: z.number().default(0),
});
export type OccupancyMix = z.infer<typeof OccupancyMixSchema>;

export const DelayBucketSchema = z.object({
	lo_min: z.number().int().nullable().optional(),
	hi_min: z.number().int().nullable().optional(),
	count: z.number().int().default(0),
});
export type DelayBucket = z.infer<typeof DelayBucketSchema>;

export const NonRespondingRouteSchema = z.object({
	route_id: z.string(),
	count: z.number().int(),
});
export type NonRespondingRoute = z.infer<typeof NonRespondingRouteSchema>;

export const NetworkFileSchema = z.object({
	generated_utc: isoUtc(),
	vehicles_in_service: z.number().int(),
	on_time_pct: z.number().int().nullable(),
	status_dist: StatusDistSchema,
	delay_p50_min: z.number().int().nullable(),
	delay_p90_min: z.number().int().nullable(),
	non_responding: z.number().int(),
	feed_freshness_s: z.number().int().nullable(),
	coverage_pct: z.number().int().nullable(),
	occupancy_mix: OccupancyMixSchema.nullable().optional(),
	delay_histogram: z.array(DelayBucketSchema).nullable().optional(),
	non_responding_by_route: z.array(NonRespondingRouteSchema).nullable().optional(),
	...payloadEnvelopeFields(),
});
export type NetworkFile = z.infer<typeof NetworkFileSchema>;
