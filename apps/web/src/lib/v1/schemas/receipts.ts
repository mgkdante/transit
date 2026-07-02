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

// S13 time-of-day cut: the day's network-wide delay reading for ONE canonical shift
// (am_peak|midday|pm_peak|evening|night). avg_delay_min is the SAME pooled ghost-excluded
// mean methodology as the day-level scalar, so a shift cut reconciles with the day number.
export const ReceiptShiftCutSchema = z.object({
	shift: z.string(),
	observation_count: z.number().int().nullable().optional(),
	severe_count: z.number().int().nullable().optional(),
	severe_pct: z.number().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
});
export type ReceiptShiftCut = z.infer<typeof ReceiptShiftCutSchema>;

// S13 one route scheduled that day yet with ZERO realtime observations (not-reported —
// distinct from an explicitly cancelled route).
export const ReceiptNotReportedRouteSchema = z.object({
	id: z.string(),
	name: z.string().nullable().optional(),
	scheduled_trip_days: z.number().int().nullable().optional(),
});
export type ReceiptNotReportedRoute = z.infer<typeof ReceiptNotReportedRouteSchema>;

// S13 the day's scheduled→delivered→cancelled→silent service-state split. The ONE
// completeness number lives here (service_completeness_pct) — the web heroes it from
// service_states, there is no duplicate top-level scalar. not_reported_route_count is the
// PRE-cap total; not_reported_routes is capped (top by scheduled_trip_days).
export const ReceiptServiceStatesSchema = z.object({
	scheduled_trip_days: z.number().int().nullable().optional(),
	delivered_trip_days: z.number().int().nullable().optional(),
	cancelled_trip_days: z.number().int().nullable().optional(),
	silent_trip_days: z.number().int().nullable().optional(),
	not_reported_route_count: z.number().int().nullable().optional(),
	service_completeness_pct: z.number().nullable().optional(),
	not_reported_routes: z.array(ReceiptNotReportedRouteSchema).optional(),
});
export type ReceiptServiceStates = z.infer<typeof ReceiptServiceStatesSchema>;

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
	// S13 additive-optional re-granulation (default []/absent on pre-S13 receipts).
	by_shift: z.array(ReceiptShiftCutSchema).optional(),
	service_states: ReceiptServiceStatesSchema.nullable().optional(),
	...payloadEnvelopeFields(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;
