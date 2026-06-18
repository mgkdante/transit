// route_reliability.ts — Zod mirror of historic_route_reliability.schema.json
// (title: "RouteReliability"). The per-route history surface: OTP/delay
// percentiles per grain period, scheduled-vs-observed headway by shift, a
// time-of-day "habits" heatmap, and the weakest stops on the route.
// Fetched per route id under route_reliability_prefix (404 = empty state).

import { z } from 'zod';
import { isoUtc } from './types';

export const ReliabilityPeriodSchema = z.object({
	// NOTE: free-string grain the pipeline owns (e.g. 'day'/'week'/'month'/
	// '2026-06'); NOT validated against the web filter Grain enum.
	grain: z.string(),
	date: z.string().nullable().optional(),
	otp_pct: z.number().int().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
	p50_min: z.number().nullable().optional(),
	p90_min: z.number().nullable().optional(),
	severe_pct: z.number().nullable().optional(),
});
export type ReliabilityPeriod = z.infer<typeof ReliabilityPeriodSchema>;

export const HeadwayPeriodSchema = z.object({
	shift: z.string(),
	scheduled_min: z.number().nullable().optional(),
	observed_min: z.number().nullable().optional(),
	excess_wait_min: z.number().nullable().optional(),
});
export type HeadwayPeriod = z.infer<typeof HeadwayPeriodSchema>;

export const RouteHabitsSchema = z.object({
	// e.g. 'repeat_problem_relative' — drives the heatmap normalization on the
	// consumer side. RAW string; never resolveLabel.
	scale: z.string(),
	// 2-D heatmap; each cell is a number or null (null = no data, not zero).
	matrix: z.array(z.array(z.number().nullable())).optional(),
});
export type RouteHabits = z.infer<typeof RouteHabitsSchema>;

export const WeakStopSchema = z.object({
	id: z.string(),
	name: z.string().nullable().optional(),
	median_delay_min: z.number().nullable().optional(),
});
export type WeakStop = z.infer<typeof WeakStopSchema>;

export const RouteDayOfWeekSchema = z.object({
	day_of_week_iso: z.number().int(),
	avg_delay_min: z.number().nullable().optional(),
	severe_pct: z.number().nullable().optional(),
	observation_count: z.number().int().nullable().optional(),
});
export type RouteDayOfWeek = z.infer<typeof RouteDayOfWeekSchema>;

export const RouteReliabilitySchema = z.object({
	generated_utc: isoUtc(),
	id: z.string(),
	name: z.string().nullable().optional(),
	periods: z.array(ReliabilityPeriodSchema).optional(),
	headway: z.array(HeadwayPeriodSchema).optional(),
	// null when the route has no time-of-day habit data.
	habits: RouteHabitsSchema.nullable().optional(),
	// per-route weekday seasonality (ISO 1=Mon..7=Sun).
	day_of_week: z.array(RouteDayOfWeekSchema).optional(),
	weak_stops: z.array(WeakStopSchema).optional(),
});
export type RouteReliability = z.infer<typeof RouteReliabilitySchema>;
