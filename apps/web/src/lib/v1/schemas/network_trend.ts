// network_trend.ts — Zod mirror of historic_network_trend.schema.json
// (title: "NetworkTrend"). The network-wide daily trend series: one TrendPoint
// per date with OTP %, avg delay, p90 delay and vehicle count. Powers the
// network-health trend chart.

import { z } from 'zod';
import { isoUtc } from './types';
import { OccupancyMixSchema } from './network';

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
});
export type TrendPoint = z.infer<typeof TrendPointSchema>;

export const NetworkTrendSchema = z.object({
	generated_utc: isoUtc(),
	series: z.array(TrendPointSchema).optional(),
});
export type NetworkTrend = z.infer<typeof NetworkTrendSchema>;
