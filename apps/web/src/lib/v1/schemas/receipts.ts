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

export const ReceiptShiftCutSchema = z.object({
	shift: z.string(),
	observation_count: z.number().int().nullable().optional(),
	severe_count: z.number().int().nullable().optional(),
	severe_pct: z.number().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
});
export type ReceiptShiftCut = z.infer<typeof ReceiptShiftCutSchema>;

export const ReceiptNotReportedRouteSchema = z.object({
	id: z.string(),
	name: z.string().nullable().optional(),
	scheduled_trip_days: z.number().int().nullable().optional(),
});
export type ReceiptNotReportedRoute = z.infer<typeof ReceiptNotReportedRouteSchema>;

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
	date: z.string(),
	otp_pct: z.number().int().nullable().optional(),
	avg_delay_min: z.number().nullable().optional(),
	severe_pct: z.number().nullable().optional(),
	affected_routes: z.number().int().nullable().optional(),
	affected_stops: z.number().int().nullable().optional(),
	alerts: z.number().int().nullable().optional(),
	vehicles: z.number().int().nullable().optional(),
	rider_impact_score: z.number().nullable().optional(),
	worst_route: ReceiptWorstRouteSchema.nullable().optional(),
	worst_stop: ReceiptWorstStopSchema.nullable().optional(),
	by_shift: z.array(ReceiptShiftCutSchema).optional(),
	service_states: ReceiptServiceStatesSchema.nullable().optional(),
	...payloadEnvelopeFields(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;
