// alert_history.ts — Zod mirror of historic_alert_history.schema.json
// (title: "AlertHistory"). The archive of past service alerts with their
// resolved duration and rider-impact (impact_passages). Unlike the live alerts
// file, severity here is a free string (the historic build doesn't re-validate
// the closed SeverityCode enum) and only `id` is required per entry.
//
// LANGUAGE CONTRACT: header_text / header_text_en are RAW FR/EN headline TEXT —
// never resolveLabel.

import { z } from 'zod';
import { isoUtc } from './types';

export const AlertHistoryEntrySchema = z.object({
	id: z.string(),
	/** RAW FR — never resolveLabel. The archived FR headline; null when absent. */
	header_text: z.string().nullable().optional(),
	/** Optional archived English headline; null when absent. Never resolveLabel. */
	header_text_en: z.string().nullable().optional(),
	// Free-string severity (NOT the live SeverityCode enum); null when absent.
	severity: z.string().nullable().optional(),
	routes: z.array(z.string()).optional(),
	stops: z.array(z.string()).optional(),
	start_utc: isoUtc().nullable().optional(),
	end_utc: isoUtc().nullable().optional(),
	// Resolved active duration; null on a negative/open window (guarded).
	duration_min: z.number().nullable().optional(),
	impact_passages: z.number().int().nullable().optional(),
});
export type AlertHistoryEntry = z.infer<typeof AlertHistoryEntrySchema>;

export const AlertHistorySchema = z.object({
	generated_utc: isoUtc(),
	alerts: z.array(AlertHistoryEntrySchema).optional(),
});
export type AlertHistory = z.infer<typeof AlertHistorySchema>;
