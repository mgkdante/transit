import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';
import { OccupancyMixSchema } from './network';

export const RouteDelayHistogramBinSchema = z.object({
	lo_sec: z.number().int().nullable().optional(),
	hi_sec: z.number().int().nullable().optional(),
	count: z.number().int().default(0),
});
export type RouteDelayHistogramBin = z.infer<typeof RouteDelayHistogramBinSchema>;

export const ReliabilityPeriodSchema = z.object({
	grain: z.string(),
	date: z.string().nullable().optional(),
	otp_pct: z.number().int().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
	p50_min: z.number().nullable().optional(),
	p90_min: z.number().nullable().optional(),
	severe_pct: z.number().nullable().optional(),
	observation_count: z.number().int().nullable().optional(),
	wilson_lo: z.number().nullable().optional(),
	wilson_hi: z.number().nullable().optional(),
	on_time: z.number().int().nullable().optional(),
	delay_histogram: z.array(RouteDelayHistogramBinSchema).nullable().optional(),
	prior_observation_count: z.number().int().nullable().optional(),
	prior_otp_pct: z.number().int().nullable().optional(),
	prior_on_time: z.number().int().nullable().optional(),
});
export type ReliabilityPeriod = z.infer<typeof ReliabilityPeriodSchema>;

export const HeadwayPeriodSchema = z.object({
	shift: z.string(),
	direction_id: z.number().nullable().optional(),
	day_type: z.string().nullable().optional(),
	scheduled_min: z.number().nullable().optional(),
	observed_min: z.number().nullable().optional(),
	excess_wait_min: z.number().nullable().optional(),
	cov: z.number().nullable().optional(),
	bunched_pct: z.number().nullable().optional(),
	observation_count: z.number().int().nullable().optional(),
	prior_observation_count: z.number().int().nullable().optional(),
	prior_observed_min: z.number().nullable().optional(),
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
	skipped_stop_rate_pct: z.number().nullable().optional(),
	skipped_stop_count: z.number().int().nullable().optional(),
	stop_time_update_count: z.number().int().nullable().optional(),
});
export type SkippedStopPeriod = z.infer<typeof SkippedStopPeriodSchema>;

export const RouteHabitsSchema = z.object({
	scale: z.string(),
	matrix: z.array(z.array(z.number().nullable())).optional(),
});
export type RouteHabits = z.infer<typeof RouteHabitsSchema>;

export const WeakStopSchema = z.object({
	id: z.string(),
	name: z.string().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
	observation_count: z.number().int().nullable().optional(),
	severe_pct: z.number().nullable().optional(),
	wilson_lo: z.number().nullable().optional(),
	wilson_hi: z.number().nullable().optional(),
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
	grain: z.string().optional(),
	date: z.string().nullable().optional(),
	cancellation_rate_pct: z.number().nullable().optional(),
	canceled_trip_days: z.number().int().nullable().optional(),
	total_trip_days: z.number().int().nullable().optional(),
	scheduled_trip_days: z.number().int().nullable().optional(),
	delivered_trip_days: z.number().int().nullable().optional(),
	silent_trip_days: z.number().int().nullable().optional(),
	service_completeness_pct: z.number().nullable().optional(),
});
export type CancellationPeriod = z.infer<typeof CancellationPeriodSchema>;

export const CrowdingDelayCellSchema = z.object({
	band: z.string(),
	avg_delay_min: z.number().nullable().optional(),
	p50_min: z.number().nullable().optional(),
	observation_count: z.number().int().nullable().optional(),
	day_count: z.number().int().nullable().optional(),
});
export type CrowdingDelayCell = z.infer<typeof CrowdingDelayCellSchema>;

export const CrosstabCellSchema = z.object({
	shift: z.string(),
	day_type: z.string(),
	otp_pct: z.number().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
	severe_pct: z.number().nullable().optional(),
	observation_count: z.number().int().nullable().optional(),
});
export type CrosstabCell = z.infer<typeof CrosstabCellSchema>;

export const OccupancyByGrainSchema = z.object({
	grain: z.string(),
	mix: OccupancyMixSchema.nullable().optional(),
});
export type OccupancyByGrain = z.infer<typeof OccupancyByGrainSchema>;

export const OccupancyByDowSchema = z.object({
	day_of_week_iso: z.number().int(),
	mix: OccupancyMixSchema.nullable().optional(),
	n: z.number().int().nullable().optional(),
});
export type OccupancyByDow = z.infer<typeof OccupancyByDowSchema>;

export const OccupancyByHourSchema = z.object({
	hour_of_day_local: z.number().int(),
	mix: OccupancyMixSchema.nullable().optional(),
	n: z.number().int().nullable().optional(),
});
export type OccupancyByHour = z.infer<typeof OccupancyByHourSchema>;

export const ReliabilityByGrainSchema = z.object({
	grain: z.string(),
	date: z.string().nullable().optional(),
	by_shift: z.array(ReliabilityPeriodSchema).optional(),
	by_daytype: z.array(ReliabilityPeriodSchema).optional(),
	day_of_week: z.array(RouteDayOfWeekSchema).optional(),
	by_shift_daytype: z.array(CrosstabCellSchema).optional(),
});
export type ReliabilityByGrain = z.infer<typeof ReliabilityByGrainSchema>;

export const RouteHabitsByGrainSchema = z.object({
	grain: z.string(),
	date: z.string().nullable().optional(),
	habits: RouteHabitsSchema.nullable().optional(),
	cells_observed: z.number().int().optional(),
	cells_suppressed: z.number().int().optional(),
});
export type RouteHabitsByGrain = z.infer<typeof RouteHabitsByGrainSchema>;

export const HeadwayByGrainSchema = z.object({
	grain: z.string(),
	date: z.string().nullable().optional(),
	headway: z.array(HeadwayPeriodSchema).optional(),
});
export type HeadwayByGrain = z.infer<typeof HeadwayByGrainSchema>;

export const WeakStopGrainSchema = z.object({
	grain: z.string(),
	date: z.string().nullable().optional(),
	stops: z.array(WeakStopSchema).optional(),
});
export type WeakStopGrain = z.infer<typeof WeakStopGrainSchema>;

export const RouteReliabilitySchema = z.object({
	generated_utc: isoUtc(),
	id: z.string(),
	name: z.string().nullable().optional(),
	periods: z.array(ReliabilityPeriodSchema).optional(),
	headway: z.array(HeadwayPeriodSchema).optional(),
	habits: RouteHabitsSchema.nullable().optional(),
	day_of_week: z.array(RouteDayOfWeekSchema).optional(),
	weak_stops: z.array(WeakStopSchema).optional(),
	cancellations: z.array(CancellationPeriodSchema).optional(),
	occupancy_mix: OccupancyMixSchema.nullable().optional(),
	service_spans: z.array(ServiceSpanPeriodSchema).optional(),
	skipped_stops: z.array(SkippedStopPeriodSchema).optional(),
	delay_by_crowding: z.array(CrowdingDelayCellSchema).optional(),
	by_shift_daytype: z.array(CrosstabCellSchema).optional(),
	occupancy_by_grain: z.array(OccupancyByGrainSchema).optional(),
	occupancy_by_dow: z.array(OccupancyByDowSchema).optional(),
	occupancy_by_hour: z.array(OccupancyByHourSchema).optional(),
	periods_by_grain: z.array(ReliabilityByGrainSchema).optional(),
	habits_by_grain: z.array(RouteHabitsByGrainSchema).optional(),
	headway_by_grain: z.array(HeadwayByGrainSchema).optional(),
	weak_stops_by_grain: z.array(WeakStopGrainSchema).optional(),
	...payloadEnvelopeFields(),
});
export type RouteReliability = z.infer<typeof RouteReliabilitySchema>;
