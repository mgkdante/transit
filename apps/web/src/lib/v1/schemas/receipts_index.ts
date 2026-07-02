// receipts_index.ts — Zod mirror of historic_receipts_index.schema.json
// (title: "ReceiptsIndex"). The discovery index of published receipt dates:
// fetch {receipts_prefix}{date}.json for each date. Dates absent here either
// never had data (404 -> empty state) or are older archived receipts.

import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

// S13 per-date availability metadata for the DateRangePicker. has_data = the receipt
// carries real reliability telemetry (vs an alerts-only shell); has_schedule = the day's
// scheduled universe is known. available[].date is a subset of dates.
export const ReceiptAvailabilitySchema = z.object({
	date: z.string(),
	has_data: z.boolean(),
	has_schedule: z.boolean().optional(),
	publish_generation_id: z.string().nullable().optional(),
});
export type ReceiptAvailability = z.infer<typeof ReceiptAvailabilitySchema>;

export const ReceiptsIndexSchema = z.object({
	generated_utc: isoUtc(),
	// ISO dates with a published receipt in the trailing 30-day build window,
	// ascending. Optional: absent when the index has not been built yet.
	dates: z.array(z.string()).optional(),
	// S13 additive-optional per-date availability (default absent on a pre-S13 index).
	available: z.array(ReceiptAvailabilitySchema).optional(),
	...payloadEnvelopeFields(),
});
export type ReceiptsIndex = z.infer<typeof ReceiptsIndexSchema>;
