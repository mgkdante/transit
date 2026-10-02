import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

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
	retention: z.record(z.string(), z.number().int()).optional(),
	methodology: z.record(z.string(), z.unknown()).optional(),
	conformance: ProvenanceConformanceSchema.nullable().optional(),
	...payloadEnvelopeFields(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;
