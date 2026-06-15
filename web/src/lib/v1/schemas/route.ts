// route.ts — Zod mirror of static_route.schema.json (title: "RouteFile").
// The per-route detail page: directions (each with an ordered stop list,
// headsign and an opaque GeoJSON-ish shape), service-period headways, and
// first/last departure. Fetched per route id under routes_prefix.

import { z } from 'zod';
import { isoUtc } from './types';

export const RouteStopSchema = z.object({
	id: z.string(),
	seq: z.number().int(),
	name: z.string().nullable().optional(),
});
export type RouteStop = z.infer<typeof RouteStopSchema>;

export const RouteDirectionSchema = z.object({
	dir: z.number().int(),
	headsign: z.string().nullable().optional(),
	// Opaque shape geometry (GeoJSON-ish object, additionalProperties allowed);
	// null when no shape is published. Kept loose — the map layer owns parsing.
	shape: z.record(z.string(), z.unknown()).nullable().optional(),
	stops: z.array(RouteStopSchema).optional(),
});
export type RouteDirection = z.infer<typeof RouteDirectionSchema>;

export const ServicePeriodSchema = z.object({
	shift: z.string(),
	window: z.string().nullable().optional(),
	headway_min: z.number().nullable().optional(),
});
export type ServicePeriod = z.infer<typeof ServicePeriodSchema>;

export const RouteFileSchema = z.object({
	generated_utc: isoUtc(),
	id: z.string(),
	long: z.string().nullable().optional(),
	directions: z.array(RouteDirectionSchema).optional(),
	service_periods: z.array(ServicePeriodSchema).optional(),
	first_departure: z.string().nullable().optional(),
	last_departure: z.string().nullable().optional(),
});
export type RouteFile = z.infer<typeof RouteFileSchema>;
