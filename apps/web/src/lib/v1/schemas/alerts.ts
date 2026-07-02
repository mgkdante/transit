// alerts.ts — Zod mirror of live_alerts.schema.json (title: "AlertsFile").
// Live service alerts: severity (closed SeverityCode), affected routes/stops,
// the active window, and the alert headline/body in FR (+ optional EN).
//
// LANGUAGE CONTRACT: header_key / header_text are RAW FR TEXT straight from the
// STM feed. They are NOT label codes — never pass them to resolveLabel().
// description / *_en carry the body and English variants. See per-field notes.

import { z } from 'zod';
import { isoUtc, SeverityCodeSchema, payloadEnvelopeFields } from './types';
// The active-period shape is identical across live + historic (same contract
// $def); import it rather than redeclare it, so the two mirrors never drift.
import { AlertActivePeriodSchema } from './alert_history';

export const AlertSchema = z.object({
	id: z.string(),
	severity: SeverityCodeSchema,
	/**
	 * RAW FR — never resolveLabel. The feed's headline key (free FR text), used
	 * as the alert's stable headline; this is display text, not a label code.
	 */
	header_key: z.string(),
	/**
	 * RAW FR — never resolveLabel. The FR headline text as shown to riders.
	 * Defaults to "" in the contract.
	 */
	header_text: z.string().optional(),
	/** Optional English headline; null when the feed has no EN variant. */
	header_text_en: z.string().nullable().optional(),
	/** RAW FR alert body; null when absent. Never resolveLabel. */
	description: z.string().nullable().optional(),
	/** Optional English alert body; null when absent. */
	description_en: z.string().nullable().optional(),
	routes: z.array(z.string()).optional(),
	stops: z.array(z.string()).optional(),
	start_utc: isoUtc().nullable().optional(),
	end_utc: isoUtc().nullable().optional(),
	/** Raw GTFS-RT/i3 cause (GTFS-RT Cause enum name, e.g. "CONSTRUCTION"); null when absent. */
	cause: z.string().nullable().optional(),
	/** Raw GTFS-RT/i3 effect (GTFS-RT Effect enum name, e.g. "DETOUR"); null when absent. */
	effect: z.string().nullable().optional(),
	/** Raw upstream severity_level, distinct from the bucketed `severity` enum. */
	severity_level: z.string().nullable().optional(),
	/**
	 * S15 additive — the alert's public URL (FR + optional EN), closing the old
	 * "(url is not yet carried upstream)" note. Null when the feed omits it.
	 */
	url: z.string().nullable().optional(),
	url_en: z.string().nullable().optional(),
	/**
	 * S15 additive — every active window (migration 0077), mirroring the historic
	 * shape so a multi-period alert is visible on the live surface too. The scalar
	 * start_utc/end_utc stay the primary (period[0]) window; absent on legacy feeds.
	 */
	active_periods: z.array(AlertActivePeriodSchema).optional(),
});
export type Alert = z.infer<typeof AlertSchema>;

export const AlertsFileSchema = z.object({
	generated_utc: isoUtc(),
	alerts: z.array(AlertSchema),
	...payloadEnvelopeFields(),
});
export type AlertsFile = z.infer<typeof AlertsFileSchema>;
