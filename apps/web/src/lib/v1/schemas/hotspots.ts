// hotspots.ts — Zod mirror of historic_hotspots.schema.json (title: "Hotspots").
// The ranked worst spots on the network: each carries a rank, a type
// discriminator (route/stop), id, optional name, an OTP delta (points) and a
// free-string severity label.

import { z } from 'zod';
import { HistoryDateSchema } from './history';
import { isoUtc, payloadEnvelopeFields } from './types';

export const HotspotSchema = z.object({
	rank: z.number().int(),
	// 'route' | 'stop' discriminator — free string the pipeline owns.
	type: z.string(),
	id: z.string(),
	name: z.string().nullable().optional(),
	otp_delta_pts: z.number().nullable().optional(),
	// Free-string severity from the pipeline (NOT the SeverityCode alert enum).
	severity: z.string().nullable().optional(),
});
export type Hotspot = z.infer<typeof HotspotSchema>;

// S12 additive: the evidence-rich per-entry shape carried by the by_grain ladders.
// rank is nullable here (a sub-MIN_N tray entry carries rank=null; a ranked entry
// carries its 1-based PER-KIND ladder position — rank restarts per kind, WEB2).
// Ranking is on the not-severe Wilson LOWER bound of the severe proxy, ranked per
// kind. issue_count is reserved; currently always None (the mart join lands with the
// S14 score reconciliation).
export const HotspotEntrySchema = z.object({
	rank: z.number().int().nullable().optional(),
	type: z.string(),
	id: z.string(),
	name: z.string().nullable().optional(),
	severity: z.string().nullable().optional(),
	otp_delta_pts: z.number().nullable().optional(),
	observation_count: z.number().int().nullable().optional(),
	severe_count: z.number().int().nullable().optional(),
	severe_pct: z.number().nullable().optional(),
	wilson_lo: z.number().nullable().optional(),
	wilson_hi: z.number().nullable().optional(),
	issue_count: z.number().int().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
});
export type HotspotEntry = z.infer<typeof HotspotEntrySchema>;

// S12 additive: one re-granulated worst-N ladder for ONE grain. grain =
// 'day'|'week'|'month'|'shift'; date/window_end are the trailing window bounds
// (null for the 'shift' PEAK-ONLY time-of-day cut). entries = a MIXED route+stop
// array (type discriminates) ranked PER KIND — rank restarts per kind (WEB2), so the
// web filters entries by type into per-kind tabs losslessly. total_ranked_routes /
// total_ranked_stops = the PRE-truncation ranked counts per kind (the honest
// shown/total denominators). tray = the un-ranked sub-MIN_N "all per city" union tail
// (sorted severe_pct DESC, capped); tray_total = the pre-cap tray count.
export const HotspotGrainSchema = z.object({
	grain: z.string(),
	date: z.string().nullable().optional(),
	window_end: z.string().nullable().optional(),
	entries: z.array(HotspotEntrySchema).optional(),
	tray: z.array(HotspotEntrySchema).optional(),
	total_ranked_routes: z.number().int().nullable().optional(),
	total_ranked_stops: z.number().int().nullable().optional(),
	tray_total: z.number().int().nullable().optional(),
});
export type HotspotGrain = z.infer<typeof HotspotGrainSchema>;

export const HotspotsSchema = z.object({
	generated_utc: isoUtc(),
	hotspots: z.array(HotspotSchema).optional(),
	// S12 additive-optional: the re-granulated ladders (scalar hotspots[] stays as-is).
	by_grain: z.array(HotspotGrainSchema).optional(),
	...payloadEnvelopeFields(),
});
export type Hotspots = z.infer<typeof HotspotsSchema>;

export const HistoricHotspotsDaySchema = HotspotsSchema.extend({
	date: HistoryDateSchema,
});
export type HistoricHotspotsDay = z.infer<typeof HistoricHotspotsDaySchema>;
