// receipts_index.ts — Zod mirror of historic_receipts_index.schema.json
// (title: "ReceiptsIndex"). The discovery index of published receipt dates:
// fetch {receipts_prefix}{date}.json for each date. Dates absent here either
// never had data (404 -> empty state) or are older archived receipts.

import { z } from 'zod';
import { isoUtc } from './types';

export const ReceiptsIndexSchema = z.object({
	generated_utc: isoUtc(),
	// ISO dates with a published receipt in the trailing 30-day build window,
	// ascending. Optional: absent when the index has not been built yet.
	dates: z.array(z.string()).optional(),
});
export type ReceiptsIndex = z.infer<typeof ReceiptsIndexSchema>;
