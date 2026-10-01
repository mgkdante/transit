import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

export const DataHealthGateSchema = z.object({
	checks_run: z.number().int().nullable().optional(),
	errors: z.number().int().nullable().optional(),
	warnings: z.number().int().nullable().optional(),
	verdict: z.string().nullable().optional(),
	generated_utc: isoUtc().nullable().optional(),
});
export type DataHealthGate = z.infer<typeof DataHealthGateSchema>;

export const LaneHealthSchema = z.object({
	lane: z.string(),
	last_publish_utc: isoUtc().nullable().optional(),
	age_s: z.number().int().nullable().optional(),
	files_written: z.number().int().nullable().optional(),
	files_skipped: z.number().int().nullable().optional(),
	files_total: z.number().int().nullable().optional(),
	gate: DataHealthGateSchema.nullable().optional(),
});
export type LaneHealth = z.infer<typeof LaneHealthSchema>;

export const DataHealthFeedSchema = z.object({
	feed: z.string(),
	status: z.string().nullable().optional(),
	age_s: z.number().int().nullable().optional(),
});
export type DataHealthFeed = z.infer<typeof DataHealthFeedSchema>;

export const DataHealthSchema = z.object({
	generated_utc: isoUtc(),
	lanes: z.array(LaneHealthSchema).optional(),
	feeds: z.array(DataHealthFeedSchema).optional(),
	...payloadEnvelopeFields(),
});
export type DataHealth = z.infer<typeof DataHealthSchema>;
