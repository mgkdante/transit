// network.ts — Zod mirror of live_network.schema.json (title: "NetworkFile").
// The live network-health rollup: vehicles in service, OTP %, delay percentiles,
// status distribution, occupancy mix and feed freshness. Powers the
// network-health surface. Many headline numbers are .nullable() — the contract
// makes "no data yet" explicit, and we honour that rather than coercing to 0.

import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

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

/**
 * One bucket of the network delay distribution — the same trip-level signed
 * minutes that power delay_p50_min / delay_p90_min, binned into fixed edges.
 * `lo_min` is the inclusive lower edge (null = unbounded below); `hi_min` is the
 * exclusive upper edge (null = unbounded above); `count` defaults to 0 so the
 * full 8-bucket shape always emits (zeros included) when there ARE observations.
 */
export const DelayBucketSchema = z.object({
	// lo_min / hi_min default to null in the canonical contract → optional there,
	// so the Zod must be .optional() too (never stricter than the mirror).
	lo_min: z.number().int().nullable().optional(),
	hi_min: z.number().int().nullable().optional(),
	count: z.number().int().default(0),
});
export type DelayBucket = z.infer<typeof DelayBucketSchema>;

/**
 * One route's count of non-responding (silent) scheduled trips — a per-ROUTE
 * silent-trip tally (silent trips carry no vehicle id by definition). Both
 * fields are required WITHIN the sub-model; it only ever appears inside the
 * optional `non_responding_by_route` list.
 */
export const NonRespondingRouteSchema = z.object({
	route_id: z.string(),
	count: z.number().int(),
});
export type NonRespondingRoute = z.infer<typeof NonRespondingRouteSchema>;

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
	// Additive-optional (default None on the contract). The distribution of the
	// SAME trip-level delays that power p50/p90, binned into 8 fixed buckets;
	// null ONLY when there are zero delay observations (same guard as p50/p90).
	delay_histogram: z.array(DelayBucketSchema).nullable().optional(),
	// Additive-optional. Per-route count of silent scheduled trips (no live
	// vehicle); SUM(count) equals the scalar `non_responding`. null/absent when
	// no route is non-responding — the surface stands the section down then.
	non_responding_by_route: z.array(NonRespondingRouteSchema).nullable().optional(),
	...payloadEnvelopeFields(),
});
export type NetworkFile = z.infer<typeof NetworkFileSchema>;
