// stops_index.ts — Zod mirror of static_stops_index.schema.json
// (title: "StopsIndex"). The flat catalogue of every stop: id, name, position,
// and optional rider-facing code. Drives stop search and the stop map layer.

import { z } from 'zod';
import { isoUtc } from './types';

export const StopIndexEntrySchema = z.object({
	id: z.string(),
	name: z.string(),
	lat: z.number(),
	lon: z.number(),
	// Rider-facing stop code (printed on the pole); null when absent.
	code: z.string().nullable().optional(),
	// Highest-priority GTFS mode serving this stop (pipeline-derived); null when
	// no route linkage. Closed enum — drives the search mode glyph/tag.
	mode: z.enum(['metro', 'tram', 'rail', 'bus', 'ferry']).nullable().optional(),
	// Up to 5 route ids serving this stop, for the search mode + result chips.
	routes: z.array(z.string()).optional(),
});
export type StopIndexEntry = z.infer<typeof StopIndexEntrySchema>;

export const StopsIndexSchema = z.object({
	generated_utc: isoUtc(),
	stops: z.array(StopIndexEntrySchema),
});
export type StopsIndex = z.infer<typeof StopsIndexSchema>;
