// provenance.ts — Zod mirror of provenance.schema.json (title: "Provenance").
// The data-honesty manifest for the historic tier: which source feeds were
// loaded and when (sources), how fresh each feed is (freshness), known data
// gaps, retention windows, and a free-form methodology object. Powers the
// "how we measure this" / honesty footer.

import { z } from 'zod';
import { isoUtc } from './types';

export const ProvenanceSourceSchema = z.object({
	feed: z.string(),
	last_loaded_utc: isoUtc().nullable().optional(),
	chain: z.string().nullable().optional(),
});
export type ProvenanceSource = z.infer<typeof ProvenanceSourceSchema>;

export const ProvenanceFreshnessSchema = z.object({
	feed: z.string(),
	age_s: z.number().int().nullable().optional(),
	status: z.string().nullable().optional(),
});
export type ProvenanceFreshness = z.infer<typeof ProvenanceFreshnessSchema>;

export const ProvenanceSchema = z.object({
	generated_utc: isoUtc(),
	sources: z.array(ProvenanceSourceSchema).optional(),
	freshness: z.array(ProvenanceFreshnessSchema).optional(),
	gaps: z.array(z.string()).optional(),
	// Retention window per tier/feed, in days (additionalProperties: integer).
	retention: z.record(z.string(), z.number().int()).optional(),
	// Free-form methodology notes (additionalProperties: true). Kept loose.
	methodology: z.record(z.string(), z.unknown()).optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;
