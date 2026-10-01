import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';
import { OccupancyMixSchema } from './network';

export const NetworkShiftSchema = z.object({
	grain: z.string(),
	otp_pct: z.number().int().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
	severe_pct: z.number().nullable().optional(),
	observation_count: z.number().int().nullable().optional(),
	wilson_lo: z.number().nullable().optional(),
	wilson_hi: z.number().nullable().optional(),
});
export type NetworkShift = z.infer<typeof NetworkShiftSchema>;

export const TrendPointSchema = z.object({
	date: z.string(),
	otp_pct: z.number().int().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
	p90_min: z.number().nullable().optional(),
	vehicles: z.number().int().nullable().optional(),
	cancellation_rate: z.number().nullable().optional(),
	service_completeness_rate: z.number().nullable().optional(),
	occupancy_mix: OccupancyMixSchema.nullable().optional(),
	observation_count: z.number().int().nullable().optional(),
	wilson_lo: z.number().nullable().optional(),
	wilson_hi: z.number().nullable().optional(),
});
export type TrendPoint = z.infer<typeof TrendPointSchema>;

export const NetworkTrendSchema = z.object({
	generated_utc: isoUtc(),
	series: z.array(TrendPointSchema).optional(),
	weekly: z.array(TrendPointSchema).optional(),
	monthly: z.array(TrendPointSchema).optional(),
	by_shift: z.array(NetworkShiftSchema).optional(),
	by_daytype: z.array(NetworkShiftSchema).optional(),
	...payloadEnvelopeFields(),
});
export type NetworkTrend = z.infer<typeof NetworkTrendSchema>;
