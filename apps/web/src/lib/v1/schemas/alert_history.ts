// alert_history.ts — Zod mirror of historic_alert_history.schema.json
// (title: "AlertHistory"). The archive of past service alerts with their
// resolved duration and rider-impact (impact_passages). Unlike the live alerts
// file, severity here is a free string (the historic build doesn't re-validate
// the closed SeverityCode enum) and only `id` is required per entry.
//
// LANGUAGE CONTRACT: header_text / header_text_en are RAW FR/EN headline TEXT —
// never resolveLabel.

import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

/**
 * One active window of a service alert (S15 · migration 0077). An alert can carry
 * SEVERAL disjoint windows (a recurring weekend closure, a multi-day works
 * schedule); the scalar `start_utc`/`end_utc` pair on the entry remains the PRIMARY
 * (period[0]) window for backward-compat, and this list carries EVERY window when
 * the archive published them. Both bounds are nullable (an open-ended window).
 */
export const AlertActivePeriodSchema = z.object({
	start_utc: isoUtc().nullable().optional(),
	end_utc: isoUtc().nullable().optional(),
});
export type AlertActivePeriod = z.infer<typeof AlertActivePeriodSchema>;

export const AlertHistoryEntrySchema = z.object({
	id: z.string(),
	/** RAW FR — never resolveLabel. The archived FR headline; null when absent. */
	header_text: z.string().nullable().optional(),
	/** Optional archived English headline; null when absent. Never resolveLabel. */
	header_text_en: z.string().nullable().optional(),
	/** Raw source FR description; display cleanup belongs to alertDisplayText. */
	description: z.string().nullable().optional(),
	/** Raw source EN description; honest-null when STM did not publish English. */
	description_en: z.string().nullable().optional(),
	// Free-string severity (NOT the live SeverityCode enum); null when absent.
	severity: z.string().nullable().optional(),
	routes: z.array(z.string()).optional(),
	stops: z.array(z.string()).optional(),
	start_utc: isoUtc().nullable().optional(),
	end_utc: isoUtc().nullable().optional(),
	// Resolved active duration; null on a negative/open window (guarded).
	duration_min: z.number().nullable().optional(),
	impact_passages: z.number().int().nullable().optional(),
	/**
	 * S15 additive — the source history view already carries these, closing the
	 * entry-vs-breakdown gap. Raw GTFS-RT/i3 cause/effect enum names + the upstream
	 * severity_level (distinct from the banded free-string `severity`); null before.
	 */
	cause: z.string().nullable().optional(),
	effect: z.string().nullable().optional(),
	severity_level: z.string().nullable().optional(),
	/** S15 additive — the alert's public URL (post-0077 rows; honest-null before). */
	url: z.string().nullable().optional(),
	/**
	 * S15 additive — every active window (migration 0077). Legacy rows carry the
	 * scalar start/end as a 1-element list; absent/empty on the oldest payloads.
	 */
	active_periods: z.array(AlertActivePeriodSchema).optional(),
});
export type AlertHistoryEntry = z.infer<typeof AlertHistoryEntrySchema>;

export const AlertBreakdownBucketSchema = z.object({
	// cause/effect/severity label; "unknown" when STM omitted it.
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
	// Tier-2 distinct-alert distribution; null when no alerts in the window.
	breakdown: AlertBreakdownSchema.nullable().optional(),
	/**
	 * S15 additive — the honest served window (the full retained span the archive
	 * covers, ISO `YYYY-MM-DD`). Legacy payloads omit both; the surface then derives
	 * the span from the entries. `total_in_window` is the true count BEFORE the
	 * newest-first cap; `truncated` discloses the cap honestly (never a silent drop).
	 */
	window_start: z.string().nullable().optional(),
	window_end: z.string().nullable().optional(),
	total_in_window: z.number().int().nullable().optional(),
	truncated: z.boolean().nullable().optional(),
	...payloadEnvelopeFields(),
});
export type AlertHistory = z.infer<typeof AlertHistorySchema>;
