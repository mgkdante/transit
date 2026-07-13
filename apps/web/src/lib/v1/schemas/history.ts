// history.ts — Zod mirrors of the shared retained-history collection and
// availability contracts.

import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

export const HistorySelectionModeSchema = z.enum(['range', 'date']);
export type HistorySelectionMode = z.infer<typeof HistorySelectionModeSchema>;

export const HistoricCoverageGapSchema = z.object({
	start_date: z.string(),
	end_date: z.string(),
	reason: z.string().nullable().optional(),
});
export type HistoricCoverageGap = z.infer<typeof HistoricCoverageGapSchema>;

export const HistoricPartitionRefSchema = z.object({
	path: z.string(),
	coverage_start: z.string(),
	coverage_end: z.string(),
	count: z.number().int().min(0).nullable().optional(),
	sha256: z.string().nullable().optional(),
});
export type HistoricPartitionRef = z.infer<typeof HistoricPartitionRefSchema>;

export const HistoricCollectionIndexSchema = z.object({
	generated_utc: isoUtc(),
	family: z.string(),
	selection_mode: HistorySelectionModeSchema,
	entity_id: z.string().nullable().optional(),
	collection_generation_id: z.string().nullable().optional(),
	first_available_date: z.string().nullable().optional(),
	last_available_date: z.string().nullable().optional(),
	available_dates: z.array(z.string()).optional(),
	gaps: z.array(HistoricCoverageGapSchema).optional(),
	partitions: z.array(HistoricPartitionRefSchema).optional(),
	...payloadEnvelopeFields(),
});
export type HistoricCollectionIndex = z.infer<typeof HistoricCollectionIndexSchema>;

export const HistoricFamilyAvailabilitySchema = z.object({
	family: z.string(),
	selection_mode: HistorySelectionModeSchema,
	index_path: z.string(),
	first_available_date: z.string().nullable().optional(),
	last_available_date: z.string().nullable().optional(),
	gaps: z.array(HistoricCoverageGapSchema).optional(),
});
export type HistoricFamilyAvailability = z.infer<typeof HistoricFamilyAvailabilitySchema>;

export const HistoricAvailabilityIndexSchema = z.object({
	generated_utc: isoUtc(),
	families: z.array(HistoricFamilyAvailabilitySchema).optional(),
	...payloadEnvelopeFields(),
});
export type HistoricAvailabilityIndex = z.infer<typeof HistoricAvailabilityIndexSchema>;
