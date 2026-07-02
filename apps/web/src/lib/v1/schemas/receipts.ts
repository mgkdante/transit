// receipts.ts — Zod mirror of historic_receipt.schema.json (title: "Receipt").
// A daily "service receipt": the day's headline OTP / avg delay / severe %, the
// counts of affected routes/stops/alerts/vehicles, a rider-impact score, and the
// single worst route + worst stop. Fetched per date under receipts_prefix
// (dates come from receipts_index; 404 = empty state).

import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

export const ReceiptWorstRouteSchema = z.object({
	id: z.string(),
	name: z.string().nullable().optional(),
	otp_delta_pts: z.number().nullable().optional(),
});
export type ReceiptWorstRoute = z.infer<typeof ReceiptWorstRouteSchema>;

export const ReceiptWorstStopSchema = z.object({
	id: z.string(),
	name: z.string().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
});
export type ReceiptWorstStop = z.infer<typeof ReceiptWorstStopSchema>;

export const ReceiptSchema = z.object({
	generated_utc: isoUtc(),
	// The receipt's calendar date (ISO, local-day). Required.
	date: z.string(),
	otp_pct: z.number().int().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
	severe_pct: z.number().nullable().optional(),
	affected_routes: z.number().int().nullable().optional(),
	affected_stops: z.number().int().nullable().optional(),
	alerts: z.number().int().nullable().optional(),
	vehicles: z.number().int().nullable().optional(),
	// null when the day had no rider-impact signal (guarded against sentinels).
	rider_impact_score: z.number().nullable().optional(),
	worst_route: ReceiptWorstRouteSchema.nullable().optional(),
	worst_stop: ReceiptWorstStopSchema.nullable().optional(),
	...payloadEnvelopeFields(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;
