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
	// Highest-priority GTFS mode serving this stop (pipeline-derived,
	// metro|tram|rail|bus|ferry today); null when no route linkage. FREE STRING to
	// match the canonical contract (StopIndexEntry.mode is `str | None`, not an
	// enum) — the web validator must never be STRICTER than the contract, or a new
	// pipeline-side mode value would reject the whole stops_index snapshot. The
	// search-mode glyph/tag consumer (stopMode.ts) matches known values and falls
	// back gracefully for anything else.
	mode: z.string().nullable().optional(),
	// Up to 5 route ids serving this stop, for the search mode + result chips.
	routes: z.array(z.string()).optional(),
});
export type StopIndexEntry = z.infer<typeof StopIndexEntrySchema>;

export const StopsIndexSchema = z.object({
	generated_utc: isoUtc(),
	stops: z.array(StopIndexEntrySchema),
});
export type StopsIndex = z.infer<typeof StopsIndexSchema>;
