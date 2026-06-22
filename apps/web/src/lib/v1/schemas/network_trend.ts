// network_trend.ts — Zod mirror of historic_network_trend.schema.json
// (title: "NetworkTrend"). The network-wide daily trend series: one TrendPoint
// per date with OTP %, avg delay, p90 delay and vehicle count. Powers the
// network-health trend chart. Additive: network-wide by_shift[] / by_daytype[]
// (NetworkShift) carry observation-weighted reliability per time-of-day shift
// (am_peak…night) and day-type (weekday/weekend) — a trailing-window proxy.

import { z } from 'zod';
import { isoUtc } from './types';
import { OccupancyMixSchema } from './network';

// One network-wide reliability reading for a non-calendar grain (a time-of-day
// shift or a day-type). `grain` is the free-string token (am_peak…night /
// weekday / weekend — kept free so an enum tightening upstream never breaks the
// web). The three metrics are nullable + optional: a grain with too little data
// (or none observed) carries null, never a fabricated 0. Mirrors the canonical
// NetworkShift $def exactly (grain required; otp_pct integer, avg/severe number).
export const NetworkShiftSchema = z.object({
	// Non-calendar grain token (date:null upstream). Required.
	grain: z.string(),
	otp_pct: z.number().int().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
	severe_pct: z.number().nullable().optional(),
	// Chart Doctrine honesty fields (slice-S3). observation_count = OTP/Wilson n
	// (otp_known, smaller than the severe/avg base); wilson_lo/hi = 95% bounds (PERCENT)
	// of the real on_time OTP.
	observation_count: z.number().int().nullable().optional(),
	wilson_lo: z.number().nullable().optional(),
	wilson_hi: z.number().nullable().optional(),
});
export type NetworkShift = z.infer<typeof NetworkShiftSchema>;

export const TrendPointSchema = z.object({
	// Calendar date (ISO local-day). Required.
	date: z.string(),
	otp_pct: z.number().int().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
	p90_min: z.number().nullable().optional(),
	vehicles: z.number().int().nullable().optional(),
	// network-wide canceled / RT-reported trip-days, %; null when none observed.
	cancellation_rate: z.number().nullable().optional(),
	// network-wide crowding band-shares; null when no occupancy telemetry.
	occupancy_mix: OccupancyMixSchema.nullable().optional(),
	// Chart Doctrine honesty fields (slice-S3). observation_count = the OTP/avg
	// denominator for THIS bucket only (cancellation_rate/occupancy_mix have their own);
	// wilson_lo/hi = 95% bounds (PERCENT) of the OTP.
	observation_count: z.number().int().nullable().optional(),
	wilson_lo: z.number().nullable().optional(),
	wilson_hi: z.number().nullable().optional(),
});
export type TrendPoint = z.infer<typeof TrendPointSchema>;

export const NetworkTrendSchema = z.object({
	generated_utc: isoUtc(),
	series: z.array(TrendPointSchema).optional(),
	// Additive coarser-grain trend series: one TrendPoint per week-start
	// (weekly) / month-start (monthly) date. p90_min + vehicles are null on
	// these grains (they are 14d-daily-only). Absent on older snapshots.
	weekly: z.array(TrendPointSchema).optional(),
	monthly: z.array(TrendPointSchema).optional(),
	// Network-wide reliability by time-of-day shift (am_peak…night) and by
	// day-type (weekday/weekend). Additive optional — absent on older snapshots.
	by_shift: z.array(NetworkShiftSchema).optional(),
	by_daytype: z.array(NetworkShiftSchema).optional(),
});
export type NetworkTrend = z.infer<typeof NetworkTrendSchema>;
