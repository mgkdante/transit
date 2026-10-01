import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

export const AlertActivePeriodSchema = z.object({
	start_utc: isoUtc().nullable().optional(),
	end_utc: isoUtc().nullable().optional(),
});
export type AlertActivePeriod = z.infer<typeof AlertActivePeriodSchema>;

export const AlertHistoryEntrySchema = z.object({
	id: z.string(),
	header_text: z.string().nullable().optional(),
	header_text_en: z.string().nullable().optional(),
	description: z.string().nullable().optional(),
	description_en: z.string().nullable().optional(),
	severity: z.string().nullable().optional(),
	routes: z.array(z.string()).optional(),
	stops: z.array(z.string()).optional(),
	start_utc: isoUtc().nullable().optional(),
	end_utc: isoUtc().nullable().optional(),
	duration_min: z.number().nullable().optional(),
	impact_passages: z.number().int().nullable().optional(),
	cause: z.string().nullable().optional(),
	effect: z.string().nullable().optional(),
	severity_level: z.string().nullable().optional(),
	url: z.string().nullable().optional(),
	active_periods: z.array(AlertActivePeriodSchema).optional(),
});
export type AlertHistoryEntry = z.infer<typeof AlertHistoryEntrySchema>;

export const AlertBreakdownBucketSchema = z.object({
	key: z.string(),
	count: z.number().int().optional(),
	median_duration_min: z.number().nullable().optional(),
});
export type AlertBreakdownBucket = z.infer<typeof AlertBreakdownBucketSchema>;

export const AlertBreakdownSchema = z.object({
	by_cause: z.array(AlertBreakdownBucketSchema).optional(),
	by_effect: z.array(AlertBreakdownBucketSchema).optional(),
	by_severity: z.array(AlertBreakdownBucketSchema).optional(),
});
export type AlertBreakdown = z.infer<typeof AlertBreakdownSchema>;

export const AlertHistorySchema = z.object({
	generated_utc: isoUtc(),
	alerts: z.array(AlertHistoryEntrySchema).optional(),
	breakdown: AlertBreakdownSchema.nullable().optional(),
	window_start: z.string().nullable().optional(),
	window_end: z.string().nullable().optional(),
	total_in_window: z.number().int().nullable().optional(),
	truncated: z.boolean().nullable().optional(),
	...payloadEnvelopeFields(),
});
export type AlertHistory = z.infer<typeof AlertHistorySchema>;
