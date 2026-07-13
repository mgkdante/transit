// alert_archive.ts — Zod mirrors of the retained alert page/index schemas.

import { z } from 'zod';
import { AlertHistoryEntrySchema } from './alert_history';
import { isoUtc, payloadEnvelopeFields } from './types';

export const AlertArchiveEntrySchema = AlertHistoryEntrySchema.extend({
	first_seen_utc: isoUtc(),
	last_seen_utc: isoUtc(),
});
export type AlertArchiveEntry = z.infer<typeof AlertArchiveEntrySchema>;

export const AlertArchivePageSchema = z.object({
	generated_utc: isoUtc(),
	month: z.string(),
	page: z.number().int().min(1),
	alerts: z.array(AlertArchiveEntrySchema).min(1).max(250),
	...payloadEnvelopeFields(),
});
export type AlertArchivePage = z.infer<typeof AlertArchivePageSchema>;

export const AlertArchivePageRefSchema = z.object({
	path: z.string(),
	page: z.number().int().min(1),
	count: z.number().int().min(1).max(250),
	byte_size: z.number().int().min(1),
	sha256: z.string(),
	coverage_start: z.string(),
	coverage_end: z.string(),
});
export type AlertArchivePageRef = z.infer<typeof AlertArchivePageRefSchema>;

export const AlertArchiveMonthSchema = z.object({
	month: z.string(),
	total_alerts: z.number().int().min(1),
	pages: z.array(AlertArchivePageRefSchema),
});
export type AlertArchiveMonth = z.infer<typeof AlertArchiveMonthSchema>;

export const AlertArchiveIndexSchema = z.object({
	generated_utc: isoUtc(),
	collection_generation_id: z.string(),
	// Required keys with honest-null values on an empty archive.
	first_available_date: z.string().nullable(),
	last_available_date: z.string().nullable(),
	total_alerts: z.number().int().min(0),
	months: z.array(AlertArchiveMonthSchema),
	...payloadEnvelopeFields(),
});
export type AlertArchiveIndex = z.infer<typeof AlertArchiveIndexSchema>;
