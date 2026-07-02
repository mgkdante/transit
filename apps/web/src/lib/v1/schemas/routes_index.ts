// routes_index.ts — Zod mirror of static_routes_index.schema.json
// (title: "RoutesIndex"). The flat catalogue of every route: id, short name,
// GTFS route_type, optional long name and brand colour. Drives the route list /
// search. `type` is the GTFS route_type integer (0=tram,1=metro,3=bus,...).

import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

export const RouteIndexEntrySchema = z.object({
	id: z.string(),
	short: z.string(),
	type: z.number().int(),
	long: z.string().nullable().optional(),
	// Hex brand colour from GTFS (e.g. "009EE0"); null when the feed omits it.
	color: z.string().nullable().optional(),
	// True when historic/route_reliability/{id}.json is published for this route;
	// the loader skips probing reliability for routes where this is explicitly
	// false. Optional so snapshots published before this field still parse.
	reliability: z.boolean().optional(),
});
export type RouteIndexEntry = z.infer<typeof RouteIndexEntrySchema>;

export const RoutesIndexSchema = z.object({
	generated_utc: isoUtc(),
	routes: z.array(RouteIndexEntrySchema),
	...payloadEnvelopeFields(),
});
export type RoutesIndex = z.infer<typeof RoutesIndexSchema>;
