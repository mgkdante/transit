// route_reliability.ts — Zod mirror of historic_route_reliability.schema.json
// (title: "RouteReliability"). The per-route history surface: OTP/delay
// percentiles per grain period, scheduled-vs-observed headway by shift, a
// time-of-day "habits" heatmap, and the weakest stops on the route.
// Fetched per route id under route_reliability_prefix (404 = empty state).

import { z } from 'zod';
import { isoUtc } from './types';
import { OccupancyMixSchema } from './network';

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
	// Chart Doctrine honesty fields (slice-S3, additive-optional). observation_count =
	// the OTP/avg denominator; wilson_lo/wilson_hi = 95% Wilson bounds (PERCENT) of the
	// real on_time OTP. Rank on wilson_lo. MUST stay nullable+optional (pre-republish
	// snapshots omit them).
	observation_count: z.number().int().nullable().optional(),
	wilson_lo: z.number().nullable().optional(),
	wilson_hi: z.number().nullable().optional(),
});
export type ReliabilityPeriod = z.infer<typeof ReliabilityPeriodSchema>;

export const HeadwayPeriodSchema = z.object({
	shift: z.string(),
	scheduled_min: z.number().nullable().optional(),
	observed_min: z.number().nullable().optional(),
	excess_wait_min: z.number().nullable().optional(),
	// Tier-2 regularity (busiest-direction rows): stddev/mean of gaps + bunching %.
	cov: z.number().nullable().optional(),
	bunched_pct: z.number().nullable().optional(),
});
export type HeadwayPeriod = z.infer<typeof HeadwayPeriodSchema>;

export const ServiceSpanPeriodSchema = z.object({
	date: z.string().nullable().optional(),
	first_trip_utc: z.string().nullable().optional(),
	last_trip_utc: z.string().nullable().optional(),
	service_span_min: z.number().int().nullable().optional(),
	first_trip_delay_min: z.number().nullable().optional(),
	last_trip_delay_min: z.number().nullable().optional(),
	trip_count: z.number().int().nullable().optional(),
});
export type ServiceSpanPeriod = z.infer<typeof ServiceSpanPeriodSchema>;

export const SkippedStopPeriodSchema = z.object({
	date: z.string().nullable().optional(),
	// skipped / all observed stop-time updates, %; null when none observed.
	skipped_stop_rate_pct: z.number().nullable().optional(),
	skipped_stop_count: z.number().int().nullable().optional(),
	stop_time_update_count: z.number().int().nullable().optional(),
});
export type SkippedStopPeriod = z.infer<typeof SkippedStopPeriodSchema>;

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
	avg_delay_min: z.number().nullable().optional(),
});
export type WeakStop = z.infer<typeof WeakStopSchema>;

export const RouteDayOfWeekSchema = z.object({
	day_of_week_iso: z.number().int(),
	avg_delay_min: z.number().nullable().optional(),
	severe_pct: z.number().nullable().optional(),
	observation_count: z.number().int().nullable().optional(),
});
export type RouteDayOfWeek = z.infer<typeof RouteDayOfWeekSchema>;

export const CancellationPeriodSchema = z.object({
	// free-string grain the pipeline owns (e.g. 'day'); NOT the web Grain enum.
	// Optional to match the canonical schema (DB↔UI contract doctrine): the producer
	// always emits it today, but the contract permits omitting it — the web validator
	// must never be STRICTER than the canonical contract, or it would reject a valid
	// snapshot. (Drift caught by the contract audit; fixtures masked it.)
	grain: z.string().optional(),
	date: z.string().nullable().optional(),
	// canceled / RT-reported trip-days, %; null when no trips were observed.
	cancellation_rate_pct: z.number().nullable().optional(),
	canceled_trip_days: z.number().int().nullable().optional(),
	total_trip_days: z.number().int().nullable().optional(),
});
export type CancellationPeriod = z.infer<typeof CancellationPeriodSchema>;

export const CrowdingDelayCellSchema = z.object({
	// occupancy band label, same vocabulary as OccupancyMix keys
	// (empty/many_seats/few_seats/standing/full).
	band: z.string(),
	// observation-weighted avg delay for route×days whose dominant band was this.
	avg_delay_min: z.number().nullable().optional(),
	// best-effort observation-weighted mean of contributing daily p50s.
	p50_min: z.number().nullable().optional(),
	observation_count: z.number().int().nullable().optional(),
	day_count: z.number().int().nullable().optional(),
});
export type CrowdingDelayCell = z.infer<typeof CrowdingDelayCellSchema>;

export const CrosstabCellSchema = z.object({
	// canonical time-of-day shift token (am_peak|midday|pm_peak|evening|night).
	shift: z.string(),
	// weekday|weekend.
	day_type: z.string(),
	// REAL on_time/known OTP for this (shift, day_type) cell; null when no obs.
	otp_pct: z.number().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
	severe_pct: z.number().nullable().optional(),
	observation_count: z.number().int().nullable().optional(),
});
export type CrosstabCell = z.infer<typeof CrosstabCellSchema>;

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
	// per-day cancellation history (most recent ~30 closed days).
	cancellations: z.array(CancellationPeriodSchema).optional(),
	// trailing-window crowding band-shares; null when no occupancy telemetry.
	occupancy_mix: OccupancyMixSchema.nullable().optional(),
	// per-day service-span / first-last punctuality history.
	service_spans: z.array(ServiceSpanPeriodSchema).optional(),
	// per-day skipped-stop rate history (ramp-in, no backfill).
	skipped_stops: z.array(SkippedStopPeriodSchema).optional(),
	// per-band delay×crowding correlation over trailing 30d; empty when no
	// occupancy telemetry. Additive-optional (back-compat with older artifacts).
	delay_by_crowding: z.array(CrowdingDelayCellSchema).optional(),
	// Tier-3 2D shift × day_type delay crosstab; SPARSE (only cells with
	// observations). Additive-optional (back-compat with older artifacts).
	by_shift_daytype: z.array(CrosstabCellSchema).optional(),
});
export type RouteReliability = z.infer<typeof RouteReliabilitySchema>;
