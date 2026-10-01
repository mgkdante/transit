import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

export const ReceiptAvailabilitySchema = z.object({
	date: z.string(),
	has_data: z.boolean(),
	has_schedule: z.boolean().optional(),
	publish_generation_id: z.string().nullable().optional(),
});
export type ReceiptAvailability = z.infer<typeof ReceiptAvailabilitySchema>;

export const ReceiptsIndexSchema = z.object({
	generated_utc: isoUtc(),
	collection_generation_id: z.string().nullable().optional(),
	dates: z.array(z.string()).optional(),
	available: z.array(ReceiptAvailabilitySchema).optional(),
	...payloadEnvelopeFields(),
});
export type ReceiptsIndex = z.infer<typeof ReceiptsIndexSchema>;
