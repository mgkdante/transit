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

// Feed-conformance verdict for the active provider — how well the upstream GTFS
// payload matched the schema the pipeline expects. `status` is the only required
// field (canonical leaves the vocabulary open: "compliant", "out-of-norm", …);
// `extra_row_count` counts rows the loader saw but did not recognize, and
// `unknown_members` names the unexpected columns/enum members. Powers the
// data-quality badge — present per-provider, null when the feed wasn't checked.
export const ProvenanceConformanceSchema = z.object({
	status: z.string(),
	extra_row_count: z.number().int().optional(),
	unknown_members: z.array(z.string()).optional(),
});
export type ProvenanceConformance = z.infer<typeof ProvenanceConformanceSchema>;

export const ProvenanceSchema = z.object({
	generated_utc: isoUtc(),
	sources: z.array(ProvenanceSourceSchema).optional(),
	freshness: z.array(ProvenanceFreshnessSchema).optional(),
	gaps: z.array(z.string()).optional(),
	// Retention window per tier/feed, in days (additionalProperties: integer).
	retention: z.record(z.string(), z.number().int()).optional(),
	// Free-form methodology notes (additionalProperties: true). Kept loose.
	methodology: z.record(z.string(), z.unknown()).optional(),
	// Feed-conformance verdict — nullable (default null) when not checked.
	conformance: ProvenanceConformanceSchema.nullable().optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;
