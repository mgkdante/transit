// stop.ts — Zod mirror of static_stop.schema.json (title: "StopFile").
// The per-stop detail page: position, accessibility, the routes served, and the
// static schedule grouped by route (each with a headsign and a list of times).
// Fetched per stop id under stops_prefix.

import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

export const ScheduledRouteSchema = z.object({
	route: z.string(),
	headsign: z.string().nullable().optional(),
	// HH:MM[:SS] local schedule times; defaults to [] in the pipeline.
	times: z.array(z.string()).optional(),
});
export type ScheduledRoute = z.infer<typeof ScheduledRouteSchema>;

export const StopFileSchema = z.object({
	generated_utc: isoUtc(),
	id: z.string(),
	name: z.string(),
	lat: z.number(),
	lon: z.number(),
	code: z.string().nullable().optional(),
	routes_served: z.array(z.string()).optional(),
	scheduled: z.array(ScheduledRouteSchema).optional(),
	wheelchair: z.boolean().optional(),
	...payloadEnvelopeFields(),
});
export type StopFile = z.infer<typeof StopFileSchema>;
